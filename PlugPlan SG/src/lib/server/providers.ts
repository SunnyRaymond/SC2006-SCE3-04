import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CandidateRoute, IssueReport, OfficialSnapshot, Place, RouteEstimate, Station, VehicleProfile } from '@/lib/types';
import { ProviderError } from './errors';

const PROVIDER_BUDGET_MS = 3_900;
const SNAPSHOT_TTL_MS = 10 * 60_000;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_DETAIL_POSTALS = 12;
const MAX_ROUTED_STATIONS = 8;
const DEMO_PLACES: Array<Place & { address: string }> = [
  { label: 'Demo Fixture — Marina Bay Sands', address: '10 Bayfront Avenue', lat: 1.2834, lng: 103.8607, postal: '018956' },
  { label: 'Demo Fixture — Gardens by the Bay', address: '18 Marina Gardens Drive', lat: 1.2816, lng: 103.8636, postal: '018953' },
  { label: 'Demo Fixture — Orchard Road', address: 'Orchard Road', lat: 1.3048, lng: 103.8318, postal: '238858' },
];

export interface Deadline {
  at: number;
  fetch: typeof fetch;
}

export function createProviderDeadline(fetchImpl: typeof fetch = fetch, budgetMs = PROVIDER_BUDGET_MS): Deadline {
  return { at: Date.now() + budgetMs, fetch: fetchImpl };
}

function remaining(deadline: Deadline): number {
  const left = deadline.at - Date.now();
  if (left <= 0) throw new ProviderError('A live data request timed out.', 504);
  return left;
}

async function request(deadline: Deadline, url: string, init: RequestInit = {}): Promise<Response> {
  const ms = remaining(deadline);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = deadline.fetch(url, { ...init, signal: controller.signal });
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new ProviderError('A live data request timed out.', 504)), ms);
      controller.signal.addEventListener('abort', () => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(new ProviderError('A live data request timed out.', 504));
      }, { once: true });
    });
    return await Promise.race([pending, timeout]);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError('A live data request timed out.', 504);
    throw new ProviderError();
  } finally {
    clearTimeout(timer);
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function withinDeadline<T>(deadline: Deadline, operation: Promise<T>): Promise<T> {
  const ms = remaining(deadline);
  let id: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { id = setTimeout(() => reject(new ProviderError('A live data request timed out.', 504)), ms); }),
    ]);
  } finally {
    if (id) clearTimeout(id);
  }
}

