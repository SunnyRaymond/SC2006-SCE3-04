import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { calculatePlan } from '../src/lib/domain/engine';
import type {
  CandidateRoute, Connector, FaultEvidence, OfficialSnapshot, PlanInput, PlanResult,
  RouteEstimate, Station, VehicleProfile,
} from '../src/lib/types';

/**
 * Shared fixture for the Lab 4 black-box and basis-path suites.
 *
 * Baseline (hand calculation): 60 kWh battery, 20 kWh/100 km, SOC 50%, reserve 20%,
 * 20 km / 30 min to the station, 100 km / 60 min onward, 200 km / 90 min direct.
 * Arrival 26 kWh (43.33%), target 32 kWh (53.33%), 6 kWh into the battery,
 * 6.67 kWh from the charger, 50 kW effective, 8 min, S$2.00, detour 0.
 */
export function connector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'c1', plugType: 'CCS2', powerType: 'DC', powerKw: 100, price: 0.3, priceType: 'kWh', status: 'AVAILABLE', ...overrides };
}

export function station(id = 's1', connectors: Connector[] = [connector()], overrides: Partial<Station> = {}): Station {
  return { id, name: id, address: 'test', postal: '000000', lat: 1.3, lng: 103.8, operator: 'TEST', openingHours: '24/7', openingHoursAssumed: false, connectors, ...overrides };
}

export function route(stationId = 's1', overrides: Partial<CandidateRoute> = {}, toKm = 20, fromKm = 100, toMin = 30, fromMin = 60): CandidateRoute {
  return {
    stationId,
    toStation: { distanceKm: toKm, durationMinutes: toMin },
    fromStation: { distanceKm: fromKm, durationMinutes: fromMin },
    walkingMeters: 100,
    ...overrides,
  };
}

export interface PlanOptions {
  profile?: Partial<VehicleProfile>;
  input?: Partial<PlanInput>;
  stations?: Station[];
  routes?: CandidateRoute[];
  directRoute?: RouteEstimate;
  faults?: FaultEvidence[];
  observedAt?: string;
  retrievedAt?: string;
  now?: string;
  state?: OfficialSnapshot['state'];
}

export function plan(options: PlanOptions = {}): PlanResult {
  const profile: VehicleProfile = {
    name: 'Test EV', capacityKWh: 60, consumptionKWhPer100Km: 20, plugTypes: ['CCS2'], maxAcKw: 7, maxDcKw: 50,
    reserveSoc: 20, defaultDetourMinutes: 45, minChargerKw: 1, maxWalkingM: 600, ...options.profile,
  };
  const input: PlanInput = {
    origin: { label: 'Origin', lat: 1.29, lng: 103.85 }, destination: { label: 'Destination', lat: 1.35, lng: 103.82 },
    currentSoc: 50, departureAt: '2026-10-15T20:00:00+08:00', maxChargingMinutes: 60, maxDetourMinutes: 120,
    strategy: 'FASTEST', manualTargetSoc: null, ...options.input,
  };
  const stations = options.stations ?? [station()];
  return calculatePlan({
    input,
    profile,
    snapshot: {
      source: 'TEST', state: options.state ?? 'LIVE', observedAt: options.observedAt ?? '2026-10-15T11:59:00+08:00',
      retrievedAt: options.retrievedAt ?? '2026-10-15T11:59:30+08:00', stations,
    },
    directRoute: options.directRoute ?? { distanceKm: 200, durationMinutes: 90 },
    routes: options.routes ?? stations.map((item) => route(item.id)),
    faults: options.faults ?? [],
    now: options.now ?? '2026-10-15T12:00:00+08:00',
  });
}

/** Feasibility decision only: which stations survive, or the exclusion codes. */
export function decision(result: PlanResult): string {
  if (result.recommendations.length > 0) return `RECOMMENDED ${result.recommendations.map((item) => item.stationId).join(',')}`;
  if (result.excluded.length > 0) return `EXCLUDED ${result.excluded.map((item) => item.code).join(',')}`;
  return 'NO_OPTIONS';
}

/** Decision plus the numeric fields of the first recommendation. */
export function metrics(result: PlanResult): string {
  const first = result.recommendations[0];
  if (!first) return decision(result);
  const cost = first.estimatedCost === null ? 'null' : first.estimatedCost.toFixed(2);
  return `arrivalSoc=${first.arrivalSoc.toFixed(2)} targetSoc=${first.targetSoc.toFixed(2)} batteryKWh=${first.requiredBatteryKWh.toFixed(2)} min=${first.chargingMinutes.toFixed(2)} cost=${cost}`;
}

export function hasWarning(result: PlanResult, text: string): boolean {
  return result.recommendations.some((item) => item.warnings.some((warning) => warning.includes(text)));
}

export interface LabCase {
  id: string;
  /** Equivalence class / boundary, or the basis path taken. */
  design: string;
  /** Requirement or decision node traced to. */
  trace: string;
  input: string;
  expected: string;
  run: () => string;
}

function execute(run: () => string): string {
  try {
    return run();
  } catch (error) {
    if (error instanceof ZodError) return `REJECTED ${error.issues[0].path.join('.')}`;
    if (error instanceof Error) return `ERROR ${error.name}`;
    throw error;
  }
}

/**
 * Registers each case as a Vitest test. When LAB4_RESULTS_DIR is set, the observed
 * actual output of every case is written to JSON for the submitted results table.
 */
export function defineCases(suite: string, cases: LabCase[]): void {
  const rows: Array<Omit<LabCase, 'run'> & { actual: string; result: string }> = [];
  describe(suite, () => {
    afterAll(() => {
      const directory = process.env.LAB4_RESULTS_DIR;
      if (!directory) return;
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, `${suite}.json`), JSON.stringify(rows, null, 2));
    });
    for (const { run, ...details } of cases) {
      it(`${details.id}: ${details.design}`, () => {
        const actual = execute(run);
        rows.push({ ...details, actual, result: actual === details.expected ? 'PASS' : 'FAIL' });
        expect(actual).toBe(details.expected);
      });
    }
  });
}
