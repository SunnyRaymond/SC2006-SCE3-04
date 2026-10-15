import { describe, expect, it } from 'vitest';
import { decodePolyline } from '../src/lib/map';
describe('provider route geometry', () => {
  it('decodes the published Google polyline example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
  it('rejects truncated and invalid geometry without hanging', () => {
    expect(() => decodePolyline('_')).toThrow(); expect(() => decodePolyline(' ')).toThrow(); expect(decodePolyline('')).toEqual([]);
  });
});
