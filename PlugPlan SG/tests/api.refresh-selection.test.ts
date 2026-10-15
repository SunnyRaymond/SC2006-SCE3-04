import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAction } from '../src/lib/server/service';
import type { PlanResult, Recommendation, SavedPlan, VehicleProfile } from '../src/lib/types';
import type { RequestContext } from '../src/lib/server/supabase';

const mocks = vi.hoisted(() => ({
  calculatePlan: vi.fn(),
  createDemoScenario: vi.fn(),
  getActiveFaults: vi.fn(),
  getOwnedPlan: vi.fn(),
  savePlanVersion: vi.fn(),
}));

vi.mock('../src/lib/domain/engine', () => ({ calculatePlan: mocks.calculatePlan }));
vi.mock('../src/lib/domain/fixtures', () => ({ createDemoScenario: mocks.createDemoScenario }));
vi.mock('../src/lib/server/db', () => ({
  bootstrap: vi.fn(), createImageUrl: vi.fn(), deletePlan: vi.fn(), deleteProfile: vi.fn(),
  getActiveFaults: mocks.getActiveFaults, getOwnedPlan: mocks.getOwnedPlan, getProfile: vi.fn(),
  listReports: vi.fn(), moderateReport: vi.fn(), revokeSession: vi.fn(), savePlanVersion: mocks.savePlanVersion,
  saveProfile: vi.fn(), selectRecommendation: vi.fn(), submitReport: vi.fn(),
}));
vi.mock('../src/lib/server/providers', () => ({
  attachCachedOfficialStatuses: vi.fn(), createProviderDeadline: () => Date.now() + 1000,
  getLiveSnapshot: vi.fn(), getRoutes: vi.fn(), searchPlaces: vi.fn(),
}));

const planId = '00000000-0000-4000-8000-000000000001';
const profile: VehicleProfile = {
  name: 'Test EV', capacityKWh: 60, consumptionKWhPer100Km: 17.5,
  plugTypes: ['Combo2', 'Type 2'], maxAcKw: 11, maxDcKw: 100,
  reserveSoc: 20, defaultDetourMinutes: 15, minChargerKw: 3, maxWalkingM: 0,
};
const inputs: PlanResult['inputs'] = {
  origin: { label: 'Origin', lat: 1.28, lng: 103.86 },
  destination: { label: 'Destination', lat: 1.3, lng: 103.83 },
  currentSoc: 18, departureAt: '2026-10-15T12:00:00+08:00',
  maxChargingMinutes: 45, maxDetourMinutes: 15, strategy: 'BALANCED', manualTargetSoc: null,
};

function recommendation(id: string, stationId: string, stationName: string): Recommendation {
  return {
    id, stationId, connectorId: `${id}-connector`, stationName, address: 'Singapore',
    lat: 1.3, lng: 103.83, operator: 'Fixture', plugType: 'Combo 2', powerType: 'DC', powerKw: 100,
    status: 'AVAILABLE', arrivalSoc: 10, automaticTargetSoc: 80, targetSoc: 80,
    requiredBatteryKWh: 42, requiredChargerKWh: 44, chargingMinutes: 30,
    estimatedCost: 10, priceType: 'kWh', unitPrice: 0.5, detourMinutes: 3, travelMinutes: 20,
    totalJourneyMinutes: 53, availability: 1, score: 1, rank: 1, explanations: [], warnings: [],
    toStation: { distanceKm: 3, durationMinutes: 5 }, fromStation: { distanceKm: 4, durationMinutes: 6 },
  };
}

function result(recommendations: Recommendation[], excluded: PlanResult['excluded'] = []): PlanResult {
  return {
    inputs, profileAssumptions: profile, recommendations, excluded,
    noChargeNeeded: false, directRoute: { distanceKm: 20, durationMinutes: 30 },
    snapshot: { source: 'DEMO_FIXTURE: synthetic test data', state: 'DEMO_FIXTURE', observedAt: '2026-10-15T00:00:00Z', retrievedAt: '2026-10-15T00:00:00Z' },
    faultFilterCheckedAt: '2026-10-15T00:00:00Z', faultEvidence: [], summary: 'Synthetic fixture plan.',
  };
}

function buildPlan(selected: Recommendation): SavedPlan {
  const oldResult = result([selected]);
  return {
    id: planId, title: 'Destination', createdAt: '2026-10-15T00:00:00Z',
    selectedRecommendationId: selected.id, currentVersionId: 'version-1',
    versions: [{ id: 'version-1', planId, number: 1, createdAt: '2026-10-15T00:00:00Z', reason: 'CREATE', result: oldResult }],
  };
}

function currentPlanFixture(selectedRecommendationId: string): SavedPlan {
  const firstRecommendation = recommendation('old-selection', 'station-faulted', 'Faulted station');
  const alternative = recommendation('alternative', 'station-alternative', 'Alternative station');
  const plan = buildPlan(firstRecommendation);
  plan.selectedRecommendationId = selectedRecommendationId;
  plan.versions[0].result.recommendations = [firstRecommendation, alternative];
  return plan;
}

