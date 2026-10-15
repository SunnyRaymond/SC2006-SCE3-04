import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppBootstrap, AppUser, IssueReport, ModerationAction, ModerationDecision,
  PlanResult, PlanVersion, SavedPlan, VehicleProfile,
} from '@/lib/types';
import { ApiError, databaseError } from './errors';
import type { RequestContext } from './supabase';

type Row = Record<string, any>;

function throwDb(error: { code?: string; message?: string } | null): void {
  if (error) throw databaseError(error);
}

function mapDecision(row: Row): ModerationDecision {
  return {
    id: row.id,
    action: row.action,
    reason: row.reason,
    moderatorId: row.moderator_id,
    createdAt: row.created_at,
    resultingStatus: row.resulting_status,
  };
}

function mapReport(row: Row, decisions: ModerationDecision[] = []): IssueReport {
  const createdAt = row.created_at ?? '';
  return {
    id: row.id,
    userId: row.user_id ?? '',
    stationId: row.station_id,
    stationName: row.station_name,
    connectorId: row.connector_id ?? null,
    category: row.category,
    status: row.status,
    note: row.note ?? '',
    imagePath: row.image_path ?? null,
    expiresAt: row.expires_at ?? '',
    createdAt,
    updatedAt: row.updated_at ?? createdAt,
    revision: Number(row.revision ?? 0),
    mergedIntoId: row.merged_into_id ?? null,
    decisions,
  };
}

function mapVersion(row: Row): PlanVersion {
  return {
    id: row.id,
    planId: row.plan_id,
    number: Number(row.version_number),
    createdAt: row.created_at,
    reason: row.reason,
    result: row.result as PlanResult,
  };
}

function mapPlan(row: Row, versions: PlanVersion[] = []): SavedPlan {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    selectedRecommendationId: row.selected_recommendation_id ?? null,
    currentVersionId: row.current_version_id ?? null,
    versions,
  };
}

async function loadDecisions(db: SupabaseClient, reportIds: string[]): Promise<Map<string, ModerationDecision[]>> {
  const result = new Map<string, ModerationDecision[]>();
  if (reportIds.length === 0) return result;
  const { data, error } = await db.from('moderation_decisions').select('*').in('report_id', reportIds).order('created_at', { ascending: true });
  throwDb(error);
  for (const row of data ?? []) {
    const list = result.get(row.report_id) ?? [];
    list.push(mapDecision(row));
    result.set(row.report_id, list);
  }
  return result;
}

export async function getProfile(context: RequestContext): Promise<VehicleProfile | null> {
  const { data, error } = await context.db.from('vehicles').select('data').eq('user_id', context.user.id).maybeSingle();
  throwDb(error);
  return data?.data ?? null;
}

