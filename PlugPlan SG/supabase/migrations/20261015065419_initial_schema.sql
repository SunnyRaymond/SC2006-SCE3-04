create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'DRIVER' check (role in ('DRIVER', 'MODERATOR')),
  status text not null default 'ACTIVE'
);
create unique index app_users_email_lower_uidx on public.app_users (lower(email));

create table public.revoked_sessions (
  session_id uuid primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  revoked_at timestamptz not null default now()
);

create table private.issue_report_submissions (
  user_id uuid not null references public.app_users(id) on delete cascade,
  submitted_at timestamptz not null default now()
);
create index issue_report_submissions_user_time_idx on private.issue_report_submissions (user_id, submitted_at);
revoke all on private.issue_report_submissions from public, anon, authenticated;

create function private.valid_vehicle_profile(p_data jsonb)
returns boolean
language plpgsql immutable
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_value jsonb;
begin
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data->'name') is distinct from 'string'
     or length(btrim(p_data->>'name')) not between 1 and 100
     or jsonb_typeof(p_data->'plugTypes') is distinct from 'array'
     or jsonb_array_length(p_data->'plugTypes') < 1 then
    return false;
  end if;
  for v_value in select value from jsonb_array_elements(p_data->'plugTypes') as values(value) loop
    if jsonb_typeof(v_value) is distinct from 'string'
       or length(btrim(v_value #>> '{}')) not between 1 and 40 then return false; end if;
  end loop;
  if jsonb_typeof(p_data->'capacityKWh') is distinct from 'number'
     or (p_data->>'capacityKWh')::numeric not between 10 and 250
     or jsonb_typeof(p_data->'consumptionKWhPer100Km') is distinct from 'number'
     or (p_data->>'consumptionKWhPer100Km')::numeric not between 5 and 50
     or jsonb_typeof(p_data->'maxAcKw') is distinct from 'number'
     or (p_data->>'maxAcKw')::numeric not between 1 and 50
     or jsonb_typeof(p_data->'maxDcKw') is distinct from 'number'
     or (p_data->>'maxDcKw')::numeric not between 1 and 400
     or jsonb_typeof(p_data->'reserveSoc') is distinct from 'number'
     or (p_data->>'reserveSoc')::numeric not between 5 and 40
     or jsonb_typeof(p_data->'defaultDetourMinutes') is distinct from 'number'
     or (p_data->>'defaultDetourMinutes')::numeric not between 0 and 120
     or jsonb_typeof(p_data->'minChargerKw') is distinct from 'number'
     or (p_data->>'minChargerKw')::numeric not between 0 and 400
     or jsonb_typeof(p_data->'maxWalkingM') is distinct from 'number'
     or (p_data->>'maxWalkingM')::numeric < 0 then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.valid_vehicle_profile(jsonb) from public, anon, authenticated;
grant execute on function private.valid_vehicle_profile(jsonb) to authenticated;

create function private.valid_plan_result(p_result jsonb)
returns boolean
language plpgsql immutable
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_value jsonb;
begin
  if jsonb_typeof(p_result) is distinct from 'object'
     or jsonb_typeof(p_result->'inputs') is distinct from 'object'
     or not private.valid_vehicle_profile(p_result->'profileAssumptions')
     or jsonb_typeof(p_result->'recommendations') is distinct from 'array'
     or jsonb_typeof(p_result->'excluded') is distinct from 'array'
     or jsonb_typeof(p_result->'noChargeNeeded') is distinct from 'boolean'
     or jsonb_typeof(p_result->'directRoute') is distinct from 'object'
     or jsonb_typeof(p_result->'snapshot') is distinct from 'object'
     or jsonb_typeof(p_result->'faultFilterCheckedAt') is distinct from 'string'
     or jsonb_typeof(p_result->'faultEvidence') is distinct from 'array'
     or jsonb_typeof(p_result->'summary') is distinct from 'string' then return false; end if;
  for v_value in select value from jsonb_array_elements(p_result->'recommendations') as items(value) loop
    if jsonb_typeof(v_value) is distinct from 'object'
       or jsonb_typeof(v_value->'id') is distinct from 'string'
       or jsonb_typeof(v_value->'stationId') is distinct from 'string' then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.valid_plan_result(jsonb) from public, anon, authenticated;

create table public.vehicles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint vehicles_data_shape check (private.valid_vehicle_profile(data))
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  selected_recommendation_id text,
  current_version_id uuid,
  created_at timestamptz not null default now()
);
create index plans_user_created_idx on public.plans (user_id, created_at desc);

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  result jsonb not null check (private.valid_plan_result(result)),
  reason text not null check (reason in ('CREATE', 'RECONFIGURE', 'REFRESH')),
  created_at timestamptz not null default now(),
  unique (plan_id, version_number),
  unique (id, plan_id)
);
alter table public.plans
  add constraint plans_current_version_same_plan_fk
  foreign key (current_version_id, id)
  references public.plan_versions (id, plan_id)
  deferrable initially deferred;

