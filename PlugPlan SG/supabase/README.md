# Supabase database

The PlugPlan SG database is attached to project ref `lqzuldwhzrbgitelztnx`. The migrations below were applied to that project after confirming that the application schema was empty. They preserve Supabase-managed Auth and Storage schemas and do not change Auth email-confirmation settings.

## Migrations

Apply in timestamp order:

1. `migrations/20261015065419_initial_schema.sql` creates the application tables, Auth provisioning triggers, RLS policies, RPCs, and the private `issue-images` bucket.
2. `migrations/20261015065744_harden_profile_and_revision_checks.sql` grants the profile validator needed by authenticated profile writes and hardens `moderate_report` against missing report/revision values.
3. `migrations/20261015073113_moderate_report_revision_conflict_http_409.sql` maps only stale `moderate_report` revisions to SQLSTATE `PT409` (PostgREST HTTP 409). The row lock, revision check, role gate, legal-transition checks, audit insert, and grants remain unchanged.
4. `migrations/20261015075439_save_plan_version_preserve_selection.sql` preserves the selected recommendation when its ID is still present in the appended version; otherwise it clears the selection without choosing a fallback.

For a new environment, review the linked project's migration history before applying these files. Use the team's configured Supabase CLI or Supabase migration tool; if using the CLI, link the target ref, inspect `supabase migration list --linked`, then run `supabase db push` only after confirming it will apply these migrations in order. Do not paste the SQL into an already-migrated database or create a second copy of the tables/policies. The repository contains no database credentials.

After applying, verify that the seven `public` application tables have RLS enabled and that the private bucket is named `issue-images`, is non-public, has a 5 MiB limit, and allows only `image/jpeg`, `image/png`, and `image/webp`.

## Tables and access rules

| Table | Purpose and access |
|---|---|
| `app_users` | One row per `auth.users` account. A user can read only their own row. No client role/status writes. |
| `vehicles` | At most one JSON `VehicleProfile` per Driver, keyed by `user_id`; owner-only read/write. Profile deletion does not delete saved plans or their copied result/profile assumptions. |
| `plans` | Driver-owned saved plans. Owner can read/delete and update only the selected recommendation field. Creation and version changes use `save_plan_version()`. Deleting a plan cascades its versions. |
| `plan_versions` | Append-only calculated results. Plan owner can read. Client insert/update is denied; `save_plan_version()` appends atomically. |
| `issue_reports` | Driver reports. Owner and active Moderator can read; direct client writes are denied. Use `submit_report()` and `moderate_report()`. |
| `moderation_decisions` | Append-only Moderator audit history. The report owner and active Moderators can read; writes occur only through `moderate_report()`. |
| `revoked_sessions` | Server-managed revoked session IDs. No direct client table access. `revoke_session()` records only the caller's current session. |

The private `private.issue_report_submissions` table tracks the per-Driver report limit and is not exposed to client roles. RLS helpers check the stored application role, active status, and the JWT `session_id` revocation record on every protected access.

## Authentication and roles

An `auth.users` insert trigger creates an `app_users` row with `role = 'DRIVER'` and `status = 'ACTIVE'`. It does not trust `raw_user_meta_data` or `raw_app_meta_data`. Public signup therefore cannot self-assign Moderator. Email updates sync to `app_users`; the Auth confirmation/SMTP configuration remains a project setting and is not modified by these migrations.

Only a trusted project administrator may promote an account to `MODERATOR` or change its status using an administrative path outside the public client API. Do not grant `authenticated` or `anon` update access to `app_users`. Keep test-account credentials in ignored `PlugPlan SG/.local/test-users.json`; never commit passwords, JWTs, publishable keys, or service keys.

`is_current_session_active()` returns whether the authenticated user's account and current JWT session are active. `revoke_session()` takes no arguments and returns `{ "revoked": true }`; call it before Supabase client sign-out. A previously issued token is rejected by the application and by RLS after its session ID is revoked.

## Plan version RPC

