import { connector, decision, defineCases, hasWarning, metrics, plan, route, station, type LabCase } from './lab4.helpers';
import type { CandidateRoute, PlanResult, Station, Strategy } from '../src/lib/types';

/**
 * Black-box tests of the PlanEngine control class (calculatePlan).
 * Equivalence classes and boundaries come from the SRS and the validated input ranges;
 * every expected value was calculated by hand before the suite was run.
 */
const accepted = 'RECOMMENDED s1';

function ids(result: PlanResult): string {
  return result.recommendations.map((item) => item.stationId).join('>');
}

const taper = (result: PlanResult) => `targetSoc=${result.recommendations[0]?.targetSoc.toFixed(2)} taperWarning=${hasWarning(result, 'above 80%')}`;
const cost = (result: PlanResult) => {
  const value = result.recommendations[0]?.estimatedCost;
  return `cost=${value === null || value === undefined ? 'null' : value.toFixed(2)}`;
};

const rankingStations: Station[] = [
  station('A', [connector({ id: 'a1', powerKw: 50, price: 0.6 }), connector({ id: 'a2', powerKw: 50, price: 0.6, status: 'OCCUPIED' })]),
  station('B', [connector({ id: 'b1', powerKw: 10, price: 0.4 }), connector({ id: 'b2', powerKw: 10, price: 0.4, status: 'OCCUPIED' })]),
  station('C', [connector({ id: 'c1', powerKw: 25, price: 0.1 }), connector({ id: 'c2', powerKw: 25, price: 0.1, status: 'UNAVAILABLE' })]),
  station('D', [connector({ id: 'd1', powerKw: 20, price: 0.5 }), connector({ id: 'd2', powerKw: 20, price: 0.5 })]),
];
const rankingRoutes: CandidateRoute[] = [
  route('A', {}, 20, 100, 40, 60), route('B', {}, 20, 100, 30, 60), route('C', {}, 20, 100, 50, 60), route('D', {}, 20, 100, 60, 60),
];
const rank = (strategy: Strategy) => () => ids(plan({ stations: rankingStations, routes: rankingRoutes, input: { strategy } }));

const many = (count: number) => Array.from({ length: count }, (_, index) => station(`s${index + 1}`));

