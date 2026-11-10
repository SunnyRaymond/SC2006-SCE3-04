export const dynamic = 'force-dynamic';

/** Liveness check: returns { ok: true } while the service is running. */
export async function GET(): Promise<Response> {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
