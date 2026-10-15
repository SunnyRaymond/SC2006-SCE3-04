#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_FILE = path.join(PROJECT_ROOT, '.local', 'test-users.json');
const REPORT_FILE = path.join(PROJECT_ROOT, '.local', 'performance.json');
const CONCURRENCY = 20;
const REQUESTS_PER_USER = 5;
const REQUESTS_TOTAL = CONCURRENCY * REQUESTS_PER_USER;
const MAX_FRESH_AGE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const API_PATH = '/api/app';
const STRATEGIES = ['FASTEST', 'CHEAPEST', 'AVAILABILITY', 'DETOUR', 'BALANCED'];
const DEFAULT_PROFILE = {
  name: 'PlugPlan performance test vehicle',
  capacityKWh: 60,
  consumptionKWhPer100Km: 17.5,
  plugTypes: ['Combo2', 'Type 2'],
  maxAcKw: 22,
  maxDcKw: 150,
  reserveSoc: 20,
  defaultDetourMinutes: 15,
  minChargerKw: 0,
  maxWalkingM: 0,
};
const INPUT = {
  origin: { label: 'Nanyang Technological University', lat: 1.3483, lng: 103.6831 },
  destination: { label: 'Marina Bay Sands', lat: 1.2834, lng: 103.8607 },
  currentSoc: 30,
  maxChargingMinutes: 60,
  maxDetourMinutes: 15,
  manualTargetSoc: null,
};

const USAGE = `Usage (the default is help only; no network calls are made):
  node scripts/benchmark.mjs
  node scripts/benchmark.mjs --run --mode=live --server=dev
  node scripts/benchmark.mjs --run --mode=live --server=production --base-url=http://127.0.0.1:3000
  node scripts/benchmark.mjs --run --mode=live --server=production --base-url=https://your-deployment.example
  node scripts/benchmark.mjs --run --mode=fixture --server=dev   # diagnostic only; never an NFR-01 pass

Options:
  --run                         Required to sign in or make requests.
  --mode=live|fixture           Defaults to live. Fixture runs are diagnostic only.
  --server=dev|production       Required and recorded in the report.
  --base-url=URL                Defaults to BENCHMARK_BASE_URL or http://127.0.0.1:3000.
  --warmup-delay-ms=N           Delay between sequential warmup plans; live mode requires at least 5000 ms.

Configuration is read from ignored credentials.env/.env.local/.env and .local/test-users.json.
Loopback HTTP is allowed even when the Node server runs in production mode; external hosts must use HTTPS.
This benchmark does not verify the negotiated TLS version and is not NFR-05 TLS evidence.
The report is written to ignored .local/performance.json. No credentials or tokens are saved.`;

function parseArgs(argv) {
  const result = { run: false, mode: 'live', server: '', baseUrl: '', warmupDelayMs: 5000 };
  for (const arg of argv) {
    if (arg === '--run') result.run = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg.startsWith('--mode=')) result.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--server=')) result.server = arg.slice('--server='.length);
    else if (arg.startsWith('--base-url=')) result.baseUrl = arg.slice('--base-url='.length);
    else if (arg.startsWith('--warmup-delay-ms=')) result.warmupDelayMs = Number(arg.slice('--warmup-delay-ms='.length));
    else throw new Error('Unknown option. Use --help for usage.');
  }
  return result;
}

