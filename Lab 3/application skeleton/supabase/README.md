# Supabase setup

The SQL migrations in migrations/ define the PlugPlan application schema, row-level security policies, database functions, and private report-image storage.

## Apply migrations

For a new project, apply the four files in migrations/ in filename order using the Supabase SQL Editor or your team's configured migration workflow:

1. 20261015065419_initial_schema.sql creates the application tables, account-provisioning trigger, access policies and functions, and the private issue-images bucket.
2. 20261015065744_harden_profile_and_revision_checks.sql adds profile and report-revision checks.
3. 20261015073113_moderate_report_revision_conflict_http_409.sql returns a conflict response for stale moderation revisions.
4. 20261015075439_save_plan_version_preserve_selection.sql preserves a selected recommendation when it remains in a newly saved plan version.

For an existing project, compare its migration history first and apply only migrations that have not already run. Do not execute the same migration twice. Apply migrations to the intended project and keep its database credentials out of this folder.

## Authentication and storage

New Supabase Auth users receive the DRIVER role. Moderator access must be granted through a trusted project-administrator path; public signup cannot assign that role.

The migrations create the private issue-images bucket with restricted access. Keep row-level security enabled and configure Supabase Auth redirect URLs for the local or deployed application origin. The application uses the publishable key in the client and relies on database policies for access control.

See the [application README](../README.md) for local run steps and environment variables.