const context = {
  token: 'unit-test-token', sessionId: 'unit-test-session', authUser: {} as never,
  user: { id: '00000000-0000-4000-8000-000000000002', email: 'driver@example.test', role: 'DRIVER' as const, status: 'ACTIVE' },
  db: {} as never,
} as RequestContext;
const scenario = {
  snapshot: { source: 'DEMO_FIXTURE', state: 'DEMO_FIXTURE', observedAt: '2026-10-15T00:00:00Z', retrievedAt: '2026-10-15T00:00:00Z', stations: [] },
  routes: [], directRoute: { distanceKm: 20, durationMinutes: 30 },
};

describe('plan.refresh selection handling', () => {
  let savedPlan: SavedPlan;

  beforeEach(() => {
    vi.clearAllMocks();
    const chosen = recommendation('old-selection', 'station-faulted', 'Faulted station');
    savedPlan = currentPlanFixture(chosen.id);
    mocks.getOwnedPlan.mockImplementation(async () => structuredClone(savedPlan));
    mocks.getActiveFaults.mockResolvedValue([]);
    mocks.createDemoScenario.mockReturnValue(scenario);
    mocks.savePlanVersion.mockImplementation(async (_context, id, computed: PlanResult, reason) => {
      const retainsSelection = computed.recommendations.some(item => item.id === savedPlan.selectedRecommendationId);
      const version = {
        id: 'version-2', planId: String(id), number: 2, createdAt: '2026-10-15T00:01:00Z', reason, result: computed,
      } as const;
      savedPlan = {
        ...savedPlan,
        selectedRecommendationId: retainsSelection ? savedPlan.selectedRecommendationId : null,
        currentVersionId: version.id,
        versions: [...savedPlan.versions, version],
      };
      return structuredClone(savedPlan);
    });
  });

  it('keeps an original selection when it remains on the refreshed shortlist', async () => {
    const stillAvailable = recommendation('alternative', 'station-alternative', 'Alternative station');
    const stillAvailableResult = result([
      recommendation('old-selection', 'station-faulted', 'Faulted station'), stillAvailable,
    ]);
    mocks.calculatePlan.mockReturnValue(stillAvailableResult);

    const response = await handleAction(context, { action: 'plan.refresh', planId, mode: 'DEMO_FIXTURE' });
    const saved = response.plan as SavedPlan;
    expect(saved.selectedRecommendationId).toBe('old-selection');
    expect(saved.versions.at(-1)?.result.summary).not.toContain('Next alternative:');
    expect(saved.versions.at(-1)?.result.summary).toContain('Your selected connector (Faulted station, connector old-selection-connector) remains feasible; no fallback is required.');
    expect(response.fallbackMessage).toContain('This plan uses the explicitly selected Demo Fixture data.');
    expect(response.fallbackMessage).toContain('remains feasible; no fallback is required.');
  });

  it('clears an invalid selection and persists the next alternative in summary and fallback message', async () => {
    const alternative = recommendation('alternative', 'station-alternative', 'Alternative station');
    const refreshed = result([alternative], [{
      stationId: 'station-faulted', stationName: 'Faulted station', reason: 'excluded by an active verified fault report', code: 'ACTIVE_FAULT',
    }]);
    refreshed.faultEvidence = [{ stationId: 'station-faulted', reportId: '00000000-0000-4000-8000-000000000009', expiresAt: '2026-10-16T00:00:00Z' }];
    mocks.calculatePlan.mockReturnValue(refreshed);

    const response = await handleAction(context, { action: 'plan.refresh', planId, mode: 'DEMO_FIXTURE' });
    const saved = response.plan as SavedPlan;
    const savedResult = saved.versions.at(-1)?.result;
    expect(saved.selectedRecommendationId).toBeNull();
    expect(savedResult?.summary).toContain('Your saved selection (Faulted station, connector old-selection-connector) was cleared');
    expect(savedResult?.summary).toContain('excluded by an active verified fault report');
    expect(savedResult?.summary).toContain('Next alternative: Alternative station, connector alternative-connector. Select it to continue.');
    expect(response.fallbackMessage).toContain('This plan uses the explicitly selected Demo Fixture data.');
    expect(response.fallbackMessage).toContain('Next alternative: Alternative station, connector alternative-connector.');
  });

  it('explains when no fallback recommendation remains', async () => {
    const noOptions = result([], [{
      stationId: 'station-faulted', stationName: 'Faulted station', reason: 'excluded by an active verified fault report', code: 'ACTIVE_FAULT',
    }]);
    mocks.calculatePlan.mockReturnValue(noOptions);

    const response = await handleAction(context, { action: 'plan.refresh', planId, mode: 'DEMO_FIXTURE' });
    const saved = response.plan as SavedPlan;
    expect(saved.selectedRecommendationId).toBeNull();
    expect(saved.versions.at(-1)?.result.summary).toContain('No fallback is available because no recommendation remains.');
    expect(response.fallbackMessage).toContain('No fallback is available because no recommendation remains.');
  });
});
