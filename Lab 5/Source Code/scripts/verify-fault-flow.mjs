#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

const args = process.argv.slice(2);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/verify-fault-flow.mjs --run';

if (args.length === 1 && args[0] === '--self-check') {
  assert.equal(selectionFallbackIsValid({
    selectedRecommendationId: null,
    versions: [{ id: 'v1', number: 1, result: {
      summary: 'Next alternative: Alternative station, connector C-2. Select it to continue.',
      recommendations: [{ id: 'alternate', stationId: 'other', stationName: 'Alternative station', connectorId: 'C-2' }],
    } }], currentVersionId: 'v1',
  }, 'faulted', 'Next alternative: Alternative station, connector C-2. Select it to continue.'), true);
  assert.equal(selectionFallbackIsValid({
    selectedRecommendationId: 'faulted-rec',
    versions: [{ id: 'v1', number: 1, result: { recommendations: [{ id: 'faulted-rec', stationId: 'faulted' }] } }],
    currentVersionId: 'v1',
  }, 'faulted', 'Choose an available alternative.'), false);
  assert.equal(selectionFallbackIsValid({
    selectedRecommendationId: null,
    versions: [{ id: 'v1', number: 1, result: { summary: 'No fallback is available because no recommendation remains.', recommendations: [] } }],
    currentVersionId: 'v1',
  }, 'faulted', 'No fallback is available because no recommendation remains.'), true);
  process.stdout.write('Fault-flow self-check passed.\n');
  process.exit(0);
}

if (args.length !== 1 || args[0] !== '--run') {
  process.stdout.write(`${usage}\n`);
  process.exit(args.length === 0 ? 0 : 1);
}

loadEnv({ path: path.join(projectRoot, 'credentials.env'), quiet: true });

const baseUrl = process.env.PLUGPLAN_API_BASE_URL || 'http://127.0.0.1:3000';
const usersPath = path.join(projectRoot, '.local', 'test-users.json');
const outputPath = path.join(projectRoot, '.local', 'fault-flow.json');
const runMarker = randomUUID();
const baseProfile = {
  name: 'Fault flow disposable vehicle', capacityKWh: 60, consumptionKWhPer100Km: 17.5,
  plugTypes: ['Combo2', 'Type 2'], maxAcKw: 11, maxDcKw: 100,
  reserveSoc: 20, defaultDetourMinutes: 15, minChargerKw: 3, maxWalkingM: 0,
};
const profileInput = {
  origin: { label: 'Marina Bay Sands', lat: 1.2834, lng: 103.8607, postal: '018956' },
  destination: { label: `Fault-flow-${runMarker.slice(0, 8)}`, lat: 1.3048, lng: 103.8318, postal: '238858' },
  currentSoc: 18, departureAt: new Date(Date.now() + 60 * 60_000 + 8 * 60 * 60_000).toISOString().replace('Z', '+08:00'),
  maxChargingMinutes: 45, maxDetourMinutes: 15, strategy: 'BALANCED', manualTargetSoc: null,
};

