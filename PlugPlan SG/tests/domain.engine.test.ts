import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Connector, FaultEvidence, OfficialSnapshot, PlanInput, RouteEstimate, Station, VehicleProfile } from '../src/lib/types';
import { calculatePlan } from '../src/lib/domain/engine';
import { createDemoScenario } from '../src/lib/domain/fixtures';
import { DEMO_DIRECT_ROUTE, DEMO_FAULTS, DEMO_INPUT, DEMO_PROFILE, DEMO_ROUTES, DEMO_SNAPSHOT } from '../src/lib/domain/fixtures';

const CHECKED_AT = '2026-10-15T12:00:00+08:00';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'connector', plugType: 'CCS2', powerType: 'DC', powerKw: 100,
    price: 0.3, priceType: 'kWh', status: 'AVAILABLE', ...overrides,
  };
}

function makeStation(id = 'station', connector = makeConnector(), overrides: Partial<Station> = {}): Station {
  return {
    id, name: id, address: 'Demo fixture', postal: '000000', lat: 1.3, lng: 103.8,
    operator: 'DEMO_FIXTURE', openingHours: '24/7', openingHoursAssumed: false,
    connectors: [connector], ...overrides,
  };
}

function makeRoute(stationId = 'station', toDistance = 20, fromDistance = 100, toMinutes = 30, fromMinutes = 60, walkingMeters = 100): CandidateRoute {
  return {
    stationId,
    toStation: { distanceKm: toDistance, durationMinutes: toMinutes },
    fromStation: { distanceKm: fromDistance, durationMinutes: fromMinutes },
    walkingMeters,
  };
}

function calculate(options: {
  profile?: Partial<VehicleProfile>;
  input?: Partial<PlanInput>;
  stations?: Station[];
  routes?: CandidateRoute[];
  directRoute?: RouteEstimate;
  faults?: FaultEvidence[];
  observedAt?: string;
  now?: Date | string;
  state?: OfficialSnapshot['state'];
} = {}) {
  const profile = { ...DEMO_PROFILE, capacityKWh: 60, consumptionKWhPer100Km: 20, plugTypes: ['CCS2'], maxAcKw: 7, maxDcKw: 50, reserveSoc: 20, minChargerKw: 1, maxWalkingM: 600, ...options.profile };
  const input = { ...DEMO_INPUT, currentSoc: 50, departureAt: '2026-10-15T20:00:00', maxChargingMinutes: 60, maxDetourMinutes: 120, strategy: 'FASTEST' as const, manualTargetSoc: null, ...options.input };
  const stations = options.stations ?? [makeStation()];
  const routes = options.routes ?? stations.map((station) => makeRoute(station.id));
  const observedAt = options.observedAt ?? '2026-10-15T11:59:00+08:00';
  const snapshot: OfficialSnapshot = {
    source: 'DEMO_FIXTURE: synthetic test data', state: options.state ?? 'DEMO_FIXTURE',
    observedAt, retrievedAt: '2026-10-15T11:59:30+08:00', stations,
  };
  return calculatePlan({
    input, profile, snapshot,
    directRoute: options.directRoute ?? { distanceKm: 200, durationMinutes: 90 },
    routes, faults: options.faults ?? [], now: options.now ?? CHECKED_AT,
  });
}