const cases: LabCase[] = [
  // Current SOC: valid [0, 100]
  { id: 'BB-01', design: 'SOC invalid low (boundary-)', trace: 'FR-05', input: 'currentSoc=-0.1', expected: 'REJECTED currentSoc', run: () => decision(plan({ input: { currentSoc: -0.1 } })) },
  { id: 'BB-02', design: 'SOC valid (lower boundary)', trace: 'FR-05, FR-08', input: 'currentSoc=0; to-station 0 km', expected: 'arrivalSoc=0.00 targetSoc=53.33 batteryKWh=32.00 min=42.67 cost=10.67', run: () => metrics(plan({ input: { currentSoc: 0 }, routes: [route('s1', {}, 0)] })) },
  { id: 'BB-03', design: 'SOC valid (nominal, numeric oracle)', trace: 'FR-08, FR-13, FR-15, FR-17, NFR-04', input: 'Baseline: currentSoc=50', expected: 'arrivalSoc=43.33 targetSoc=53.33 batteryKWh=6.00 min=8.00 cost=2.00', run: () => metrics(plan()) },
  { id: 'BB-04', design: 'SOC valid (upper boundary)', trace: 'FR-05, FR-13', input: 'currentSoc=100', expected: 'EXCLUDED NO_CHARGING_REQUIRED', run: () => decision(plan({ input: { currentSoc: 100 } })) },
  { id: 'BB-05', design: 'SOC invalid high (boundary+)', trace: 'FR-05', input: 'currentSoc=100.1', expected: 'REJECTED currentSoc', run: () => decision(plan({ input: { currentSoc: 100.1 } })) },
  // Arrival energy: >= 0 reachable
  { id: 'BB-06', design: 'Arrival energy = 0 (boundary, reachable)', trace: 'FR-09', input: 'to-station 150 km; currentSoc=50', expected: accepted, run: () => decision(plan({ routes: [route('s1', {}, 150)] })) },
  { id: 'BB-07', design: 'Arrival energy < 0 (boundary-)', trace: 'FR-09', input: 'to-station 150 km; currentSoc=49.9', expected: 'EXCLUDED UNREACHABLE', run: () => decision(plan({ input: { currentSoc: 49.9 }, routes: [route('s1', {}, 150)] })) },
  // Maximum detour: valid [0, 120]; feasible when detour <= limit
  { id: 'BB-08', design: 'Detour limit invalid low', trace: 'FR-05', input: 'maxDetourMinutes=-0.1', expected: 'REJECTED maxDetourMinutes', run: () => decision(plan({ input: { maxDetourMinutes: -0.1 } })) },
  { id: 'BB-09', design: 'Detour limit lower boundary', trace: 'FR-12', input: 'maxDetourMinutes=0; detour 0', expected: accepted, run: () => decision(plan({ input: { maxDetourMinutes: 0 } })) },
  { id: 'BB-10', design: 'Detour equals limit (boundary)', trace: 'FR-12', input: 'maxDetourMinutes=10; detour 10', expected: accepted, run: () => decision(plan({ input: { maxDetourMinutes: 10 }, routes: [route('s1', {}, 20, 100, 40, 60)] })) },
  { id: 'BB-11', design: 'Detour above limit (boundary+)', trace: 'FR-12', input: 'maxDetourMinutes=9.9; detour 10', expected: 'EXCLUDED DETOUR_LIMIT', run: () => decision(plan({ input: { maxDetourMinutes: 9.9 }, routes: [route('s1', {}, 20, 100, 40, 60)] })) },
  { id: 'BB-12', design: 'Detour limit upper boundary', trace: 'FR-05', input: 'maxDetourMinutes=120', expected: accepted, run: () => decision(plan({ input: { maxDetourMinutes: 120 } })) },
  { id: 'BB-13', design: 'Detour limit invalid high', trace: 'FR-05', input: 'maxDetourMinutes=120.1', expected: 'REJECTED maxDetourMinutes', run: () => decision(plan({ input: { maxDetourMinutes: 120.1 } })) },
  // Maximum charging duration: valid [5, 720]; baseline needs 8 min
  { id: 'BB-14', design: 'Charging limit invalid low', trace: 'FR-05', input: 'maxChargingMinutes=4.9', expected: 'REJECTED maxChargingMinutes', run: () => decision(plan({ input: { maxChargingMinutes: 4.9 } })) },
  { id: 'BB-15', design: 'Charging limit lower boundary', trace: 'FR-16', input: 'maxChargingMinutes=5; needs 8 min', expected: 'EXCLUDED DWELL_LIMIT', run: () => decision(plan({ input: { maxChargingMinutes: 5 } })) },
  { id: 'BB-16', design: 'Charging time just above limit', trace: 'FR-16', input: 'maxChargingMinutes=7.9; needs 8 min', expected: 'EXCLUDED DWELL_LIMIT', run: () => decision(plan({ input: { maxChargingMinutes: 7.9 } })) },
  { id: 'BB-17', design: 'Charging time equals limit (boundary)', trace: 'FR-16', input: 'maxChargingMinutes=8; needs 8 min', expected: accepted, run: () => decision(plan({ input: { maxChargingMinutes: 8 } })) },
  { id: 'BB-18', design: 'Charging limit upper boundary', trace: 'FR-05', input: 'maxChargingMinutes=720', expected: accepted, run: () => decision(plan({ input: { maxChargingMinutes: 720 } })) },
  { id: 'BB-19', design: 'Charging limit invalid high', trace: 'FR-05', input: 'maxChargingMinutes=720.1', expected: 'REJECTED maxChargingMinutes', run: () => decision(plan({ input: { maxChargingMinutes: 720.1 } })) },
  // Manual target SOC: null or [0, 100]; must reach the automatic target 53.33%
  { id: 'BB-20', design: 'Manual target absent', trace: 'FR-13, FR-14', input: 'manualTargetSoc=null', expected: 'targetSoc=53.33 taperWarning=false', run: () => taper(plan()) },
  { id: 'BB-21', design: 'Manual target invalid low', trace: 'FR-14', input: 'manualTargetSoc=-0.1', expected: 'REJECTED manualTargetSoc', run: () => decision(plan({ input: { manualTargetSoc: -0.1 } })) },
  { id: 'BB-22', design: 'Manual target lower boundary', trace: 'FR-14', input: 'manualTargetSoc=0', expected: 'EXCLUDED MANUAL_TARGET_TOO_LOW', run: () => decision(plan({ input: { manualTargetSoc: 0 } })) },
  { id: 'BB-23', design: 'Manual target just below automatic', trace: 'FR-14', input: 'manualTargetSoc=53.3; automatic 53.33', expected: 'EXCLUDED MANUAL_TARGET_TOO_LOW', run: () => decision(plan({ input: { manualTargetSoc: 53.3 } })) },
  { id: 'BB-24', design: 'Manual target just above automatic', trace: 'FR-14', input: 'manualTargetSoc=53.34; automatic 53.33', expected: 'targetSoc=53.34 taperWarning=false', run: () => taper(plan({ input: { manualTargetSoc: 53.34 } })) },
  { id: 'BB-25', design: 'Target at 80% (taper boundary)', trace: 'FR-14', input: 'manualTargetSoc=80', expected: 'targetSoc=80.00 taperWarning=false', run: () => taper(plan({ input: { manualTargetSoc: 80 } })) },
  { id: 'BB-26', design: 'Target above 80% (taper boundary+)', trace: 'FR-14', input: 'manualTargetSoc=80.1', expected: 'targetSoc=80.10 taperWarning=true', run: () => taper(plan({ input: { manualTargetSoc: 80.1 } })) },
  { id: 'BB-27', design: 'Manual target upper boundary', trace: 'FR-14', input: 'manualTargetSoc=100', expected: 'targetSoc=100.00 taperWarning=true', run: () => taper(plan({ input: { manualTargetSoc: 100 } })) },
  { id: 'BB-28', design: 'Manual target invalid high', trace: 'FR-14', input: 'manualTargetSoc=100.1', expected: 'REJECTED manualTargetSoc', run: () => decision(plan({ input: { manualTargetSoc: 100.1 } })) },
  // Vehicle profile: reserve [5, 40], capacity [10, 250]
  { id: 'BB-29', design: 'Reserve invalid low', trace: 'FR-04', input: 'reserveSoc=4.9', expected: 'REJECTED reserveSoc', run: () => decision(plan({ profile: { reserveSoc: 4.9 } })) },
  { id: 'BB-30', design: 'Reserve lower boundary', trace: 'FR-13', input: 'reserveSoc=5; target 23 kWh, arrival 26 kWh', expected: 'EXCLUDED NO_CHARGING_REQUIRED', run: () => decision(plan({ profile: { reserveSoc: 5 } })) },
  { id: 'BB-31', design: 'Reserve upper boundary', trace: 'FR-13', input: 'reserveSoc=40', expected: 'targetSoc=73.33 taperWarning=false', run: () => taper(plan({ profile: { reserveSoc: 40 } })) },
  { id: 'BB-32', design: 'Reserve invalid high', trace: 'FR-04', input: 'reserveSoc=40.1', expected: 'REJECTED reserveSoc', run: () => decision(plan({ profile: { reserveSoc: 40.1 } })) },
  { id: 'BB-33', design: 'Capacity invalid low', trace: 'FR-04', input: 'capacityKWh=9.9', expected: 'REJECTED capacityKWh', run: () => decision(plan({ profile: { capacityKWh: 9.9 } })) },
  { id: 'BB-34', design: 'Capacity lower boundary', trace: 'FR-13', input: 'capacityKWh=10; target 22 kWh', expected: 'EXCLUDED DESTINATION_UNREACHABLE', run: () => decision(plan({ profile: { capacityKWh: 10 } })) },
  { id: 'BB-35', design: 'Capacity upper boundary', trace: 'FR-13', input: 'capacityKWh=250; arrival 121 kWh, target 70 kWh', expected: 'EXCLUDED NO_CHARGING_REQUIRED', run: () => decision(plan({ profile: { capacityKWh: 250 } })) },
  { id: 'BB-36', design: 'Capacity invalid high', trace: 'FR-04', input: 'capacityKWh=250.1', expected: 'REJECTED capacityKWh', run: () => decision(plan({ profile: { capacityKWh: 250.1 } })) },
  // Destination energy plus reserve must fit the battery
  { id: 'BB-37', design: 'Target equals capacity (boundary)', trace: 'FR-13', input: 'onward 240 km; needs exactly 60 kWh', expected: 'targetSoc=100.00 taperWarning=true', run: () => taper(plan({ routes: [route('s1', {}, 20, 240)] })) },
  { id: 'BB-38', design: 'Target above capacity (boundary+)', trace: 'FR-13', input: 'onward 241 km; needs 60.2 kWh', expected: 'EXCLUDED DESTINATION_UNREACHABLE', run: () => decision(plan({ routes: [route('s1', {}, 20, 241)] })) },
  // Direct-trip sufficiency: arrival at destination >= reserve
  { id: 'BB-39', design: 'Direct trip leaves exactly reserve', trace: 'FR-13', input: 'direct 90 km; 12 kWh left, reserve 12 kWh', expected: 'noChargeNeeded=true', run: () => `noChargeNeeded=${plan({ directRoute: { distanceKm: 90, durationMinutes: 90 } }).noChargeNeeded}` },
  { id: 'BB-40', design: 'Direct trip below reserve (boundary-)', trace: 'FR-13', input: 'direct 90.5 km; 11.9 kWh left', expected: 'noChargeNeeded=false', run: () => `noChargeNeeded=${plan({ directRoute: { distanceKm: 90.5, durationMinutes: 90 } }).noChargeNeeded}` },
  // Plug compatibility
  { id: 'BB-41', design: 'Compatible plug via alias', trace: 'FR-10', input: 'vehicle "Combo 2"; station CCS2', expected: accepted, run: () => decision(plan({ profile: { plugTypes: ['Combo 2'] } })) },
  { id: 'BB-42', design: 'No compatible plug', trace: 'FR-10', input: 'vehicle CCS2; station CHAdeMO', expected: 'EXCLUDED NO_COMPATIBLE_CONNECTOR', run: () => decision(plan({ stations: [station('s1', [connector({ plugType: 'CHAdeMO' })])] })) },
  // Opening hours: charging window 20:30-20:38 must fit
  { id: 'BB-43', design: 'Window exactly fits opening hours', trace: 'FR-11', input: 'openingHours=20:30-20:38', expected: accepted, run: () => decision(plan({ stations: [station('s1', [connector()], { openingHours: '20:30-20:38' })] })) },
  { id: 'BB-44', design: 'Opens one minute after arrival', trace: 'FR-11', input: 'openingHours=20:31-21:00', expected: 'EXCLUDED CLOSED_DURING_CHARGING', run: () => decision(plan({ stations: [station('s1', [connector()], { openingHours: '20:31-21:00' })] })) },
  { id: 'BB-45', design: 'Closes before charging ends', trace: 'FR-11', input: 'openingHours=20:00-20:37', expected: 'EXCLUDED CLOSED_DURING_CHARGING', run: () => decision(plan({ stations: [station('s1', [connector()], { openingHours: '20:00-20:37' })] })) },
  { id: 'BB-46', design: 'Overnight hours span midnight', trace: 'FR-11', input: 'openingHours=20:00-06:00', expected: accepted, run: () => decision(plan({ stations: [station('s1', [connector()], { openingHours: '20:00-06:00' })] })) },
  // Effective power and minimum charger power
  { id: 'BB-47', design: 'Connector above vehicle limit', trace: 'FR-15', input: 'connector 100 kW; vehicle DC 50 kW', expected: 'powerKw=50 min=8.00', run: () => { const first = plan().recommendations[0]; return `powerKw=${first.powerKw} min=${first.chargingMinutes.toFixed(2)}`; } },
  { id: 'BB-48', design: 'Connector below vehicle limit', trace: 'FR-15', input: 'connector 40 kW; vehicle DC 50 kW', expected: 'powerKw=40 min=10.00', run: () => { const first = plan({ stations: [station('s1', [connector({ powerKw: 40 })])] }).recommendations[0]; return `powerKw=${first.powerKw} min=${first.chargingMinutes.toFixed(2)}`; } },
  { id: 'BB-49', design: 'Power equals minimum (boundary)', trace: 'FR-15', input: 'minChargerKw=50; effective 50 kW', expected: accepted, run: () => decision(plan({ profile: { minChargerKw: 50 } })) },
  { id: 'BB-50', design: 'Power below minimum (boundary-)', trace: 'FR-15', input: 'minChargerKw=50.1; effective 50 kW', expected: 'EXCLUDED BELOW_MINIMUM_POWER', run: () => decision(plan({ profile: { minChargerKw: 50.1 } })) },
  // Price classes
  { id: 'BB-51', design: 'Per-kWh price', trace: 'FR-17', input: 'S$0.30/kWh', expected: 'cost=2.00', run: () => cost(plan()) },
  { id: 'BB-52', design: 'Per-hour price', trace: 'FR-17', input: 'S$0.80/h; 8 min', expected: 'cost=0.11', run: () => cost(plan({ stations: [station('s1', [connector({ price: 0.8, priceType: 'h' })])] })) },
  { id: 'BB-53', design: 'Zero price (boundary)', trace: 'FR-17', input: 'S$0/kWh', expected: 'cost=0.00', run: () => cost(plan({ stations: [station('s1', [connector({ price: 0 })])] })) },
  { id: 'BB-54', design: 'Negative price (invalid)', trace: 'FR-17', input: 'S$-0.01/kWh', expected: 'cost=null', run: () => cost(plan({ stations: [station('s1', [connector({ price: -0.01 })])] })) },
  { id: 'BB-55', design: 'Unsupported price type', trace: 'FR-17', input: 'priceType=free', expected: 'cost=null', run: () => cost(plan({ stations: [station('s1', [connector({ price: null, priceType: 'free' })])] })) },
  // Ranking strategy: five valid values, one invalid
  { id: 'BB-56', design: 'Strategy FASTEST', trace: 'FR-18', input: 'Four-station ranking fixture', expected: 'A>C>B', run: rank('FASTEST') },
  { id: 'BB-57', design: 'Strategy CHEAPEST', trace: 'FR-18', input: 'Four-station ranking fixture', expected: 'C>B>D', run: rank('CHEAPEST') },
  { id: 'BB-58', design: 'Strategy AVAILABILITY', trace: 'FR-18', input: 'Four-station ranking fixture', expected: 'D>A>C', run: rank('AVAILABILITY') },
  { id: 'BB-59', design: 'Strategy DETOUR', trace: 'FR-18', input: 'Four-station ranking fixture', expected: 'B>A>C', run: rank('DETOUR') },
  { id: 'BB-60', design: 'Strategy BALANCED', trace: 'FR-18', input: 'Four-station ranking fixture', expected: 'C>A>B', run: rank('BALANCED') },
  { id: 'BB-61', design: 'Strategy invalid', trace: 'FR-05', input: 'strategy=RANDOM', expected: 'REJECTED strategy', run: () => decision(plan({ input: { strategy: 'RANDOM' as Strategy } })) },
  // Shortlist size: at most three
  { id: 'BB-62', design: 'Three feasible stations (boundary)', trace: 'FR-19', input: '3 stations', expected: 'RECOMMENDED s1,s2,s3', run: () => decision(plan({ stations: many(3) })) },
  { id: 'BB-63', design: 'Four feasible stations (boundary+)', trace: 'FR-19', input: '4 stations', expected: 'RECOMMENDED s1,s2,s3', run: () => decision(plan({ stations: many(4) })) },
  // Departure time format
  { id: 'BB-64', design: 'Departure without offset', trace: 'FR-05', input: 'departureAt=2026-10-15T20:00:00', expected: 'singaporeAssumed=true', run: () => `singaporeAssumed=${hasWarning(plan({ input: { departureAt: '2026-10-15T20:00:00' } }), 'interpreted as Asia/Singapore')}` },
  { id: 'BB-65', design: 'Departure impossible date', trace: 'FR-05', input: 'departureAt=2026-02-30T10:00:00+08:00', expected: 'REJECTED departureAt', run: () => decision(plan({ input: { departureAt: '2026-02-30T10:00:00+08:00' } })) },
  // Data freshness: stale from 10 minutes
  { id: 'BB-66', design: 'Data age 9:59 (boundary-)', trace: 'NFR-03', input: 'observedAt=11:50:01; now=12:00:00', expected: 'state=LIVE', run: () => `state=${plan({ observedAt: '2026-10-15T11:50:01+08:00' }).snapshot.state}` },
  { id: 'BB-67', design: 'Data age 10:00 (boundary)', trace: 'NFR-03', input: 'observedAt=11:50:00; now=12:00:00', expected: 'state=STALE', run: () => `state=${plan({ observedAt: '2026-10-15T11:50:00+08:00' }).snapshot.state}` },
  // Verified fault expiry: active while expiry is after now
  { id: 'BB-68', design: 'Fault expires after now', trace: 'FR-23, FR-25', input: 'expiresAt=12:00:01; now=12:00:00', expected: 'EXCLUDED ACTIVE_FAULT_MARK', run: () => decision(plan({ faults: [{ stationId: 's1', reportId: 'r1', expiresAt: '2026-10-15T12:00:01+08:00' }] })) },
  { id: 'BB-69', design: 'Fault expires at now (boundary)', trace: 'FR-23, FR-25', input: 'expiresAt=12:00:00; now=12:00:00', expected: accepted, run: () => decision(plan({ faults: [{ stationId: 's1', reportId: 'r1', expiresAt: '2026-10-15T12:00:00+08:00' }] })) },
];

defineCases('blackbox', cases);
