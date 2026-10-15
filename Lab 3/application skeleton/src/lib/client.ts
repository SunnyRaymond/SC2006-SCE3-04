import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { flowType: 'pkce', detectSessionInUrl: true } },
);

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string>, public retryAfter?: number) {
    super(retryAfter && Number.isFinite(retryAfter) && retryAfter > 0
      ? `${message} You can submit again at ${formatSG(new Date(Date.now() + retryAfter * 1000).toISOString())} SGT.`
      : message);
  }
}

export async function api<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch('/api/app', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ ...payload, action }),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? 'Something went wrong. Please try again.', response.status, data.fields, data.retryAfter);
  return data as T;
}

export const formatSG = (value: string, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...options,
}).format(new Date(value));

export function localSG(value = new Date().toISOString()) {
  const d = new Date(new Date(value).getTime() + 8 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function currency(value: number | null) {
  return value === null ? 'Price unavailable' : `S$${value.toFixed(2)}`;
}