describe('calculatePlan energy, feasibility, pricing, and ranking', () => {
  it('matches an independent numeric oracle for SOC, energy, wall energy, time, cost, and detour', () => {
    const result = calculate();
    const rec = result.recommendations[0];
    expect(rec.arrivalSoc).toBeCloseTo(43.3333333333, 8);
    expect(rec.automaticTargetSoc).toBeCloseTo(53.3333333333, 8);
    expect(rec.requiredBatteryKWh).toBeCloseTo(6, 8);
    expect(rec.requiredChargerKWh).toBeCloseTo(6 / 0.9, 8);
    expect(rec.chargingMinutes).toBeCloseTo(8, 8);
    expect(rec.powerKw).toBe(50);
    expect(rec.estimatedCost).toBeCloseTo(2, 8);
    expect(rec.detourMinutes).toBe(0);
    expect(rec.totalJourneyMinutes).toBeCloseTo(98, 8);
    expect(result.noChargeNeeded).toBe(false);
  });

  it('changes reachability across a 0.1 SOC point boundary without making negative arrival energy feasible', () => {
    const boundaryRoute = makeRoute('station', 150, 100, 30, 60);
    const exactlyReachable = calculate({ routes: [boundaryRoute], input: { currentSoc: 50 } });
    const belowBoundary = calculate({ routes: [boundaryRoute], input: { currentSoc: 49.9 } });
    expect(exactlyReachable.recommendations).toHaveLength(1);
    expect(exactlyReachable.recommendations[0].arrivalSoc).toBe(0);
    expect(belowBoundary.recommendations).toHaveLength(0);
    expect(belowBoundary.excluded[0].code).toBe('UNREACHABLE');
  });

  it('changes the independent battery-energy oracle by 0.1 kWh when the destination leg changes by 0.5 km', () => {
    const short = calculate({ routes: [makeRoute('station', 20, 100)] }).recommendations[0];
    const long = calculate({ routes: [makeRoute('station', 20, 100.5)] }).recommendations[0];
    expect(short.requiredBatteryKWh).toBeCloseTo(6, 8);
    expect(long.requiredBatteryKWh - short.requiredBatteryKWh).toBeCloseTo(0.1, 8);
  });

  it('uses a 90% efficiency and the vehicle charging limit in per-kWh and per-hour estimates', () => {
    const perHour = calculate({ stations: [makeStation('station', makeConnector({ powerKw: 100, price: 0.8, priceType: 'h' }))] }).recommendations[0];
    expect(perHour.powerKw).toBe(50);
    expect(perHour.chargingMinutes).toBeCloseTo(8, 8);
    expect(perHour.estimatedCost).toBeCloseTo(0.8 * 8 / 60, 8);
    const higherPrice = calculate({ stations: [makeStation('station', makeConnector({ price: 0.31 }))] }).recommendations[0];
    expect(higherPrice.estimatedCost!).toBeCloseTo(0.31 * (6 / 0.9), 8);
    expect(higherPrice.estimatedCost! - 2).toBeCloseTo(0.0666666667, 8);
  });

  it('treats unsupported free and unknown prices as unavailable with visible warnings', () => {
    for (const priceType of ['free', 'unknown'] as const) {
      const rec = calculate({ stations: [makeStation('station', makeConnector({ price: null, priceType }))] }).recommendations[0];
      expect(rec.estimatedCost).toBeNull();
      expect(rec.unitPrice).toBeNull();
      expect(rec.warnings.some((warning) => /price is unavailable|free pricing is unsupported/i.test(warning))).toBe(true);
    }
    const unknownWithUnitPrice = calculate({
      stations: [makeStation('station', makeConnector({ price: 0.3, priceType: 'unknown' }))],
    }).recommendations[0];
    expect(unknownWithUnitPrice.estimatedCost).toBeNull();
    expect(unknownWithUnitPrice.unitPrice).toBeNull();
    expect(unknownWithUnitPrice.warnings.some((warning) => warning.includes('unsupported'))).toBe(true);
    const missingKwhPrice = calculate({
      stations: [makeStation('station', makeConnector({ price: null, priceType: 'kWh' }))],
    }).recommendations[0];
    expect(missingKwhPrice.estimatedCost).toBeNull();
    expect(missingKwhPrice.warnings.some((warning) => warning.includes('unit price is invalid'))).toBe(true);
  });

  it('excludes automatic targets above capacity and manual targets below the reserve requirement', () => {
    const tooFarDestination = calculate({ routes: [makeRoute('station', 20, 241)] });
    expect(tooFarDestination.recommendations).toHaveLength(0);
    expect(tooFarDestination.excluded[0].code).toBe('DESTINATION_UNREACHABLE');
    const manualTooLow = calculate({ input: { manualTargetSoc: 50 } });
    expect(manualTooLow.recommendations).toHaveLength(0);
    expect(manualTooLow.excluded[0].code).toBe('MANUAL_TARGET_TOO_LOW');
  });

  it('preserves a feasible manual target above 80% and discloses the taper assumption', () => {
    const result = calculate({ input: { manualTargetSoc: 85 } });
    expect(result.recommendations[0].targetSoc).toBe(85);
    expect(result.recommendations[0].warnings.some((warning) => warning.includes('above 80%'))).toBe(true);
  });

  it('classifies dwell, minimum-power, walking, and no-compatible-plug failures', () => {
    expect(calculate({ input: { maxChargingMinutes: 7 } }).excluded[0].code).toBe('DWELL_LIMIT');
    expect(calculate({ profile: { minChargerKw: 60 } }).excluded[0].code).toBe('BELOW_MINIMUM_POWER');
    expect(calculate({ profile: { maxWalkingM: 50 } }).excluded[0].code).toBe('WALKING_LIMIT');
    expect(calculate({ stations: [makeStation('station', makeConnector({ plugType: 'CHAdeMO' }))] }).excluded[0].code).toBe('NO_COMPATIBLE_CONNECTOR');
  });

  it('explains occupied and unavailable compatible connectors instead of recommending the station', () => {
    const station = makeStation('station', makeConnector({ status: 'OCCUPIED' }));
    station.connectors.push(makeConnector({ id: 'offline', plugType: 'CCS2', status: 'UNAVAILABLE' }));
    const result = calculate({ stations: [station] });
    expect(result.recommendations).toHaveLength(0);
    expect(result.excluded[0].code).toBe('NO_AVAILABLE_CONNECTOR');
    expect(result.excluded[0].reason).toContain('1 occupied');
    expect(result.excluded[0].reason).toContain('1 unavailable');
  });

  it('normalizes only common Combo 2 and Type 2 aliases while retaining the station connector label', () => {
    const combo = calculate({
      profile: { plugTypes: ['Combo 2'] },
      stations: [makeStation('station', makeConnector({ plugType: 'CCS2' }))],
    });
    const type2 = calculate({
      profile: { plugTypes: ['Type 2'] },
      stations: [makeStation('station', makeConnector({ plugType: 'Type2', powerType: 'AC', powerKw: 11 }))],
    });
    expect(combo.recommendations[0].plugType).toBe('CCS2');
    expect(type2.recommendations[0].plugType).toBe('Type2');
  });

  it('treats a zero walking limit as unlimited and excludes unverifiable routes for a positive limit', () => {
    const noLimit = calculate({
      profile: { maxWalkingM: 0 },
      routes: [{ ...makeRoute(), walkingMeters: undefined }],
    });
    const positiveLimit = calculate({
      profile: { maxWalkingM: 100 },
      routes: [{ ...makeRoute(), walkingMeters: undefined }],
    });
    expect(noLimit.recommendations).toHaveLength(1);
    expect(noLimit.recommendations[0].warnings.some((warning) => warning.includes('no walking limit was requested'))).toBe(true);
    expect(positiveLimit.recommendations).toHaveLength(0);
    expect(positiveLimit.excluded[0].code).toBe('WALKING_UNVERIFIED');
  });

  it('checks a complete charging window, handles overnight hours, and discloses unknown hours and walking data', () => {
    const closed = calculate({ stations: [makeStation('station', makeConnector(), { openingHours: '09:00-17:00' })] });
    expect(closed.excluded[0].code).toBe('CLOSED_DURING_CHARGING');
    const overnight = calculate({
      stations: [makeStation('station', makeConnector(), { openingHours: '20:00-06:00' })],
      input: { departureAt: '2026-10-15T23:50:00+08:00' },
      routes: [makeRoute('station', 20, 100, 10, 60)],
    });
    expect(overnight.recommendations).toHaveLength(1);
    const unknownHours = calculate({
      profile: { maxWalkingM: 0 },
      stations: [makeStation('station', makeConnector(), { openingHours: 'weekdays 09:00-17:00' })],
      routes: [{ ...makeRoute(), walkingMeters: undefined }],
    });
    expect(unknownHours.recommendations[0].warnings.some((warning) => warning.includes('could not be parsed'))).toBe(true);
    expect(unknownHours.recommendations[0].warnings.some((warning) => warning.includes('Walking distance is unavailable'))).toBe(true);
    const unparseableAssumed = calculate({ stations: [makeStation('station', makeConnector(), { openingHours: 'unknown', openingHoursAssumed: true })] });
    expect(unparseableAssumed.recommendations[0].warnings.some((warning) => warning.includes('marked as assumed'))).toBe(true);
    expect(unparseableAssumed.recommendations[0].warnings.some((warning) => warning.includes('could not be parsed'))).toBe(true);
  });

  it('uses the Asia/Singapore default for offset-free times and warns when that assumption is made', () => {
    const result = calculate({
      stations: [makeStation('station', makeConnector(), { openingHours: '20:00-21:00' })],
      input: { departureAt: '2026-10-15T20:00:00' },
    });
    expect(result.recommendations[0].warnings.some((warning) => warning.includes('interpreted as Asia/Singapore'))).toBe(true);
  });

  it('orders all five strategies by their published primary metric and resolves ties deterministically', () => {
    const stations = [
      makeStation('A', makeConnector({ id: 'a', powerKw: 50, price: 0.8 })),
      makeStation('B', makeConnector({ id: 'b', powerKw: 40, price: 0.05 })),
      makeStation('C', makeConnector({ id: 'c', powerKw: 30, price: 0.3 })),
      makeStation('D', makeConnector({ id: 'd', powerKw: 30, price: null, priceType: 'unknown' })),
    ];
    const routes = [
      makeRoute('A', 30, 90, 60, 60, 10),
      makeRoute('B', 40, 100, 70, 70, 10),
      makeRoute('C', 30, 70, 50, 50, 10),
      makeRoute('D', 35, 70, 52, 53, 10),
    ];
    const order = (strategy: PlanInput['strategy']) => calculate({ stations, routes, input: { strategy } }).recommendations.map((rec) => rec.stationId);
    expect(order('FASTEST')[0]).toBe('C');
    expect(order('CHEAPEST')[0]).toBe('B');
    expect(calculate({ stations: stations.slice(1), routes: routes.slice(1), input: { strategy: 'CHEAPEST' } }).recommendations.at(-1)?.stationId).toBe('D');
    expect(order('AVAILABILITY')[0]).toBe('C');
    expect(order('DETOUR')[0]).toBe('C');
    expect(order('BALANCED')[0]).toBe('C');
    const tie = calculate({
      stations: [makeStation('z'), makeStation('a')],
      routes: [makeRoute('z', 20, 100, 30, 60), makeRoute('a', 20, 100, 30, 60)],
      input: { strategy: 'FASTEST' },
    });
    expect(tie.recommendations.map((rec) => rec.stationId)).toEqual(['a', 'z']);
  });

  it('selects only one connector per station, then returns at most three ranked recommendations', () => {
    const multi = makeStation('station', makeConnector({ id: 'slow', powerKw: 10 }));
    multi.connectors.push(makeConnector({ id: 'fast', powerKw: 100 }));
    const stations = [multi, makeStation('second'), makeStation('third'), makeStation('fourth')];
    const result = calculate({ stations });
    expect(result.recommendations).toHaveLength(3);
    expect(new Set(result.recommendations.map((rec) => rec.stationId)).size).toBe(3);
    expect(result.recommendations.find((rec) => rec.stationId === 'station')?.connectorId).toBe('fast');
    expect(result.recommendations.map((rec) => rec.rank)).toEqual([1, 2, 3]);
  });

  it('filters active faults after ranking, records evidence, and omits expired or unrelated evidence', () => {
    const stations = [makeStation('fast'), makeStation('fallback')];
    const routes = [makeRoute('fast', 20, 100, 20, 50), makeRoute('fallback', 20, 100, 40, 60)];
    const faults: FaultEvidence[] = [
      { stationId: 'fast', reportId: 'active-report', decisionId: 'decision-1', expiresAt: '2026-10-15T13:00:00+08:00' },
      { stationId: 'fallback', reportId: 'expired-report', expiresAt: '2026-10-15T11:59:00+08:00' },
      { stationId: 'unrelated', reportId: 'unused-report', expiresAt: '2026-10-15T13:00:00+08:00' },
    ];
    const result = calculate({ stations, routes, faults });
    expect(result.recommendations.map((rec) => rec.stationId)).toEqual(['fallback']);
    expect(result.recommendations[0].rank).toBe(1);
    expect(result.excluded.find((item) => item.stationId === 'fast')?.code).toBe('ACTIVE_FAULT_MARK');
    expect(result.faultEvidence).toEqual([faults[0]]);
    expect(result.faultFilterCheckedAt).toBe('2026-10-15T04:00:00.000Z');
  });

  it('permits zero or one recommendation and marks enough direct charge without claiming a required stop', () => {
    const enough = calculate({ directRoute: { distanceKm: 50, durationMinutes: 45 } });
    expect(enough.noChargeNeeded).toBe(true);
    expect(enough.summary).toContain('sufficient');
    const one = calculate({ stations: [makeStation()] });
    expect(one.recommendations).toHaveLength(1);
    const zero = calculate({ stations: [] });
    expect(zero.recommendations).toHaveLength(0);
    expect(zero.summary).toContain('No eligible');
  });

  it('marks snapshots stale at 10 minutes, but not at 9:59, and preserves the Demo Fixture label', () => {
    const fresh = calculate({ observedAt: '2026-10-15T11:50:01+08:00', state: 'LIVE' });
    const stale = calculate({ observedAt: '2026-10-15T11:50:00+08:00', state: 'LIVE' });
    expect(fresh.snapshot.state).toBe('LIVE');
    expect(stale.snapshot.state).toBe('STALE');
    expect(stale.recommendations[0].warnings.some((warning) => warning.includes('at least 10 minutes'))).toBe(true);
    expect(calculate({ observedAt: '2026-10-15T11:00:00+08:00' }).snapshot.state).toBe('DEMO_FIXTURE');
  });

  it('warns and assumes all-day access when operating hours are missing or explicitly assumed', () => {
    const missing = calculate({ stations: [makeStation('station', makeConnector(), { openingHours: null, openingHoursAssumed: false })] });
    const assumed = calculate({ stations: [makeStation('station', makeConnector(), { openingHours: '09:00-17:00', openingHoursAssumed: true })] });
    expect(missing.recommendations[0].warnings.some((warning) => warning.includes('assumed open all day'))).toBe(true);
    expect(assumed.recommendations).toHaveLength(0);
    expect(assumed.excluded[0].code).toBe('CLOSED_DURING_CHARGING');
  });

  it('keeps fixture data synthetic, reusable, and able to exercise all requested branches', () => {
    expect(DEMO_SNAPSHOT.stations.length).toBeGreaterThanOrEqual(6);
    const result = calculatePlan({
      input: DEMO_INPUT, profile: DEMO_PROFILE, snapshot: DEMO_SNAPSHOT,
      directRoute: DEMO_DIRECT_ROUTE, routes: DEMO_ROUTES, faults: DEMO_FAULTS,
      now: '2026-10-15T12:00:00+08:00',
    });
    expect(result.snapshot.source).toContain('DEMO_FIXTURE');
    expect(result.excluded.map((item) => item.code)).toEqual(expect.arrayContaining([
      'NO_COMPATIBLE_CONNECTOR', 'UNREACHABLE', 'CLOSED_DURING_CHARGING', 'DWELL_LIMIT', 'NO_AVAILABLE_CONNECTOR', 'ACTIVE_FAULT_MARK',
    ]));
    expect(result.recommendations.some((rec) => rec.estimatedCost === null)).toBe(true);
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
  });

  it('completes 100 deterministic fixture runs with byte-stable results', () => {
    const run = () => calculatePlan({
      input: DEMO_INPUT, profile: DEMO_PROFILE, snapshot: DEMO_SNAPSHOT,
      directRoute: DEMO_DIRECT_ROUTE, routes: DEMO_ROUTES, faults: DEMO_FAULTS,
      now: '2026-10-15T12:00:00+08:00',
    });
    const expected = JSON.stringify(run());
    for (let index = 0; index < 100; index += 1) expect(JSON.stringify(run())).toBe(expected);
  });

  it('builds an input-responsive Singapore-scale demo with three varied options for the low-SOC default', () => {
    const profile: VehicleProfile = {
      ...DEMO_PROFILE, name: 'Default LTA profile', capacityKWh: 60, consumptionKWhPer100Km: 17.5,
      plugTypes: ['Combo 2', 'Type 2', 'CHAdeMO'], maxAcKw: 11, maxDcKw: 100, reserveSoc: 20, maxWalkingM: 0,
    };
    const input: PlanInput = {
      ...DEMO_INPUT, currentSoc: 18, maxChargingMinutes: 45, maxDetourMinutes: 15,
      strategy: 'FASTEST', departureAt: '2026-10-15T20:00:00+08:00', manualTargetSoc: null,
    };
    const scenario = createDemoScenario(input, profile);
    const result = calculatePlan({ ...scenario, input, profile, faults: DEMO_FAULTS, now: CHECKED_AT });
    expect(scenario.directRoute).toMatchObject({ distanceKm: 30, durationMinutes: 30 });
    expect(result.snapshot.source).toContain('DEMO_FIXTURE');
    expect(result.recommendations).toHaveLength(3);
    expect(new Set(result.recommendations.map((item) => item.powerKw)).size).toBe(3);
    expect(new Set(result.recommendations.map((item) => item.estimatedCost)).size).toBe(3);
    expect(result.recommendations.every((item) => item.chargingMinutes > 0 && item.chargingMinutes < 45)).toBe(true);

    const enoughCharge = { ...input, currentSoc: 100 };
    const highChargeScenario = createDemoScenario(enoughCharge, profile);
    const enough = calculatePlan({ ...highChargeScenario, input: enoughCharge, profile, faults: DEMO_FAULTS, now: CHECKED_AT });
    expect(enough.noChargeNeeded).toBe(true);
  });
});