create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  station_id text not null check (length(btrim(station_id)) between 1 and 128),
  station_name text not null check (length(btrim(station_name)) between 1 and 160),
  connector_id text check (connector_id is null or length(btrim(connector_id)) between 1 and 128),
  category text not null check (category in ('BLOCKED_BAY', 'SUSPECTED_FAULTY_CONNECTOR', 'INCORRECT_LOCATION', 'ACCESS_PROBLEM')),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REJECTED', 'MERGED', 'RESOLVED', 'EXPIRED')),
  note text not null default '' check (length(note) <= 2000),
  image_path text check (image_path is null or length(image_path) <= 1024),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  merged_into_id uuid,
  check ((status = 'MERGED' and merged_into_id is not null) or (status <> 'MERGED' and merged_into_id is null))
);
create index issue_reports_owner_created_idx on public.issue_reports (user_id, created_at desc);
create index issue_reports_active_duplicate_idx on public.issue_reports (station_id, category, connector_id, expires_at)
  where status in ('PENDING', 'VERIFIED');
create index issue_reports_active_fault_idx on public.issue_reports (station_id, expires_at)
  where status = 'VERIFIED' and category = 'SUSPECTED_FAULTY_CONNECTOR';

create table public.moderation_decisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.issue_reports(id) on delete cascade,
  moderator_id uuid not null references public.app_users(id) on delete restrict,
  action text not null check (action in ('VERIFY', 'REJECT', 'MERGE', 'RESOLVE', 'EXPIRE')),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  resulting_status text not null check (resulting_status in ('VERIFIED', 'REJECTED', 'MERGED', 'RESOLVED', 'EXPIRED')),
  created_at timestamptz not null default now()
);
create index moderation_decisions_report_created_idx on public.moderation_decisions (report_id, created_at desc);

create function private.auth_session_active()
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null then return false; end if;
  begin
    v_session_id := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if v_session_id is null then return false; end if;
  return not exists (
    select 1 from public.revoked_sessions r
    where r.session_id = v_session_id and r.user_id = v_user_id
  );
end;
$$;
revoke all on function private.auth_session_active() from public, anon, authenticated;

create function private.active_app_user()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
  select private.auth_session_active() and exists (
    select 1 from public.app_users u where u.id = auth.uid() and u.status = 'ACTIVE'
  );
$$;
revoke all on function private.active_app_user() from public, anon, authenticated;

create function private.active_driver()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
  select private.auth_session_active() and exists (
    select 1 from public.app_users u where u.id = auth.uid() and u.status = 'ACTIVE' and u.role = 'DRIVER'
  );
$$;
revoke all on function private.active_driver() from public, anon, authenticated;

create function private.active_moderator()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
  select private.auth_session_active() and exists (
    select 1 from public.app_users u where u.id = auth.uid() and u.status = 'ACTIVE' and u.role = 'MODERATOR'
  );
$$;
revoke all on function private.active_moderator() from public, anon, authenticated;
grant execute on function private.active_app_user() to authenticated;
grant execute on function private.active_driver() to authenticated;
grant execute on function private.active_moderator() to authenticated;

create function public.handle_auth_user_created()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  insert into public.app_users (id, email, role, status)
  values (new.id, new.email, 'DRIVER', 'ACTIVE');
  return new;
end;
$$;
revoke all on function public.handle_auth_user_created() from public, anon, authenticated;
create trigger plugplan_provision_driver
after insert on auth.users
for each row execute function public.handle_auth_user_created();

create function public.handle_auth_email_updated()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.app_users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.handle_auth_email_updated() from public, anon, authenticated;
create trigger plugplan_sync_auth_email
after update of email on auth.users
for each row execute function public.handle_auth_email_updated();

create function private.check_plan_selection()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_result jsonb;
begin
  if new.selected_recommendation_id is null then return new; end if;
  if new.current_version_id is null then
    raise exception using errcode = '23514', message = 'selected recommendation requires a current version';
  end if;
  select pv.result into v_result from public.plan_versions pv
    where pv.id = new.current_version_id and pv.plan_id = new.id;
  if not found or not exists (
    select 1 from jsonb_array_elements(v_result->'recommendations') rec(value)
    where rec.value->>'id' = new.selected_recommendation_id
  ) then
    raise exception using errcode = '23514', message = 'selected recommendation is not in the current version';
  end if;
  return new;
end;
$$;
revoke all on function private.check_plan_selection() from public, anon, authenticated;
create trigger plans_check_selection
before insert or update of selected_recommendation_id, current_version_id on public.plans
for each row execute function private.check_plan_selection();

