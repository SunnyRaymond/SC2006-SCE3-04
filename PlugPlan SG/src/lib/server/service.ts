import { z } from 'zod';
import { calculatePlan } from '@/lib/domain/engine';
import { createDemoScenario } from '@/lib/domain/fixtures';
import { planInputSchema, profileSchema, reportSchema } from '@/lib/domain/validation';
import type { CandidateRoute, IssueReport, OfficialSnapshot, PlanInput, PlanResult, VehicleProfile } from '@/lib/types';
import { ApiError, validationError } from './errors';
import {
  bootstrap, createImageUrl, deletePlan, deleteProfile, getActiveFaults, getOwnedPlan,
  getProfile, listReports, moderateReport, revokeSession, savePlanVersion,
  saveProfile, selectRecommendation, submitReport,
} from './db';
import { attachCachedOfficialStatuses, createProviderDeadline, getLiveSnapshot, getRoutes, searchPlaces } from './providers';
import type { RequestContext } from './supabase';

interface RouteCache {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  snapshot: OfficialSnapshot;
  profile: VehicleProfile;
  routeRetrievedAt: string;
  directRoute: PlanResult['directRoute'];
  routes: CandidateRoute[];
}

const routeCache = new Map<string, RouteCache>();
const modeSchema = z.enum(['LIVE', 'DEMO_FIXTURE']);
const idSchema = z.string().uuid();
const ROUTE_CACHE_TTL_MS = 5 * 60_000;
const SNAPSHOT_TTL_MS = 10 * 60_000;

function cacheKey(context: RequestContext, planId: string): string {
  return `${context.user.id}:${planId}`;
}

function rememberRoutes(context: RequestContext, planId: string, result: PlanResult, routes: CandidateRoute[], snapshot: OfficialSnapshot, routeRetrievedAt = new Date().toISOString()): void {
  routeCache.delete(cacheKey(context, planId));
  routeCache.set(cacheKey(context, planId), {
    origin: { lat: result.inputs.origin.lat, lng: result.inputs.origin.lng },
    destination: { lat: result.inputs.destination.lat, lng: result.inputs.destination.lng },
    snapshot,
    profile: result.profileAssumptions,
    routeRetrievedAt,
    directRoute: result.directRoute,
    routes,
  });
  while (routeCache.size > 100) routeCache.delete(routeCache.keys().next().value as string);
}

function cachedRoutes(context: RequestContext, planId: string, input: PlanInput): RouteCache | null {
  const cached = routeCache.get(cacheKey(context, planId));
  if (!cached || cached.origin.lat !== input.origin.lat || cached.origin.lng !== input.origin.lng
    || cached.destination.lat !== input.destination.lat || cached.destination.lng !== input.destination.lng) return null;
  return cached;
}

function sameRouteCriteria(left: VehicleProfile, right: VehicleProfile): boolean {
  const normalize = (plug: string) => plug.toLocaleLowerCase().replace(/[^a-z0-9]/g, '').replace(/^ccs2$/, 'combo2');
  const leftPlugs = left.plugTypes.map(normalize).sort();
  const rightPlugs = right.plugTypes.map(normalize).sort();
  return left.minChargerKw === right.minChargerKw
    && (left.maxWalkingM > 0) === (right.maxWalkingM > 0)
    && JSON.stringify(leftPlugs) === JSON.stringify(rightPlugs);
}

