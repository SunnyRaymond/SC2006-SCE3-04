import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => { throw Object.assign(new Error('No LTA cache fixture'), { code: 'ENOENT' }); }),
  writeFile: vi.fn(async () => undefined),
}));

const testState = vi.hoisted(() => {
  const profile = {
    name: 'Timeout test EV', capacityKWh: 60, consumptionKWhPer100Km: 17.5,
    plugTypes: ['Combo 2'], maxAcKw: 11, maxDcKw: 100, reserveSoc: 20,
    defaultDetourMinutes: 15, minChargerKw: 3, maxWalkingM: 0,
  };
  const input = {
    origin: { label: 'Origin', lat: 1.2834, lng: 103.8607, postal: '018956' },
    destination: { label: 'Destination', lat: 1.3048, lng: 103.8318, postal: '238858' },
    currentSoc: 18, departureAt: '2026-10-15T08:00:00+08:00', maxChargingMinutes: 45,
    maxDetourMinutes: 15, strategy: 'BALANCED', manualTargetSoc: null,
  };
  const result = {
    inputs: input, profileAssumptions: profile, recommendations: [], excluded: [], noChargeNeeded: false,
    directRoute: { distanceKm: 10, durationMinutes: 30 },
    snapshot: { source: 'LTA DataMall', state: 'LIVE', observedAt: '2026-10-15T00:00:00Z', retrievedAt: '2026-10-15T00:00:00Z' },
    faultFilterCheckedAt: '2026-10-15T00:00:00Z', faultEvidence: [], summary: 'Previous saved result.',
  };
  const plan = {
    id: '10000000-0000-4000-8000-000000000001', title: 'Saved journey', createdAt: '2026-10-15T00:00:00Z',
    selectedRecommendationId: null, currentVersionId: '10000000-0000-4000-8000-000000000002',
    versions: [{ id: '10000000-0000-4000-8000-000000000002', planId: '10000000-0000-4000-8000-000000000001',
      number: 1, createdAt: '2026-10-15T00:00:00Z', reason: 'CREATE', result }],
  };
  return {
    profile, input, plan,
    context: {
      token: 'unit-test-token', sessionId: 'unit-test-session', db: {},
      user: { id: '10000000-0000-4000-8000-000000000003', email: 'driver@example.test', role: 'DRIVER', status: 'ACTIVE' },
      authUser: { id: '10000000-0000-4000-8000-000000000003' },
    },
    requireUser: vi.fn(),
    deadline: null as null | { at: number; fetch: typeof fetch },
    db: {
      bootstrap: vi.fn(), createImageUrl: vi.fn(), deletePlan: vi.fn(), deleteProfile: vi.fn(),
      getActiveFaults: vi.fn(), getOwnedPlan: vi.fn(), getProfile: vi.fn(), listReports: vi.fn(),
      moderateReport: vi.fn(), revokeSession: vi.fn(), savePlanVersion: vi.fn(), saveProfile: vi.fn(),
      selectRecommendation: vi.fn(), submitReport: vi.fn(),
    },
  };
});

vi.mock('@/lib/server/supabase', () => ({
  requireUser: testState.requireUser,
  requireDriver: vi.fn(),
  requireModerator: vi.fn(),
}));

vi.mock('@/lib/server/db', () => testState.db);

import { POST as app } from '../src/app/api/app/route';

function pause(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(action: string, payload: Record<string, unknown>) {
  return new Request('http://localhost/api/app', {
    method: 'POST',
    headers: { authorization: 'Bearer unit-test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
}

describe('full API provider deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OneMap_API', 'unit-test-key');
    vi.stubEnv('LTA_Datamall_API', 'unit-test-key');
    testState.requireUser.mockImplementation(async (_request, deadline) => {
      testState.deadline = deadline;
      Object.assign(testState.context, { providerDeadline: deadline });
      await pause(250);
      return testState.context;
    });
    testState.db.getProfile.mockImplementation(async () => {
      await pause(250);
      return testState.profile;
    });
    testState.db.getActiveFaults.mockImplementation(async () => {
      await pause(250);
      return [];
    });
    testState.db.getOwnedPlan.mockResolvedValue(testState.plan);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('times out a stalled LIVE create within five seconds of request start and never saves a partial plan', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
      else signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));

    const started = performance.now();
    const startedAt = Date.now();
    const response = await app(request('plan.create', { input: testState.input, mode: 'LIVE' }));
    const elapsedMs = performance.now() - started;
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.error).toMatch(/timed out/i);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(testState.deadline!.at - startedAt).toBeLessThanOrEqual(4_000);
    expect(testState.db.savePlanVersion).not.toHaveBeenCalled();
  }, 7_000);

  it('returns a provider failure quickly on LIVE refresh and preserves the previous saved version', async () => {
    const oldVersions = structuredClone(testState.plan.versions);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider unavailable', { status: 503 })));

    const started = performance.now();
    const response = await app(request('plan.refresh', { planId: testState.plan.id, mode: 'LIVE' }));
    const elapsedMs = performance.now() - started;
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBeTruthy();
    expect(elapsedMs).toBeLessThan(5_000);
    expect(testState.db.savePlanVersion).not.toHaveBeenCalled();
    expect(testState.plan.versions).toEqual(oldVersions);
  }, 7_000);
});