async function jsonResponse(response: Response, deadline: Deadline): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 429) throw new ProviderError('The live data provider is rate limiting requests.', 503);
    throw new ProviderError();
  }
  try {
    return JSON.parse(await withinDeadline(deadline, response.text()));
  } catch {
    throw new ProviderError('The live data provider returned invalid data.');
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new ProviderError('Live data credentials are not configured.', 503);
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactAddress(row: Record<string, unknown>): string {
  return text(row.ADDRESS) || [text(row.BLK_NO), text(row.ROAD_NAME), text(row.BUILDING)].filter(Boolean).join(' ');
}

export async function searchPlaces(query: string, mode: 'LIVE' | 'DEMO_FIXTURE', deadline = createProviderDeadline()): Promise<Place[]> {
  if (mode === 'DEMO_FIXTURE') {
    const q = query.trim().toLocaleLowerCase();
    return DEMO_PLACES.filter(place => `${place.label} ${place.address}`.toLocaleLowerCase().includes(q)).map(place => ({ ...place }));
  }
  const url = new URL('https://www.onemap.gov.sg/api/common/elastic/search');
  url.search = new URLSearchParams({ searchVal: query, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' }).toString();
  const data = record(await jsonResponse(await request(deadline, url.toString(), {
    headers: { Authorization: env('OneMap_API'), Accept: 'application/json' },
  }), deadline));
  if (!data || data.error || data.found === 0 || !Array.isArray(data.results)) throw new ProviderError('No usable place results were returned.');
  return data.results.slice(0, 8).flatMap((candidate): Place[] => {
    const row = record(candidate);
    if (!row) return [];
    const lat = number(row.LATITUDE);
    const lng = number(row.LONGITUDE);
    const label = text(row.SEARCHVAL) || compactAddress(row);
    if (!label || lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
    const address = compactAddress(row);
    const place: Place & { address?: string } = { label, lat, lng };
    if (address) place.address = address;
    const postal = text(row.POSTAL);
    if (postal && postal !== 'NIL') place.postal = postal;
    return [place];
  });
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasZone ? raw : `${raw}+08:00`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

interface BatchStation {
  postal: string;
  lat: number;
  lng: number;
  name: string;
  address: string;
  powerRating?: number | null;
}

interface CachedDetails {
  stations: Station[];
  retrievedAt: string;
}

interface DiskCache {
  observedAt: string;
  batchRetrievedAt: string;
  batch: BatchStation[];
  details: Record<string, CachedDetails>;
}

const memoryCache: { value: DiskCache | null } = { value: null };

function cacheFile(): string {
  return path.join(process.cwd(), '.cache', 'lta-public.json');
}

async function loadCache(): Promise<DiskCache | null> {
  if (memoryCache.value) return memoryCache.value;
  try {
    const value = JSON.parse(await readFile(cacheFile(), 'utf8')) as DiskCache;
    if (Array.isArray(value.batch) && value.details && typeof value.details === 'object') {
      memoryCache.value = value;
      return value;
    }
  } catch { /* No usable cache yet. */ }
  return null;
}

async function saveCache(value: DiskCache): Promise<void> {
  memoryCache.value = value;
  try {
    await mkdir(path.dirname(cacheFile()), { recursive: true });
    await writeFile(cacheFile(), JSON.stringify(value), 'utf8');
  } catch { /* The in-process cache remains available when disk writes are unavailable. */ }
}

function unwrapRows(value: unknown): unknown[] {
  const outer = record(value);
  if (!outer) return [];
  const data = record(outer.value) ?? record(outer.data);
  const rows = data?.evLocationsData ?? outer.evLocationsData;
  return Array.isArray(rows) ? rows : [];
}

async function fetchBatch(deadline: Deadline): Promise<{ rows: BatchStation[]; observedAt: string }> {
  const response = await request(deadline, 'https://datamall2.mytransport.sg/ltaodataservice/EVCBatch', {
    headers: { AccountKey: env('LTA_Datamall_API'), Accept: 'application/json' },
  });
  const envelope = record(await jsonResponse(response, deadline));
  if (!envelope) throw new ProviderError('The live charging provider returned invalid data.');
  const groups = Array.isArray(envelope.value) ? envelope.value : [];
  const item = groups.map(record).find(row => {
    if (!row || !text(row.Link)) return false;
    try {
      const url = new URL(text(row.Link));
      return url.protocol === 'https:' && (url.hostname === 'amazonaws.com' || url.hostname.endsWith('.amazonaws.com'));
    } catch { return false; }
  });
  if (!item) throw new ProviderError('The live charging provider did not supply a usable snapshot.');
  const link = text(item.Link);
  const dataResponse = await request(deadline, link, { headers: { Accept: 'application/json' }, redirect: 'error' });
  if (!dataResponse.ok) throw new ProviderError();
  const bytes = new Uint8Array(await withinDeadline(deadline, dataResponse.arrayBuffer()));
  if (bytes.byteLength > MAX_BATCH_BYTES) throw new ProviderError('The live charging snapshot is too large to process.');
  let document: unknown;
  try { document = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ProviderError('The live charging provider returned invalid data.'); }
  const root = record(document);
  const rows = unwrapRows(document).flatMap((item): BatchStation[] => {
    const row = record(item);
    if (!row) return [];
    const postal = text(row.postalCode ?? row.postal ?? row.PostalCode);
    const lat = number(row.latitude ?? row.Latitude);
    const lng = number(row.longtitude ?? row.longitude ?? row.Longitude);
    if (!postal || lat === null || lng === null) return [];
    return [{ postal, lat, lng, name: text(row.name ?? row.stationName) || 'EV charging station', address: text(row.address ?? row.Address) || postal, powerRating: number(row.powerRating) }];
  });
  if (rows.length === 0) throw new ProviderError('The live charging provider returned no usable station locations.');
  const observedAt = timestamp(root?.LastUpdatedTime);
  if (!observedAt) throw new ProviderError('The live charging snapshot did not include a valid source update time.');
  return { rows, observedAt };
}

function haversineKm(a: Pick<Place, 'lat' | 'lng'>, b: Pick<Place, 'lat' | 'lng'>): number {
  const radians = (degree: number) => degree * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(v));
}

function nearbyPostals(batch: BatchStation[], origin: Place, destination: Place): string[] {
  const direct = haversineKm(origin, destination);
  const bestByPostal = new Map<string, number>();
  for (const station of batch) {
    const detour = Math.max(0, haversineKm(origin, station) + haversineKm(station, destination) - direct);
    if (detour > Math.max(8, direct * 0.45)) continue;
    bestByPostal.set(station.postal, Math.min(bestByPostal.get(station.postal) ?? Infinity, detour));
  }
  return [...bestByPostal.entries()].sort((a, b) => a[1] - b[1]).slice(0, MAX_DETAIL_POSTALS).map(([postal]) => postal);
}

function stationFromDetail(row: Record<string, unknown>, requestedPostal: string): Station | null {
  const postal = text(row.postalCode ?? row.postal ?? row.PostalCode) || requestedPostal;
  const lat = number(row.latitude ?? row.Latitude);
  const lng = number(row.longitude ?? row.longtitude ?? row.Longitude);
  if (!postal || lat === null || lng === null) return null;
  const locationId = text(row.locationId ?? row.id);
  const stationId = locationId || `${postal}:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const connectors: Station['connectors'] = [];
  const chargePoints = Array.isArray(row.chargingPoints) ? row.chargingPoints : [];
  for (const rawPoint of chargePoints) {
    const point = record(rawPoint);
    if (!point) continue;
    const plugTypes = Array.isArray(point.plugTypes) ? point.plugTypes : [];
    for (const rawPlug of plugTypes) {
      const plug = record(rawPlug);
      if (!plug) continue;
      const plugType = text(plug.plugType);
      if (!plugType) continue;
      const powerType = text(plug.powerRating).toUpperCase() === 'AC' ? 'AC' : 'DC';
      const powerKw = number(plug.chargingSpeed) ?? number(point.chargingSpeed) ?? 0;
      const price = number(plug.price);
      const rawPriceType = text(plug.priceType).toLowerCase();
      const priceType: Station['connectors'][number]['priceType'] = rawPriceType === 'free'
        ? 'free'
        : rawPriceType === 'kwh'
          ? 'kWh'
          : rawPriceType === 'h' || rawPriceType === 'hour'
            ? 'h'
            : 'unknown';
      const ids = Array.isArray(plug.evIds) ? plug.evIds : [];
      if (ids.length === 0) {
        connectors.push({ id: `${text(point.id) || 'charger'}:${plugType}`, plugType, powerType, powerKw, price: priceType === 'free' ? 0 : price, priceType, status: 'UNAVAILABLE' });
        continue;
      }
      for (const rawId of ids) {
        const evId = record(rawId);
        if (!evId) continue;
        const stableId = text(evId.id) || text(evId.evCpId) || text(point.id) || 'charger';
        const statusRaw = text(evId.status || point.status).toUpperCase();
        const status: Station['connectors'][number]['status'] = ['1', 'AVAILABLE', 'OPERATIONAL', 'ACTIVE'].includes(statusRaw)
          ? 'AVAILABLE'
          : ['0', 'UNAVAILABLE', 'OUT_OF_SERVICE', 'INACTIVE'].includes(statusRaw)
            ? 'UNAVAILABLE'
            : 'UNAVAILABLE';
        connectors.push({ id: `${stableId}:${plugType}`, plugType, powerType, powerKw, price: priceType === 'free' ? 0 : price, priceType, status });
      }
    }
  }
  const operatingHours = text(row.openingHours) || chargePoints.map(point => text(record(point)?.operatingHours)).find(Boolean) || '';
  const address = text(row.address) || text(row.name) || postal;
  return {
    id: stationId,
    name: text(row.name) || 'EV charging station',
    address,
    postal,
    lat,
    lng,
    operator: chargePoints.map(point => text(record(point)?.operator)).find(Boolean) || text(row.operator) || 'Unknown operator',
    openingHours: operatingHours || '24/7',
    openingHoursAssumed: !operatingHours,
    connectors,
  };
}

function normalizeDetail(payload: unknown, requestedPostal: string): Station[] {
  return unwrapRows(payload).flatMap((item): Station[] => {
    const row = record(item);
    if (!row) return [];
    const station = stationFromDetail(row, requestedPostal);
    return station ? [station] : [];
  });
}

async function fetchPostal(deadline: Deadline, postal: string): Promise<Station[]> {
  const url = new URL('https://datamall2.mytransport.sg/ltaodataservice/EVChargingPoints');
  url.searchParams.set('PostalCode', postal);
  const data = await jsonResponse(await request(deadline, url.toString(), {
    headers: { AccountKey: env('LTA_Datamall_API'), Accept: 'application/json' },
  }), deadline);
  return normalizeDetail(data, postal);
}

async function mapLimit<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await fn(values[index]);
    }
  }));
  return output;
}

function mergeStations(batch: BatchStation[], details: Station[], selectedPostals: Set<string>): Station[] {
  return details.filter(detail => {
    if (!selectedPostals.has(detail.postal)) return false;
    const samePostal = batch.filter(row => row.postal === detail.postal);
    if (samePostal.length === 0) return true;
    return samePostal.some(row => haversineKm(row, detail) <= 0.35);
  });
}

function freshnessState(observedAt: string, detailTimes: string[], usedCache: boolean): OfficialSnapshot['state'] {
  const cutoff = Date.now() - SNAPSHOT_TTL_MS;
  const timestamps = [observedAt, ...detailTimes].map(value => Date.parse(value)).filter(Number.isFinite);
  const stale = timestamps.length === 0 || timestamps.some(value => value < cutoff);
  if (stale) return 'STALE';
  return usedCache ? 'CACHED' : 'LIVE';
}

export async function getLiveSnapshot(
  origin: Place,
  destination: Place,
  deadline = createProviderDeadline(),
): Promise<{ snapshot: OfficialSnapshot; detailsRetrievedAt: Record<string, string>; coverageWarning?: string }> {
  const now = new Date().toISOString();
  const cache = await loadCache();
  let current: DiskCache = cache ?? { observedAt: now, batchRetrievedAt: now, batch: [], details: {} };
  let usedCache = false;
  let batchFailure: unknown;
  try {
    const latest = await fetchBatch(deadline);
    current = { ...current, batch: latest.rows, observedAt: latest.observedAt, batchRetrievedAt: new Date().toISOString() };
  } catch (error) {
    batchFailure = error;
    if (current.batch.length === 0) throw error instanceof ProviderError ? error : new ProviderError();
    usedCache = true;
  }

  const selectedPostals = nearbyPostals(current.batch, origin, destination);
  if (selectedPostals.length === 0) {
    if (batchFailure) throw new ProviderError('No cached charging locations cover this route.', 503);
    throw new ProviderError('No charging locations were found near this route.');
  }

  const outcomes = await mapLimit(selectedPostals, 4, async postal => {
    try {
      const stations = await fetchPostal(deadline, postal);
      return { postal, stations, retrievedAt: new Date().toISOString(), live: true, failed: false };
    } catch {
      return { postal, stations: current.details[postal]?.stations ?? [], retrievedAt: current.details[postal]?.retrievedAt ?? '', live: false, failed: true };
    }
  });
  const liveDetails = outcomes.filter(row => row.live);
  const haveUsableFallback = outcomes.some(row => row.stations.length > 0);
  if (liveDetails.length === 0 && !haveUsableFallback) {
    throw new ProviderError('Live charging details are unavailable and no cached details cover this route.', 503);
  }
  for (const outcome of liveDetails) current.details[outcome.postal] = { stations: outcome.stations, retrievedAt: outcome.retrievedAt };
  await saveCache(current);
  const stationRows = outcomes.flatMap(row => row.stations);
  const stations = mergeStations(current.batch, stationRows, new Set(selectedPostals));
  if (stations.length === 0 && liveDetails.length === 0) throw new ProviderError('No cached charging locations cover this route.', 503);
  const detailTimes = outcomes.map(row => row.retrievedAt).filter(Boolean);
  const detailsRetrievedAt = Object.fromEntries(outcomes.filter(row => row.retrievedAt).map(row => [row.postal, row.retrievedAt]));
  const state = freshnessState(current.observedAt, detailTimes, usedCache || outcomes.some(row => !row.live));
  return {
    snapshot: { source: 'LTA DataMall', state, observedAt: current.observedAt, retrievedAt: current.batchRetrievedAt, stations },
    detailsRetrievedAt,
    coverageWarning: outcomes.some(row => row.failed) || batchFailure
      ? 'Some route-area station details came from cache or could not be refreshed.'
      : undefined,
  };
}

function formatSgt(value?: string): string | null {
  const parsed = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  const formatted = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(parsed));
  return `${formatted} SGT`;
}

export function formatCachedOfficialStatus(
  report: Pick<IssueReport, 'stationId' | 'stationName' | 'connectorId'>,
  station?: Station,
  observedAt?: string,
  detailRetrievedAt?: string,
  now = Date.now(),
): string {
  const batchTime = formatSgt(observedAt);
  if (!station) {
    return batchTime
      ? `No matching station in cached LTA DataMall details; batch source time ${batchTime}.`
      : 'No cached LTA DataMall status is available for this station yet.';
  }

  let statusText: string;
  if (report.connectorId) {
    const connector = station.connectors.find(item => item.id === report.connectorId);
    statusText = !connector
      ? 'This connector was not present in the cached LTA details.'
      : connector.status === 'AVAILABLE'
        ? 'LTA reports this connector available.'
        : connector.status === 'OCCUPIED'
          ? 'LTA reports this connector occupied.'
          : 'LTA does not report this connector as available (offline or status not supplied).';
  } else if (station.connectors.length === 0) {
    statusText = 'LTA supplied no connector status for this station.';
  } else {
    const available = station.connectors.filter(connector => connector.status === 'AVAILABLE').length;
    statusText = `${available}/${station.connectors.length} connectors reported available; other connector status may be offline or not supplied.`;
  }

  const detailAge = detailRetrievedAt ? now - Date.parse(detailRetrievedAt) : NaN;
  const batchAge = observedAt ? now - Date.parse(observedAt) : NaN;
  const fresh = Number.isFinite(detailAge) && detailAge >= 0 && detailAge < SNAPSHOT_TTL_MS
    && Number.isFinite(batchAge) && batchAge >= 0 && batchAge < SNAPSHOT_TTL_MS;
  const state = fresh ? 'cached' : 'stale cached';
  const detailTime = formatSgt(detailRetrievedAt);
  return `LTA DataMall ${state} status: ${statusText}${detailTime ? ` Detail retrieved ${detailTime}` : ''}${batchTime ? `; batch source time ${batchTime}` : ''}.`;
}

export async function attachCachedOfficialStatuses(reports: IssueReport[]): Promise<IssueReport[]> {
  const cache = await loadCache();
  const byId = new Map<string, { station: Station; retrievedAt: string }>();
  const byName = new Map<string, Array<{ station: Station; retrievedAt: string }>>();
  for (const details of Object.values(cache?.details ?? {})) {
    for (const station of details.stations) {
      const value = { station, retrievedAt: details.retrievedAt };
      byId.set(station.id, value);
      const key = station.name.trim().toLocaleLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), value]);
    }
  }
  return reports.map(report => {
    const exact = byId.get(report.stationId);
    const named = exact ?? (() => {
      const matches = byName.get(report.stationName.trim().toLocaleLowerCase()) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    })();
    return {
      ...report,
      officialStatus: formatCachedOfficialStatus(report, named?.station, cache?.observedAt, named?.retrievedAt),
    };
  });
}

function parseRoute(document: unknown): RouteEstimate {
  const root = record(document);
  if (!root || number(root.status) !== 0) throw new ProviderError('OneMap could not provide a usable route.');
  const summary = record(root.route_summary) ?? record(root.summary) ?? root;
  const distanceMeters = number(summary.total_distance ?? summary.distance);
  const durationSeconds = number(summary.total_time ?? summary.duration);
  if (distanceMeters === null || durationSeconds === null || distanceMeters < 0 || durationSeconds < 0) {
    throw new ProviderError('OneMap returned an incomplete route.');
  }
  const geometry = root.route_geometry;
  return {
    distanceKm: distanceMeters / 1000,
    durationMinutes: durationSeconds / 60,
    ...(geometry === undefined ? {} : { geometry: typeof geometry === 'string' ? geometry : JSON.stringify(geometry) }),
  };
}

async function fetchRoute(deadline: Deadline, start: Pick<Place, 'lat' | 'lng'>, end: Pick<Place, 'lat' | 'lng'>, routeType: 'drive' | 'walk' = 'drive'): Promise<RouteEstimate> {
  const url = new URL('https://www.onemap.gov.sg/api/public/routingsvc/route');
  url.search = new URLSearchParams({ start: `${start.lat},${start.lng}`, end: `${end.lat},${end.lng}`, routeType }).toString();
  return parseRoute(await jsonResponse(await request(deadline, url.toString(), {
    headers: { Authorization: env('OneMap_API'), Accept: 'application/json' },
  }), deadline));
}

export async function getRoutes(
  origin: Place,
  destination: Place,
  stations: Station[],
  profile: VehicleProfile,
  deadline = createProviderDeadline(),
): Promise<{ directRoute: RouteEstimate; routes: CandidateRoute[]; coverageWarning?: string }> {
  const directRoute = await fetchRoute(deadline, origin, destination);
  const normalizePlug = (plug: string) => plug.toLocaleLowerCase().replace(/[^a-z0-9]/g, '').replace(/^ccs2$/, 'combo2');
  const compatible = stations.filter(station => station.connectors.some(connector =>
    profile.plugTypes.some(type => normalizePlug(type) === normalizePlug(connector.plugType))
    && connector.powerKw >= profile.minChargerKw,
  ));
  const directDistance = haversineKm(origin, destination);
  const candidates = compatible
    .map(station => ({ station, detourLowerBound: haversineKm(origin, station) + haversineKm(station, destination) - directDistance }))
    .filter(row => row.detourLowerBound <= Math.max(8, directDistance * 0.45))
    .sort((a, b) => a.detourLowerBound - b.detourLowerBound)
    .slice(0, MAX_ROUTED_STATIONS)
    .map(row => row.station);
  const legs = profile.maxWalkingM > 0 ? ['to', 'from', 'walk'] as const : ['to', 'from'] as const;
  const tasks = candidates.flatMap(station => legs.map(leg => ({ station, leg })));
  const outcomes = await mapLimit(tasks, 4, async ({ station, leg }) => {
    try {
      const route = leg === 'to'
        ? await fetchRoute(deadline, origin, station)
        : leg === 'walk'
          ? await fetchRoute(deadline, station, destination, 'walk')
          : await fetchRoute(deadline, station, destination);
      return { stationId: station.id, leg, route, failed: false };
    } catch {
      return { stationId: station.id, leg, route: null, failed: true };
    }
  });
  const failed = outcomes.some(outcome => outcome.failed);
  const byStation = new Map<string, typeof outcomes>();
  for (const outcome of outcomes) {
    const items = byStation.get(outcome.stationId) ?? [];
    items.push(outcome);
    byStation.set(outcome.stationId, items);
  }
  const usable: CandidateRoute[] = [];
  for (const station of candidates) {
    const stationOutcomes = byStation.get(station.id) ?? [];
    const toStation = stationOutcomes.find(outcome => outcome.leg === 'to')?.route;
    const fromStation = stationOutcomes.find(outcome => outcome.leg === 'from')?.route;
    const walking = stationOutcomes.find(outcome => outcome.leg === 'walk')?.route;
    if (!toStation || !fromStation || (profile.maxWalkingM > 0 && !walking)) continue;
    usable.push({ stationId: station.id, toStation, fromStation, ...(walking ? { walkingMeters: walking.distanceKm * 1000 } : {}) });
  }
  if (candidates.length > 0 && usable.length === 0) throw new ProviderError('OneMap could not provide routes for the charging stations near this journey.');
  return {
    directRoute,
    routes: usable,
    coverageWarning: `Only ${candidates.length} compatible station candidates in the route corridor were checked; these recommendations are not guaranteed to be globally optimal across Singapore.${failed ? ' Some candidate routes could not be checked.' : ''}`,
  };
}

export function getDemoPlaces(query: string): Place[] {
  const q = query.trim().toLocaleLowerCase();
  return DEMO_PLACES.filter(place => `${place.label} ${place.address}`.toLocaleLowerCase().includes(q)).map(place => ({ ...place }));
}

export function getProviderBudgetMs(): number {
  return PROVIDER_BUDGET_MS;
}
