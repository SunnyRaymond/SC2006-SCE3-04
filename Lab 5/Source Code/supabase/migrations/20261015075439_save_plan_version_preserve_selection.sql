create or replace function public.save_plan_version(p_plan_id uuid, p_title text, p_result jsonb, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_version_id uuid;
  v_number integer;
  v_plan public.plans%rowtype;
  v_selected_recommendation_id text;
begin
  if not private.active_driver() then raise exception using errcode = '42501', message = 'active driver session required'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'title must contain 1 to 120 characters';
  end if;
  if not private.valid_plan_result(p_result) then
    raise exception using errcode = '22023', message = 'result must match PlanResult';
  end if;
  if p_plan_id is null then
    if p_reason is distinct from 'CREATE' then raise exception using errcode = '22023', message = 'new plans require reason CREATE'; end if;
    perform 1 from public.vehicles v where v.user_id = v_user_id for key share;
    if not found then raise exception using errcode = '23514', message = 'a valid vehicle profile is required to create a plan'; end if;
    insert into public.plans (user_id, title) values (v_user_id, btrim(p_title)) returning id into v_plan_id;
    v_number := 1;
  else
    if p_reason is distinct from 'RECONFIGURE' and p_reason is distinct from 'REFRESH' then
      raise exception using errcode = '22023', message = 'existing plans require reason RECONFIGURE or REFRESH';
    end if;
    select * into v_plan from public.plans where id = p_plan_id and user_id = v_user_id for update;
    if not found then raise exception using errcode = '42501', message = 'plan not found or not owned by caller'; end if;
    v_plan_id := v_plan.id;
    v_number := (select coalesce(max(version_number), 0) + 1 from public.plan_versions where plan_id = v_plan_id);
    v_selected_recommendation_id := v_plan.selected_recommendation_id;
    if v_selected_recommendation_id is not null and not exists (
      select 1
      from jsonb_array_elements(p_result->'recommendations') rec(value)
      where rec.value->>'id' = v_selected_recommendation_id
    ) then
      v_selected_recommendation_id := null;
    end if;
  end if;

  insert into public.plan_versions (plan_id, version_number, result, reason)
  values (v_plan_id, v_number, p_result, p_reason)
  returning id into v_version_id;

  update public.plans
    set title = btrim(p_title),
        selected_recommendation_id = v_selected_recommendation_id,
        current_version_id = v_version_id
    where id = v_plan_id;
  return jsonb_build_object('planId', v_plan_id, 'versionId', v_version_id, 'number', v_number);
end;
$$;
revoke all on function public.save_plan_version(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_plan_version(uuid, text, jsonb, text) to authenticated;