function freshLiveRouteCache(cache: RouteCache | null | undefined, profile: VehicleProfile): cache is RouteCache {
  if (!cache || cache.snapshot.state === 'DEMO_FIXTURE' || cache.snapshot.state === 'STALE'
    || !sameRouteCriteria(cache.profile, profile)) return false;
  const now = Date.now();
  const routeTime = Date.parse(cache.routeRetrievedAt);
  const sourceTime = Date.parse(cache.snapshot.observedAt);
  if (!Number.isFinite(routeTime) || now < routeTime || now - routeTime >= ROUTE_CACHE_TTL_MS
    || !Number.isFinite(sourceTime) || now < sourceTime || now - sourceTime >= SNAPSHOT_TTL_MS) return false;
  const detailTimes = (cache.snapshot as OfficialSnapshot & { detailsRetrievedAt?: Record<string, string> }).detailsRetrievedAt;
  if (!detailTimes || Object.keys(detailTimes).length === 0) return false;
  return Object.values(detailTimes).every(value => {
    const time = Date.parse(value);
    return Number.isFinite(time) && now >= time && now - time < SNAPSHOT_TTL_MS;
  });
}

function clearRoutes(context: RequestContext, planId?: string): void {
  const prefix = `${context.user.id}:`;
  for (const key of routeCache.keys()) {
    if (key.startsWith(prefix) && (!planId || key === cacheKey(context, planId))) routeCache.delete(key);
  }
}

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error.issues);
  return result.data;
}

function validatePlanInput(value: unknown): PlanInput {
  const placeDraft = z.object({
    label: z.string(), lat: z.number(), lng: z.number(), postal: z.string().optional(), address: z.string().max(300).optional(),
  }).strict();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return validate(planInputSchema, value);
  const input = value as Record<string, unknown>;
  const normalizePlace = (raw: unknown): unknown => {
    const parsed = placeDraft.safeParse(raw);
    if (!parsed.success) return raw;
    const { address, ...place } = parsed.data;
    return { ...place, label: address && !place.label.includes(address) ? `${place.label} — ${address}` : place.label };
  };
  return validate(planInputSchema, {
    ...input,
    origin: normalizePlace(input.origin),
    destination: normalizePlace(input.destination),
  });
}

function appendWarning(result: PlanResult, warning?: string): void {
  if (warning && !result.summary.includes(warning)) result.summary = `${result.summary} ${warning}`.trim();
}

function explainInvalidatedSelection(
  result: PlanResult,
  previousSelection: PlanResult['recommendations'][number] | undefined,
  previousSelectionId: string | null,
): string | null {
  if (!previousSelectionId) return null;
  const retainedSelection = result.recommendations.find(item => item.id === previousSelectionId);
  if (retainedSelection) {
    const confirmation = `Your selected connector (${retainedSelection.stationName}, connector ${retainedSelection.connectorId}) remains feasible; no fallback is required.`;
    appendWarning(result, confirmation);
    return confirmation;
  }
  const exclusion = previousSelection
    ? result.excluded.find(item => item.stationId === previousSelection.stationId)?.reason
    : undefined;
  const reason = exclusion
    ?? 'it is no longer on the current shortlist';
  const alternative = result.recommendations[0];
  const previousLabel = previousSelection
    ? `${previousSelection.stationName}, connector ${previousSelection.connectorId}`
    : 'your previously selected recommendation';
  const notice = alternative
    ? `Your saved selection (${previousLabel}) was cleared because ${reason}. Next alternative: ${alternative.stationName}, connector ${alternative.connectorId}. Select it to continue.`
    : `Your saved selection (${previousLabel}) was cleared because ${reason}. No fallback is available because no recommendation remains.`;
  appendWarning(result, notice);
  return notice;
}

