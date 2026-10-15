import type {
  CandidateRoute, Connector, Exclusion, FaultEvidence, OfficialSnapshot, PlanInput,
  PlanResult, Recommendation, RouteEstimate, Station, VehicleProfile,
} from '../types';
import { planInputSchema, profileSchema } from './validation';

const CHARGING_EFFICIENCY = 0.9;
const TEN_MINUTES_MS = 10 * 60_000;
const SG_OFFSET_MS = 8 * 60 * 60_000;
const BALANCED_WEIGHTS = { time: 0.35, cost: 0.25, availability: 0.25, detour: 0.15 } as const;
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

interface ParsedTime { epochMs: number; assumedSingapore: boolean }
interface OpeningWindow { start: number; end: number; allDay: boolean }
interface RankedCandidate extends Recommendation { strategy: PlanInput['strategy'] }

function parseTime(value: string | Date): ParsedTime | undefined {
  if (value instanceof Date) {
    const epochMs = value.getTime();
    return Number.isFinite(epochMs) ? { epochMs, assumedSingapore: false } : undefined;
  }
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const epochMs = Date.parse(hasOffset ? value : `${value}+08:00`);
  return Number.isFinite(epochMs) ? { epochMs, assumedSingapore: !hasOffset } : undefined;
}

function singaporeCalendarMinute(epochMs: number): number {
  const parts = Object.fromEntries(timeFormatter.formatToParts(epochMs).map((part) => [part.type, part.value]));
  const midnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return (midnight + Number(parts.hour) * 60 * 60_000 + Number(parts.minute) * 60_000) / 60_000;
}

function parseOpeningHours(value: string): OpeningWindow | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(24\s?h(?:ours?)?|24\/7|open 24 hours|always open)$/.test(normalized)) {
    return { start: 0, end: 1440, allDay: true };
  }
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  if (startHour > 23 || startMinute > 59 || endHour > 24 || endMinute > 59 || (endHour === 24 && endMinute !== 0)) return undefined;
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= start) end += 1440;
  return { start, end, allDay: start === 0 && end === 1440 };
}

function coversChargingWindow(arrivalMs: number, chargingMinutes: number, window: OpeningWindow): boolean {
  if (window.allDay) return true;
  const arrival = singaporeCalendarMinute(arrivalMs) + ((arrivalMs + SG_OFFSET_MS) % 60_000) / 60_000;
  const end = arrival + chargingMinutes;
  const localDay = Math.floor(arrival / 1440) * 1440;
  for (let offset = -1; offset <= 1; offset += 1) {
    const open = localDay + offset * 1440 + window.start;
    const close = localDay + offset * 1440 + window.end;
    if (arrival >= open && end <= close) return true;
  }
  return false;
}

function validRoute(route: RouteEstimate | undefined): route is RouteEstimate {
  return !!route && Number.isFinite(route.distanceKm) && route.distanceKm >= 0
    && Number.isFinite(route.durationMinutes) && route.durationMinutes >= 0;
}

function canonicalPlugType(value: string): string {
  const compact = value.trim().toLowerCase().replace(/\s+/g, '');
  if (compact === 'ccs2' || compact === 'combo2') return 'combo2';
  if (compact === 'type2') return 'type2';
  return compact;
}

function knownCost(candidate: Recommendation): candidate is Recommendation & { estimatedCost: number } {
  return candidate.estimatedCost !== null && Number.isFinite(candidate.estimatedCost);
}

function minMax(value: number, values: number[]): number {
  if (values.length === 0) return 1;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min ? 0.5 : (value - min) / (max - min);
}

