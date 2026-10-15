-- Rollback-only regression cases for selection preservation. Run against a test project as an administrator.
begin;
do $$
declare
  v_user_id uuid;
  v_plan_id uuid;
  v_version_id uuid;
  v_result jsonb;
  v_same_recommendation jsonb;
  v_missing_recommendation jsonb;
  v_empty_recommendations jsonb;
  v_selected text;
  v_version_count integer;
  v_initial_copy jsonb;
  v_profile jsonb := '{
    "name":"Rollback selection test",
    "capacityKWh":60,
    "consumptionKWhPer100Km":17.5,
    "plugTypes":["Combo2"],
    "maxAcKw":22,
    "maxDcKw":150,
    "reserveSoc":20,
    "defaultDetourMinutes":15,
    "minChargerKw":0,
    "maxWalkingM":0
  }'::jsonb;
begin
  select id into v_user_id
  from public.app_users
  where role = 'DRIVER' and status = 'ACTIVE'
  order by id
  limit 1;
  if v_user_id is null then raise exception 'No active Driver is available for rollback test.'; end if;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_id,
    'role', 'authenticated',
    'session_id', gen_random_uuid()
  )::text, true);

  v_result := jsonb_build_object(
    'inputs', '{}'::jsonb,
    'profileAssumptions', v_profile,
    'recommendations', jsonb_build_array(jsonb_build_object('id', 'selected-keep', 'stationId', 'TEST-A')),
    'excluded', '[]'::jsonb,
    'noChargeNeeded', false,
    'directRoute', '{}'::jsonb,
    'snapshot', '{}'::jsonb,
    'faultFilterCheckedAt', now()::text,
    'faultEvidence', '[]'::jsonb,
    'summary', 'rollback selection test'
  );
  v_same_recommendation := jsonb_set(v_result, '{recommendations}', jsonb_build_array(
    jsonb_build_object('id', 'selected-keep', 'stationId', 'TEST-A'),
    jsonb_build_object('id', 'alternative', 'stationId', 'TEST-B')
  ));
  v_missing_recommendation := jsonb_set(v_result, '{recommendations}', jsonb_build_array(
    jsonb_build_object('id', 'alternative', 'stationId', 'TEST-B')
  ));
  v_empty_recommendations := jsonb_set(v_result, '{recommendations}', '[]'::jsonb);

  insert into public.plans (user_id, title)
  values (v_user_id, 'Rollback selection preservation test')
  returning id into v_plan_id;
  insert into public.plan_versions (plan_id, version_number, result, reason)
  values (v_plan_id, 1, v_result, 'CREATE')
  returning id into v_version_id;
  update public.plans set current_version_id = v_version_id where id = v_plan_id;
  update public.plans set selected_recommendation_id = 'selected-keep' where id = v_plan_id;
  v_initial_copy := v_result;

  perform public.save_plan_version(v_plan_id, 'Rollback selection preservation test', v_same_recommendation, 'RECONFIGURE');
  select selected_recommendation_id into v_selected from public.plans where id = v_plan_id;
  if v_selected is distinct from 'selected-keep' then raise exception 'Selection was not preserved when still recommended.'; end if;

  perform public.save_plan_version(v_plan_id, 'Rollback selection preservation test', v_missing_recommendation, 'REFRESH');
  select selected_recommendation_id into v_selected from public.plans where id = v_plan_id;
  if v_selected is not null then raise exception 'Selection was not cleared when it disappeared.'; end if;

  update public.plans set selected_recommendation_id = 'alternative' where id = v_plan_id;
  perform public.save_plan_version(v_plan_id, 'Rollback selection preservation test', v_empty_recommendations, 'RECONFIGURE');
  select selected_recommendation_id into v_selected from public.plans where id = v_plan_id;
  if v_selected is not null then raise exception 'Selection was not cleared for an empty recommendation list.'; end if;

  select result into v_result from public.plan_versions where plan_id = v_plan_id and version_number = 1;
  select count(*) into v_version_count from public.plan_versions where plan_id = v_plan_id;
  if v_result is distinct from v_initial_copy or v_version_count <> 4 then
    raise exception 'The original version changed or append-only version count was incorrect.';
  end if;
  raise notice 'PASS: preserve present selection; clear missing selection; keep empty result unselected; old version unchanged; four versions appended.';
end;
$$;
rollback;
