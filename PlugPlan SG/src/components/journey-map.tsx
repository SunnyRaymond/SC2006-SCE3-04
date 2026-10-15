'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { decodePolyline } from '@/lib/map';
import type { Place, Recommendation } from '@/lib/types';

export default function JourneyMap({ origin, destination, recommendations = [], selectedId }: {
  origin?: Place | null; destination?: Place | null; recommendations?: Recommendation[]; selectedId?: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current, { scrollWheelZoom: false, zoomControl: false }).setView([1.326, 103.82], 11);
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      minZoom: 11, maxZoom: 19,
      attribution: '&copy; <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>',
    }).addTo(instance);
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    const resize = new ResizeObserver(() => instance.invalidateSize()); resize.observe(host.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const points: L.LatLngTuple[] = [];
    function point(lat: number, lng: number, label: string, color: string, radius: number) {
      points.push([lat, lng]);
      const text = document.createElement('span'); text.textContent = label;
      L.circleMarker([lat, lng], { radius, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(text).addTo(layer.current!);
    }
    if (origin) point(origin.lat, origin.lng, `Origin: ${origin.label}`, '#364f5e', 8);
    if (destination) point(destination.lat, destination.lng, `Destination: ${destination.label}`, '#bd663c', 8);
    recommendations.forEach((r) => point(r.lat, r.lng, `#${r.rank} ${r.stationName}`, '#177357', selectedId === r.id ? 13 : 10));
    const active = recommendations.find(r => r.id === selectedId) ?? recommendations[0];
    if (active) for (const route of [active.toStation, active.fromStation]) {
      if (!route.geometry) continue;
      try { L.polyline(decodePolyline(route.geometry), { color: '#197959', weight: 4, opacity: .8 }).addTo(layer.current); } catch { /* Markers remain usable if the provider geometry is invalid. */ }
    }
    if (points.length > 1) map.current.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    else if (points.length) map.current.setView(points[0], 13);
  }, [origin, destination, recommendations, selectedId]);
  return <div className="journey-map" ref={host} aria-label="Journey map. All locations and recommendation details are also available in the adjacent text list." role="region" />;
}