function assignScores(candidates: RankedCandidate[], strategy: PlanInput['strategy']): RankedCandidate[] {
  const priced = candidates.flatMap((candidate) => candidate.estimatedCost === null ? [] : [candidate.estimatedCost]);
  return candidates.map((candidate) => {
    const cost = candidate.estimatedCost;
    const hasKnownCost = cost !== null && Number.isFinite(cost);
    let score: number;
    switch (strategy) {
      case 'FASTEST': score = candidate.totalJourneyMinutes; break;
      case 'CHEAPEST': score = hasKnownCost ? cost : (Math.max(0, ...priced) + 1); break;
      case 'AVAILABILITY': score = 1 - candidate.availability; break;
      case 'DETOUR': score = candidate.detourMinutes; break;
      case 'BALANCED': {
        const costFactor = hasKnownCost ? minMax(cost, priced) : 1;
        score = BALANCED_WEIGHTS.time * minMax(candidate.totalJourneyMinutes, candidates.map((item) => item.totalJourneyMinutes))
          + BALANCED_WEIGHTS.cost * costFactor
          + BALANCED_WEIGHTS.availability * (1 - minMax(candidate.availability, candidates.map((item) => item.availability)))
          + BALANCED_WEIGHTS.detour * minMax(candidate.detourMinutes, candidates.map((item) => item.detourMinutes));
        break;
      }
    }
    return { ...candidate, score, strategy };
  });
}

function compareCandidates(a: RankedCandidate, b: RankedCandidate, strategy: PlanInput['strategy']): number {
  if (strategy === 'CHEAPEST') {
    if (knownCost(a) !== knownCost(b)) return knownCost(a) ? -1 : 1;
    if (knownCost(a) && knownCost(b) && a.estimatedCost !== b.estimatedCost) return a.estimatedCost - b.estimatedCost;
  }
  if (strategy === 'AVAILABILITY' && a.availability !== b.availability) return b.availability - a.availability;
  if (strategy === 'DETOUR' && a.detourMinutes !== b.detourMinutes) return a.detourMinutes - b.detourMinutes;
  if (strategy === 'FASTEST' && a.totalJourneyMinutes !== b.totalJourneyMinutes) return a.totalJourneyMinutes - b.totalJourneyMinutes;
  if (strategy === 'BALANCED' && a.score !== b.score) return a.score - b.score;
  if (a.totalJourneyMinutes !== b.totalJourneyMinutes) return a.totalJourneyMinutes - b.totalJourneyMinutes;
  if (knownCost(a) !== knownCost(b)) return knownCost(a) ? -1 : 1;
  if (knownCost(a) && knownCost(b) && a.estimatedCost !== b.estimatedCost) return a.estimatedCost - b.estimatedCost;
  if (a.detourMinutes !== b.detourMinutes) return a.detourMinutes - b.detourMinutes;
  return a.stationId.localeCompare(b.stationId) || a.connectorId.localeCompare(b.connectorId);
}

function strategyExplanation(strategy: PlanInput['strategy'], candidate: Recommendation): string {
  switch (strategy) {
    case 'FASTEST': return `Ranked by total drive and charging time (${candidate.totalJourneyMinutes.toFixed(1)} min).`;
    case 'CHEAPEST': return candidate.estimatedCost === null
      ? 'Price is unavailable; this option is placed after options with known charging costs.'
      : `Ranked by estimated charging cost (S$${candidate.estimatedCost.toFixed(2)}).`;
    case 'AVAILABILITY': return `Ranked by available compatible connectors (${Math.round(candidate.availability * 100)}% available).`;
    case 'DETOUR': return `Ranked by extra driving time (${candidate.detourMinutes.toFixed(1)} min).`;
    case 'BALANCED': return 'Balanced score uses fixed weights: time 0.35, cost 0.25, availability 0.25, detour 0.15.';
  }
}

function makeExclusion(station: Station, code: string, reason: string): Exclusion {
  return { stationId: station.id, stationName: station.name, code, reason };
}

