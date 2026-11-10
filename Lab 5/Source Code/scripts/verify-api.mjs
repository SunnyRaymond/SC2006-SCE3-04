import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

if (!process.argv.includes('--run')) {
  process.stdout.write('Usage: node scripts/verify-api.mjs --run\n');
  process.exit(0);
}

loadEnv({ path: path.resolve('credentials.env'), quiet: true });

const baseUrl = process.env.PLUGPLAN_API_BASE_URL || 'http://127.0.0.1:3000';
const outputPath = path.resolve('.local/api-verification.json');
const usersPath = path.resolve('.local/test-users.json');
const users = JSON.parse(await readFile(usersPath, 'utf8'));
const previous = await readFile(outputPath, 'utf8').then(JSON.parse).catch(() => null);
const runNumber = Number(previous?.runNumber ?? 0) + 1;
const loadUsers = Array.isArray(users.loadUsers) ? users.loadUsers : [];
if (loadUsers.length < 3) throw new Error('At least three disposable loadUsers accounts are required.');

const reportUsers = runNumber === 1
  ? { reporter: users.other, secondary: loadUsers.at(-2), cross: loadUsers.at(-1) }
  : (() => {
      const start = ((runNumber - 2) * 3) % loadUsers.length;
      return {
        reporter: loadUsers[start],
        secondary: loadUsers[(start + 1) % loadUsers.length],
        cross: loadUsers[(start + 2) % loadUsers.length],
      };
    })();
const accountRecords = {
  owner: users.other,
  driver: users.driver,
  moderator: users.moderator,
  reporter: reportUsers.reporter,
  secondary: reportUsers.secondary,
  cross: reportUsers.cross,
};

const results = {
  runNumber,
  runId: randomUUID(),
  startedAt: new Date().toISOString(),
  baseUrl,
  status: 'running',
  accounts: Object.fromEntries(Object.entries(accountRecords).map(([key, value]) => [key, { id: value?.id, role: value?.role }])),
  checks: [],
  live: [],
  officialStatus: [],
  artifacts: { planIds: [], reportIds: [] },
  failures: [],
};

async function persist() {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

function check(name, passed, details = {}) {
  results.checks.push({ name, passed: Boolean(passed), ...details });
  if (!passed) throw new Error(`CHECK_FAILED:${name}`);
}

function safeFailure(stage, error) {
  return { stage, errorType: error instanceof Error ? error.name : 'Error' };
}

function makeSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIGURATION_MISSING');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(account, logicalName) {
  if (!account?.email || !account?.password || !account?.id || !account?.role) throw new Error(`TEST_ACCOUNT_INVALID:${logicalName}`);
  const client = makeSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error || !data.session || data.user?.id !== account.id) throw new Error(`SIGN_IN_FAILED:${logicalName}`);
  return { client, token: data.session.access_token, userId: data.user.id, role: account.role };
}