function currentVersion(plan) {
  return plan?.versions?.find(version => version.id === plan.currentVersionId)
    ?? [...(plan?.versions ?? [])].sort((a, b) => Number(b.number) - Number(a.number))[0]
    ?? null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function selectionFallbackIsValid(plan, faultedStationId, fallbackMessage) {
  const currentResult = currentVersion(plan)?.result;
  const recommendations = currentResult?.recommendations ?? [];
  const summary = currentResult?.summary ?? '';
  if (plan?.selectedRecommendationId !== null || recommendations.some(item => item.stationId === faultedStationId)) return false;
  if (recommendations.length === 0) {
    return /No fallback is available because no recommendation remains/i.test(summary)
      && /No fallback is available because no recommendation remains/i.test(fallbackMessage ?? '');
  }
  const alternative = recommendations[0];
  const choice = `Next alternative: ${alternative.stationName}, connector ${alternative.connectorId}. Select it to continue.`;
  return summary.includes(choice) && String(fallbackMessage ?? '').includes(choice);
}

function validOutputEnvelope(run, history) {
  return { schemaVersion: 1, history, run };
}

let history = [];
try {
  const previous = JSON.parse(await readFile(outputPath, 'utf8'));
  history = Array.isArray(previous.history) ? previous.history : [];
  if (previous.run && typeof previous.run === 'object') history.push(previous.run);
} catch { /* First run or no previous verification record. */ }
history = history.slice(-20);

const result = {
  startedAt: new Date().toISOString(),
  mode: 'DEMO_FIXTURE_SYNTHETIC_FAULTS',
  status: 'RUNNING',
  checks: [],
  stages: {},
  cleanup: { plansDeleted: 0, reportsClosed: 0, failures: 0 },
  failureCode: null,
};

const ownedPlanIds = new Set();
const planTitles = new Set([profileInput.destination.label]);
const reportSpecs = [];
const ownReportIds = new Set();
let driver;
let moderator;
let accountId;
let savedProfile;
let profileRead = false;
let profileMayHaveChanged = false;
let faultStationId;
let reportSubmissionAttempted = false;

function check(name, passed, details = {}) {
  result.checks.push({ name, passed: Boolean(passed), ...details });
  if (!passed) throw new Error(`CHECK_FAILED:${name}`);
}

function markFailure(error, stage) {
  result.status = 'FAILED';
  result.failureCode = error instanceof Error && /^[A-Z0-9_.:-]+$/.test(error.message)
    ? error.message.slice(0, 120)
    : `FAILED_${stage.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function supabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIGURATION_MISSING');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function signIn(account, expectedRole) {
  if (!account?.email || !account?.password || !account?.id || String(account.role).toUpperCase() !== expectedRole) {
    throw new Error(`${expectedRole}_ACCOUNT_INVALID`);
  }
  const client = supabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error || !data.session?.access_token || data.user?.id !== account.id) throw new Error(`${expectedRole}_SIGN_IN_FAILED`);
  return { client, token: data.session.access_token, userId: data.user.id };
}

async function request(account, action, payload = {}) {
  const response = await fetch(new URL('/api/app', baseUrl), {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, action }),
  });
  let body = null;
  try { body = await response.json(); } catch { /* Keep no response content in the verification file. */ }
  return { status: response.status, body };
}

async function api(account, action, payload = {}) {
  const response = await request(account, action, payload);
  check(`${action} returns 200`, response.status === 200, { httpStatus: response.status });
  return response.body;
}

function recordPlan(prefix, plan) {
  if (plan?.id) ownedPlanIds.add(plan.id);
  if (prefix) result.stages[prefix] = { httpStatus: 200, versionCount: plan?.versions?.length ?? 0 };
}

async function activeFaultRows() {
  const { data, error } = await driver.client.rpc('get_active_faults');
  if (error) throw new Error('ACTIVE_FAULT_LOOKUP_FAILED');
  return (data ?? []).map(row => ({ stationId: row.station_id, reportId: row.report_id }));
}

async function saveResult() {
  result.finishedAt = new Date().toISOString();
  result.summary = {
    passed: result.checks.filter(item => item.passed).length,
    failed: result.checks.filter(item => !item.passed).length,
    total: result.checks.length,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(validOutputEnvelope(result, history), null, 2)}\n`, 'utf8');
}