function arrivalWarnings(
  inputTime: ParsedTime,
  snapshot: OfficialSnapshot,
  snapshotWarnings: string[],
  station: Station,
  route: CandidateRoute,
): string[] {
  const warnings = [...snapshotWarnings];
  if (inputTime.assumedSingapore) warnings.push('Departure time has no time-zone offset; interpreted as Asia/Singapore.');
  if (station.openingHours === null) {
    warnings.push('No explicit opening hours; assumed open all day for this estimate.');
  } else {
    if (station.openingHoursAssumed) warnings.push('Opening-hours data is marked as assumed; the supplied window was still checked.');
    if (!parseOpeningHours(station.openingHours)) warnings.push(`Opening hours “${station.openingHours}” could not be parsed; station was assumed open.`);
  }
  if (route.walkingMeters === undefined || !Number.isFinite(route.walkingMeters) || route.walkingMeters < 0) {
    warnings.push('Walking distance is unavailable; the station was retained because no walking limit was requested.');
  }
  if (snapshot.state === 'DEMO_FIXTURE') warnings.push('DEMO_FIXTURE source: station, connector, price, route, and status values are synthetic examples.');
  return [...new Set(warnings)];
}

function estimateCost(connector: Connector, chargerKWh: number, chargingMinutes: number): number | null {
  if (connector.price === null || !Number.isFinite(connector.price) || connector.price < 0) return null;
  if (connector.priceType === 'kWh') return connector.price * chargerKWh;
  if (connector.priceType === 'h') return connector.price * (chargingMinutes / 60);
  return null;
}

