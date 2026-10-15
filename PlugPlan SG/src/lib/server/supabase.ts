import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { ApiError } from './errors';
import type { AppUser } from '@/lib/types';
import type { Deadline } from './providers';

export interface RequestContext {
  token: string;
  sessionId: string;
  db: SupabaseClient;
  providerDeadline?: Deadline;
  user: AppUser;
  authUser: User;
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new ApiError('The service is not configured.', 503);
  return value;
}

export function getPublicSupabaseClient(accessToken?: string): SupabaseClient {
  return createClient(environment('SUPABASE_URL'), environment('SUPABASE_PUBLISHABLE_KEY'), {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function sessionIdFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as { session_id?: unknown };
    return typeof decoded.session_id === 'string' && decoded.session_id.length > 0 ? decoded.session_id : null;
  } catch {
    return null;
  }
}

export async function requireUser(request: Request, providerDeadline?: Deadline): Promise<RequestContext> {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) throw new ApiError('Sign in to continue.', 401);

  const token = match[1];
  const db = getPublicSupabaseClient(token);
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) throw new ApiError('Your session is invalid or expired. Sign in again.', 401);
  const sessionId = sessionIdFromToken(token);
  if (!sessionId) throw new ApiError('Your session is invalid or expired. Sign in again.', 401);

  const sessionCheck = await db.rpc('is_current_session_active');
  if (sessionCheck.error) throw new ApiError('The service could not verify your session.', 503);
  if (sessionCheck.data !== true) throw new ApiError('Your session is no longer active. Sign in again.', 401);

  const { data: userRow, error: userError } = await db
    .from('app_users')
    .select('id,email,role,status')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (userError) throw new ApiError('The service could not verify your account.', 503);
  if (!userRow) throw new ApiError('This account is not active in PlugPlan SG.', 403);
  if (String(userRow.status).toUpperCase() !== 'ACTIVE') throw new ApiError('This account is inactive. Contact the PlugPlan SG team.', 403);
  if (userRow.role !== 'DRIVER' && userRow.role !== 'MODERATOR') throw new ApiError('This account does not have an application role.', 403);

  return {
    token,
    sessionId,
    db,
    providerDeadline,
    authUser: authData.user,
    user: { id: userRow.id, email: userRow.email, role: userRow.role, status: userRow.status },
  };
}

export function requireDriver(context: RequestContext): void {
  if (context.user.role !== 'DRIVER') throw new ApiError('This action is available to Drivers only.', 403);
}

export function requireModerator(context: RequestContext): void {
  if (context.user.role !== 'MODERATOR') throw new ApiError('This action is available to Moderators only.', 403);
}