create function private.prevent_plan_version_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, pg_temp
as $$
begin
  raise exception using errcode = '55000', message = 'plan versions are immutable';
end;
$$;
revoke all on function private.prevent_plan_version_update() from public, anon, authenticated;
create trigger plan_versions_immutable before update on public.plan_versions
for each row execute function private.prevent_plan_version_update();

alter table public.app_users enable row level security;
alter table public.revoked_sessions enable row level security;
alter table public.vehicles enable row level security;
alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.issue_reports enable row level security;
alter table public.moderation_decisions enable row level security;

create policy app_users_read_self on public.app_users for select to authenticated
  using (id = auth.uid() and private.active_app_user());

create policy vehicles_read_own on public.vehicles for select to authenticated
  using (user_id = auth.uid() and private.active_driver());
create policy vehicles_insert_own on public.vehicles for insert to authenticated
  with check (user_id = auth.uid() and private.active_driver());
create policy vehicles_update_own on public.vehicles for update to authenticated
  using (user_id = auth.uid() and private.active_driver())
  with check (user_id = auth.uid() and private.active_driver());
create policy vehicles_delete_own on public.vehicles for delete to authenticated
  using (user_id = auth.uid() and private.active_driver());

create policy plans_read_own on public.plans for select to authenticated
  using (user_id = auth.uid() and private.active_driver());
create policy plans_update_selection_own on public.plans for update to authenticated
  using (user_id = auth.uid() and private.active_driver())
  with check (user_id = auth.uid() and private.active_driver());
create policy plans_delete_own on public.plans for delete to authenticated
  using (user_id = auth.uid() and private.active_driver());

create policy plan_versions_read_own on public.plan_versions for select to authenticated
  using (exists (
    select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid() and private.active_driver()
  ));

create policy issue_reports_read_owner_or_moderator on public.issue_reports for select to authenticated
  using ((user_id = auth.uid() and private.active_driver()) or private.active_moderator());

create policy moderation_decisions_read_owner_or_moderator on public.moderation_decisions for select to authenticated
  using (private.active_moderator() or exists (
    select 1 from public.issue_reports r
    where r.id = report_id and r.user_id = auth.uid() and private.active_driver()
  ));

revoke all on table public.app_users, public.revoked_sessions, public.vehicles, public.plans,
  public.plan_versions, public.issue_reports, public.moderation_decisions from public, anon, authenticated;
grant select on public.app_users, public.vehicles, public.plans, public.plan_versions,
  public.issue_reports, public.moderation_decisions to authenticated;
grant insert, update, delete on public.vehicles to authenticated;
grant update (selected_recommendation_id) on public.plans to authenticated;
grant delete on public.plans to authenticated;

create function public.is_current_session_active()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
  select private.active_app_user();
$$;
revoke all on function public.is_current_session_active() from public, anon, authenticated;
grant execute on function public.is_current_session_active() to authenticated;

create function public.revoke_session()
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  begin
    v_session_id := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'valid session required';
  end;
  if v_session_id is null or not exists (
    select 1 from public.app_users u where u.id = v_user_id and u.status = 'ACTIVE'
  ) then raise exception using errcode = '42501', message = 'active session required'; end if;
  insert into public.revoked_sessions (session_id, user_id) values (v_session_id, v_user_id)
  on conflict (session_id) do nothing;
  return jsonb_build_object('revoked', true);
end;
$$;
revoke all on function public.revoke_session() from public, anon, authenticated;
grant execute on function public.revoke_session() to authenticated;

create function public.save_plan_version(p_plan_id uuid, p_title text, p_result jsonb, p_reason text)
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
    update public.plans set title = btrim(p_title), selected_recommendation_id = null where id = v_plan_id;
  end if;
  insert into public.plan_versions (plan_id, version_number, result, reason)
  values (v_plan_id, v_number, p_result, p_reason)
  returning id into v_version_id;
  update public.plans set current_version_id = v_version_id where id = v_plan_id;
  return jsonb_build_object('planId', v_plan_id, 'versionId', v_version_id, 'number', v_number);
