#!/usr/bin/env node

import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_FILE = path.join(PROJECT_ROOT, '.local', 'test-users.json');
const REPORT_FILE = path.join(PROJECT_ROOT, '.local', 'reliability.json');
const EXPECTED_RUNS = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const API_PATH = '/api/app';
const STRATEGIES = ['FASTEST', 'CHEAPEST', 'AVAILABILITY', 'DETOUR', 'BALANCED'];
const PROFILE = {
  name: 'PlugPlan reliability test vehicle',
  capacityKWh: 75,
  consumptionKWhPer100Km: 16,
  plugTypes: ['Combo2', 'Type 2'],
  maxAcKw: 22,
  maxDcKw: 150,
  reserveSoc: 20,
  defaultDetourMinutes: 120,
  minChargerKw: 0,
  maxWalkingM: 0,
};
const USAGE = `Usage (the default is help only; no network calls are made):
  node scripts/reliability.mjs
  node scripts/reliability.mjs --run --server=production --base-url=http://127.0.0.1:3000
  node scripts/reliability.mjs --run --server=dev --base-url=http://127.0.0.1:3000

Options:
  --run                    Required to sign in or make requests.
  --server=dev|production  Required and recorded in the report.
  --base-url=URL           Defaults to RELIABILITY_BASE_URL or http://127.0.0.1:3000.

Uses only the dedicated reliabilityUser object in ignored .local/test-users.json.
Runs 100 deterministic DEMO_FIXTURE journeys and writes a redacted record to
.local/reliability.json. No account identifiers, passwords, or tokens are saved.
Loopback HTTP is allowed in production mode; external hosts must use HTTPS.
The runner does not inspect negotiated TLS and is not NFR-05 TLS evidence.`;

function parseArgs(argv) {
  const result = { run: false, server: '', baseUrl: '' };
  for (const arg of argv) {
    if (arg === '--run') result.run = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg.startsWith('--server=')) result.server = arg.slice('--server='.length);
    else if (arg.startsWith('--base-url=')) result.baseUrl = arg.slice('--base-url='.length);
    else throw new Error('Unknown option. Use --help for usage.');
  }
  return result;
}

function endpointEvidence(baseUrl) {
  const hostname = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return {
    scheme: baseUrl.protocol.replace(':', ''),
    scope: loopback ? 'loopback' : 'external',
    tlsEvidence: false,
    tlsNote: 'The runner records the URL scheme only; it does not inspect negotiated TLS and cannot satisfy NFR-05.',
  };
}

function finiteNumbers(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbers);
  if (value && typeof value === 'object') return Object.values(value).every(finiteNumbers);
  return true;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function currentVersion(plan) {
  const versions = Array.isArray(plan?.versions) ? plan.versions : [];
  return versions.find(version => version.id === plan?.currentVersionId)
    ?? [...versions].sort((a, b) => Number(b?.number ?? 0) - Number(a?.number ?? 0))[0]
    ?? null;
}

function versionSnapshot(plan) {
  return new Map((Array.isArray(plan?.versions) ? plan.versions : []).map(version => [version.id, stableJson(version.result)]));
}

function checkOldVersionsUnchanged(before, plan) {
  const after = versionSnapshot(plan);
  if (before.size === 0) return false;
  for (const [id, result] of before) if (after.get(id) !== result) return false;
  return true;
}

function resultChecks(plan, expectedPreviousNumber = null, oldVersions = null) {
  const version = currentVersion(plan);
  const result = version?.result;
  const recommendations = result?.recommendations;
  const recommendationCount = Array.isArray(recommendations) ? recommendations.length : 0;
  return {
    recommendationCount,
    exactlyThreeRecommendations: recommendationCount === 3,
    finiteRecommendationValues: recommendationCount === 3 && recommendations.every(finiteNumbers),
    fixtureSource: result?.snapshot?.state === 'DEMO_FIXTURE'
      && typeof result?.snapshot?.source === 'string'
      && result.snapshot.source.includes('DEMO_FIXTURE'),
    versionNumber: Number.isInteger(version?.number) ? version.number : null,
    versionIncremented: expectedPreviousNumber === null
      ? Number.isInteger(version?.number) && version.number === 1
      : Number.isInteger(version?.number) && version.number === expectedPreviousNumber + 1,
    oldVersionsImmutable: oldVersions === null || checkOldVersionsUnchanged(oldVersions, plan),
  };
}

