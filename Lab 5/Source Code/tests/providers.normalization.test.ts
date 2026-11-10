import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VehicleProfile } from '../src/lib/types';
import { createProviderDeadline, formatCachedOfficialStatus, getLiveSnapshot, getRoutes, searchPlaces } from '../src/lib/server/providers';
import { ProviderError } from '../src/lib/server/errors';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => { throw Object.assign(new Error('No LTA cache fixture'), { code: 'ENOENT' }); }),
  writeFile: vi.fn(async () => undefined),
}));

const profile: VehicleProfile = {
  name: 'Test EV', capacityKWh: 60, consumptionKWhPer100Km: 16, plugTypes: ['Type 2', 'Combo 2'],
  maxAcKw: 11, maxDcKw: 100, reserveSoc: 20, defaultDetourMinutes: 20, minChargerKw: 3,
  maxWalkingM: 0,
};

beforeEach(() => {
  vi.stubEnv('OneMap_API', 'test-onemap-token');
  vi.stubEnv('LTA_Datamall_API', 'test-lta-key');
});

afterEach(() => vi.unstubAllEnvs());

describe('provider response normalization', () => {
  it('labels cached official connector status and keeps detail and batch times distinct', () => {
    const now = Date.now();
    const report = { stationId: 'loc-1', stationName: 'Detailed Station', connectorId: 'c1' };
    const station = {
      id: 'loc-1', name: 'Detailed Station', address: '1 Test Road', postal: '123456', lat: 1.3, lng: 103.8,
      operator: 'Example', openingHours: '24/7', openingHoursAssumed: true,
      connectors: [{ id: 'c1', plugType: 'Type 2', powerType: 'AC' as const, powerKw: 11, price: null, priceType: 'unknown' as const, status: 'AVAILABLE' as const }],
    };
    const observedAt = new Date(now - 120_000).toISOString();
    const retrievedAt = new Date(now - 60_000).toISOString();
    const status = formatCachedOfficialStatus(report, station, observedAt, retrievedAt, now);
    expect(status).toContain('LTA DataMall cached status');
    expect(status).toContain('reports this connector available');
    expect(status).toContain('Detail retrieved');
    expect(status).toContain('batch source time');
    expect(status).not.toContain(observedAt);
    expect(status).not.toContain(retrievedAt);
    expect(formatCachedOfficialStatus(report, undefined, observedAt)).toContain('No matching station in cached LTA DataMall details');
  });

  it('normalizes the signed LTA batch index and PostalCode detail response', async () => {
    const updated = new Date().toISOString();
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/EVCBatch')) return Response.json({ value: [{ Link: 'https://s3.amazonaws.com/public-test/evc.json?X-Amz-Signature=secret' }] });
      if (url.includes('s3.amazonaws.com')) return Response.json({ LastUpdatedTime: updated, evLocationsData: [
        { name: 'Batch Station', address: '1 Test Road', postalCode: '123456', latitude: 1.3, longtitude: 103.8, powerRating: 11 },
      ] });
      if (url.includes('PostalCode=123456')) return Response.json({ value: { evLocationsData: [
        { address: '1 Test Road', name: 'Detailed Station', longitude: 103.8, latitude: 1.3, locationId: 'loc-1', status: '1', chargingPoints: [
          { status: '1', operatingHours: '', operator: 'Example Operator', position: '', name: 'CP1', id: '', plugTypes: [
            { plugType: 'Type 2', powerRating: 'AC', chargingSpeed: '11', price: '0.7', priceType: 'kWh', evIds: [{ id: '', evCpId: 'R102125G-001', status: '1' }] },
            { plugType: 'Combo 2', powerRating: 'DC', chargingSpeed: '50', price: '', priceType: '', evIds: [{ id: 'dc-1', evCpId: 'R102125G-001', status: '0' }] },
          ] },
        ] },
      ] } });
      throw new Error('Unexpected provider URL');
    };

    const { snapshot, detailsRetrievedAt } = await getLiveSnapshot(
      { label: 'Origin', lat: 1.3, lng: 103.8 },
      { label: 'Destination', lat: 1.3, lng: 103.8 },
      createProviderDeadline(fetcher),
    );
    expect(snapshot.state).toBe('LIVE');
    expect(snapshot.observedAt).toBe(new Date(updated).toISOString());
    expect(new Date(detailsRetrievedAt['123456']).getTime()).toBeGreaterThan(0);
    expect(snapshot.stations).toHaveLength(1);
    expect(snapshot.stations[0]).toMatchObject({ id: 'loc-1', postal: '123456', openingHours: '24/7', openingHoursAssumed: true });
    expect(snapshot.stations[0].connectors).toEqual([
      expect.objectContaining({ id: 'R102125G-001:Type 2', powerType: 'AC', powerKw: 11, price: 0.7, priceType: 'kWh', status: 'AVAILABLE' }),
      expect.objectContaining({ id: 'dc-1:Combo 2', powerType: 'DC', powerKw: 50, price: null, priceType: 'unknown', status: 'UNAVAILABLE' }),
    ]);
    expect(calls.some(url => url.includes('X-Amz-Signature'))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('X-Amz-Signature');
  });

  it('keeps OneMap place address, coordinates, postal code, and route meters/seconds', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      if (String(input).includes('/elastic/search')) return Response.json({ found: 1, results: [
        { SEARCHVAL: 'TEST BUILDING', ADDRESS: '1 TEST ROAD SINGAPORE 123456', LATITUDE: '1.3', LONGITUDE: '103.8', POSTAL: '123456' },
      ] });
      return Response.json({ status: 0, route_summary: { total_distance: 2500, total_time: 600 }, route_geometry: 'encoded-route' });
    };
    const placeResults = await searchPlaces('Test Building', 'LIVE', createProviderDeadline(fetcher));
    expect(placeResults).toHaveLength(1);
    expect(placeResults[0]).toMatchObject({ label: 'TEST BUILDING', address: '1 TEST ROAD SINGAPORE 123456', lat: 1.3, lng: 103.8, postal: '123456' });
    const station = {
      id: 's1', name: 'Station', address: '1 Test Road', postal: '123456', lat: 1.3, lng: 103.8,
      operator: 'Example', openingHours: '24/7', openingHoursAssumed: true,
      connectors: [{ id: 'c1', plugType: 'Type 2', powerType: 'AC' as const, powerKw: 11, price: 0.7, priceType: 'kWh' as const, status: 'AVAILABLE' as const }],
    };
    const routes = await getRoutes(
      { label: 'Origin', lat: 1.3, lng: 103.8 },
      { label: 'Destination', lat: 1.31, lng: 103.81 },
      [station], profile, createProviderDeadline(fetcher),
    );
    expect(routes.directRoute).toMatchObject({ distanceKm: 2.5, durationMinutes: 10, geometry: 'encoded-route' });
    expect(routes.routes[0]).toMatchObject({ stationId: 's1', toStation: { distanceKm: 2.5 }, fromStation: { durationMinutes: 10 } });
    expect(calls[0].headers.get('Authorization')).toBe('test-onemap-token');
    expect(calls.some(call => call.url.includes('routeType=drive'))).toBe(true);
  });

  it('bounds a provider failure when the upstream request never resolves', async () => {
    const started = Date.now();
    const hanging: typeof fetch = () => new Promise<Response>(() => {});
    await expect(searchPlaces('test', 'LIVE', createProviderDeadline(hanging, 80))).rejects.toBeInstanceOf(ProviderError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('does not invent a candidate route when all OneMap station routes fail', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return Response.json({ status: 0, route_summary: { total_distance: 1_000, total_time: 300 } });
      return new Promise<Response>(() => {});
    };
    const station = {
      id: 's1', name: 'Station', address: '1 Test Road', postal: '123456', lat: 1.3, lng: 103.8,
      operator: 'Example', openingHours: '24/7', openingHoursAssumed: true,
      connectors: [{ id: 'c1', plugType: 'Type 2', powerType: 'AC' as const, powerKw: 11, price: 0.7, priceType: 'kWh' as const, status: 'AVAILABLE' as const }],
    };
    const started = Date.now();
    await expect(getRoutes(
      { label: 'Origin', lat: 1.3, lng: 103.8 },
      { label: 'Destination', lat: 1.31, lng: 103.81 },
      [station], profile, createProviderDeadline(fetcher, 80),
    )).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBeGreaterThan(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