export async function saveProfile(context: RequestContext, profile: VehicleProfile): Promise<VehicleProfile> {
  const { error } = await context.db.from('vehicles').upsert({ user_id: context.user.id, data: profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  throwDb(error);
  return profile;
}

export async function deleteProfile(context: RequestContext): Promise<void> {
  const { error } = await context.db.from('vehicles').delete().eq('user_id', context.user.id);
  throwDb(error);
}

export async function listPlans(context: RequestContext): Promise<SavedPlan[]> {
  const { data: rows, error } = await context.db.from('plans')
    .select('id,user_id,title,selected_recommendation_id,current_version_id,created_at')
    .eq('user_id', context.user.id)
    .order('created_at', { ascending: false });
  throwDb(error);
  const ids = (rows ?? []).map(row => row.id);
  const versionMap = new Map<string, PlanVersion[]>();
  if (ids.length) {
    const { data: versions, error: versionError } = await context.db.from('plan_versions')
      .select('id,plan_id,version_number,result,reason,created_at')
      .in('plan_id', ids)
      .order('version_number', { ascending: true });
    throwDb(versionError);
    for (const row of versions ?? []) {
      const list = versionMap.get(row.plan_id) ?? [];
      list.push(mapVersion(row));
      versionMap.set(row.plan_id, list);
    }
  }
  return (rows ?? []).map(row => mapPlan(row, versionMap.get(row.id) ?? []));
}

export async function getOwnedPlan(context: RequestContext, planId: string): Promise<SavedPlan> {
  const { data, error } = await context.db.from('plans')
    .select('id,user_id,title,selected_recommendation_id,current_version_id,created_at')
    .eq('id', planId).eq('user_id', context.user.id).maybeSingle();
  throwDb(error);
  if (!data) throw new ApiError('The requested plan was not found.', 404);
  const { data: versions, error: versionError } = await context.db.from('plan_versions')
    .select('id,plan_id,version_number,result,reason,created_at')
    .eq('plan_id', planId)
    .order('version_number', { ascending: true });
  throwDb(versionError);
  return mapPlan(data, (versions ?? []).map(mapVersion));
}

export async function savePlanVersion(
  context: RequestContext,
  planId: string | null,
  result: PlanResult,
  reason: PlanVersion['reason'],
): Promise<SavedPlan> {
  const destination = result.inputs.destination.label;
  const title = destination.length > 90 ? `${destination.slice(0, 87)}...` : destination;
  const { data, error } = await context.db.rpc('save_plan_version', {
    p_plan_id: planId,
    p_title: title,
    p_result: result,
    p_reason: reason,
  });
  throwDb(error);
  const saved = Array.isArray(data) ? data[0] : data;
  const savedPlanId = saved?.planId ?? saved?.plan_id ?? planId;
  if (typeof savedPlanId !== 'string') throw new ApiError('The plan could not be saved. Please try again.', 503);
  return getOwnedPlan(context, savedPlanId);
}

export async function selectRecommendation(context: RequestContext, planId: string, recommendationId: string): Promise<SavedPlan> {
  const plan = await getOwnedPlan(context, planId);
  const version = plan.versions.find(item => item.id === plan.currentVersionId);
  if (!version || !version.result.recommendations.some(item => item.id === recommendationId)) {
    throw new ApiError('Choose a recommendation from the current plan version.', 400, { recommendationId: 'Choose a current recommendation.' });
  }
  const { data, error } = await context.db.from('plans').update({ selected_recommendation_id: recommendationId })
    .eq('id', planId).eq('user_id', context.user.id).eq('current_version_id', plan.currentVersionId)
    .select('id,user_id,title,selected_recommendation_id,current_version_id,created_at').maybeSingle();
  throwDb(error);
  if (!data) throw new ApiError('This plan changed while you were selecting. Refresh and choose from the current version.', 409);
  return mapPlan(data, plan.versions);
}

export async function deletePlan(context: RequestContext, planId: string): Promise<void> {
  const { data, error } = await context.db.from('plans').delete().eq('id', planId).eq('user_id', context.user.id).select('id').maybeSingle();
  throwDb(error);
  if (!data) throw new ApiError('The requested plan was not found.', 404);
}

export async function listReports(context: RequestContext): Promise<IssueReport[]> {
  let query = context.db.from('issue_reports').select('*').order('created_at', { ascending: false });
  if (context.user.role === 'DRIVER') query = query.eq('user_id', context.user.id);
  const { data, error } = await query;
  throwDb(error);
  const rows = data ?? [];
  const decisions = await loadDecisions(context.db, rows.map(row => row.id));
  return rows.map(row => mapReport(row, decisions.get(row.id) ?? []));
}

export async function getReport(context: RequestContext, reportId: string): Promise<IssueReport> {
  let query = context.db.from('issue_reports').select('*').eq('id', reportId);
  if (context.user.role === 'DRIVER') query = query.eq('user_id', context.user.id);
  const { data, error } = await query.maybeSingle();
  throwDb(error);
  if (!data) throw new ApiError('The requested report was not found.', 404);
  const decisions = await loadDecisions(context.db, [reportId]);
  return mapReport(data, decisions.get(reportId) ?? []);
}

export async function submitReport(context: RequestContext, input: {
  stationId: string; stationName: string; connectorId: string | null;
  category: IssueReport['category']; note: string; imagePath: string | null;
}): Promise<{ report: IssueReport; duplicate: boolean; sharedDuplicate: boolean }> {
  const { data, error } = await context.db.rpc('submit_report', {
    p_station_id: input.stationId,
    p_station_name: input.stationName,
    p_connector_id: input.connectorId,
    p_category: input.category,
    p_note: input.note,
    p_image_path: input.imagePath,
  });
  throwDb(error);
  const result = Array.isArray(data) ? data[0] : data;
  const rawReport = result?.report;
  if (!rawReport?.id) throw new ApiError('The report could not be submitted. Please try again.', 503);
  const duplicate = result.duplicate === true;
  if (!duplicate) return { report: await getReport(context, rawReport.id), duplicate: false, sharedDuplicate: false };
  const ownReport = await getReport(context, rawReport.id).catch(() => null);
  if (ownReport) return { report: ownReport, duplicate: true, sharedDuplicate: false };
  const masked: IssueReport = {
    id: rawReport.id,
    userId: '',
    stationId: rawReport.station_id,
    stationName: rawReport.station_name,
    connectorId: rawReport.connector_id ?? null,
    category: rawReport.category,
    status: rawReport.status,
    note: '',
    imagePath: null,
    expiresAt: rawReport.expires_at,
    createdAt: rawReport.created_at,
    updatedAt: rawReport.created_at,
    revision: 0,
    mergedIntoId: null,
    decisions: [],
  };
  return { report: masked, duplicate: true, sharedDuplicate: true };
}

export async function moderateReport(context: RequestContext, input: {
  reportId: string; action: ModerationAction; reason: string; expectedRevision: number; mergeTargetId: string | null;
}): Promise<IssueReport> {
  const { data, error } = await context.db.rpc('moderate_report', {
    p_report_id: input.reportId,
    p_action: input.action,
    p_reason: input.reason,
    p_expected_revision: input.expectedRevision,
    p_merge_target: input.mergeTargetId,
  });
  throwDb(error);
  const reportId = data?.report?.id ?? data?.id ?? input.reportId;
  return getReport(context, reportId);
}

export async function getActiveFaults(context: RequestContext): Promise<PlanResult['faultEvidence']> {
  const { data, error } = await context.db.rpc('get_active_faults');
  throwDb(error);
  return (data ?? []).map((row: Row) => ({
    stationId: row.station_id,
    reportId: row.report_id,
    decisionId: row.decision_id ?? undefined,
    expiresAt: row.expires_at,
  }));
}

export async function bootstrap(context: RequestContext): Promise<AppBootstrap> {
  if (context.user.role === 'MODERATOR') {
    return { user: context.user as AppUser, profile: null, plans: [], reports: await listReports(context) };
  }
  const [profile, plans, reports] = await Promise.all([getProfile(context), listPlans(context), listReports(context)]);
  return { user: context.user, profile, plans, reports };
}

export async function revokeSession(context: RequestContext): Promise<void> {
  const { error } = await context.db.rpc('revoke_session');
  throwDb(error);
}

export async function createImageUrl(context: RequestContext, reportId: string): Promise<string> {
  const report = await getReport(context, reportId);
  if (!report.imagePath || !report.imagePath.startsWith(`${report.userId}/`)) throw new ApiError('This report has no available image.', 404);
  const { data, error } = await context.db.storage.from('issue-images').createSignedUrl(report.imagePath, 10 * 60);
  if (error || !data?.signedUrl) throw new ApiError('The report image is unavailable.', 503);
  return data.signedUrl;
}