async function calculate(context: RequestContext, input: PlanInput, profile: VehicleProfile, mode: 'LIVE' | 'DEMO_FIXTURE', cached?: RouteCache | null, allowFreshCache = false): Promise<{ result: PlanResult; routes: CandidateRoute[]; fallbackMessage: string; cacheSnapshot: OfficialSnapshot; routeRetrievedAt?: string }> {
  const deadline = context.providerDeadline ?? createProviderDeadline();
  const faults = await getActiveFaults(context);
  const fallbackCache = mode === 'LIVE' && cached?.snapshot.state !== 'DEMO_FIXTURE' ? cached : null;
  let snapshot: OfficialSnapshot;
  let directRoute: PlanResult['directRoute'];
  let routes: CandidateRoute[];
  let warning: string | undefined;
  let fallbackMessage = '';
  let routeRetrievedAt: string | undefined;

  if (mode === 'DEMO_FIXTURE') {
    const scenario = createDemoScenario(input, profile);
    snapshot = scenario.snapshot;
    directRoute = scenario.directRoute;
    routes = scenario.routes;
  } else if (allowFreshCache && freshLiveRouteCache(cached, profile)) {
    snapshot = { ...cached.snapshot, state: 'CACHED' };
    directRoute = cached.directRoute;
    routes = cached.routes;
    routeRetrievedAt = cached.routeRetrievedAt;
    warning = 'Recently cached live station and route data were reused for the same journey; source timestamps are unchanged.';
    fallbackMessage = 'Reused recent live route and station data. Refresh remains available for a new provider check.';
  } else {
    try {
      const live = await getLiveSnapshot(input.origin, input.destination, deadline);
      snapshot = live.snapshot;
      warning = live.coverageWarning;
      Object.assign(snapshot, { detailsRetrievedAt: live.detailsRetrievedAt });
    } catch (error) {
      if (!fallbackCache) throw error;
      snapshot = { ...fallbackCache.snapshot, state: 'STALE' };
      warning = 'Live station data was unavailable; the last saved route-area snapshot is shown as stale.';
      fallbackMessage = 'Live station data was unavailable, so the last saved route-area snapshot is shown as stale.';
    }

    if (fallbackMessage && fallbackCache) {
      directRoute = fallbackCache.directRoute;
      routes = fallbackCache.routes;
      routeRetrievedAt = fallbackCache.routeRetrievedAt;
      warning = `${warning} Previous saved route estimates are also being reused.`;
    } else {
      try {
        const stationRows = snapshot.stations;
        const liveRoutes = await getRoutes(input.origin, input.destination, stationRows, profile, deadline);
        directRoute = liveRoutes.directRoute;
        routes = liveRoutes.routes;
        routeRetrievedAt = new Date().toISOString();
        warning = [warning, liveRoutes.coverageWarning].filter(Boolean).join(' ');
      } catch (error) {
        if (!fallbackCache) throw error;
        directRoute = fallbackCache.directRoute;
        const stationIds = new Set(snapshot.stations.map(station => station.id));
        routes = fallbackCache.routes.filter(route => stationIds.has(route.stationId));
        if (routes.length === 0 && stationIds.size > 0) throw error;
        routeRetrievedAt = fallbackCache.routeRetrievedAt;
        warning = [warning, 'OneMap routes were unavailable; previously saved route estimates are being reused.'].filter(Boolean).join(' ');
        fallbackMessage = 'Live routes were unavailable, so the last saved route estimates were reused.';
      }
    }
  }

  const result = calculatePlan({ input, profile, snapshot, directRoute, routes, faults });
  const detailsRetrievedAt = (snapshot as OfficialSnapshot & { detailsRetrievedAt?: Record<string, string> }).detailsRetrievedAt;
  if (detailsRetrievedAt) Object.assign(result.snapshot, { detailsRetrievedAt });
  appendWarning(result, warning);
  if (!fallbackMessage) {
    fallbackMessage = mode === 'DEMO_FIXTURE'
      ? 'This plan uses the explicitly selected Demo Fixture data.'
      : result.snapshot.state === 'LIVE'
        ? 'Plan refreshed with current live data.'
        : `Live refresh was unavailable; the plan uses ${result.snapshot.state.toLowerCase()} station data.`;
  }
  return { result, routes, fallbackMessage, cacheSnapshot: snapshot, routeRetrievedAt };
}

