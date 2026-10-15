create or replace function public.moderate_report(
  p_report_id uuid,
  p_action text,
  p_reason text,
  p_expected_revision integer,
  p_merge_target uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
declare
  v_moderator_id uuid := auth.uid();
  v_report public.issue_reports%rowtype;
  v_target public.issue_reports%rowtype;
  v_decision public.moderation_decisions%rowtype;
  v_resulting_status text;
begin
  if not private.active_moderator() then raise exception using errcode = '42501', message = 'active moderator session required'; end if;
  if p_report_id is null or p_expected_revision is null then
    raise exception using errcode = '22023', message = 'report id and expected revision are required';
  end if;
  if p_action is null or p_action not in ('VERIFY', 'REJECT', 'MERGE', 'RESOLVE', 'EXPIRE')
     or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'invalid action or reason';
  end if;
  if (p_action = 'MERGE' and p_merge_target is null) or (p_action <> 'MERGE' and p_merge_target is not null) then
    raise exception using errcode = '22023', message = 'merge target is required only for MERGE';
  end if;

  select * into v_report from public.issue_reports where id = p_report_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'report not found'; end if;
  if v_report.revision <> p_expected_revision then
    raise exception using errcode = 'PT409', message = format('REVISION_CONFLICT current_revision=%s', v_report.revision);
  end if;

  if p_action = 'VERIFY' then
    if v_report.status <> 'PENDING' or v_report.expires_at <= now() then
      raise exception using errcode = '23514', message = 'only an unexpired pending report can be verified';
    end if;
    v_resulting_status := 'VERIFIED';
  elsif p_action = 'REJECT' then
    if v_report.status <> 'PENDING' then raise exception using errcode = '23514', message = 'only a pending report can be rejected'; end if;
    v_resulting_status := 'REJECTED';
  elsif p_action = 'MERGE' then
    if v_report.status not in ('PENDING', 'VERIFIED') or v_report.expires_at <= now() then
      raise exception using errcode = '23514', message = 'only an active pending or verified report can be merged';
    end if;
    if p_merge_target = p_report_id then raise exception using errcode = '23514', message = 'a report cannot be merged into itself'; end if;
    select * into v_target from public.issue_reports where id = p_merge_target for update;
    if not found or v_target.status not in ('PENDING', 'VERIFIED') or v_target.expires_at <= now()
       or v_target.merged_into_id is not null
       or v_target.station_id <> v_report.station_id or v_target.category <> v_report.category
       or (v_report.status = 'VERIFIED' and v_target.status <> 'VERIFIED') then
      raise exception using errcode = '23514', message = 'merge target must be an active canonical report for the same station and category';
    end if;
    v_resulting_status := 'MERGED';
  elsif p_action = 'RESOLVE' then
    if v_report.status not in ('PENDING', 'VERIFIED') then raise exception using errcode = '23514', message = 'only a pending or verified report can be resolved'; end if;
    v_resulting_status := 'RESOLVED';
  else
    if v_report.status not in ('PENDING', 'VERIFIED') then raise exception using errcode = '23514', message = 'only a pending or verified report can be expired'; end if;
    v_resulting_status := 'EXPIRED';
  end if;

  update public.issue_reports
    set status = v_resulting_status,
        merged_into_id = case when p_action = 'MERGE' then p_merge_target else null end,
        updated_at = now(),
        revision = revision + 1
    where id = p_report_id
    returning * into v_report;
  insert into public.moderation_decisions (report_id, moderator_id, action, reason, resulting_status)
  values (p_report_id, v_moderator_id, p_action, btrim(p_reason), v_resulting_status)
  returning * into v_decision;
  return jsonb_build_object('report', to_jsonb(v_report), 'decision', to_jsonb(v_decision));
end;
$$;
revoke all on function public.moderate_report(uuid, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.moderate_report(uuid, text, text, integer, uuid) to authenticated;