```text
save_plan_version(
  p_plan_id uuid,
  p_title text,
  p_result jsonb,
  p_reason text
) -> { "planId": uuid, "versionId": uuid, "number": integer }
```

Pass `p_plan_id = null` and `p_reason = 'CREATE'` to create a plan; a valid Driver profile is required. Existing owned plans accept `RECONFIGURE` or `REFRESH`. The function locks the plan and, in one transaction, appends the next version and advances `current_version_id`. It preserves the existing selection only when that recommendation ID appears in the new result; if it disappeared or the result has no recommendations, it clears the selection and does not auto-select a fallback. The current-version and selection update occurs after the new immutable version is inserted, so the selection trigger validates against the new version atomically. A `PlanResult` shape check protects persisted copies. Direct version updates are rejected; deleting a plan deletes its versions.

`tests/save_plan_version_selection_rollback.sql` exercises preserve, disappeared-selection, and empty-recommendation cases in a transaction that ends with `ROLLBACK`. It also checks that an earlier version remains unchanged. Run it only after the corresponding migration is applied.

The rollback cases passed on the linked project after applying the migration; a follow-up read confirmed that the temporary test plan left no persisted row.

## Report and moderation RPCs

```text
submit_report(
  p_station_id text,
  p_station_name text,
  p_connector_id text,
  p_category text,
  p_note text,
  p_image_path text default null
) -> { "duplicate": boolean, "report": object }

moderate_report(
  p_report_id uuid,
  p_action text,
  p_reason text,
  p_expected_revision integer,
  p_merge_target uuid default null
) -> { "report": object, "decision": object }

get_active_faults() -> rows(
  station_id text,
  report_id uuid,
  decision_id uuid,
  expires_at timestamptz
)
```

`submit_report()` is Driver-only. It sets new reports to `PENDING` with `expires_at = created time + 24 hours` and enforces five valid submission attempts per rolling hour. An active duplicate returns only a safe summary (ID, station/connector/category, status, expiry, and creation time); it never returns another Driver's note, image path, email, or identity. A duplicate attempt counts toward the request limit. A report's expiry is enforced by time checks; no background process changes its row status automatically.

`moderate_report()` is active-Moderator-only, locks the report, checks `p_expected_revision`, validates the transition, and appends a reasoned audit row while incrementing `revision`. Legal actions are `VERIFY`, `REJECT`, `MERGE`, `RESOLVE`, and `EXPIRE`. A merge requires an active canonical target for the same station and category; a verified fault can merge only into a verified target. A stale revision uses SQLSTATE `PT409`, which PostgREST returns as HTTP 409 without triggering PostgreSQL serialization retries; invalid parameters use `22023`; invalid transitions or merge targets use `23514`; missing reports use `P0002`; insufficient role/session uses `42501`.

`get_active_faults()` is Driver-only and returns only unexpired `VERIFIED` reports in category `SUSPECTED_FAULTY_CONNECTOR`, excluding merged source rows. It does not expose reporter identity, note, or image path. Resolving/expiring a report removes only that report's support; another active verified report can continue supporting the station mark.

## Private issue images

The private `issue-images` bucket accepts JPEG, PNG, or WebP up to 5 MiB. An upload path must be `auth.uid()/<UUID>.<jpg|jpeg|png|webp>`. Drivers can insert/read/delete only their own objects; they cannot update or overwrite objects. An active Moderator can read any object in this bucket for report review. The application issues a short-lived signed URL only after checking access to the associated report. Do not store an image URL as the report's `image_path`; store the object path.

## Database acceptance

The current schema was checked using rollback-only transactions: RLS/role isolation, metadata role escalation, profile bounds, plan append/immutability, cross-user reads, duplicate privacy, rate limiting, moderation/revision conflicts, active-fault filtering, session revocation, and deletion behavior. For ongoing acceptance, see [`../docs/acceptance.md`](../docs/acceptance.md). Run test-user and report creation checks only with dedicated test accounts and clean up generated application data after testing.
