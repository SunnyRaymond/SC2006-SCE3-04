import { ApiError, errorResponse } from '@/lib/server/errors';
import { createProviderDeadline } from '@/lib/server/providers';
import { handleAction } from '@/lib/server/service';
import { requireDriver, requireModerator, requireUser } from '@/lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_048_576;
const DRIVER_ACTIONS = new Set([
  'profile.save', 'profile.delete', 'plan.create', 'plan.reconfigure', 'plan.refresh',
  'plan.select', 'plan.delete', 'report.create',
]);

async function readBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ApiError('The request is too large.', 413);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError('The request is too large.', 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('The request body could not be read.', 400);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const providerDeadline = createProviderDeadline();
    const context = await requireUser(request, providerDeadline);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      throw new ApiError('Send this request as JSON.', 415);
    }
    const raw = await readBody(request);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new ApiError('The request body must contain valid JSON.', 400); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError('The request body must be a JSON object.', 400);
    const body = parsed as Record<string, unknown>;
    if (typeof body.action !== 'string') throw new ApiError('Choose an action.', 400, { action: 'An action is required.' });
    if (body.action === 'report.moderate') requireModerator(context);
    else if (DRIVER_ACTIONS.has(body.action)) requireDriver(context);
    const result = await handleAction(context, body);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