export async function handleAction(context: RequestContext, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const action = body.action;
  switch (action) {
    case 'bootstrap': {
      const data = await bootstrap(context);
      if (context.user.role === 'MODERATOR') data.reports = await attachCachedOfficialStatuses(data.reports);
      return data as unknown as Record<string, unknown>;
    }
    case 'profile.save': {
      const profile = validate(profileSchema, body.profile);
      const saved = await saveProfile(context, profile);
      return { profile: saved };
    }
    case 'profile.delete':
      await deleteProfile(context);
      clearRoutes(context);
      return { ok: true };
    case 'places.search': {
      const input = validate(z.object({ query: z.string().trim().min(1).max(200), mode: modeSchema }), body);
      const places = await searchPlaces(input.query, input.mode, context.providerDeadline ?? createProviderDeadline());
      return { places };
    }
    case 'plan.create': {
      const payload = validate(z.object({ input: z.unknown(), mode: modeSchema }), body);
      const input = validatePlanInput(payload.input);
      const profileRaw = await getProfile(context);
      if (!profileRaw) throw new ApiError('Save a valid vehicle profile before planning.', 400, { profile: 'A vehicle profile is required.' });
      const profile = validate(profileSchema, profileRaw);
      const computed = await calculate(context, input, profile, payload.mode);
      const plan = await savePlanVersion(context, null, computed.result, 'CREATE');
      rememberRoutes(context, plan.id, computed.result, computed.routes, computed.cacheSnapshot);
      return { plan };
    }
    case 'plan.reconfigure': {
      const payload = validate(z.object({ planId: idSchema, input: z.unknown(), mode: modeSchema }), body);
      const input = validatePlanInput(payload.input);
      const plan = await getOwnedPlan(context, payload.planId);
      const profileRaw = await getProfile(context);
      if (!profileRaw) throw new ApiError('Save a valid vehicle profile before planning.', 400, { profile: 'A vehicle profile is required.' });
      const cached = cachedRoutes(context, plan.id, input);
      const profile = validate(profileSchema, profileRaw);
      const computed = await calculate(context, input, profile, payload.mode, cached, true);
      const saved = await savePlanVersion(context, plan.id, computed.result, 'RECONFIGURE');
      rememberRoutes(context, plan.id, computed.result, computed.routes, computed.cacheSnapshot, computed.routeRetrievedAt);
      return { plan: saved };
    }
    case 'plan.refresh': {
      const payload = validate(z.object({ planId: idSchema, mode: modeSchema }), body);
      const plan = await getOwnedPlan(context, payload.planId);
      const current = plan.versions.find(version => version.id === plan.currentVersionId);
      if (!current) throw new ApiError('This plan has no saved version to refresh.', 409);
      const profile = validate(profileSchema, current.result.profileAssumptions);
      const cached = cachedRoutes(context, plan.id, current.result.inputs);
      const computed = await calculate(context, current.result.inputs, profile, payload.mode, cached);
      const previousSelection = plan.selectedRecommendationId
        ? current.result.recommendations.find(item => item.id === plan.selectedRecommendationId)
        : undefined;
      const selectionNotice = explainInvalidatedSelection(computed.result, previousSelection, plan.selectedRecommendationId);
      if (selectionNotice) computed.fallbackMessage = `${computed.fallbackMessage} ${selectionNotice}`.trim();
      const saved = await savePlanVersion(context, plan.id, computed.result, 'REFRESH');
      rememberRoutes(context, plan.id, computed.result, computed.routes, computed.cacheSnapshot, computed.routeRetrievedAt);
      return { plan: saved, fallbackMessage: computed.fallbackMessage };
    }
    case 'plan.select': {
      const payload = validate(z.object({ planId: idSchema, recommendationId: z.string().min(1).max(200) }), body);
      return { plan: await selectRecommendation(context, payload.planId, payload.recommendationId) };
    }
    case 'plan.delete': {
      const payload = validate(z.object({ planId: idSchema }), body);
      await deletePlan(context, payload.planId);
      clearRoutes(context, payload.planId);
      return { ok: true };
    }
    case 'reports.list': {
      const reports = await listReports(context);
      return { reports: context.user.role === 'MODERATOR' ? await attachCachedOfficialStatuses(reports) : reports };
    }
    case 'report.create': {
      const rawPath = typeof body.imagePath === 'string' ? body.imagePath : null;
      const cleanupPath = rawPath && validOwnedImagePath(context, rawPath) ? rawPath : null;
      try {
        const { action: _action, ...draft } = body;
        const input = validate(reportSchema, draft) as {
          stationId: string; stationName: string; connectorId?: string | null;
          category: IssueReport['category']; note: string; imagePath?: string | null;
        };
        const imagePath = input.imagePath ?? null;
        if (imagePath) await validateUploadedImage(context, imagePath);
        const saved = await submitReport(context, {
          stationId: input.stationId,
          stationName: input.stationName,
          connectorId: input.connectorId ?? null,
          category: input.category,
          note: input.note,
          imagePath,
        });
        if (saved.duplicate && imagePath) await removeOrphanImage(context, imagePath);
        return { report: saved.report, ...(saved.duplicate ? { duplicate: true } : {}) };
      } catch (error) {
        if (cleanupPath) await removeOrphanImage(context, cleanupPath);
        throw error;
      }
    }
    case 'report.moderate': {
      const payload = validate(z.object({
        reportId: idSchema,
        moderationAction: z.enum(['VERIFY', 'REJECT', 'MERGE', 'RESOLVE', 'EXPIRE']),
        reason: z.string().trim().min(1).max(500),
        expectedRevision: z.number().int().min(1),
        mergeTargetId: idSchema.nullable().optional(),
      }), body);
      const report = await moderateReport(context, {
        reportId: payload.reportId,
        action: payload.moderationAction,
        reason: payload.reason,
        expectedRevision: payload.expectedRevision,
        mergeTargetId: payload.mergeTargetId ?? null,
      });
      return { report };
    }
    case 'report.image-url': {
      const payload = validate(z.object({ reportId: idSchema }), body);
      return { url: await createImageUrl(context, payload.reportId) };
    }
    case 'session.logout':
      await revokeSession(context);
      return { ok: true };
    default:
      throw new ApiError('Unknown action.', 400, { action: 'Choose a supported action.' });
  }
}