function percentileNearestRank(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function targetEvidence(baseUrl) {
  const hostname = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return {
    scheme: baseUrl.protocol.replace(':', ''),
    scope: loopback ? 'loopback' : 'external',
    tlsEvidence: false,
    tlsNote: 'The runner records the URL scheme only; it does not inspect negotiated TLS and cannot satisfy NFR-05.',
  };
}

assert.equal(REQUESTS_TOTAL, 100, 'The NFR-01 denominator must remain 100 requests.');
assert.equal(percentileNearestRank(Array.from({ length: 100 }, (_, i) => i + 1), 0.95), 95, 'p95 uses nearest-rank over all 100 samples.');
assert.deepEqual(DEFAULT_PROFILE.plugTypes, ['Combo2', 'Type 2']);
assert.equal(DEFAULT_PROFILE.capacityKWh, 60);
assert.equal(DEFAULT_PROFILE.consumptionKWhPer100Km, 17.5);
assert.equal(DEFAULT_PROFILE.reserveSoc, 20);
assert.equal(DEFAULT_PROFILE.minChargerKw, 0);
assert.equal(DEFAULT_PROFILE.maxWalkingM, 0);
assert.equal(DEFAULT_PROFILE.defaultDetourMinutes, 15);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function snapshotOf(body) {
  const plan = body?.plan;
  const versions = Array.isArray(plan?.versions) ? plan.versions : [];
  const version = versions.find(item => item?.id === plan?.currentVersionId)
    ?? [...versions].sort((a, b) => Number(b?.number ?? 0) - Number(a?.number ?? 0))[0];
  return version?.result?.snapshot ?? null;
}

function snapshotEvidence(snapshot, mode) {
  const observedAt = typeof snapshot?.observedAt === 'string' ? snapshot.observedAt : null;
  const parsed = observedAt ? Date.parse(observedAt) : NaN;
  const sourceAgeMs = Number.isFinite(parsed) ? Date.now() - parsed : null;
  const state = typeof snapshot?.state === 'string' ? snapshot.state : null;
  const source = typeof snapshot?.source === 'string' ? snapshot.source : null;
  const freshnessQualified = state === 'CACHED' || (sourceAgeMs !== null && sourceAgeMs >= 0 && sourceAgeMs <= MAX_FRESH_AGE_MS);
  return {
    mode,
    dataState: state,
    source,
    observedAt,
    retrievedAt: typeof snapshot?.retrievedAt === 'string' ? snapshot.retrievedAt : null,
    sourceAgeMs,
    freshnessQualified: mode === 'live' && source !== 'DEMO_FIXTURE' && freshnessQualified,
  };
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
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await response.json(); } catch { /* Record status/latency without preserving a response body. */ }
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

function readDriverUsers(document) {
  const users = Array.isArray(document?.loadUsers20) ? document.loadUsers20 : document?.loadUsers;
  if (!Array.isArray(users) || users.length !== CONCURRENCY) return null;
  if (users.some(user => !user || typeof user.email !== 'string' || typeof user.password !== 'string'
    || String(user.role ?? '').toUpperCase() !== 'DRIVER')) return null;
  return users;
}

function makeDepartureAt(offsetMs = 30 * 60 * 1000) {
  const singaporeTime = new Date(Date.now() + offsetMs + 8 * 60 * 60 * 1000);
  const p = value => String(value).padStart(2, '0');
  return `${singaporeTime.getUTCFullYear()}-${p(singaporeTime.getUTCMonth() + 1)}-${p(singaporeTime.getUTCDate())}`
    + `T${p(singaporeTime.getUTCHours())}:${p(singaporeTime.getUTCMinutes())}:00+08:00`;
}

function makeBaseReport(args) {
  let target = { scheme: null, scope: 'invalid', tlsEvidence: false, tlsNote: 'The runner does not inspect negotiated TLS and cannot satisfy NFR-05.' };
  try {
    target = targetEvidence(new URL(args.baseUrl || process.env.BENCHMARK_BASE_URL || 'http://127.0.0.1:3000'));
  } catch { /* Invalid URL is reported by the run setup. */ }
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    serverEnvironment: args.server,
    target,
    mode: args.mode === 'fixture' ? 'DEMO_FIXTURE' : 'LIVE',
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    workload: {
      expectedUsers: CONCURRENCY,
      concurrency: CONCURRENCY,
      requestsPerUser: REQUESTS_PER_USER,
      requestsPlanned: REQUESTS_TOTAL,
      latencyDenominator: 'Every attempted formal request; failed/non-200 responses are retained.',
      p95Method: 'Nearest-rank (ceil(0.95 * n)); no sample is discarded.',
    },
    warmup: { usersExpected: CONCURRENCY, usersPrepared: 0, plansCreated: 0, passed: false, records: [] },
    samples: [],
    summary: { attempted: 0, http200: 0, freshnessQualified: 0, p50Ms: null, p95Ms: null, maxMs: null },
    cleanup: { plansAttempted: 0, plansDeleted: 0, failures: 0 },
    nfr01: {
      eligible: false,
      verdict: args.mode === 'fixture' ? 'DIAGNOSTIC_ONLY' : 'INSUFFICIENT_DATA',
      passCriteria: 'LIVE only; 20 authenticated Drivers; 20 successful LIVE warmup plans; exactly 100 formal requests at concurrency 20; every response HTTP 200 and CACHED or source data age <= 10 minutes; p95 <= 3000 ms.',
    },
  };
}