function failureForStation(
  station: Station,
  route: CandidateRoute | undefined,
  input: PlanInput,
  profile: VehicleProfile,
  directRoute: RouteEstimate,
  departure: ParsedTime,
  snapshot: OfficialSnapshot,
  sharedWarnings: string[],
): { candidates: RankedCandidate[]; exclusion?: Exclusion } {
  if (!validRoute(route?.toStation) || !validRoute(route?.fromStation)) {
    return { candidates: [], exclusion: makeExclusion(station, 'NO_ROUTE', 'No usable route estimate is available for this station.') };
  }

  const capacity = profile.capacityKWh;
  const initialBatteryKWh = capacity * input.currentSoc / 100;
  const energyToStation = route.toStation.distanceKm * profile.consumptionKWhPer100Km / 100;
  const arrivalBatteryKWh = initialBatteryKWh - energyToStation;
  if (arrivalBatteryKWh < -1e-9) {
    return { candidates: [], exclusion: makeExclusion(station, 'UNREACHABLE', 'Estimated battery energy on arrival is below zero.') };
  }

  const detourMinutes = Math.max(0, route.toStation.durationMinutes + route.fromStation.durationMinutes - directRoute.durationMinutes);
  if (detourMinutes > input.maxDetourMinutes) {
    return { candidates: [], exclusion: makeExclusion(station, 'DETOUR_LIMIT', `Estimated extra driving time (${detourMinutes.toFixed(1)} min) exceeds the ${input.maxDetourMinutes} min limit.`) };
  }

  const compatible = station.connectors.filter((item) => profile.plugTypes.some((plugType) => canonicalPlugType(plugType) === canonicalPlugType(item.plugType)));
  if (compatible.length === 0) {
    return { candidates: [], exclusion: makeExclusion(station, 'NO_COMPATIBLE_CONNECTOR', 'No connector matches the vehicle plug types.') };
  }
  if (profile.maxWalkingM > 0 && (route.walkingMeters === undefined || !Number.isFinite(route.walkingMeters) || route.walkingMeters < 0)) {
    return { candidates: [], exclusion: makeExclusion(station, 'WALKING_UNVERIFIED', 'Maximum walking distance is set, but the route has no usable walking estimate; this station was excluded until walking distance can be checked.') };
  }
  if (profile.maxWalkingM > 0 && route.walkingMeters !== undefined && route.walkingMeters > profile.maxWalkingM) {
    return { candidates: [], exclusion: makeExclusion(station, 'WALKING_LIMIT', `Walking distance (${route.walkingMeters} m) exceeds the ${profile.maxWalkingM} m limit.`) };
  }

  const available = compatible.filter((item) => item.status === 'AVAILABLE');
  if (available.length === 0) {
    const occupied = compatible.filter((item) => item.status === 'OCCUPIED').length;
    const unavailable = compatible.filter((item) => item.status === 'UNAVAILABLE').length;
    const details = [occupied ? `${occupied} occupied` : '', unavailable ? `${unavailable} unavailable` : ''].filter(Boolean).join(', ');
    return { candidates: [], exclusion: makeExclusion(station, 'NO_AVAILABLE_CONNECTOR', `No compatible connector is currently available${details ? ` (${details})` : ''}.`) };
  }

  const availability = available.length / compatible.length;
  const fromEnergy = route.fromStation.distanceKm * profile.consumptionKWhPer100Km / 100;
  const reserveKWh = capacity * profile.reserveSoc / 100;
  const automaticTargetKWh = fromEnergy + reserveKWh;
  const automaticTargetSoc = automaticTargetKWh / capacity * 100;
  if (automaticTargetKWh > capacity + 1e-9) {
    return { candidates: [], exclusion: makeExclusion(station, 'DESTINATION_UNREACHABLE', `Destination travel plus reserve needs ${automaticTargetKWh.toFixed(1)} kWh, above the ${capacity} kWh battery capacity.`) };
  }
  if (input.manualTargetSoc !== null && input.manualTargetSoc + 1e-9 < automaticTargetSoc) {
    return { candidates: [], exclusion: makeExclusion(station, 'MANUAL_TARGET_TOO_LOW', `Manual target ${input.manualTargetSoc}% is below the ${automaticTargetSoc.toFixed(1)}% needed to reach the destination with reserve.`) };
  }

  const targetSoc = input.manualTargetSoc ?? automaticTargetSoc;
  const targetBatteryKWh = capacity * targetSoc / 100;
  const requiredBatteryKWh = Math.max(0, targetBatteryKWh - Math.max(0, arrivalBatteryKWh));
  if (requiredBatteryKWh <= 1e-9) {
    return { candidates: [], exclusion: makeExclusion(station, 'NO_CHARGING_REQUIRED', 'The vehicle would already meet the target on arrival, so this stop would add no charging.') };
  }

  const arrivalAtStationMs = departure.epochMs + route.toStation.durationMinutes * 60_000;
  const routeWarnings = arrivalWarnings(departure, snapshot, sharedWarnings, station, route);
  const attempted: RankedCandidate[] = [];
  let sawLowPower = false;
  let sawClosed = false;
  let sawDwell = false;
  let sawInvalidPower = false;

  for (const item of available) {
    const vehicleLimit = item.powerType === 'AC' ? profile.maxAcKw : profile.maxDcKw;
    const effectivePowerKw = Math.min(item.powerKw, vehicleLimit);
    if (!Number.isFinite(item.powerKw) || item.powerKw <= 0 || !Number.isFinite(effectivePowerKw) || effectivePowerKw <= 0) {
      sawInvalidPower = true;
      continue;
    }
    if (effectivePowerKw < profile.minChargerKw) {
      sawLowPower = true;
      continue;
    }

    const requiredChargerKWh = requiredBatteryKWh / CHARGING_EFFICIENCY;
    const chargingMinutes = requiredChargerKWh / effectivePowerKw * 60;
    if (chargingMinutes > input.maxChargingMinutes + 1e-9) {
      sawDwell = true;
      continue;
    }

    const openingWindow = station.openingHours === null
      ? { start: 0, end: 1440, allDay: true }
      : parseOpeningHours(station.openingHours);
    if (openingWindow && !coversChargingWindow(arrivalAtStationMs, chargingMinutes, openingWindow)) {
      sawClosed = true;
      continue;
    }

    const estimatedCost = estimateCost(item, requiredChargerKWh, chargingMinutes);
    const warnings = [...routeWarnings];
    if (item.priceType === 'free') warnings.push('Free pricing is unsupported by the current estimate; price is shown as unavailable.');
    else if (item.priceType !== 'kWh' && item.priceType !== 'h') warnings.push('Price is unavailable because the price type or unit price is missing or unsupported.');
    else if (estimatedCost === null) warnings.push('Price is unavailable because the unit price is invalid.');
    if (targetSoc > 80) warnings.push('Charging above 80% may take longer because of battery charging taper.');
    const travelMinutes = route.toStation.durationMinutes + route.fromStation.durationMinutes;
    const base: Recommendation = {
      id: `${station.id}:${item.id}`,
      stationId: station.id,
      connectorId: item.id,
      stationName: station.name,
      address: station.address,
      lat: station.lat,
      lng: station.lng,
      operator: station.operator,
      plugType: item.plugType,
      powerType: item.powerType,
      powerKw: effectivePowerKw,
      status: item.status,
      arrivalSoc: Math.max(0, arrivalBatteryKWh) / capacity * 100,
      automaticTargetSoc,
      targetSoc,
      requiredBatteryKWh,
      requiredChargerKWh,
      chargingMinutes,
      estimatedCost,
      priceType: item.priceType,
      unitPrice: item.priceType === 'kWh' || item.priceType === 'h' ? item.price : null,
      detourMinutes,
      travelMinutes,
      totalJourneyMinutes: travelMinutes + chargingMinutes,
      availability,
      score: 0,
      rank: 0,
      explanations: [],
      warnings,
      toStation: route.toStation,
      fromStation: route.fromStation,
    };
    attempted.push({ ...base, strategy: input.strategy });
  }

  if (attempted.length > 0) return { candidates: attempted };
  if (sawClosed) return { candidates: [], exclusion: makeExclusion(station, 'CLOSED_DURING_CHARGING', 'Station would be closed during arrival or the planned charging window.') };
  if (sawDwell) return { candidates: [], exclusion: makeExclusion(station, 'DWELL_LIMIT', 'Required charging time exceeds the maximum charging duration.') };
  if (sawLowPower) return { candidates: [], exclusion: makeExclusion(station, 'BELOW_MINIMUM_POWER', `No available compatible connector reaches the ${profile.minChargerKw} kW minimum after applying vehicle charging limits.`) };
  if (sawInvalidPower) return { candidates: [], exclusion: makeExclusion(station, 'INVALID_CONNECTOR_POWER', 'No available compatible connector has a usable power estimate.') };
  return { candidates: [], exclusion: makeExclusion(station, 'NO_FEASIBLE_CONNECTOR', 'No compatible connector can meet the charging requirements.') };
}