function validOwnedImagePath(context: RequestContext, imagePath: string): boolean {
  const parts = imagePath.split('/');
  return parts.length === 2 && parts[0] === context.user.id
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i.test(parts[1]);
}

async function validateUploadedImage(context: RequestContext, imagePath: string): Promise<void> {
  if (!validOwnedImagePath(context, imagePath)) throw new ApiError('The image path is invalid.', 400, { imagePath: 'Use an image uploaded to your own account.' });
  const [folder, name] = imagePath.split('/');
  const { data, error } = await context.db.storage.from('issue-images').list(folder, { search: name, limit: 20 });
  if (error) throw new ApiError('The uploaded image could not be checked.', 503);
  const file = (data ?? []).find(item => item.name === name);
  const metadata = file?.metadata as Record<string, unknown> | null | undefined;
  const mime = String(metadata?.mimetype ?? metadata?.contentType ?? '').toLowerCase();
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const expectedMime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
    : extension === 'png' ? 'image/png' : 'image/webp';
  const size = Number(metadata?.size);
  if (!file || mime !== expectedMime || !Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) {
    throw new ApiError('The uploaded image type or size is invalid.', 400, { imagePath: 'Upload a matching JPEG, PNG or WebP image up to 5 MB.' });
  }
}

async function removeOrphanImage(context: RequestContext, imagePath: string): Promise<void> {
  const { data, error } = await context.db.from('issue_reports').select('id').eq('image_path', imagePath).limit(1);
  if (error || (data?.length ?? 0) > 0) return;
  await context.db.storage.from('issue-images').remove([imagePath]);
}
