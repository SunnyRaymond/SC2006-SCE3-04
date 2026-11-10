# Verification record — 15 October 2026

This records actual checks of the current working tree. Implementation files are uncommitted; no application code has been pushed. The acceptance procedures are in [acceptance.md](acceptance.md). Google/GitHub provider configuration was deferred by the owner.

## Reference environment

- Windows 10.0.26300; Intel Core i9-13900H, 20 logical processors, 15.6 GiB RAM.
- Node.js 22.12.0; Next.js 16.4.1 production server at `http://127.0.0.1:3000`.
- Supabase project `lqzuldwhzrbgitelztnx`, Tokyo region, Nano compute; authenticated API calls use the public application key and user JWT with database RLS.
- LTA DataMall and OneMap authenticated live adapters; private local provider cache. Fixed synthetic data is separately labelled `DEMO_FIXTURE`.
- Chrome browser, desktop 1440×1000 and mobile 390×844.

Local HTTP is a development transport. This record does not establish deployed TLS compliance.

## Executed checks

| Check | Observed result |
|---|---|
| TypeScript and production build | Passed. `/`, `/api/app`, and `/api/health` built; production health returned HTTP 200. |
| Unit and route-handler suite | **41/41 passed**, eight files. Domain branches **243/278 (87.41%)**, engine **228/262 (87.02%)**. Provider tests isolate file writes and cannot populate the application's real-provider cache. |
| Energy / feasibility / cost / ranking | Logical partitions: **100% / 86.47% / 100% / 85.33%** respectively. Exact branch denominators and fixed numerical oracles are in [calculation-fixtures.md](calculation-fixtures.md). |
| Registration | A new disposable account was registered through the real browser UI. It entered the Driver workspace directly, signed in with its password, and returned `DRIVER` from the authenticated bootstrap API. Hosted email confirmation is disabled by the owner's explicit choice. |
| Browser journeys | **8/8 passed** in the final production build: account access, real registration, vehicle/planning/comparison/version/report flow, Moderator review, mobile planning/results, unsaved-change confirmation/logout, keyboard-only search/create/compare/dialog flow, and unsaved-location reload behavior. The report flow also verifies a duplicate's safe summary, a controlled HTTP 429 retry-time display, invalid-image rejection and retained draft text. Real API rate limiting was verified separately. |
| Accessibility | All **nine** core frames had **zero serious/critical** axe violations under WCAG 2 A/AA and WCAG 2.1 A/AA tags. Keyboard search, planning, comparison, dialog dismissal and restored focus passed. |
| Live provider integration | Actual LIVE create **3.000 s**, cached LIVE reconfigure **1.047 s**, LIVE refresh **3.261 s**. Reconfigure preserved the source timestamps and old versions. Moderator reports displayed cached official LTA status with detail retrieval and batch source times. |
| API contracts and lifecycle | A shared-session integration run passed **103 checks**; its last logout assertion was interrupted by another test signing out that same user. An isolated production check subsequently verified **bootstrap 200 → logout 200 → old JWT 401**. The failure is retained in the private original record. |
| Permission and moderation | Authenticated Drivers received HTTP 403 for Verify, Reject, Merge, Resolve and Expire. The integration run checked duplicate privacy, image ownership/MIME, private signed URLs, five-per-hour limiting, pending/verified fault behavior, multiple supports, canonical merge, resolution and expiry. |
| Concurrent moderation | A stale revision returned HTTP 409 after the database conflict code was corrected to `PT409`. Row locking, expected-revision checks, role checks, and append-only decision history remain enforced. |
| Fault lifecycle and refresh fallback | **38/38 passed** against real Supabase persistence with explicitly synthetic Demo Fixture reports. Pending does not filter; verification filters create/reconfigure/refresh; refresh clears an invalid selection and names the next alternative for Driver choice; a valid selection persists. Two independent supports keep the station excluded until both are withdrawn or expired. Original versions remain unchanged. All three generated plans were deleted, the profile restored, and zero active test fault supports remained. |
| Secret handling | The final scan checked both actual provider credential values across 38 source/client files and the one reachable Git commit, with zero findings. `credentials.env`, `.local/test-users.json`, and `.cache` are ignored. The 24 checked disposable password accounts used bcrypt-format hashes; no hash or password was exported. |

The controlled timeout tests call the actual API route handler with delayed authentication/profile/fault prerequisites and injected provider responses. A stalled LIVE create returned a timeout in about **3.98 seconds**; an immediate provider error also returned within five seconds. Neither wrote a plan version, and the previous refresh version remained unchanged. These are controlled failure tests, not observations of a real public-provider outage.

## NFR-01: cached real-provider performance

Command: `node scripts/benchmark.mjs --run --mode=live --server=production --base-url=http://127.0.0.1:3000`.

Twenty separate Driver accounts each warmed a real LIVE NTU-to-Marina plan. The formal workload then used **20 concurrent users × 5 strategy reconfigurations = 100 requests**. No other verification load ran during the formal measured workload. All requests retained their latency in the denominator. All 100 responses were HTTP 200 and reused fresh cached real-provider data with its original timestamps.

| Metric | Result |
|---|---:|
| Attempted / successful requests | **100 / 100** |
| Fresh/cached qualification | **100 / 100** |
| p50 | 1,217.57 ms |
| p95, nearest-rank | **1,918.67 ms** |
| Maximum | 2,033.83 ms |
| Generated plans cleaned up | **20 / 20** |
| NFR-01 verdict on this reference environment | **PASS** |

This final-build run followed the selection-preservation fix. The earlier run is retained separately in the private evidence. The final warmup began with an empty real-provider cache, repopulated from LTA with 2,799 station-index rows; the synthetic normalization fixture was absent from that cache. This is the cached-data strategy-reconfiguration workload defined by the script. It does not claim that every cold search, provider download, or different origin/destination completes within three seconds.

## NFR-10: repeated full API journeys

**PASS on the final production build: 100/100 consecutive complete API journeys, zero failures and zero skipped journeys.** Each journey checked create, comparison data for three options, selection, refresh, reconfigure, finite recommendation values, explicit Demo Fixture provenance, immutable prior versions, deletion and confirmed absence. Strategies cycled across all five presets. All **100/100** generated plans were deleted and the original profile was restored. Browser comparison rendering is tested separately above.

The earlier pre-fallback-fix 100/100 run is retained as separate private evidence. This result uses explicitly synthetic Demo Fixture data and real application/Supabase persistence; it does not claim 100 LIVE-provider journeys or 100 browser-rendered comparisons. The calculation branch results in the executed-checks table and calculation-fixtures.md separately satisfy the four reported logical partitions above 80%.

## Remaining acceptance gates

| Requirement | Required remaining evidence |
|---|---|
| NFR-04 | Team review and approval of the published fixed fixture/oracle set. The numerical tests pass; approval has not been invented. |
| NFR-05 | Deferred by the owner until deployment; the current delivery is a local demonstration. Then inspect the actual authenticated HTTPS application endpoint for TLS 1.2 or later. The localhost test is not TLS evidence. |
| NFR-09 | Conduct the real five-participant first-use study; at least four must create a plan and compare two options unassisted within three minutes. Use [usability-study.md](usability-study.md). |

Private raw evidence stays in ignored `.local/`: `ui-results.json`, `accessibility.json`, `api-verification.json`, `logout-verification.json`, `fault-flow.json`, `performance.json`, `reliability.json`, `secret-verification.json`, and UI screenshots. Test credentials and browser traces must not be copied into public submissions. The fault-flow record retains its initial setup failure when the local server was not running; the completed run is recorded separately. The real-user study has not been run.
