export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  const read = () => {
    let result = 0, shift = 0, byte = 0;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid route geometry');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid route geometry');
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += read(); lng += read();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

type LatLng = { lat: number; lng: number };
const point = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Google Maps driving directions: origin → optional charging stop → destination. Opens the app on mobile. */
export function googleMapsDirectionsUrl(origin: LatLng, destination: LatLng, stop?: LatLng | null): string {
  const params = new URLSearchParams({ api: '1', origin: point(origin), destination: point(destination), travelmode: 'driving' });
  if (stop) params.set('waypoints', point(stop));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