end;
$$;
revoke all on function public.save_plan_version(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_plan_version(uuid, text, jsonb, text) to authenticated;

create function public.submit_report(
  p_station_id text,
  p_station_name text,
  p_connector_id text,
  p_category text,
  p_note text,
  p_image_path text default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, private, storage, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_first timestamptz;
  v_retry integer;
  v_duplicate public.issue_reports%rowtype;
  v_report public.issue_reports%rowtype;
begin
  if not private.active_driver() then raise exception using errcode = '42501', message = 'active driver session required'; end if;
  if p_station_id is null or length(btrim(p_station_id)) not between 1 and 128
     or p_station_name is null or length(btrim(p_station_name)) not between 1 and 160
     or (p_connector_id is not null and length(btrim(p_connector_id)) not between 1 and 128)
     or p_category is null or p_category not in ('BLOCKED_BAY', 'SUSPECTED_FAULTY_CONNECTOR', 'INCORRECT_LOCATION', 'ACCESS_PROBLEM')
     or p_note is null or length(p_note) > 2000 then
    raise exception using errcode = '22023', message = 'invalid report fields';
  end if;
  if p_image_path is not null and (
       length(p_image_path) > 1024
       or cardinality(storage.foldername(p_image_path)) <> 1
       or (storage.foldername(p_image_path))[1] <> v_user_id::text
       or storage.filename(p_image_path) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'issue-images' and o.name = p_image_path)
     ) then
    raise exception using errcode = '22023', message = 'image must be an uploaded issue-images object owned by the caller';
  end if;

  perform 1 from public.app_users u where u.id = v_user_id for update;
  delete from private.issue_report_submissions s
    where s.user_id = v_user_id and s.submitted_at < now() - interval '1 hour';
  select count(*), min(s.submitted_at) into v_count, v_first
    from private.issue_report_submissions s
    where s.user_id = v_user_id and s.submitted_at >= now() - interval '1 hour';
  if v_count >= 5 then
    v_retry := greatest(1, ceil(extract(epoch from (v_first + interval '1 hour' - clock_timestamp())))::integer);
    raise exception using errcode = 'P0001', message = format('RATE_LIMITED retry_after_seconds=%s', v_retry);
  end if;
  insert into private.issue_report_submissions (user_id) values (v_user_id);

  perform pg_advisory_xact_lock(hashtextextended(
    btrim(p_station_id) || chr(31) || coalesce(btrim(p_connector_id), '') || chr(31) || p_category, 0
  ));
  select * into v_duplicate from public.issue_reports r
    where r.station_id = btrim(p_station_id)
      and coalesce(r.connector_id, '') = coalesce(nullif(btrim(p_connector_id), ''), '')
      and r.category = p_category
      and r.status in ('PENDING', 'VERIFIED')
      and r.expires_at > now()
    order by r.created_at desc limit 1;
  if found then
    return jsonb_build_object('duplicate', true, 'report', jsonb_build_object(
      'id', v_duplicate.id,
      'station_id', v_duplicate.station_id,
      'station_name', v_duplicate.station_name,
      'connector_id', v_duplicate.connector_id,
      'category', v_duplicate.category,
      'status', v_duplicate.status,
      'expires_at', v_duplicate.expires_at,
      'created_at', v_duplicate.created_at
    ));
  end if;

  insert into public.issue_reports (user_id, station_id, station_name, connector_id, category, note, image_path)
  values (v_user_id, btrim(p_station_id), btrim(p_station_name), nullif(btrim(p_connector_id), ''), p_category, p_note, p_image_path)
  returning * into v_report;
  return jsonb_build_object('duplicate', false, 'report', to_jsonb(v_report));
end;
$$;
revoke all on function public.submit_report(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_report(text, text, text, text, text, text) to authenticated;

create function public.moderate_report(
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
    raise exception using errcode = '40001', message = format('REVISION_CONFLICT current_revision=%s', v_report.revision);
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

create function public.get_active_faults()
returns table (station_id text, report_id uuid, decision_id uuid, expires_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, private, pg_temp
as $$
begin
  if not private.active_driver() then raise exception using errcode = '42501', message = 'active driver session required'; end if;
  return query
  select r.station_id, r.id, d.id, r.expires_at
  from public.issue_reports r
  join lateral (
    select md.id from public.moderation_decisions md
    where md.report_id = r.id and md.action = 'VERIFY' and md.resulting_status = 'VERIFIED'
    order by md.created_at desc limit 1
  ) d on true
  where r.status = 'VERIFIED'
    and r.category = 'SUSPECTED_FAULTY_CONNECTOR'
    and r.expires_at > now()
    and r.merged_into_id is null;
end;
$$;
revoke all on function public.get_active_faults() from public, anon, authenticated;
grant execute on function public.get_active_faults() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-images', 'issue-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy issue_images_read_owner_or_moderator on storage.objects for select to authenticated
  using (bucket_id = 'issue-images' and (
    (private.active_driver() and (storage.foldername(name))[1] = auth.uid()::text)
    or private.active_moderator()
  ));
create policy issue_images_insert_owner on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issue-images'
    and private.active_driver()
    and cardinality(storage.foldername(name)) = 1
    and (storage.foldername(name))[1] = auth.uid()::text
    and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  );
create policy issue_images_delete_owner on storage.objects for delete to authenticated
  using (
    bucket_id = 'issue-images'
    and private.active_driver()
    and cardinality(storage.foldername(name)) = 1
    and (storage.foldername(name))[1] = auth.uid()::text
    and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  );