async function responseWithToken(token, action, payload = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/app`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
      cache: 'no-store',
    });
    let body = null;
    try { body = await response.json(); } catch { /* Keep the result status without retaining a raw response. */ }
    return { status: response.status, body, cacheControl: response.headers.get('cache-control') };
  } finally {
    clearTimeout(timer);
  }
}

async function api(account, action, payload = {}, expectedStatus = 200) {
  const response = await responseWithToken(account.token, action, payload);
  check(`${action} status ${expectedStatus}`, response.status === expectedStatus, {
    status: response.status,
    ...(response.status !== expectedStatus ? { safeError: response.body?.error ?? null } : {}),
  });
  return response;
}

function noStore(name, response) {
  check(`${name} uses no-store`, response.cacheControl === 'no-store', { cacheControl: response.cacheControl });
}

function futureSingaporeTime() {
  return new Date(Date.now() + 60 * 60_000 + 8 * 60 * 60_000).toISOString().replace('Z', '+08:00');
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validProfile() {
  return {
    name: 'Integration EV', capacityKWh: 60, consumptionKWhPer100Km: 17.5,
    plugTypes: ['Combo 2', 'Type 2'], maxAcKw: 11, maxDcKw: 100,
    reserveSoc: 20, defaultDetourMinutes: 15, minChargerKw: 3, maxWalkingM: 0,
  };
}

function planInput() {
  return {
    origin: { label: 'Marina Bay Sands', lat: 1.2834, lng: 103.8607, postal: '018956' },
    destination: { label: 'Orchard Road', lat: 1.3048, lng: 103.8318, postal: '238858' },
    currentSoc: 18, departureAt: futureSingaporeTime(), maxChargingMinutes: 45,
    maxDetourMinutes: 15, strategy: 'BALANCED', manualTargetSoc: null,
  };
}

function reportDraft(stationId, category, connectorId = null) {
  return {
    stationId,
    stationName: `Integration ${stationId}`,
    connectorId,
    category,
    note: `Disposable API integration report ${results.runId}`,
  };
}

async function faultRows(account) {
  const { data, error } = await account.client.rpc('get_active_faults');
  if (error) throw new Error('GET_ACTIVE_FAULTS_FAILED');
  return (data ?? []).map(row => ({ stationId: row.station_id, reportId: row.report_id, expiresAt: row.expires_at }));
}

async function faultIds(account) {
  return new Set((await faultRows(account)).map(row => row.reportId));
}

async function uploadImage(account, pathName, contentType, bytes) {
  const { error } = await account.client.storage.from('issue-images').upload(pathName, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error('STORAGE_UPLOAD_FAILED');
}

async function imageExists(account, imagePath) {
  const [folder, name] = imagePath.split('/');
  const { data, error } = await account.client.storage.from('issue-images').list(folder, { search: name, limit: 20 });
  if (error) throw new Error('STORAGE_LIST_FAILED');
  return (data ?? []).some(file => file.name === name);
}

async function main() {
  let stage = 'sign-in';
  let owner;
  let driver;
  let moderator;
  let reporter;
  let secondary;
  let cross;
  let originalProfile = null;
  let originalProfileLoaded = false;
  let fixturePlanId = null;
  let livePlanId = null;
  let liveStatusContext = null;
  let profileWasSaved = false;

  try {
    const signed = new Map();
    for (const [key, account] of Object.entries(accountRecords)) {
      if (!signed.has(account.id)) signed.set(account.id, await signIn(account, key));
    }
    owner = signed.get(accountRecords.owner.id);
    driver = signed.get(accountRecords.driver.id);
    moderator = signed.get(accountRecords.moderator.id);
    reporter = signed.get(accountRecords.reporter.id);
    secondary = signed.get(accountRecords.secondary.id);
    cross = signed.get(accountRecords.cross.id);
    for (const [key, account] of Object.entries({ owner, driver, moderator, reporter, secondary, cross })) {
      const response = await api(account, 'bootstrap');
      check(`${key} role comes from app_users`, response.body?.user?.role === account.role, { role: response.body?.user?.role });
      if (key === 'owner') {
        noStore('bootstrap', response);
        originalProfile = response.body.profile;
        originalProfileLoaded = true;
      }
    }

    stage = 'profile-and-place-search';
    const badProfile = { ...validProfile(), capacityKWh: 0 };
    const invalidProfile = await responseWithToken(owner.token, 'profile.save', { profile: badProfile });
    check('profile.save returns field errors', invalidProfile.status === 400 && Boolean(invalidProfile.body?.fields?.capacityKWh), {
      status: invalidProfile.status,
      fieldKeys: Object.keys(invalidProfile.body?.fields ?? {}),
    });
    const injectedProfile = await responseWithToken(owner.token, 'profile.save', { profile: { ...validProfile(), role: 'MODERATOR' } });
    check('profile.save rejects client role injection', injectedProfile.status === 400, { status: injectedProfile.status });
    const savedProfile = await api(owner, 'profile.save', { profile: validProfile() });
    profileWasSaved = true;
    check('profile.save preserves requested EV values', sameJson(savedProfile.body.profile, validProfile()), {
      capacityKWh: savedProfile.body.profile?.capacityKWh,
      consumptionKWhPer100Km: savedProfile.body.profile?.consumptionKWhPer100Km,
      plugTypes: savedProfile.body.profile?.plugTypes,
    });
    const places = await api(owner, 'places.search', { query: 'Marina', mode: 'DEMO_FIXTURE' });
    check('places.search returns selectable address and coordinates', Array.isArray(places.body.places)
      && places.body.places.some(place => typeof place.address === 'string' && Number.isFinite(place.lat) && Number.isFinite(place.lng)), {
      count: places.body.places?.length ?? 0,
    });

    stage = 'plan-crud';
    const input = planInput();
    const create = await api(owner, 'plan.create', { input, mode: 'DEMO_FIXTURE' });
    fixturePlanId = create.body.plan?.id;
    if (fixturePlanId) results.artifacts.planIds.push(fixturePlanId);
    const planV1 = create.body.plan?.versions?.[0];
    check('fixture plan is visibly labeled and versioned', Boolean(fixturePlanId && planV1)
      && planV1.number === 1 && planV1.result.snapshot.state === 'DEMO_FIXTURE'
      && String(planV1.result.snapshot.source).includes('DEMO_FIXTURE'), {
      planId: fixturePlanId,
      versionCount: create.body.plan?.versions?.length ?? 0,
      state: planV1?.result?.snapshot?.state,
      recommendationCount: planV1?.result?.recommendations?.length ?? 0,
    });
    check('default 60kWh Combo 2/Type 2 profile yields selectable recommendations', (planV1?.result?.recommendations?.length ?? 0) > 0, {
      recommendationCount: planV1?.result?.recommendations?.length ?? 0,
    });
    const selectedId = planV1.result.recommendations[0].id;
    const selected = await api(owner, 'plan.select', { planId: fixturePlanId, recommendationId: selectedId });
    check('plan.select updates the selection pointer', selected.body.plan?.selectedRecommendationId === selectedId, {
      selected: selected.body.plan?.selectedRecommendationId,
    });
    const v1AfterSelect = selected.body.plan.versions.find(version => version.id === planV1.id);
    check('plan.select leaves the saved version immutable', sameJson(v1AfterSelect, planV1));

    const otherInput = { ...input, maxChargingMinutes: 50 };
    const reconfigured = await api(owner, 'plan.reconfigure', { planId: fixturePlanId, input: otherInput, mode: 'DEMO_FIXTURE' });
    const planV2 = reconfigured.body.plan?.versions?.find(version => version.number === 2);
    check('plan.reconfigure appends a new immutable version', Boolean(planV2)
      && reconfigured.body.plan.currentVersionId === planV2.id
      && sameJson(reconfigured.body.plan.versions.find(version => version.id === planV1.id), planV1), {
      versionNumbers: reconfigured.body.plan?.versions?.map(version => version.number),
    });

    const foreignDelete = await responseWithToken(cross.token, 'plan.delete', { planId: fixturePlanId });
    check('cross-user plan deletion is denied without mutation', foreignDelete.status === 404, { status: foreignDelete.status });
    const ownerState = await api(owner, 'bootstrap');
    const ownedPlan = ownerState.body.plans?.find(plan => plan.id === fixturePlanId);
    check('cross-user denial preserves owner plan', Boolean(ownedPlan && ownedPlan.versions.length === 2));

    const refreshedFixture = await api(owner, 'plan.refresh', { planId: fixturePlanId, mode: 'DEMO_FIXTURE' });
    const planV3 = refreshedFixture.body.plan?.versions?.find(version => version.number === 3);
    check('plan.refresh appends a fixture version and explains its source', Boolean(planV3)
      && refreshedFixture.body.plan.currentVersionId === planV3.id
      && /demo fixture/i.test(refreshedFixture.body.fallbackMessage ?? '')
      && sameJson(refreshedFixture.body.plan.versions.find(version => version.id === planV1.id), planV1)
      && sameJson(refreshedFixture.body.plan.versions.find(version => version.id === planV2.id), planV2), {
      versionNumbers: refreshedFixture.body.plan?.versions?.map(version => version.number),
      fallbackMessage: refreshedFixture.body.fallbackMessage,
    });

    stage = 'live-cold-warm';
    const beforeLive = await api(owner, 'bootstrap');
    const beforeLivePlanIds = new Set((beforeLive.body.plans ?? []).map(plan => plan.id));
    let coldStatus;
    let coldBody;
    const coldStarted = performance.now();
    try {
      const cold = await responseWithToken(owner.token, 'plan.create', { input, mode: 'LIVE' }, 12_000);
      coldStatus = cold.status;
      coldBody = cold.body;
    } catch (error) {
      coldStatus = 0;
      coldBody = null;
    }
    const coldMs = Math.round(performance.now() - coldStarted);
    if (coldStatus === 200 && coldBody?.plan?.id) {
      livePlanId = coldBody.plan.id;
      results.artifacts.planIds.push(livePlanId);
      const version = coldBody.plan.versions?.find(item => item.id === coldBody.plan.currentVersionId);
      const recommendation = version?.result?.recommendations?.[0];
      const excludedStation = version?.result?.excluded?.[0];
      if (recommendation) liveStatusContext = {
        stationId: recommendation.stationId, stationName: recommendation.stationName, connectorId: recommendation.connectorId,
      };
      else if (excludedStation) liveStatusContext = {
        stationId: excludedStation.stationId, stationName: excludedStation.stationName, connectorId: null,
      };
      const realLiveSnapshot = ['LIVE', 'CACHED', 'STALE'].includes(version?.result?.snapshot?.state)
        && version?.result?.snapshot?.source === 'LTA DataMall'
        && Number.isFinite(version?.result?.directRoute?.distanceKm);
      check('LIVE cold create uses actual non-fixture provider data', realLiveSnapshot, {
        state: version?.result?.snapshot?.state,
        source: version?.result?.snapshot?.source,
        recommendationCount: version?.result?.recommendations?.length ?? 0,
      });
      results.live.push({ phase: 'cold-create', status: coldStatus, durationMs: coldMs, outcome: 'created', state: version?.result?.snapshot?.state });
    } else {
      const errorStatusAllowed = [400, 503, 504].includes(coldStatus);
      check('LIVE cold failure is explicit and does not create a plan', errorStatusAllowed, {
        status: coldStatus,
        safeError: coldBody?.error ?? null,
      });
      const afterCold = await api(owner, 'bootstrap');
      check('LIVE cold failure leaves saved plan set unchanged', (afterCold.body.plans ?? []).every(plan => beforeLivePlanIds.has(plan.id))
        && (afterCold.body.plans ?? []).length === beforeLivePlanIds.size, {
        planCountBefore: beforeLivePlanIds.size,
        planCountAfter: afterCold.body.plans?.length ?? 0,
      });
      results.live.push({ phase: 'cold-create', status: coldStatus, durationMs: coldMs, outcome: 'explicit-provider-failure', safeError: coldBody?.error ?? null });
    }
    results.live.at(-1).within5s = coldMs <= 5_000;
    await persist();

    if (livePlanId) {
      const cachedBeforeResponse = await api(owner, 'bootstrap');
      const cachedBefore = cachedBeforeResponse.body.plans.find(plan => plan.id === livePlanId);
      const cachedBeforeVersion = cachedBefore?.versions?.find(version => version.id === cachedBefore.currentVersionId);
      const cachedBeforeSnapshot = cachedBeforeVersion?.result?.snapshot;
      if (cachedBeforeSnapshot?.source === 'LTA DataMall' && ['LIVE', 'CACHED'].includes(cachedBeforeSnapshot.state)) {
        const immutableVersions = structuredClone(cachedBefore.versions);
        const timestampEvidence = snapshot => ({
          observedAt: snapshot?.observedAt,
          retrievedAt: snapshot?.retrievedAt,
          detailsRetrievedAt: snapshot?.detailsRetrievedAt ?? null,
        });
        const originalTimestamps = timestampEvidence(cachedBeforeSnapshot);
        const reconfigureStarted = performance.now();
        const cachedReconfigure = await responseWithToken(owner.token, 'plan.reconfigure', {
          planId: livePlanId,
          input: { ...input, maxChargingMinutes: 50 },
          mode: 'LIVE',
        }, 12_000);
        const reconfigureMs = Math.round(performance.now() - reconfigureStarted);
        const reconfiguredPlan = cachedReconfigure.body?.plan;
        const reconfiguredVersion = reconfiguredPlan?.versions?.find(version => version.id === reconfiguredPlan.currentVersionId);
        const reconfiguredSnapshot = reconfiguredVersion?.result?.snapshot;
        check('LIVE reconfigure reuses fresh route cache without provider refresh', cachedReconfigure.status === 200
          && reconfiguredSnapshot?.source === 'LTA DataMall'
          && reconfiguredSnapshot?.state === 'CACHED'
          && reconfiguredVersion?.result?.inputs?.maxChargingMinutes === 50
          && sameJson(timestampEvidence(reconfiguredSnapshot), originalTimestamps), {
          status: cachedReconfigure.status,
          state: reconfiguredSnapshot?.state,
          durationMs: reconfigureMs,
          safeError: cachedReconfigure.body?.error ?? null,
        });
        check('LIVE cached reconfigure preserves previous plan versions', immutableVersions.every(old =>
          sameJson(reconfiguredPlan?.versions?.find(version => version.id === old.id), old)), {
          oldVersionCount: immutableVersions.length,
          newVersionCount: reconfiguredPlan?.versions?.length ?? 0,
        });
        results.live.push({ phase: 'cached-reconfigure', status: cachedReconfigure.status, durationMs: reconfigureMs, outcome: 'cached', state: reconfiguredSnapshot?.state, within5s: reconfigureMs <= 5_000 });
      } else {
        results.live.push({
          phase: 'cached-reconfigure', outcome: 'skipped',
          reason: cachedBeforeSnapshot?.state === 'STALE' ? 'live snapshot is stale' : 'cold LIVE create did not produce a reusable live snapshot',
          state: cachedBeforeSnapshot?.state ?? null,
        });
      }
      await persist();
    }

    const warmTargetId = livePlanId ?? fixturePlanId;
    const warmBeforeResponse = await api(owner, 'bootstrap');
    const warmBefore = warmBeforeResponse.body.plans.find(plan => plan.id === warmTargetId);
    const oldVersions = structuredClone(warmBefore.versions);
    const warmStarted = performance.now();
    let warm;
    try {
      warm = await responseWithToken(owner.token, 'plan.refresh', { planId: warmTargetId, mode: 'LIVE' }, 12_000);
    } catch {
      warm = { status: 0, body: null };
    }
    const warmMs = Math.round(performance.now() - warmStarted);
    if (warm.status === 200) {
      const warmPlan = warm.body.plan;
      const current = warmPlan?.versions?.find(item => item.id === warmPlan.currentVersionId);
      check('LIVE warm refresh stores only non-fixture result data', Boolean(current)
        && ['LIVE', 'CACHED', 'STALE'].includes(current.result.snapshot.state)
        && current.result.snapshot.source === 'LTA DataMall', {
        state: current?.result?.snapshot?.state,
        source: current?.result?.snapshot?.source,
        versionCount: warmPlan?.versions?.length ?? 0,
        fallbackMessage: warm.body.fallbackMessage,
      });
      check('LIVE warm refresh preserves older plan versions', oldVersions.every(old => sameJson(warmPlan.versions.find(item => item.id === old.id), old)), {
        oldVersionCount: oldVersions.length,
        newVersionCount: warmPlan?.versions?.length ?? 0,
      });
      results.live.push({ phase: 'warm-refresh', status: warm.status, durationMs: warmMs, outcome: 'refreshed', state: current?.result?.snapshot?.state });
    } else {
      const warmAfterResponse = await api(owner, 'bootstrap');
      const warmAfter = warmAfterResponse.body.plans.find(plan => plan.id === warmTargetId);
      check('LIVE warm failure is explicit and preserves prior plan versions', [400, 503, 504].includes(warm.status)
        && sameJson(warmAfter?.versions, oldVersions), {
        status: warm.status,
        safeError: warm.body?.error ?? null,
        versionCountBefore: oldVersions.length,
        versionCountAfter: warmAfter?.versions?.length ?? 0,
      });
      results.live.push({ phase: 'warm-refresh', status: warm.status, durationMs: warmMs, outcome: 'explicit-provider-failure', safeError: warm.body?.error ?? null });
    }
    results.live.at(-1).within5s = warmMs <= 5_000;
    await persist();

    stage = 'reports-images-and-moderation';
    const faultStationId = `int-fault-${results.runId}`;
    const fault = await api(reporter, 'report.create', {
      ...reportDraft(faultStationId, 'SUSPECTED_FAULTY_CONNECTOR', 'fault-port'),
    });
    const faultReport = fault.body.report;
    results.artifacts.reportIds.push(faultReport.id);
    check('report.create accepts a server-side issue draft', faultReport.status === 'PENDING' && faultReport.revision === 1, {
      status: faultReport.status,
      revision: faultReport.revision,
    });
    const pendingFaults = await faultIds(reporter);
    check('pending faulty report is excluded from active fault RPC', !pendingFaults.has(faultReport.id));

    const missingReason = await responseWithToken(moderator.token, 'report.moderate', {
      reportId: faultReport.id, moderationAction: 'VERIFY', expectedRevision: 1,
    });
    check('moderator reason validation returns 400', missingReason.status === 400 && Boolean(missingReason.body?.fields?.reason), {
      status: missingReason.status,
      fieldKeys: Object.keys(missingReason.body?.fields ?? {}),
    });
    for (const moderationAction of ['VERIFY', 'REJECT', 'MERGE', 'RESOLVE', 'EXPIRE']) {
      const denied = await responseWithToken(driver.token, 'report.moderate', {
        moderationAction,
        reportId: faultReport.id, reason: '', expectedRevision: 0,
        role: 'MODERATOR',
      });
      check(`Driver is denied moderation action ${moderationAction} before payload validation`, denied.status === 403, {
        status: denied.status,
      });
    }

    const verifiedFault = await api(moderator, 'report.moderate', {
      reportId: faultReport.id, moderationAction: 'VERIFY', reason: 'Integration verify', expectedRevision: 1,
    });
    check('VERIFY moves a report to a verified active fault', verifiedFault.body.report.status === 'VERIFIED'
      && verifiedFault.body.report.revision === 2, { status: verifiedFault.body.report.status });
    const activeAfterVerify = await faultIds(reporter);
    check('verified faulty report appears in active faults', activeAfterVerify.has(faultReport.id));
    const staleRevision = await responseWithToken(moderator.token, 'report.moderate', {
      reportId: faultReport.id, moderationAction: 'RESOLVE', reason: 'Stale revision check', expectedRevision: 1,
    });
    check('stale moderation revision returns 409', staleRevision.status === 409, { status: staleRevision.status });

    const badImagePath = `${reporter.userId}/${randomUUID()}.jpg`;
    await uploadImage(reporter, badImagePath, 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const badImage = await responseWithToken(reporter.token, 'report.create', {
      ...reportDraft(`int-bad-image-${results.runId}`, 'BLOCKED_BAY'), imagePath: badImagePath,
    });
    check('image MIME must match its extension', badImage.status === 400, { status: badImage.status });
    check('failed image validation deletes the new orphan upload', !(await imageExists(reporter, badImagePath)));

    const goodImagePath = `${reporter.userId}/${randomUUID()}.jpg`;
    await uploadImage(reporter, goodImagePath, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const imageReportResult = await api(reporter, 'report.create', {
      ...reportDraft(`int-image-${results.runId}`, 'ACCESS_PROBLEM'), imagePath: goodImagePath,
    });
    const imageReport = imageReportResult.body.report;
    results.artifacts.reportIds.push(imageReport.id);
    check('JPEG image is associated with the report', imageReport.imagePath === goodImagePath, { imagePathExtension: 'jpg' });
    const imageUrl = await api(moderator, 'report.image-url', { reportId: imageReport.id });
    check('moderator can obtain an authorized signed report image URL', typeof imageUrl.body.url === 'string'
      && /^https?:\/\//.test(imageUrl.body.url));
    const foreignImageUrl = await responseWithToken(cross.token, 'report.image-url', { reportId: imageReport.id });
    check('cross-user report image access is denied', foreignImageUrl.status === 404, { status: foreignImageUrl.status });

    const mergeStationId = `int-merge-${results.runId}`;
    const mergeSourceResponse = await api(reporter, 'report.create', {
      ...reportDraft(mergeStationId, 'SUSPECTED_FAULTY_CONNECTOR', 'merge-port-a'),
    });
    const mergeSource = mergeSourceResponse.body.report;
    results.artifacts.reportIds.push(mergeSource.id);
    const mergeTargetResponse = await api(secondary, 'report.create', {
      ...reportDraft(mergeStationId, 'SUSPECTED_FAULTY_CONNECTOR', 'merge-port-b'),
    });
    const mergeTarget = mergeTargetResponse.body.report;
    results.artifacts.reportIds.push(mergeTarget.id);
    check('different connector reports are separately accepted for merge', mergeSource.id !== mergeTarget.id
      && mergeSource.status === 'PENDING' && mergeTarget.status === 'PENDING', {
      sourceId: mergeSource.id,
      targetId: mergeTarget.id,
    });
    await api(moderator, 'report.moderate', {
      reportId: mergeSource.id, moderationAction: 'VERIFY', reason: 'Integration source support', expectedRevision: 1,
    });
    await api(moderator, 'report.moderate', {
      reportId: mergeTarget.id, moderationAction: 'VERIFY', reason: 'Integration canonical support', expectedRevision: 1,
    });
    const mergeSupports = (await faultRows(reporter)).filter(row => row.stationId === mergeStationId);
    check('separate verified reports provide separate fault supports', mergeSupports.length === 2
      && new Set(mergeSupports.map(row => row.reportId)).size === 2, { activeSupportCount: mergeSupports.length });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const duplicate = await api(reporter, 'report.create', {
        ...reportDraft(mergeStationId, 'SUSPECTED_FAULTY_CONNECTOR', 'merge-port-a'),
      });
      check(`same active issue is deduplicated (${attempt})`, duplicate.body.duplicate === true
        && duplicate.body.report.id === mergeSource.id, { duplicate: duplicate.body.duplicate });
    }
    const rateLimited = await responseWithToken(reporter.token, 'report.create', {
      ...reportDraft(`int-rate-${results.runId}`, 'INCORRECT_LOCATION'),
    });
    check('sixth report submission in an hour returns 429 with retryAfter', rateLimited.status === 429
      && Number.isFinite(rateLimited.body?.retryAfter) && rateLimited.body.retryAfter > 0, {
      status: rateLimited.status,
      retryAfter: rateLimited.body?.retryAfter,
    });

    const merged = await api(moderator, 'report.moderate', {
      reportId: mergeSource.id, moderationAction: 'MERGE', reason: 'Integration merge',
      expectedRevision: 2, mergeTargetId: mergeTarget.id,
    });
    check('MERGE points to a canonical target without collapsing either report', merged.body.report.status === 'MERGED'
      && merged.body.report.mergedIntoId === mergeTarget.id
      && mergeTarget.id !== mergeSource.id, {
      status: merged.body.report.status,
      mergedIntoId: merged.body.report.mergedIntoId,
    });
    const mergedSupports = (await faultRows(reporter)).filter(row => row.stationId === mergeStationId);
    check('MERGE keeps one canonical active fault support', mergedSupports.length === 1
      && mergedSupports[0].reportId === mergeTarget.id, {
      activeSupportCount: mergedSupports.length,
      canonicalReportKept: mergedSupports[0]?.reportId === mergeTarget.id,
    });
    const rejectedImage = await api(moderator, 'report.moderate', {
      reportId: imageReport.id, moderationAction: 'REJECT', reason: 'Integration reject', expectedRevision: 1,
    });
    check('REJECT moves a pending image report to rejected', rejectedImage.body.report.status === 'REJECTED', {
      status: rejectedImage.body.report.status,
    });
    const resolvedTarget = await api(moderator, 'report.moderate', {
      reportId: mergeTarget.id, moderationAction: 'RESOLVE', reason: 'Close merged integration fault', expectedRevision: 2,
    });
    check('canonical merge target can be resolved to withdraw fault support', resolvedTarget.body.report.status === 'RESOLVED'
      && !(await faultRows(reporter)).some(row => row.stationId === mergeStationId), {
      status: resolvedTarget.body.report.status,
    });

    const expiringStationId = faultStationId;
    const expiringResponse = await api(secondary, 'report.create', {
      ...reportDraft(expiringStationId, 'SUSPECTED_FAULTY_CONNECTOR', 'expire-port'),
    });
    const expiring = expiringResponse.body.report;
    results.artifacts.reportIds.push(expiring.id);
    check('second pending faulty report is excluded', !(await faultIds(secondary)).has(expiring.id));
    const verifiedToExpire = await api(moderator, 'report.moderate', {
      reportId: expiring.id, moderationAction: 'VERIFY', reason: 'Integration verify before expiry', expectedRevision: 1,
    });
    const sharedSupports = (await faultRows(secondary)).filter(row => row.stationId === faultStationId);
    check('second verified fault adds independent support at the same station', verifiedToExpire.body.report.status === 'VERIFIED'
      && sharedSupports.length === 2 && sharedSupports.some(row => row.reportId === faultReport.id)
      && sharedSupports.some(row => row.reportId === expiring.id), { activeSupportCount: sharedSupports.length });
    const resolvedFault = await api(moderator, 'report.moderate', {
      reportId: faultReport.id, moderationAction: 'RESOLVE', reason: 'Integration resolve one of two supports', expectedRevision: 2,
    });
    const supportAfterResolve = (await faultRows(secondary)).filter(row => row.stationId === faultStationId);
    check('RESOLVE withdraws one support while another verified fault remains', resolvedFault.body.report.status === 'RESOLVED'
      && supportAfterResolve.length === 1 && supportAfterResolve[0].reportId === expiring.id, {
      remainingSupport: supportAfterResolve[0]?.reportId ?? null,
    });
    const expired = await api(moderator, 'report.moderate', {
      reportId: expiring.id, moderationAction: 'EXPIRE', reason: 'Integration expire', expectedRevision: 2,
    });
    check('EXPIRE withdraws the final verified fault support', expired.body.report.status === 'EXPIRED'
      && !(await faultRows(secondary)).some(row => row.stationId === faultStationId), { status: expired.body.report.status });

    if (liveStatusContext) {
      const officialStatusReportResponse = await api(secondary, 'report.create', {
        ...reportDraft(liveStatusContext.stationId, 'INCORRECT_LOCATION', liveStatusContext.connectorId),
      });
      const officialStatusReport = officialStatusReportResponse.body.report;
      results.artifacts.reportIds.push(officialStatusReport.id);
      const officialList = await api(moderator, 'reports.list');
      const statusReport = officialList.body.reports.find(report => report.id === officialStatusReport.id);
      const officialStatus = statusReport?.officialStatus ?? '';
      check('moderator report includes cached official connector status and source times', /LTA DataMall/i.test(officialStatus)
        && /Detail retrieved/i.test(officialStatus) && /batch source time/i.test(officialStatus), {
        statusText: officialStatus,
      });
      const rejectedStatusReport = await api(moderator, 'report.moderate', {
        reportId: officialStatusReport.id, moderationAction: 'REJECT', reason: 'Close official-status integration record', expectedRevision: 1,
      });
      results.officialStatus.push({ outcome: 'cached-status-returned', status: rejectedStatusReport.body.report.status, text: officialStatus });
    } else {
      results.officialStatus.push({ outcome: 'skipped', reason: 'cold LIVE snapshot contained no station connector to inspect' });
    }

    const reporterReports = await api(reporter, 'reports.list');
    check('Driver report list is scoped to its own records', reporterReports.body.reports.every(report => report.userId === reporter.userId)
      && reporterReports.body.reports.some(report => report.id === faultReport.id), {
      count: reporterReports.body.reports.length,
    });
    const crossReports = await api(cross, 'reports.list');
    check('another Driver cannot list the reporter records', crossReports.body.reports.every(report => report.userId === cross.userId)
      && !crossReports.body.reports.some(report => report.id === faultReport.id), {
      count: crossReports.body.reports.length,
    });

    const moderatorReports = await api(moderator, 'reports.list');
    const testReportIds = new Set(results.artifacts.reportIds);
    const visibleReports = (moderatorReports.body.reports ?? []).filter(report => testReportIds.has(report.id));
    check('moderator report list includes test records and moderation decisions', visibleReports.length === testReportIds.size
      && visibleReports.some(report => report.id === faultReport.id && report.decisions?.length >= 2), {
      expected: testReportIds.size,
      actual: visibleReports.length,
      faultDecisionCount: visibleReports.find(report => report.id === faultReport.id)?.decisions?.length ?? 0,
    });

    const profileDelete = await api(owner, 'profile.delete');
    const afterProfileDelete = await api(owner, 'bootstrap');
    check('profile.delete removes the stored profile', profileDelete.body.ok === true && afterProfileDelete.body.profile === null);
    const planWithoutProfile = await responseWithToken(owner.token, 'plan.create', { input, mode: 'DEMO_FIXTURE' });
    check('plan.create requires a profile and does not create a partial plan', planWithoutProfile.status === 400
      && Boolean(planWithoutProfile.body?.fields?.profile), { status: planWithoutProfile.status });

    stage = 'logout-revocation';
    const oldToken = cross.token;
    const logout = await api(cross, 'session.logout');
    check('session.logout acknowledges server-side revocation', logout.body.ok === true);
    const revokedTokenAttempt = await responseWithToken(oldToken, 'bootstrap');
    check('revoked JWT is rejected by the next API request', revokedTokenAttempt.status === 401, {
      status: revokedTokenAttempt.status,
    });
    await cross.client.auth.signOut();
    results.status = 'completed';
  } catch (error) {
    results.failures.push(safeFailure(stage, error));
    results.status = 'failed';
  } finally {
    try {
      if (owner && livePlanId) {
        const deleted = await responseWithToken(owner.token, 'plan.delete', { planId: livePlanId });
        results.checks.push({ name: 'cleanup deletes integration LIVE plan', passed: deleted.status === 200, status: deleted.status });
      }
      if (owner && fixturePlanId) {
        const deleted = await responseWithToken(owner.token, 'plan.delete', { planId: fixturePlanId });
        results.checks.push({ name: 'cleanup deletes integration fixture plan', passed: deleted.status === 200, status: deleted.status });
      }
      if (owner && originalProfileLoaded) {
        const restored = originalProfile
          ? await responseWithToken(owner.token, 'profile.save', { profile: originalProfile })
          : await responseWithToken(owner.token, 'profile.delete');
        const pass = restored.status === 200;
        results.checks.push({ name: 'cleanup restores prior profile state', passed: pass, status: restored.status });
      }
    } catch (error) {
      results.failures.push(safeFailure('cleanup', error));
      results.status = 'failed';
    }
    if (results.checks.some(item => item.passed === false) || results.failures.length > 0) results.status = 'failed';
    results.finishedAt = new Date().toISOString();
    await persist();
  }

  const summary = {
    runNumber: results.runNumber,
    status: results.status,
    passed: results.checks.filter(item => item.passed).length,
    failed: results.checks.filter(item => !item.passed).length,
    failureStages: results.failures.map(item => item.stage),
    live: results.live,
    resultFile: path.relative(process.cwd(), outputPath),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (results.status !== 'completed') process.exitCode = 1;
}

await main();
