import type { CandidateRoute, Connector, FaultEvidence, OfficialSnapshot, PlanInput, RouteEstimate, Station, VehicleProfile } from '../types';

export const DEMO_PROFILE: VehicleProfile = {
  name: 'Demo EV',
  capacityKWh: 75,
  consumptionKWhPer100Km: 16,
  plugTypes: ['CCS2', 'Type2'],
  maxAcKw: 11,
  maxDcKw: 120,
  reserveSoc: 20,
  defaultDetourMinutes: 45,
  minChargerKw: 1,
  maxWalkingM: 600,
};

export const DEMO_INPUT: PlanInput = {
  origin: { label: 'Demo origin', lat: 1.29027, lng: 103.851959 },
  destination: { label: 'Demo destination', lat: 1.352083, lng: 103.819836 },
  currentSoc: 62,
  departureAt: '2026-10-15T20:00:00+08:00',
  maxChargingMinutes: 45,
  maxDetourMinutes: 60,
  strategy: 'BALANCED',
  manualTargetSoc: null,
};

const connector = (value: Connector): Connector => value;
const makeStation = (station: Station): Station => station;

const stations: Station[] = [
  makeStation({
    id: 'DEMO-FAST', name: 'Demo Fast Charge', address: 'Demo fixture location 1', postal: '000001',
    lat: 1.300, lng: 103.840, operator: 'DEMO_FIXTURE', openingHours: '24/7', openingHoursAssumed: false,
    connectors: [connector({ id: 'DEMO-FAST-CCS', plugType: 'CCS2', powerType: 'DC', powerKw: 150, price: 0.55, priceType: 'kWh', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-CHEAP', name: 'Demo Value Charge', address: 'Demo fixture location 2', postal: '000002',
    lat: 1.310, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: '24h', openingHoursAssumed: false,
    connectors: [connector({ id: 'DEMO-CHEAP-TYPE2', plugType: 'Type2', powerType: 'AC', powerKw: 11, price: 0.35, priceType: 'kWh', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-INCOMPATIBLE', name: 'Demo Other Plug', address: 'Demo fixture location 3', postal: '000003',
    lat: 1.320, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: null, openingHoursAssumed: true,
    connectors: [connector({ id: 'DEMO-OTHER-CHADEMO', plugType: 'CHAdeMO', powerType: 'DC', powerKw: 50, price: 0.25, priceType: 'kWh', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-UNREACHABLE', name: 'Demo Far Charge', address: 'Demo fixture location 4', postal: '000004',
    lat: 1.330, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: '24/7', openingHoursAssumed: false,
    connectors: [connector({ id: 'DEMO-FAR-CCS', plugType: 'CCS2', powerType: 'DC', powerKw: 100, price: 0.48, priceType: 'kWh', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-CLOSED', name: 'Demo Daytime Charge', address: 'Demo fixture location 5', postal: '000005',
    lat: 1.340, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: '09:00-17:00', openingHoursAssumed: false,
    connectors: [connector({ id: 'DEMO-CLOSED-TYPE2', plugType: 'Type2', powerType: 'AC', powerKw: 11, price: 0.4, priceType: 'kWh', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-DWELL', name: 'Demo Slow Charge', address: 'Demo fixture location 6', postal: '000006',
    lat: 1.350, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: '24/7', openingHoursAssumed: false,
    connectors: [connector({ id: 'DEMO-SLOW-TYPE2', plugType: 'Type2', powerType: 'AC', powerKw: 1, price: 0.5, priceType: 'h', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-FAULT', name: 'Demo Reported Fault', address: 'Demo fixture location 7', postal: '000007',
    lat: 1.360, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: '24/7', openingHoursAssumed: false,
    connectors: [connector({ id: 'DEMO-FAULT-CCS', plugType: 'CCS2', powerType: 'DC', powerKw: 100, price: 0.45, priceType: 'kWh', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-UNKNOWN-PRICE', name: 'Demo Price Unavailable', address: 'Demo fixture location 8', postal: '000008',
    lat: 1.370, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: '24/7', openingHoursAssumed: false,
    connectors: [connector({ id: 'DEMO-UNKNOWN-CCS', plugType: 'CCS2', powerType: 'DC', powerKw: 100, price: null, priceType: 'unknown', status: 'AVAILABLE' })],
  }),
  makeStation({
    id: 'DEMO-OCCUPIED', name: 'Demo Busy Charge', address: 'Demo fixture location 9', postal: '000009',
    lat: 1.380, lng: 103.830, operator: 'DEMO_FIXTURE', openingHours: '24/7', openingHoursAssumed: false,
    connectors: [
      connector({ id: 'DEMO-BUSY-CCS', plugType: 'CCS2', powerType: 'DC', powerKw: 100, price: 0.5, priceType: 'kWh', status: 'OCCUPIED' }),
      connector({ id: 'DEMO-OFFLINE-TYPE2', plugType: 'Type2', powerType: 'AC', powerKw: 11, price: 0.4, priceType: 'kWh', status: 'UNAVAILABLE' }),
    ],
  }),
];

export const DEMO_SNAPSHOT: OfficialSnapshot = {
  source: 'DEMO_FIXTURE: synthetic station and connector data; not a live provider result',
  state: 'DEMO_FIXTURE',
  observedAt: '2026-10-15T11:58:00+08:00',
  retrievedAt: '2026-10-15T11:59:00+08:00',
  stations,
};

export const DEMO_DIRECT_ROUTE: RouteEstimate = {
  distanceKm: 200,
  durationMinutes: 180,
  geometry: 'DEMO_FIXTURE: illustrative direct route',
};

export const DEMO_ROUTES: CandidateRoute[] = [
  { stationId: 'DEMO-FAST', toStation: { distanceKm: 50, durationMinutes: 45 }, fromStation: { distanceKm: 165, durationMinutes: 145 }, walkingMeters: 120 },
  { stationId: 'DEMO-CHEAP', toStation: { distanceKm: 42, durationMinutes: 40 }, fromStation: { distanceKm: 172, durationMinutes: 154 }, walkingMeters: 240 },
  { stationId: 'DEMO-INCOMPATIBLE', toStation: { distanceKm: 55, durationMinutes: 49 }, fromStation: { distanceKm: 155, durationMinutes: 140 }, walkingMeters: 80 },
  { stationId: 'DEMO-UNREACHABLE', toStation: { distanceKm: 320, durationMinutes: 260 }, fromStation: { distanceKm: 20, durationMinutes: 20 }, walkingMeters: 10 },
  { stationId: 'DEMO-CLOSED', toStation: { distanceKm: 48, durationMinutes: 44 }, fromStation: { distanceKm: 168, durationMinutes: 150 }, walkingMeters: 310 },
  { stationId: 'DEMO-DWELL', toStation: { distanceKm: 52, durationMinutes: 47 }, fromStation: { distanceKm: 164, durationMinutes: 148 }, walkingMeters: 450 },
  { stationId: 'DEMO-FAULT', toStation: { distanceKm: 40, durationMinutes: 36 }, fromStation: { distanceKm: 170, durationMinutes: 155 }, walkingMeters: 190 },
  { stationId: 'DEMO-UNKNOWN-PRICE', toStation: { distanceKm: 46, durationMinutes: 42 }, fromStation: { distanceKm: 170, durationMinutes: 155 }, walkingMeters: 100 },
  { stationId: 'DEMO-OCCUPIED', toStation: { distanceKm: 35, durationMinutes: 32 }, fromStation: { distanceKm: 175, durationMinutes: 156 }, walkingMeters: 60 },
];

export const DEMO_FAULTS: FaultEvidence[] = [
  { stationId: 'DEMO-FAULT', reportId: 'DEMO_FIXTURE-REPORT-1', decisionId: 'DEMO_FIXTURE-DECISION-1', expiresAt: '2026-10-16T12:00:00+08:00' },
];

export function createDemoScenario(input: PlanInput, profile: VehicleProfile): {
  snapshot: OfficialSnapshot;
  routes: CandidateRoute[];
  directRoute: RouteEstimate;
} {
  const reachableKm = profile.capacityKWh * input.currentSoc / 100 / profile.consumptionKWhPer100Km * 100;
  const referenceRangeKm = 60 * 18 / 100 / 17.5 * 100;
  const scale = Math.max(0.5, Math.min(1.5, reachableKm / referenceRangeKm));
  const routeShape: Record<string, [number, number, number, number, number]> = {
    'DEMO-FAST': [12, 22, 12, 23, 80],
    'DEMO-CHEAP': [14, 18, 14, 21, 120],
    'DEMO-INCOMPATIBLE': [17, 25, 17, 25, 180],
    'DEMO-UNREACHABLE': [100, 20, 80, 20, 100],
    'DEMO-CLOSED': [12, 22, 12, 23, 90],
    'DEMO-DWELL': [12, 26, 12, 25, 60],
    'DEMO-FAULT': [12, 20, 12, 25, 100],
    'DEMO-UNKNOWN-PRICE': [15, 23, 23, 23, 200],
    'DEMO-OCCUPIED': [12, 22, 12, 23, 75],
  };

  // Short Singapore-scale route estimates are synthetic and scale with the submitted vehicle range.
  return {
    snapshot: structuredClone(DEMO_SNAPSHOT),
    routes: Object.entries(routeShape).map(([stationId, [toKm, fromKm, toMinutes, fromMinutes, walkingMeters]]) => ({
      stationId,
      toStation: { distanceKm: toKm * scale, durationMinutes: toMinutes * scale },
      fromStation: { distanceKm: fromKm * scale, durationMinutes: fromMinutes * scale },
      walkingMeters,
    })),
    directRoute: {
      distanceKm: 30 * scale,
      durationMinutes: 30 * scale,
      geometry: 'DEMO_FIXTURE: synthetic Singapore-scale route; not from OneMap',
    },
  };
}
