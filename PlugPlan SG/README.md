# PlugPlan SG

A Singapore EV charging planner built with Next.js, React, TypeScript, and Supabase. It supports Driver accounts, one EV profile per Driver, charging recommendations, comparison, saved plan versions, community reports, and a Moderator workspace.

## Run locally

Use Node.js 22.12 or later and pnpm 11. From this folder:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). For a production build:

```powershell
pnpm build
pnpm start
```

Stop the development server before building; both commands use `.next`. This is a Node.js application, and its provider adapter uses a writable local cache. Run it on a Node host with a persistent writable application directory. A deployment needs HTTPS at the hosting platform or reverse proxy. Local HTTP is not evidence of the TLS acceptance requirement.

The current delivery is a local demonstration, as requested by the owner; deployment and its TLS acceptance check are deferred.

### Quick demonstration

1. Create an email/password Driver account. The course-demo configuration signs you in directly without email confirmation.
2. Save the prefilled example under **Your vehicle**, or enter your vehicle's own figures.
3. Open **Plan a journey**, select **Demo fixtures**, then **Use example journey** and **Find charging options**. This supplies a reproducible three-option NTU-to-Marina journey and clearly labels all synthetic data.
4. Compare the options, choose a stop, change the strategy, refresh, and switch saved versions. Submit a synthetic report if demonstrating the community workflow; a pending report alone does not exclude a charger.
5. Use an administrator-provisioned Moderator account for **Report review**, reasoned decisions and audit history. Public registration always creates a Driver. Existing private demonstration credentials remain in ignored `.local/test-users.json`.

Choose **Live data** for actual LTA/OneMap search and calculation. Public providers may supply incomplete data or fail; the application labels cached/stale data or explains the failure and retains the previous saved version.

## Configuration

The ignored `credentials.env` is loaded by `next.config.ts`. Required variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Target Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public application key; safe for the browser subject to RLS |
| `LTA_Datamall_API` | LTA DataMall AccountKey; server only |
| `OneMap_API` | Current OneMap token; server only |

Do not add `NEXT_PUBLIC_` to provider credentials. A Supabase service-role key is not used. Restart the server after changing provider credentials. Rebuild a production bundle if the Supabase URL or public key changes, because these two public settings are included in browser code. OneMap tokens expire: replace the token when needed. The currently configured OneMap token expires on 18 October 2026 at 14:06 SGT. Never commit `credentials.env`, `.env*`, `.local`, or `.cache`.

The current target is project `lqzuldwhzrbgitelztnx`. Its database migrations and private image bucket are recorded in [supabase/README.md](supabase/README.md). For a fresh Supabase project, apply the SQL migrations in filename order. New Auth users are provisioned as Drivers regardless of client metadata. Moderator accounts are provisioned by the project administrator, not through public signup.

For the course demonstration, the owner has chosen email/password registration without email confirmation. The hosted Auth setting has been changed accordingly; real signup is verified separately. The current UC-01 flow covers registration, sign-in, and sign-out; email recovery can be added with a configured SMTP service when required.

### Google and GitHub sign-in

Both entry points use Supabase OAuth with PKCE. Provider configuration is currently deferred by the owner. Their enabled state is read from hosted Auth settings, and unconfigured providers are hidden. Client secrets belong in Supabase Auth provider settings, never in frontend code.

1. In Supabase **Authentication → URL Configuration**, set the Site URL and allow the application return URLs. Local examples: `http://127.0.0.1:3000/**` and `http://localhost:3000/**`. Add the deployed HTTPS origin before deployment.
2. Create a Google **Web application** OAuth client and a GitHub **OAuth App** in the respective owner accounts.
3. Use this provider callback URL for both: `https://lqzuldwhzrbgitelztnx.supabase.co/auth/v1/callback`.
4. In Supabase **Authentication → Sign In / Providers**, enable each provider and enter its Client ID and Client Secret.
5. Test each provider with a real consenting user, including cancellation and the return to PlugPlan. OAuth approval or password entry should be completed by the account owner.

Official setup guides: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Data modes and calculation rules

**Live data** uses authenticated LTA batch/detail data and OneMap address/route services. Batch data builds the station index; postal details supply connector identifiers and current connector status. Candidate routing is bounded to nearby compatible stations, so results are the best among evaluated candidates rather than a claim of a global optimum. Source coverage limitations and data ages are disclosed in the result.

**Demo fixtures** are explicitly selected synthetic inputs, stations, routes, and prices. They exercise the same calculation and persistence flows, and every result is labelled `DEMO_FIXTURE`. A provider error does not silently substitute a demonstration result.

- Times without an offset are interpreted in Singapore time (UTC+8).
- Missing station opening hours are assumed to be 24/7 and disclosed.
- Arrival energy uses route distance and the saved vehicle consumption assumption.
- The automatic charging target covers the station-to-destination drive plus the vehicle reserve.
- Charger energy uses 90% efficiency; charging power is limited by both the vehicle and connector.
- Known per-kWh/per-hour prices are supported. Missing or unsupported prices display `Price unavailable`; parking and other fees are excluded.
- Balanced weights are time 0.35, cost 0.25, availability 0.25, and detour 0.15. The other strategies use their stated metrics with deterministic ties.
- Only verified, unexpired suspected-fault reports support station exclusion. Pending reports and other categories do not. Filtering happens after ranking and before the top three are chosen.
- Reconfigure and refresh append immutable versions. Deleting a vehicle does not rewrite assumptions preserved in existing plan versions.

The application provides recommendations. It does not reserve chargers, process payments, manage queues, or continuously monitor journeys.

## Verification

```powershell
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
```

Browser tests use installed Chrome and disposable Driver/Moderator credentials in ignored `.local/test-users.json`. That private file is not a distribution asset. Other environments need their own dedicated test accounts and matching private file. The tests create demonstration plans/reports; run them only against a development project.

The [verification record](docs/verification.md) gives the dated results and remaining gates. The [acceptance plan](docs/acceptance.md) maps all eight use cases, 25 functional requirements, and ten non-functional requirements. Exact verification results and remaining gates are recorded separately; a unit-test pass is not proof of live API, OAuth, TLS, performance, accessibility, or human usability acceptance.

Explicit `--run` scripts in `scripts/` perform API integration, the controlled 20-user/100-request workload, and 100 consecutive deterministic journeys. Read each script's usage before running it. Private evidence and screenshots stay in `.local`; no tokens or passwords should appear in public reports.

The five-participant first-use study must be conducted with real representative users. Disposable accounts and automated browser runs do not substitute for those participants.