function checksPass(checks) {
  return checks.exactlyThreeRecommendations
    && checks.finiteRecommendationValues
    && checks.fixtureSource
    && checks.versionIncremented
    && checks.oldVersionsImmutable;
}

function makeRecord(index) {
  return {
    journey: index + 1,
    strategy: STRATEGIES[index % STRATEGIES.length],
    attempted: false,
    status: 'NOT_RUN_SETUP_FAILURE',
    steps: {},
    checks: {},
    failureCodes: [],
  };
}

function makeReport(args) {
  let target = { scheme: null, scope: 'invalid', tlsEvidence: false, tlsNote: 'The runner does not inspect negotiated TLS and cannot satisfy NFR-05.' };
  try { target = endpointEvidence(new URL(args.baseUrl || process.env.RELIABILITY_BASE_URL || 'http://127.0.0.1:3000')); } catch { /* Setup records invalid URL. */ }
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    serverEnvironment: args.server,
    target,
    mode: 'DEMO_FIXTURE',
    scope: 'API journey: create; compare three recommendations; select; refresh; reconfigure; verify prior versions immutable; delete; verify absent.',
    workload: {
      expectedJourneys: EXPECTED_RUNS,
      reconfigureRequestsExpected: EXPECTED_RUNS,
      strategies: STRATEGIES,
      denominator: 'All 100 planned journeys; failed journeys remain in the denominator and setup-blocked journeys are listed as NOT_RUN.',
    },
    records: Array.from({ length: EXPECTED_RUNS }, (_, index) => makeRecord(index)),
    summary: {
      attempted: 0,
      passed: 0,
      failed: 0,
      notRun: EXPECTED_RUNS,
      expected: EXPECTED_RUNS,
      journeyVerdict: 'INSUFFICIENT_DATA',
      branchCoverageGate: 'NOT_RUN_BY_THIS_SCRIPT',
      profileRestored: null,
      cleanup: { plansAttempted: 0, plansDeleted: 0, failures: 0 },
    },
    setupFailureCodes: [],
  };
}