async function closeOwnReports() {
  if (!moderator || !accountId || !reportSubmissionAttempted) return;
  let reports;
  try {
    const list = await request(moderator, 'reports.list');
    if (list.status === 200 && Array.isArray(list.body?.reports)) reports = list.body.reports;
  } catch { /* The failure is recorded below when cleanup cannot be confirmed. */ }
  if (!reports) {
    result.cleanup.failures += 1;
    return;
  }

  for (const spec of reportSpecs) {
    const found = reports.find(report => report.userId === accountId
      && report.stationId === spec.stationId && report.connectorId === spec.connectorId
      && report.note?.includes(runMarker));
    if (!found) continue;
    ownReportIds.add(found.id);
    if (!['PENDING', 'VERIFIED'].includes(found.status)) continue;
    try {
      const action = found.status === 'PENDING' ? 'REJECT' : 'RESOLVE';
      const response = await request(moderator, 'report.moderate', {
        reportId: found.id, moderationAction: action,
        reason: 'Close synthetic fault-flow verification evidence.', expectedRevision: found.revision,
      });
      if (response.status === 200) result.cleanup.reportsClosed += 1;
      else result.cleanup.failures += 1;
    } catch { result.cleanup.failures += 1; }
  }
  if (ownReportIds.size > 0) {
    try {
      const active = await activeFaultRows();
      result.cleanup.activeOwnFaultSupportsRemaining = active.filter(row => ownReportIds.has(row.reportId)).length;
      if (result.cleanup.activeOwnFaultSupportsRemaining > 0) result.cleanup.failures += 1;
    } catch { result.cleanup.failures += 1; }
  }
}

async function deleteOwnPlans() {
  if (!driver) return;
  try {
    const bootstrap = await request(driver, 'bootstrap');
    const plans = bootstrap.status === 200 && Array.isArray(bootstrap.body?.plans) ? bootstrap.body.plans : [];
    for (const plan of plans) {
      if (ownedPlanIds.has(plan.id) || planTitles.has(plan.title)) ownedPlanIds.add(plan.id);
    }
  } catch { /* Keep known plan ids and report any delete failure. */ }
  for (const planId of ownedPlanIds) {
    try {
      const response = await request(driver, 'plan.delete', { planId });
      if (response.status === 200) result.cleanup.plansDeleted += 1;
      else result.cleanup.failures += 1;
    } catch { result.cleanup.failures += 1; }
  }
}

async function restoreProfile() {
  if (!driver || !profileRead || !profileMayHaveChanged) return;
  try {
    const response = savedProfile
      ? await request(driver, 'profile.save', { profile: savedProfile })
      : await request(driver, 'profile.delete');
    result.stages.profileRestored = { httpStatus: response.status, restored: response.status === 200 };
    if (response.status !== 200) result.cleanup.failures += 1;
  } catch {
    result.stages.profileRestored = { restored: false };
    result.cleanup.failures += 1;
  }
}