async function writeReport(report) {
  const localDir = path.resolve(PROJECT_ROOT, '.local');
  const target = path.resolve(REPORT_FILE);
  if (!target.startsWith(`${localDir}${path.sep}`)) throw new Error('Report path escaped the ignored local directory.');
  await mkdir(localDir, { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

async function run(args) {
  const report = makeBaseReport(args);
  const createdPlans = [];
  const authenticated = [];
  const modeValue = args.mode === 'fixture' ? 'DEMO_FIXTURE' : 'LIVE';
  const baseUrl = new URL(args.baseUrl || process.env.BENCHMARK_BASE_URL || 'http://127.0.0.1:3000');
  const deploymentUrl = `${baseUrl.origin}/`;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const failures = [];

  if (!['dev', 'production'].includes(args.server)) failures.push('SERVER_ENVIRONMENT_REQUIRED');
  const loopback = targetEvidence(baseUrl).scope === 'loopback';
  if (!['http:', 'https:'].includes(baseUrl.protocol)) failures.push('HTTP_OR_HTTPS_URL_REQUIRED');
  if (!loopback && baseUrl.protocol !== 'https:') failures.push('EXTERNAL_TARGET_REQUIRES_HTTPS');
  if (!supabaseUrl || !publishableKey) failures.push('SUPABASE_CLIENT_CONFIGURATION_MISSING');
  if (!Number.isInteger(args.warmupDelayMs) || args.warmupDelayMs < 0) failures.push('INVALID_WARMUP_DELAY');
  else if (args.mode === 'live' && args.warmupDelayMs < 5000) failures.push('LIVE_WARMUP_DELAY_MUST_BE_AT_LEAST_5000MS');

  let users = null;
  try {
    const userDocument = JSON.parse(await readFile(USER_FILE, 'utf8'));
    users = readDriverUsers(userDocument);
  } catch {
    failures.push('TEST_USER_FILE_UNAVAILABLE');
  }
  if (!users) failures.push('EXPECTED_EXACTLY_20_DRIVER_USERS');

  if (failures.length === 0) {
    for (let i = 0; i < users.length; i += 1) {
      const client = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      try {
        const { data, error } = await client.auth.signInWithPassword({ email: users[i].email, password: users[i].password });
        if (error || !data.session?.access_token) {
          failures.push('DRIVER_SIGN_IN_FAILED');
          report.warmup.records.push({ userSlot: i + 1, signIn: 'FAILED' });
        } else {
          authenticated.push({ slot: i + 1, token: data.session.access_token });
          report.warmup.records.push({ userSlot: i + 1, signIn: 'OK' });
        }
      } catch {
        failures.push('DRIVER_SIGN_IN_FAILED');
        report.warmup.records.push({ userSlot: i + 1, signIn: 'FAILED' });
      }
    }
    report.warmup.usersPrepared = authenticated.length;
  }

  const profilesReady = authenticated.length === CONCURRENCY;
  if (profilesReady) {
    for (const user of authenticated) {
      const result = await postAction(deploymentUrl, user.token, { action: 'profile.save', profile: DEFAULT_PROFILE });
      const record = report.warmup.records.find(item => item.userSlot === user.slot);
      record.profileStatus = result.status;
      if (result.status !== 200) failures.push('PROFILE_SETUP_FAILED');
    }
  }

  const departureAt = makeDepartureAt();
  const input = { ...INPUT, departureAt, strategy: 'BALANCED' };
  let warmupReady = profilesReady && report.warmup.records.every(record => record.signIn === 'OK' && record.profileStatus === 200);
  if (warmupReady) {
    for (let i = 0; i < authenticated.length; i += 1) {
      if (i > 0 && args.warmupDelayMs > 0) await delay(args.warmupDelayMs);
      const user = authenticated[i];
      const result = await postAction(deploymentUrl, user.token, { action: 'plan.create', input, mode: modeValue });
      const record = report.warmup.records.find(item => item.userSlot === user.slot);
      record.planCreateStatus = result.status;
      record.planCreateMs = result.durationMs;
      const planId = result.body?.plan?.id;
      if (result.status === 200 && typeof planId === 'string') {
        createdPlans.push({ user, planId });
        record.planCreated = true;
        report.warmup.plansCreated += 1;
        const snapshot = snapshotOf(result.body);
        const evidence = snapshotEvidence(snapshot, args.mode);
        Object.assign(record, evidence);
        const readyData = args.mode === 'fixture'
          ? evidence.dataState === 'DEMO_FIXTURE'
          : evidence.freshnessQualified;
        record.warmupDataReady = readyData;
        if (!readyData) failures.push(args.mode === 'fixture' ? 'FIXTURE_WARMUP_INVALID' : 'LIVE_WARMUP_NOT_FRESH_OR_CACHED');
      } else {
        record.planCreated = false;
        record.failure = result.networkError ?? 'PLAN_WARMUP_FAILED';
        failures.push(result.networkError ?? 'PLAN_WARMUP_FAILED');
      }
      if ((i + 1) % 5 === 0) console.log(`LIVE warmup: ${i + 1}/${CONCURRENCY} completed; ${report.warmup.plansCreated} plans created.`);
    }
  }

  report.warmup.passed = report.warmup.records.length === CONCURRENCY
    && report.warmup.records.every(record => record.signIn === 'OK' && record.profileStatus === 200
      && record.planCreateStatus === 200 && record.planCreated === true && record.warmupDataReady === true);

  if (report.warmup.passed) {
    const requestJobs = authenticated.map(async user => {
      const created = createdPlans.find(item => item.user.slot === user.slot);
      for (let iteration = 0; iteration < REQUESTS_PER_USER; iteration += 1) {
        const strategy = STRATEGIES[iteration];
        const result = await postAction(deploymentUrl, user.token, {
          action: 'plan.reconfigure',
          planId: created.planId,
          input: { ...input, strategy },
          mode: modeValue,
        });
        const snapshot = result.status === 200 ? snapshotOf(result.body) : null;
        const evidence = snapshotEvidence(snapshot, args.mode);
        report.samples.push({
          requestIndex: 0,
          userSlot: user.slot,
          userRequest: iteration + 1,
          strategy,
          status: result.status,
          durationMs: result.durationMs,
          networkError: result.networkError,
          ...evidence,
        });
      }
    });
    await Promise.all(requestJobs);
    report.samples.sort((a, b) => a.userSlot - b.userSlot || a.userRequest - b.userRequest);
    report.samples.forEach((sample, index) => { sample.requestIndex = index + 1; });
  } else {
    failures.push('WARMUP_INCOMPLETE_FORMAL_100_REQUEST_RUN_SKIPPED');
  }

  for (const created of createdPlans) {
    report.cleanup.plansAttempted += 1;
    const result = await postAction(deploymentUrl, created.user.token, { action: 'plan.delete', planId: created.planId });
    if (result.status === 200) report.cleanup.plansDeleted += 1;
    else report.cleanup.failures += 1;
  }

  const durations = report.samples.map(sample => sample.durationMs);
  report.summary = {
    attempted: report.samples.length,
    http200: report.samples.filter(sample => sample.status === 200).length,
    freshnessQualified: report.samples.filter(sample => sample.freshnessQualified).length,
    p50Ms: percentileNearestRank(durations, 0.50),
    p95Ms: percentileNearestRank(durations, 0.95),
    maxMs: durations.length ? Math.max(...durations) : null,
  };

  const allFormalCriteria = args.mode === 'live'
    && report.warmup.passed
    && report.samples.length === REQUESTS_TOTAL
    && report.samples.every(sample => sample.status === 200 && sample.freshnessQualified)
    && report.summary.p95Ms !== null && report.summary.p95Ms <= 3000;
  report.nfr01.eligible = args.mode === 'live' && report.warmup.passed && report.samples.length === REQUESTS_TOTAL;
  report.nfr01.verdict = args.mode === 'fixture'
    ? 'DIAGNOSTIC_ONLY'
    : report.samples.length < REQUESTS_TOTAL || !report.warmup.passed
      ? 'INSUFFICIENT_DATA'
      : allFormalCriteria ? 'PASS' : 'FAIL';
  report.nfr01.failures = [...new Set(failures)];
  report.nfr01.criteria = {
    usersAuthenticated: authenticated.length === CONCURRENCY,
    warmupPlansCreated: report.warmup.plansCreated,
    warmupPlansExpected: CONCURRENCY,
    formalRequests: report.samples.length,
    formalRequestsExpected: REQUESTS_TOTAL,
    allHttp200: report.samples.length === REQUESTS_TOTAL && report.samples.every(sample => sample.status === 200),
    allFreshOrCached: report.samples.length === REQUESTS_TOTAL && report.samples.every(sample => sample.freshnessQualified),
    p95AtMost3000Ms: report.summary.p95Ms !== null && report.summary.p95Ms <= 3000,
    cleanupComplete: report.cleanup.failures === 0 && report.cleanup.plansDeleted === report.cleanup.plansAttempted,
  };

  await writeReport(report);
  console.log(`Benchmark record written: ${path.relative(PROJECT_ROOT, REPORT_FILE)}`);
  console.log(`Mode: ${report.mode}; server: ${report.serverEnvironment}; verdict: ${report.nfr01.verdict}`);
  console.log(`Formal requests: ${report.summary.attempted}/${REQUESTS_TOTAL}; p50=${report.summary.p50Ms ?? 'n/a'} ms; p95=${report.summary.p95Ms ?? 'n/a'} ms; max=${report.summary.maxMs ?? 'n/a'} ms.`);
  console.log(`Warmup: ${report.warmup.plansCreated}/${CONCURRENCY} plans; cleanup: ${report.cleanup.plansDeleted}/${report.cleanup.plansAttempted}.`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch {
    console.log(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!args.run || args.help) {
    console.log(USAGE);
    return;
  }
  if (!['live', 'fixture'].includes(args.mode)) {
    console.log(USAGE);
    process.exitCode = 2;
    return;
  }

  loadEnv({ path: path.join(PROJECT_ROOT, 'credentials.env'), quiet: true });
  loadEnv({ path: path.join(PROJECT_ROOT, '.env.local'), quiet: true });
  loadEnv({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
  const report = makeBaseReport(args);
  try {
    await run(args);
  } catch {
    report.nfr01.failures = ['BENCHMARK_ABORTED'];
    report.nfr01.verdict = 'INSUFFICIENT_DATA';
    try { await writeReport(report); } catch { /* Do not print filesystem details or any loaded configuration. */ }
    console.error('Benchmark could not complete. See the redacted record if it was written. No credentials or response bodies were printed.');
    process.exitCode = 1;
  }
}

await main();