async function writeReport(report) {
  const localDir = path.resolve(PROJECT_ROOT, '.local');
  const target = path.resolve(REPORT_FILE);
  if (!target.startsWith(`${localDir}${path.sep}`)) throw new Error('Report path escaped ignored local directory.');
  await mkdir(localDir, { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

async function postAction(baseUrl, token, payload) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(API_PATH, baseUrl), {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await response.json(); } catch { /* Keep only status and timing in the report. */ }
    return { status: response.status, durationMs: Number((performance.now() - started).toFixed(2)), body, networkError: null };
  } catch (error) {
    return {
      status: null,
      durationMs: Number((performance.now() - started).toFixed(2)),
      body: null,
      networkError: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function stepSummary(result) {
  return { status: result.status, durationMs: result.durationMs, networkError: result.networkError };
}

function markFailure(record, code) {
  record.status = 'FAIL';
  if (!record.failureCodes.includes(code)) record.failureCodes.push(code);
}

async function findOwnedPlan(token, baseUrl, title) {
  const result = await postAction(baseUrl, token, { action: 'bootstrap' });
  if (result.status !== 200) return null;
  const matches = (result.body?.plans ?? []).filter(plan => plan.title === title);
  return matches.length === 1 ? matches[0] : null;
}

function makeDepartureAt(offsetMs = 30 * 60 * 1000) {
  const singaporeTime = new Date(Date.now() + offsetMs + 8 * 60 * 60 * 1000);
  const pad = value => String(value).padStart(2, '0');
  return `${singaporeTime.getUTCFullYear()}-${pad(singaporeTime.getUTCMonth() + 1)}-${pad(singaporeTime.getUTCDate())}`
    + `T${pad(singaporeTime.getUTCHours())}:${pad(singaporeTime.getUTCMinutes())}:00+08:00`;
}

function journeyInput(runId, index, strategy) {
  return {
    origin: { label: 'Singapore fixture origin', lat: 1.29027, lng: 103.851959 },
    destination: { label: `RLY-${runId}-${String(index + 1).padStart(3, '0')}`, lat: 1.352083, lng: 103.819836 },
    currentSoc: 40,
    departureAt: makeDepartureAt(),
    maxChargingMinutes: 720,
    maxDetourMinutes: 120,
    strategy,
    manualTargetSoc: 80,
  };
}

function setSetupFailure(report, code) {
  report.setupFailureCodes = [...new Set([...report.setupFailureCodes, code])];
  for (const record of report.records) {
    record.status = 'NOT_RUN_SETUP_FAILURE';
    record.failureCodes = [code];
  }
}

async function run(args) {
  const report = makeReport(args);
  const ownedPlans = new Map();
  let token = null;
  let previousProfile = null;
  let profileRead = false;
  let profileMayHaveChanged = false;
  let baseUrl;

  try {
    baseUrl = new URL(args.baseUrl || process.env.RELIABILITY_BASE_URL || 'http://127.0.0.1:3000');
    const target = endpointEvidence(baseUrl);
    report.target = target;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!['dev', 'production'].includes(args.server)) setSetupFailure(report, 'SERVER_ENVIRONMENT_REQUIRED');
    else if (!['http:', 'https:'].includes(baseUrl.protocol)) setSetupFailure(report, 'HTTP_OR_HTTPS_URL_REQUIRED');
    else if (target.scope === 'external' && baseUrl.protocol !== 'https:') setSetupFailure(report, 'EXTERNAL_TARGET_REQUIRES_HTTPS');
    else if (!supabaseUrl || !publishableKey) setSetupFailure(report, 'SUPABASE_CLIENT_CONFIGURATION_MISSING');

    let user = null;
    if (report.setupFailureCodes.length === 0) {
      try {
        const document = JSON.parse(await readFile(USER_FILE, 'utf8'));
        user = document?.reliabilityUser;
      } catch { /* Convert setup issues to a redacted failure code below. */ }
      if (!user || typeof user.email !== 'string' || typeof user.password !== 'string'
        || String(user.role ?? '').toUpperCase() !== 'DRIVER') setSetupFailure(report, 'DEDICATED_RELIABILITY_DRIVER_UNAVAILABLE');
    }

    if (report.setupFailureCodes.length === 0) {
      const client = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      try {
        const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
        if (error || !data.session?.access_token) setSetupFailure(report, 'DRIVER_SIGN_IN_FAILED');
        else token = data.session.access_token;
      } catch { setSetupFailure(report, 'DRIVER_SIGN_IN_FAILED'); }
    }

    if (token && report.setupFailureCodes.length === 0) {
      const bootstrap = await postAction(baseUrl, token, { action: 'bootstrap' });
      if (bootstrap.status !== 200) setSetupFailure(report, 'INITIAL_BOOTSTRAP_FAILED');
      else if (String(bootstrap.body?.user?.role ?? '').toUpperCase() !== 'DRIVER') setSetupFailure(report, 'ACCOUNT_NOT_DRIVER');
      else {
        previousProfile = bootstrap.body?.profile ?? null;
        profileRead = true;
        profileMayHaveChanged = true;
        const profileSave = await postAction(baseUrl, token, { action: 'profile.save', profile: PROFILE });
        if (profileSave.status !== 200) setSetupFailure(report, 'PROFILE_SETUP_FAILED');
      }
    }

    if (token && report.setupFailureCodes.length === 0) {
      const runId = randomUUID().toUpperCase();
      for (let index = 0; index < EXPECTED_RUNS; index += 1) {
        const record = report.records[index];
        const strategy = STRATEGIES[index % STRATEGIES.length];
        const title = `RLY-${runId}-${String(index + 1).padStart(3, '0')}`;
        const input = journeyInput(runId, index, strategy);
        record.attempted = true;
        record.status = 'PASS';
        report.summary.attempted += 1;
        let planId = null;
        try {
          const create = await postAction(baseUrl, token, { action: 'plan.create', input, mode: 'DEMO_FIXTURE' });
          record.steps.create = stepSummary(create);
          let plan = create.body?.plan ?? null;
          if (create.status === 200 && typeof plan?.id === 'string') planId = plan.id;
          else plan = await findOwnedPlan(token, baseUrl, title);
          if (plan && typeof plan.id === 'string') {
            planId = plan.id;
            ownedPlans.set(planId, title);
          }
          if (create.status !== 200 || !planId || !plan) markFailure(record, create.networkError ?? 'PLAN_CREATE_FAILED');

          const createdChecks = plan ? resultChecks(plan) : null;
          record.checks.create = createdChecks;
          if (createdChecks && !checksPass(createdChecks)) markFailure(record, 'CREATE_RESULT_INVALID');

          const initialVersion = plan ? currentVersion(plan) : null;
          const compared = initialVersion?.result?.recommendations ?? [];
          const comparePass = compared.length === 3 && finiteNumbers(compared.slice(0, 2));
          record.steps.compare = { status: comparePass ? 'PASS' : 'FAIL', comparedRecommendationCount: Math.min(compared.length, 2) };
          if (!comparePass) markFailure(record, 'COMPARE_RECOMMENDATIONS_INVALID');

          if (planId && compared.length > 0 && typeof compared[0]?.id === 'string') {
            const select = await postAction(baseUrl, token, { action: 'plan.select', planId, recommendationId: compared[0].id });
            record.steps.select = stepSummary(select);
            if (select.status !== 200) markFailure(record, select.networkError ?? 'PLAN_SELECT_FAILED');
            else plan = select.body?.plan ?? plan;
          } else {
            record.steps.select = { status: 'NOT_RUN' };
            markFailure(record, 'PLAN_SELECT_NOT_RUN');
          }

          let previousNumber = currentVersion(plan)?.number ?? null;
          let immutableVersions = versionSnapshot(plan);
          const refresh = planId
            ? await postAction(baseUrl, token, { action: 'plan.refresh', planId, mode: 'DEMO_FIXTURE' })
            : { status: null, durationMs: null, body: null, networkError: null };
          record.steps.refresh = stepSummary(refresh);
          if (refresh.status === 200 && refresh.body?.plan) {
            plan = refresh.body.plan;
            const checks = resultChecks(plan, previousNumber, immutableVersions);
            record.checks.refresh = checks;
            if (!checksPass(checks)) markFailure(record, 'REFRESH_RESULT_INVALID');
            previousNumber = checks.versionNumber;
            immutableVersions = versionSnapshot(plan);
          } else {
            record.checks.refresh = null;
            markFailure(record, refresh.networkError ?? 'PLAN_REFRESH_FAILED');
          }

          const reconfigure = planId
            ? await postAction(baseUrl, token, {
              action: 'plan.reconfigure', planId,
              input: { ...input, strategy }, mode: 'DEMO_FIXTURE',
            })
            : { status: null, durationMs: null, body: null, networkError: null };
          record.steps.reconfigure = stepSummary(reconfigure);
          if (reconfigure.status === 200 && reconfigure.body?.plan) {
            plan = reconfigure.body.plan;
            const checks = resultChecks(plan, previousNumber, immutableVersions);
            record.checks.reconfigure = checks;
            if (!checksPass(checks)) markFailure(record, 'RECONFIGURE_RESULT_INVALID');
          } else {
            record.checks.reconfigure = null;
            markFailure(record, reconfigure.networkError ?? 'PLAN_RECONFIGURE_FAILED');
          }
        } catch {
          markFailure(record, 'JOURNEY_STEP_ABORTED');
        } finally {
          if (planId) {
            report.summary.cleanup.plansAttempted += 1;
            const deletion = await postAction(baseUrl, token, { action: 'plan.delete', planId });
            record.steps.delete = stepSummary(deletion);
            if (deletion.status === 200) {
              ownedPlans.delete(planId);
              report.summary.cleanup.plansDeleted += 1;
            } else {
              markFailure(record, deletion.networkError ?? 'PLAN_DELETE_FAILED');
            }
            const verify = await postAction(baseUrl, token, { action: 'bootstrap' });
            const stillPresent = verify.status === 200 && (verify.body?.plans ?? []).some(plan => plan.id === planId);
            record.steps.verifyDeleted = { status: verify.status, absent: verify.status === 200 && !stillPresent };
            if (verify.status !== 200 || stillPresent) markFailure(record, 'PLAN_DELETE_NOT_VERIFIED');
            else if (deletion.status !== 200) {
              ownedPlans.delete(planId);
              report.summary.cleanup.plansDeleted += 1;
            }
          } else {
            record.steps.delete = { status: 'NOT_RUN' };
            record.steps.verifyDeleted = { status: 'NOT_RUN' };
          }
        }
        if ((index + 1) % 10 === 0) console.log(`Deterministic journeys: ${index + 1}/${EXPECTED_RUNS}; ${report.records.slice(0, index + 1).filter(item => item.status === 'PASS').length} passed.`);
      }
    }
  } catch {
    if (report.summary.attempted === 0 && report.setupFailureCodes.length === 0) setSetupFailure(report, 'RUNNER_SETUP_ABORTED');
    else if (report.summary.attempted < EXPECTED_RUNS) {
      for (const record of report.records) {
        if (!record.attempted) {
          record.status = 'NOT_RUN_RUNNER_ABORTED';
          record.failureCodes = ['RUNNER_ABORTED'];
        }
      }
    }
  } finally {
    if (token) {
      for (const [planId] of ownedPlans) {
        report.summary.cleanup.plansAttempted += 1;
        const deletion = await postAction(baseUrl, token, { action: 'plan.delete', planId }).catch(() => ({ status: null }));
        if (deletion.status === 200) report.summary.cleanup.plansDeleted += 1;
        else report.summary.cleanup.failures += 1;
      }
      if (profileMayHaveChanged && profileRead) {
        const restore = previousProfile
          ? await postAction(baseUrl, token, { action: 'profile.save', profile: previousProfile }).catch(() => ({ status: null }))
          : await postAction(baseUrl, token, { action: 'profile.delete' }).catch(() => ({ status: null }));
        report.summary.profileRestored = restore.status === 200;
      } else report.summary.profileRestored = true;
    }
    report.summary.passed = report.records.filter(record => record.status === 'PASS').length;
    report.summary.failed = report.records.filter(record => record.status === 'FAIL').length;
    report.summary.notRun = report.records.filter(record => !record.attempted).length;
    report.summary.journeyVerdict = report.summary.attempted === EXPECTED_RUNS
      && report.summary.passed === EXPECTED_RUNS
      && report.summary.failed === 0
      && report.summary.notRun === 0
      && report.summary.cleanup.failures === 0
      && report.summary.profileRestored === true
      ? 'PASS'
      : report.summary.attempted === EXPECTED_RUNS ? 'FAIL' : 'INSUFFICIENT_DATA';
    report.summary.denominator = EXPECTED_RUNS;
    report.summary.completeJourneyCount = report.summary.attempted;
    report.summary.reconfigureRequestsSucceeded = report.records.filter(record => record.steps.reconfigure?.status === 200).length;
    await writeReport(report).catch(() => {});
  }

  console.log(`Reliability record written: ${path.relative(PROJECT_ROOT, REPORT_FILE)}`);
  console.log(`Journey result: ${report.summary.passed}/${EXPECTED_RUNS} passed; ${report.summary.failed} failed; ${report.summary.notRun} not run; verdict=${report.summary.journeyVerdict}.`);
  console.log(`Cleanup: ${report.summary.cleanup.plansDeleted}/${report.summary.cleanup.plansAttempted} plans; profile restored=${report.summary.profileRestored === true}.`);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch { console.log(USAGE); process.exitCode = 2; return; }
  if (!args.run || args.help) { console.log(USAGE); return; }
  loadEnv({ path: path.join(PROJECT_ROOT, 'credentials.env'), quiet: true });
  loadEnv({ path: path.join(PROJECT_ROOT, '.env.local'), quiet: true });
  loadEnv({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
  await run(args);
}

await main();