async function main() {
  let stage = 'setup';
  try {
    const users = JSON.parse(await readFile(usersPath, 'utf8'));
    driver = await signIn(users?.reliabilityUser, 'DRIVER');
    moderator = await signIn(users?.moderator, 'MODERATOR');
    accountId = driver.userId;

    stage = 'profile';
    const bootstrap = await api(driver, 'bootstrap');
    check('driver role is server-authenticated', bootstrap.user?.role === 'DRIVER');
    savedProfile = bootstrap.profile ?? null;
    profileRead = true;
    profileMayHaveChanged = true;
    await api(driver, 'profile.save', { profile: baseProfile });

    stage = 'baseline';
    const baselineCreated = await api(driver, 'plan.create', { input: profileInput, mode: 'DEMO_FIXTURE' });
    const baseline = baselineCreated.plan;
    recordPlan('baseline', baseline);
    const baselineVersion = currentVersion(baseline);
    const baselineResult = baselineVersion?.result;
    const baselineRecommendations = baselineResult?.recommendations ?? [];
    check('baseline is synthetic Demo Fixture with three options', baselineRecommendations.length === 3
      && baselineResult?.snapshot?.state === 'DEMO_FIXTURE'
      && String(baselineResult?.snapshot?.source).includes('DEMO_FIXTURE'), {
      mode: baselineResult?.snapshot?.state ?? null,
      recommendationCount: baselineRecommendations.length,
    });
    if (baselineRecommendations.length !== 3) throw new Error('BASELINE_THREE_RECOMMENDATIONS_REQUIRED');

    faultStationId = baselineRecommendations[0].stationId;
    const targetRecommendationId = baselineRecommendations[0].id;
    const firstConnectorId = `flow-a-${runMarker}`;
    const secondConnectorId = `flow-b-${runMarker}`;
    const stationName = baselineRecommendations[0].stationName;
    reportSpecs.push(
      { stationId: faultStationId, connectorId: firstConnectorId },
      { stationId: faultStationId, connectorId: secondConnectorId },
    );
    const initialVersionResult = stableJson(baselineVersion.result);

    await api(driver, 'plan.select', { planId: baseline.id, recommendationId: targetRecommendationId });

    stage = 'pending-does-not-filter';
    reportSubmissionAttempted = true;
    const firstDraft = await api(driver, 'report.create', {
      stationId: faultStationId, stationName, connectorId: firstConnectorId,
      category: 'SUSPECTED_FAULTY_CONNECTOR',
      note: `Synthetic Demo Fixture fault-flow ${runMarker}: pending report only.`,
    });
    const firstReport = firstDraft.report;
    if (!firstReport?.id || firstDraft.duplicate) throw new Error('FIRST_REPORT_NOT_CREATED');
    ownReportIds.add(firstReport.id);
    check('pending synthetic fault report is explicitly not verified', firstReport.status === 'PENDING', {
      status: firstReport.status,
    });
    const pendingReconfigure = await api(driver, 'plan.reconfigure', {
      planId: baseline.id, input: profileInput, mode: 'DEMO_FIXTURE',
    });
    const pendingPlan = pendingReconfigure.plan;
    recordPlan('pendingReconfigure', pendingPlan);
    const pendingResult = currentVersion(pendingPlan)?.result;
    check('pending report does not remove the station or add fault evidence',
      pendingResult?.recommendations?.some(item => item.stationId === faultStationId) === true
      && pendingResult?.faultEvidence?.some(item => item.stationId === faultStationId) !== true, {
        recommendationCount: pendingResult?.recommendations?.length ?? 0,
        faultEvidenceCount: pendingResult?.faultEvidence?.length ?? 0,
      });
    const reselected = await api(driver, 'plan.select', { planId: baseline.id, recommendationId: targetRecommendationId });
    check('selected recommendation matches the pre-fault option', reselected.plan?.selectedRecommendationId === targetRecommendationId);

    stage = 'verified-filters-create-reconfigure-refresh';
    const verified = await api(moderator, 'report.moderate', {
      reportId: firstReport.id, moderationAction: 'VERIFY', reason: 'Synthetic Demo Fixture fault-flow verification.', expectedRevision: firstReport.revision,
    });
    check('moderator verification activates synthetic fault support', verified.report?.status === 'VERIFIED', {
      status: verified.report?.status ?? null,
    });
    const activeAfterVerify = await activeFaultRows();
    check('verified report appears in active station support', activeAfterVerify.some(row => row.reportId === firstReport.id
      && row.stationId === faultStationId), { supportCount: activeAfterVerify.filter(row => row.stationId === faultStationId).length });

    const refreshed = await api(driver, 'plan.refresh', { planId: baseline.id, mode: 'DEMO_FIXTURE' });
    const refreshedPlan = refreshed.plan;
    recordPlan('refreshed', refreshedPlan);
    const refreshedVersion = currentVersion(refreshedPlan);
    const refreshedResult = refreshedVersion?.result;
    check('refresh removes the verified faulty station and records evidence',
      !refreshedResult?.recommendations?.some(item => item.stationId === faultStationId)
      && refreshedResult?.faultEvidence?.some(item => item.stationId === faultStationId) === true, {
        recommendationCount: refreshedResult?.recommendations?.length ?? 0,
        fallbackMessagePresent: typeof refreshed.fallbackMessage === 'string' && refreshed.fallbackMessage.length > 0,
      });
    const selectionSafe = selectionFallbackIsValid(refreshedPlan, faultStationId, refreshed.fallbackMessage);
    check('refresh clears invalid selection and describes the next alternative for Driver choice', selectionSafe, {
      selectionClearedForDriverChoice: refreshedPlan?.selectedRecommendationId === null,
      explicitFallback: Boolean(refreshedResult?.recommendations?.length
        ? String(refreshed.fallbackMessage ?? '').includes(`Next alternative: ${refreshedResult.recommendations[0].stationName}, connector ${refreshedResult.recommendations[0].connectorId}. Select it to continue.`)
        : /No fallback is available because no recommendation remains/i.test(refreshed.fallbackMessage ?? '')),
    });

    const filteredCreated = await api(driver, 'plan.create', { input: profileInput, mode: 'DEMO_FIXTURE' });
    let postVerifyPlan = filteredCreated.plan;
    recordPlan('postVerifyCreate', postVerifyPlan);
    const postVerifyResult = currentVersion(postVerifyPlan)?.result;
    check('plan.create filters the verified station', !postVerifyResult?.recommendations?.some(item => item.stationId === faultStationId)
      && postVerifyResult?.faultEvidence?.some(item => item.stationId === faultStationId) === true, {
      recommendationCount: postVerifyResult?.recommendations?.length ?? 0,
    });

    const retainedChoice = postVerifyResult.recommendations[0];
    await api(driver, 'plan.select', { planId: postVerifyPlan.id, recommendationId: retainedChoice.id });
    const refreshedWithValidChoice = await api(driver, 'plan.refresh', { planId: postVerifyPlan.id, mode: 'DEMO_FIXTURE' });
    postVerifyPlan = refreshedWithValidChoice.plan;
    recordPlan('validSelectionRefresh', postVerifyPlan);
    const validChoiceResult = currentVersion(postVerifyPlan)?.result;
    check('refresh preserves a still-feasible selected recommendation',
      postVerifyPlan.selectedRecommendationId === retainedChoice.id
      && validChoiceResult?.recommendations?.some(item => item.id === retainedChoice.id) === true, {
        selectedAvailable: postVerifyPlan.selectedRecommendationId === retainedChoice.id,
      });

    const filteredReconfigure = await api(driver, 'plan.reconfigure', {
      planId: postVerifyPlan.id, input: profileInput, mode: 'DEMO_FIXTURE',
    });
    const filteredPlan = filteredReconfigure.plan;
    recordPlan('postVerifyReconfigure', filteredPlan);
    const filteredResult = currentVersion(filteredPlan)?.result;
    check('plan.reconfigure filters the verified station', !filteredResult?.recommendations?.some(item => item.stationId === faultStationId)
      && filteredResult?.faultEvidence?.some(item => item.stationId === faultStationId) === true, {
      recommendationCount: filteredResult?.recommendations?.length ?? 0,
    });

    stage = 'whole-station-supports';
    reportSubmissionAttempted = true;
    const secondDraft = await api(driver, 'report.create', {
      stationId: faultStationId, stationName, connectorId: secondConnectorId,
      category: 'SUSPECTED_FAULTY_CONNECTOR',
      note: `Synthetic Demo Fixture fault-flow ${runMarker}: second connector support at same station.`,
    });
    const secondReport = secondDraft.report;
    if (!secondReport?.id || secondDraft.duplicate) throw new Error('SECOND_REPORT_NOT_CREATED');
    ownReportIds.add(secondReport.id);
    check('second same-station support is independently submitted', secondReport.status === 'PENDING'
      && secondReport.stationId === firstReport.stationId && secondReport.connectorId !== firstReport.connectorId, {
      status: secondReport.status,
    });
    const secondVerified = await api(moderator, 'report.moderate', {
      reportId: secondReport.id, moderationAction: 'VERIFY', reason: 'Synthetic second connector support.', expectedRevision: secondReport.revision,
    });
    const twoSupports = (await activeFaultRows()).filter(row => row.stationId === faultStationId);
    check('two verified connector reports support one station fault', twoSupports.length === 2
      && twoSupports.some(row => row.reportId === firstReport.id)
      && twoSupports.some(row => row.reportId === secondReport.id), { activeSupportCount: twoSupports.length });

    const resolvedFirst = await api(moderator, 'report.moderate', {
      reportId: firstReport.id, moderationAction: 'RESOLVE', reason: 'Withdraw first synthetic support.', expectedRevision: verified.report.revision,
    });
    const remainingSupports = (await activeFaultRows()).filter(row => row.stationId === faultStationId);
    check('resolving one report leaves the other station support active', resolvedFirst.report?.status === 'RESOLVED'
      && remainingSupports.length === 1 && remainingSupports[0].reportId === secondReport.id, {
      activeSupportCount: remainingSupports.length,
    });
    const stillFiltered = await api(driver, 'plan.reconfigure', {
      planId: postVerifyPlan.id, input: profileInput, mode: 'DEMO_FIXTURE',
    });
    recordPlan('oneSupportRemains', stillFiltered.plan);
    const stillFilteredResult = currentVersion(stillFiltered.plan)?.result;
    check('station remains excluded while the second support is active',
      !stillFilteredResult?.recommendations?.some(item => item.stationId === faultStationId)
      && stillFilteredResult?.faultEvidence?.some(item => item.stationId === faultStationId) === true);

    const expiredLast = await api(moderator, 'report.moderate', {
      reportId: secondReport.id, moderationAction: 'EXPIRE', reason: 'Expire final synthetic station support.', expectedRevision: secondVerified.report.revision,
    });
    const supportsAfterExpire = (await activeFaultRows()).filter(row => row.stationId === faultStationId);
    check('expiring the final report removes the station fault support', expiredLast.report?.status === 'EXPIRED'
      && supportsAfterExpire.length === 0, { activeSupportCount: supportsAfterExpire.length });

    const restored = await api(driver, 'plan.create', { input: profileInput, mode: 'DEMO_FIXTURE' });
    recordPlan('afterExpiryCreate', restored.plan);
    const restoredResult = currentVersion(restored.plan)?.result;
    check('station returns to recommendations after its last support expires',
      restoredResult?.recommendations?.some(item => item.stationId === faultStationId) === true
      && restoredResult?.faultEvidence?.some(item => item.stationId === faultStationId) !== true, {
        recommendationCount: restoredResult?.recommendations?.length ?? 0,
      });

    const baselineAfter = await request(driver, 'bootstrap');
    const finalBaseline = baselineAfter.body?.plans?.find(plan => plan.id === baseline.id);
    const originalAfter = finalBaseline?.versions?.find(version => version.id === baselineVersion.id);
    check('first saved baseline version remains three-option and immutable',
      originalAfter?.result?.recommendations?.length === 3 && stableJson(originalAfter.result) === initialVersionResult, {
        originalRecommendationCount: originalAfter?.result?.recommendations?.length ?? 0,
        versionCount: finalBaseline?.versions?.length ?? 0,
      });

    result.status = 'PASSED';
  } catch (error) {
    markFailure(error, stage);
  } finally {
    await closeOwnReports();
    await deleteOwnPlans();
    await restoreProfile();
    if (result.cleanup.failures > 0 && result.status === 'PASSED') {
      result.status = 'FAILED_CLEANUP';
      result.failureCode = 'OWNED_TEST_DATA_CLEANUP_INCOMPLETE';
    }
    await saveResult();
  }
}

await main();
process.stdout.write(`${JSON.stringify({ status: result.status, summary: result.summary, cleanup: result.cleanup, failureCode: result.failureCode, output: path.relative(projectRoot, outputPath) })}\n`);
if (result.status !== 'PASSED') process.exitCode = 1;
