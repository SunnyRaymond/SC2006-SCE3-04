import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'PlugPlan SG · A better charging stop',
  description: 'Thoughtful, arrival-aware EV charging plans for journeys around Singapore.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