export function calculatePlan({
  input, profile, snapshot, directRoute, routes, faults, now,
}: {
  input: PlanInput;
  profile: VehicleProfile;
  snapshot: OfficialSnapshot;
  directRoute: RouteEstimate;
  routes: CandidateRoute[];
  faults: FaultEvidence[];
  now?: Date | string;
}): PlanResult {
  const validInput = planInputSchema.parse(input);
  const validProfile = profileSchema.parse(profile);
  if (!validRoute(directRoute)) throw new RangeError('A usable direct route estimate is required.');
  const checkTime = parseTime(now ?? new Date());
  const departure = parseTime(validInput.departureAt);
  if (!checkTime || !departure) throw new RangeError('A valid calculation time and departure time are required.');

  const initialBatteryKWh = validProfile.capacityKWh * validInput.currentSoc / 100;
  const directEnergyKWh = directRoute.distanceKm * validProfile.consumptionKWhPer100Km / 100;
  const reserveKWh = validProfile.capacityKWh * validProfile.reserveSoc / 100;
  const noChargeNeeded = initialBatteryKWh - directEnergyKWh >= reserveKWh - 1e-9;

  const observed = parseTime(snapshot.observedAt);
  const ageMs = observed ? checkTime.epochMs - observed.epochMs : undefined;
  const isStale = snapshot.state === 'STALE' || (ageMs !== undefined && ageMs >= TEN_MINUTES_MS);
  const resultState = isStale && snapshot.state !== 'DEMO_FIXTURE' ? 'STALE' : snapshot.state;
  const sharedWarnings: string[] = [];
  if (isStale) sharedWarnings.push('Charging data is stale (at least 10 minutes old); availability may have changed.');
  else if (!observed) sharedWarnings.push('Snapshot observation time could not be parsed; freshness could not be checked.');
  else if (ageMs !== undefined && ageMs < 0) sharedWarnings.push('Snapshot observation time is in the future; freshness could not be verified.');
  if (!parseTime(snapshot.retrievedAt)) sharedWarnings.push('Snapshot retrieval time could not be parsed.');
  if (checkTime.assumedSingapore) sharedWarnings.push('Calculation time has no time-zone offset; interpreted as Asia/Singapore.');
  if (snapshot.state === 'DEMO_FIXTURE') sharedWarnings.push('DEMO_FIXTURE source: this plan uses synthetic example data and does not represent live stations or routes.');

  const exclusions: Exclusion[] = [];
  const candidates: RankedCandidate[] = [];
  for (const station of snapshot.stations) {
    const route = routes.find((candidate) => candidate.stationId === station.id);
    const assessment = failureForStation(station, route, validInput, validProfile, directRoute, departure, snapshot, sharedWarnings);
    candidates.push(...assessment.candidates);
    if (assessment.exclusion) exclusions.push(assessment.exclusion);
  }

  const rankedConnectorCandidates = assignScores(candidates, validInput.strategy)
    .sort((a, b) => compareCandidates(a, b, validInput.strategy));
  const bestPerStation = new Map<string, RankedCandidate>();
  for (const candidate of rankedConnectorCandidates) {
    if (!bestPerStation.has(candidate.stationId)) bestPerStation.set(candidate.stationId, candidate);
  }
  const rankedStations = assignScores([...bestPerStation.values()], validInput.strategy)
    .sort((a, b) => compareCandidates(a, b, validInput.strategy));

  const rankedStationIds = new Set(rankedStations.map((candidate) => candidate.stationId));
  const activeFaults = faults.filter((fault) => {
    const expiry = parseTime(fault.expiresAt);
    return rankedStationIds.has(fault.stationId) && !!expiry && expiry.epochMs > checkTime.epochMs;
  });
  const faultedStations = new Set(activeFaults.map((fault) => fault.stationId));
  for (const stationId of faultedStations) {
    const station = snapshot.stations.find((item) => item.id === stationId);
    if (station) exclusions.push(makeExclusion(station, 'ACTIVE_FAULT_MARK', 'Excluded after ranking because an active verified faulty-station mark was supplied.'));
  }

  const recommendations = rankedStations
    .filter((candidate) => !faultedStations.has(candidate.stationId))
    .slice(0, 3)
    .map((candidate, index) => {
      const { strategy: _strategy, ...recommendation } = candidate;
      return {
        ...recommendation,
        rank: index + 1,
        explanations: [strategyExplanation(validInput.strategy, recommendation), `Selected ${recommendation.connectorId} as this station's best compatible available connector.`],
      };
    });

  const summary = noChargeNeeded
    ? recommendations.length > 0
      ? 'Current charge is sufficient to reach the destination with reserve; charger options are optional.'
      : 'Current charge is sufficient to reach the destination with reserve; no charger stop is needed.'
    : recommendations.length > 0
      ? `${recommendations.length} ranked charger option${recommendations.length === 1 ? '' : 's'} remain after feasibility and fault checks.`
      : 'No eligible charging option remains; review the exclusions or change the plan inputs.';

  return {
    inputs: validInput,
    profileAssumptions: validProfile,
    recommendations,
    excluded: exclusions,
    noChargeNeeded,
    directRoute,
    snapshot: {
      source: snapshot.source,
      state: resultState,
      observedAt: snapshot.observedAt,
      retrievedAt: snapshot.retrievedAt,
    },
    faultFilterCheckedAt: new Date(checkTime.epochMs).toISOString(),
    faultEvidence: activeFaults,
    summary,
  };
}
