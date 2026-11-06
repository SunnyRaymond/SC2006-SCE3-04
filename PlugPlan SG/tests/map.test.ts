import { describe, expect, it } from 'vitest';
import { decodePolyline, googleMapsDirectionsUrl } from '../src/lib/map';
describe('provider route geometry', () => {
  it('decodes the published Google polyline example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
  it('rejects truncated and invalid geometry without hanging', () => {
    expect(() => decodePolyline('_')).toThrow(); expect(() => decodePolyline(' ')).toThrow(); expect(decodePolyline('')).toEqual([]);
  });
});
describe('Google Maps navigation link', () => {
  const origin = { lat: 1.3448, lng: 103.6826 }, destination = { lat: 1.2834, lng: 103.8607 };
  it('routes through the charging stop as a waypoint', () => {
    const url = new URL(googleMapsDirectionsUrl(origin, destination, { lat: 1.3, lng: 103.8 }));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ api: '1', origin: '1.344800,103.682600', destination: '1.283400,103.860700', travelmode: 'driving', waypoints: '1.300000,103.800000' });
  });
  it('omits waypoints for a direct route', () => {
    expect(new URL(googleMapsDirectionsUrl(origin, destination, null)).searchParams.has('waypoints')).toBe(false);
  });
});
