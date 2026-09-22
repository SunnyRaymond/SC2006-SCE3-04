# PlugPlan SG — Lab 2 Analysis Model Specification

This is the concise analysis specification for Lab 2. It carries forward the
Lab 1 Data Dictionary, requirements, eight use cases, and nine UI frames. The
refined cases in [`use_cases.json`](use_cases.json) are the canonical use-case
source. The model describes the problem domain and UI behaviour; it does not
commit the team to a database, framework, API layout, or deployment design.

Use UML stereotypes `<<entity>>`, `<<boundary>>`, and `<<control>>`. `Driver`
and `Moderator` are use-case roles represented by `User.role`, rather than
duplicated entity classes. A Driver has zero or one EV Profile in the MVP:
zero is valid before setup or after deletion, but a valid profile is required
before planning.

## 1. Agreed FR-24/UC-07 refinement

The original issue-report capability is preserved. A Driver submits a
time-limited report for a station or connector, and it enters `PENDING` for
Moderator review. Submission alone never excludes a station.

The downstream effect is derived from existing reports and moderation decisions;
there is no standalone `FaultMark` entity and no public report feed:

- A station is faulty at time `t` when at least one report with category
  `SUSPECTED_FAULTY_CONNECTOR` is `VERIFIED` and `expiresAt > t`.
- A faulty report attached to a Connector contributes to its parent Station
  mark. A station-target report marks that Station directly.
- `PENDING`, rejected, resolved, expired, and non-fault reports do not support
  exclusion. Resolving or expiring one report removes only that report's
  support; another valid support keeps the station marked. Merging keeps the
  canonical target report and does not create duplicate support.
- The algorithm first generates and ranks suggestions using the existing route,
  compatibility, dwell, cost, availability, and strategy rules. It then
  evaluates active Moderator marks, removes marked stations before the
  displayed shortlist, and takes up to three surviving unmarked options. If
  one survives, comparison is disabled; if none survives, the UI explains that
  no eligible option remains and may use next-ranked unmarked candidates when
  available.
- The same check runs during initial generation, user-initiated recalculation,
  and manual refresh. `PlanVersion` records `faultFilterCheckedAt` and the
  report/decision evidence used at that time. There is no background
  auto-recalculation.

## 2. Conceptual model — entity classes

The following attributes are the labels for the class diagram. `?` means
optional and `/` means derived. Existing ranges come from Lab 1; the profile
preference values are also shown in D-01.

| Class (`stereotype`) | Key attributes and constraints |
|---|---|
| `User` (`<<entity>>`) | `userId`; unique `email`; `passwordHash`; `role {DRIVER, MODERATOR}`; `status`. Only a Driver owns planning/report data; only a Moderator creates decisions. |
| `EVProfile` (`<<entity>>`) | `profileId`; `vehicleName?`; `usableCapacityKWh [10,250]`; `consumptionKWhPer100Km [5,50]`; one or more `plugTypes`; `maxACPowerKW [1,50]`; `maxDCPowerKW [1,400]`; `reserveSOCPercent [5,40]`; D-01 preferences `defaultMaximumDetourMinutes?`, `minimumChargerPowerKW?`, `maximumWalkingDistanceM?`. |
| `ChargingPlan` (`<<entity>>`) | `planId`; `status`; `createdAt`; current selection `(versionId, recommendationId)?` if a Driver selects a charger. Persistent Driver-owned record containing versions; selection is a mutable plan-level reference, not part of an immutable version. |
| `PlanVersion` (`<<entity>>`) | `versionId`; `versionNumber`; `origin`; `destination`; `currentSOCPercent [0,100]`; `departureAt`; `maximumChargingMinutes [5,720]`; `maximumDetourMinutes [0,120]`; `strategy`; `manualTargetSOCPercent?`; `createdAt`; `faultFilterCheckedAt`; `faultEvidenceRefs?`. Stores a copy of vehicle assumptions used by the calculation. |
| `ChargingStation` (`<<entity>>`) | `stationId`; `name`; `address`; `latitude`; `longitude`; `operator`; `operatingHours`; `/isFaultyAt(t)`. The derived mark is true when verified/unexpired faulty support exists. |
| `Connector` (`<<entity>>`) | `connectorId`; `plugType`; `currentType {AC, DC}`; `maximumPowerKW`; official `status`; `priceType`; `unitPrice?`. Belongs to exactly one station; official status is distinct from the derived faulty mark. |
| `OfficialSnapshot` (`<<entity>>`) | `snapshotId`; `source`; `observedAt`; `retrievedAt`; `dataState {LIVE, CACHED, STALE, DEMO_FIXTURE}`. Timestamped provider evidence used by a version. |
| `RouteEstimate` (`<<entity>>`) | `routeId`; `origin`; `destination`; `distanceKm`; `durationMinutes`; `retrievedAt`. OneMap result used for route energy, detour, and destination energy. |
| `Recommendation` (`<<entity>>`) | `recommendationId`; `feasibility`; `arrivalSOC`; `automaticTargetSOC`; `requiredEnergyKWh`; `chargingMinutes`; `estimatedCost?`; `detourMinutes`; `availabilitySummary`; `rankBeforeFaultFilter`; `rank?`; `shortlistState {SURVIVES, FILTERED_FAULT, HARD_EXCLUDED}`; `filterReason?`; `explanation`. Only surviving eligible recommendations are displayed or selected. |
| `IssueReport` (`<<entity>>`) | `reportId`; `category {BLOCKED_BAY, SUSPECTED_FAULTY_CONNECTOR, INCORRECT_LOCATION, ACCESS_PROBLEM}`; `note`; `imageReference?`; `status {PENDING, VERIFIED, REJECTED, MERGED, RESOLVED, EXPIRED}`; `createdAt`; `expiresAt`; `/faultSupportAt(t)`. Always identifies one station and may identify one connector. |
| `ModerationDecision` (`<<entity>>`) | `decisionId`; `action {VERIFY, REJECT, MERGE, RESOLVE, EXPIRE}`; `reason`; `createdAt`; `resultingStatus`. Append-only audit event by one Moderator for one report. |

`RankingStrategy` is a value/enumeration selected by each version:
`FASTEST`, `CHEAPEST`, `AVAILABILITY_FIRST`, `MINIMUM_DETOUR`, or `BALANCED`.
`PriceType` supports per-kWh or per-hour; missing or unsupported price is
**Price unavailable**, never zero. `ChargingPlan.status` retains the Lab 1
plan lifecycle without adding a new status model.

### Associations and multiplicities

Use composition (`◆`) for version-owned calculation data and aggregation (`◇`)
for the station/connector grouping.

| Association | Multiplicity and meaning |
|---|---|
| `User` — `EVProfile` | User `1` to Profile `0..1`; Profile to User `1`. At most one profile per Driver; a Moderator has zero. |
| `User` — `ChargingPlan` | User `1` to Plans `0..*`; Plan to owner `1`. |
| `ChargingPlan` — `EVProfile` | Plan to current profile `0..1`; Profile to Plans `0..*`. Historical versions use copied assumptions, so deletion does not rewrite history. |
| `ChargingPlan ◆— PlanVersion` | Plan `1` to Versions `1..*`; Version to Plan `1`. Every recalculation/refresh appends a version. |
| `ChargingPlan` — current selection | Plan to selection `0..1`; selection refers to one version and one recommendation and may change without mutating the version. |
| `PlanVersion — OfficialSnapshot` | Version `1` to Snapshot `1`; Snapshot to Versions `0..*`. |
| `PlanVersion ◆— RouteEstimate` | Version `1` to Routes `1..*`; Route to Version `1`. |
| `PlanVersion ◆— Recommendation` | Version `1` to Recommendations `0..*`; Recommendation to Version `1`. Zero is the explicit no-option result. |
| `ChargingStation ◇— Connector` | Station `1` to Connectors `1..*`; Connector to Station `1`. |
| `Recommendation` — `Connector` | Recommendation `0..*` to Connector `1`. |
| `ChargingStation` — `IssueReport` | Station `1` to Reports `0..*`; Report to Station `1`. |
| `Connector` — `IssueReport` | Report to Connector `0..1`; Connector to Reports `0..*`. Connector-target fault support resolves to the parent station. |
| `User` — `IssueReport` | Driver `1` to Reports `0..*`; Report to reporter `1`. |
| `IssueReport ◆— ModerationDecision` | Report `1` to Decisions `0..*`; Decision to Report `1`. |
| `User` — `ModerationDecision` | Moderator `1` to Decisions `0..*`; Decision to Moderator `1`. |
| `PlanVersion` — `RankingStrategy` | Version to selected strategy `1`. |

### Calculation relationships

`PlanVersion` supplies the journey and copied profile assumptions to
`FeasibilityControl`; it uses `RouteEstimate`, `Connector`, and
`OfficialSnapshot` to create `Recommendation` objects. Effective power is the
lower of connector power and the applicable vehicle AC/DC limit. The automatic
target and manual-target rules, reachability, compatibility, operating hours,
detour, dwell fit, cost, ranking factors, timestamps, and estimate warnings
remain those specified in Lab 1. The model does not introduce a new calculation
formula.

## 3. Key boundary and control classes

### Boundary classes

| Class (`<<boundary>>`) | Key boundary state/attributes | Responsibility | Frame |
|---|---|---|---|
| `AccountAccessView` | `emailInput`; `passwordInput`; `registrationMode`; `inputError`; `sessionRoute` | Sign-in, Driver registration, generic error, role-aware routing | D-00 |
| `VehicleProfileView` | `profileForm`; `validationErrors`; `saveState`; `deleteConfirmation` | One profile, units/assumptions, validation, save/delete | D-01 |
| `PlanInputView` | `pendingInputs`; `targetMode`; `placeResolutionState`; `routeError`; transient `draftState` | Journey, SOC, departure, dwell, detour, target, draft/cancel/find | D-02, M-01 |
| `RecommendationView` | `displayedRecommendations`; `dataState`; `excludedReasons`; `selectedStrategy`; `refreshState` | Cards, route, explanations, freshness/data state, exclusions, edit/refresh | D-03, M-02 |
| `CompareReconfigureView` | `comparisonSet[2..3]?`; `whatIfInputs`; `unsavedChanges`; `recalculationState` | Two/three-option comparison and what-if/recalculate controls | D-04 |
| `IssueReportView` | `stationContext`; `connectorContext?`; `category`; `note`; `imageState`; `submissionState` | Station/connector context, category, note, image, duplicate/validation/success | D-05 |
| `ModeratorReviewView` | `queueFilter`; `activeReport`; `evidence`; `decisionReason`; `auditHistory`; `concurrencyState` | Restricted queue, evidence, official status, audit, decision controls | D-06 |
| `OneMapBoundary` | `placeQuery`; `resolvedPlace?`; `routeResult?`; `providerError?` | Place resolution and route result/error boundary | Plan flows |
| `LTASnapshotBoundary` | `snapshot?`; `observedAt`; `retrievedAt`; `dataState`; `providerError?` | Station/connector snapshot, timestamps, data-state boundary | Plan flows |

M-01 and M-02 are responsive presentations of D-02 and D-03, not separate
use cases or domain entities.

### Control classes

| Class (`<<control>>`) | Maintained analysis state/attributes | Responsibilities | Trace |
|---|---|---|---|
| `AccountAccessControl` | `session?`; `attemptState`; `role?` | Registration, sign-in, session role, sign-out, generic errors | UC-01; FR-01–02 |
| `EVProfileControl` | `loadedProfile?`; `validationResult`; `saveState` | Load/validate/create/update/delete profile; protect copied version assumptions | UC-02; FR-03–04 |
| `ChargingPlanControl` | `currentPlan?`; `currentVersion?`; `pendingRecalculation?`; `currentSelection?` | Validate inputs, create plan/version, coordinate recalc/refresh, preserve versions and selection/fallback | UC-03, UC-05, UC-06; FR-05, FR-21–23 |
| `ExternalDataControl` | `placeState`; `routeResults`; `usableSnapshot?`; `dataState`; `providerFailure?` | OneMap place/routes, latest usable LTA snapshot, cached/stale/demo state, visible provider failure | UC-03, UC-06; FR-06–07 |
| `FeasibilityControl` | `candidateResults`; `exclusionReasons`; `calculationWarnings` | Reachability, plug/hours/detour, SOC/energy/time/dwell/cost rules | UC-03–06; FR-08–17 |
| `StationRankingControl` | `strategy`; `factorValues`; `rankedSuggestions`; `rankingExplanation` | Fixed strategy factors, ranking, explanations, next-ranked alternatives | UC-03–06; FR-18–20, FR-23 |
| `ModeratorFaultFilter` | `checkTime`; `activeSupportRefs`; `filteredCandidates`; `survivors` | Evaluate report/decision support after ranking, mark candidates `FILTERED_FAULT`, record evidence and form survivors | UC-03/05/06 plus UC-07/08 refinement; FR-24 refinement |
| `IssueReportControl` | `reportDraft`; `duplicateMatch?`; `expiry`; `submissionState` | Validate/create expiring Pending report, duplicate check, queue availability and acknowledgement | UC-07; FR-24 |
| `ModerationControl` | `queue`; `activeReport`; `decisionDraft`; `auditHistory`; `concurrencyToken?` | Moderator authorization, queue/evidence/history, reason/concurrency checks, append decisions and status | UC-08; FR-25 |

The main coordination dependencies are
`ChargingPlanControl -> ExternalDataControl, FeasibilityControl,
StationRankingControl, ModeratorFaultFilter` and
`ModeratorFaultFilter -> Recommendation, ChargingStation, IssueReport,
ModerationDecision, PlanVersion`. `IssueReportControl` uses
`IssueReport/ChargingStation/Connector/User`; `ModerationControl` uses
`IssueReport/ModerationDecision/ChargingStation/User`.

## 4. Initial Dialog Map

### Logical UI states

| State | Frame(s) | Entry and in-state variants |
|---|---|---|
| `S0 Account Access` | D-00 | No session; sign-in, Driver registration, generic invalid-credentials and inactive-account states. |
| `S1 Vehicle Profile` | D-01 | Authenticated Driver; empty/current profile, validation, saved confirmation, delete/empty state. |
| `S2 Plan Input` | D-02; M-01 | Valid profile; normal, automatic/manual target, transient draft controls, ambiguous place, invalid input, route-error-with-inputs-preserved. |
| `S3 Recommendations` | D-03; M-02 | Ranked cards; live/cached/stale/demo, estimate warning, enough charge, no options, one survivor/comparison disabled, fallback, fault-filtered exclusion. |
| `S4 Compare & Reconfigure` | D-04 | Comparison, missing price/stale option, pending what-if, reset, new-version notice, provider error. |
| `S5 Report Charger Issue` | D-05 | Context/category/note/image, privacy reminder, duplicate, image validation, Pending success/reference, cancel. |
| `S6 Moderator Report Review` | D-06 | Queue tabs, evidence/official status/related reports/audit, reason, five actions, missing reason, concurrent update. |

The D-02 `Save as Draft` control is retained as a UI affordance from Lab 1. In
this analysis model it is a transient input state, not a new persistent Draft
entity or additional functional requirement; unsaved origin/destination values
are not retained after the UI is abandoned.

### Transitions

Same-state edges are intentional UI state changes and may be shown as loops or
annotations in the state machine.

| From | Trigger and guard | To / outcome |
|---|---|---|
| S0 | Register Driver or valid Driver sign-in | S1 or S2 with Driver session; UC-01, FR-01–02 |
| S0 | Valid Moderator sign-in | S6 with restricted Moderator session; UC-01 |
| S0 | Invalid/inactive account | S0 with generic error/support instruction; UC-01 exceptions |
| Any | Sign out | S0; session invalidated |
| S1 | Save valid profile / invalid profile / confirm delete | S1 saved / S1 field errors / S1 empty; UC-02 |
| S1 | Plan a Charge with valid profile | S2 (D-02 or M-01); UC-02 → UC-03 |
| S2 | Choose manual target, transient draft, ambiguous place, invalid input, route failure | S2 with corresponding state; UC-03 alternatives/exceptions |
| S2 | Valid journey and provider results; calculate, rank, then fault-filter | S3 (D-03 or M-02), new Plan Version; UC-03, FR-05–19, FR-24 refinement |
| M-01 | Find options with valid input | M-02 using the same calculation guard; UC-03 |
| S3 | Edit Plan | S2; UC-05 |
| S3 | Compare two/three eligible cards | S4; UC-04, FR-20 |
| S3 | Strategy/reconfigure action | S4 or new-version calculation; UC-04.AC.1, UC-05 |
| S3 | Manual Refresh with usable snapshot | S3, new version, original or next-ranked unmarked fallback; UC-06, FR-22–23, FR-24 refinement |
| S3 | No usable snapshot / enough charge / zero or one survivor | S3 explicit failure / continuation / no-option or comparison-disabled state |
| M-02 | Edit or Refresh | M-01 or M-02; same S2/S3 rules as desktop |
| S3 | Report station/connector issue | S5 with pre-filled context; UC-07 |
| S4 | Change values / Reset / Recalculate | S4 pending / S4 current values / S3 new immutable version; UC-05, FR-21, FR-24 refinement |
| S4 | Unsaved exit or provider failure | S4 confirmation / previous version unchanged; UC-05 exceptions |
| S5 | Submit valid / duplicate / invalid image or rate limit / cancel | S5 Pending reference / S5 existing-report choice / S5 validation / prior S3; UC-07, FR-24 |
| S6 | Select report | S6 with evidence, official status, related reports, audit; UC-08 |
| S6 | Verify faulty with reason | S6; append decision and activate station support for future generation/recalc/refresh |
| S6 | Reject, resolve, expire, or merge with reason | S6; append decision and update lifecycle/support according to the rules above |
| S6 | Missing reason or concurrent update | S6 blocked action / S6 refresh-required state; UC-08 exceptions |

## 5. Traceability

| Use case | Frame coverage | Main model coverage |
|---|---|---|
| UC-01 Access Account | D-00 | `User`, `AccountAccessView/Control` |
| UC-02 Manage EV Profile | D-01 | `EVProfile`, `VehicleProfileView/Control`; profile `0..1` until created |
| UC-03 Create Charging Plan | D-02, D-03, M-01, M-02 | Plan/version, routes, snapshots, recommendations, all planning controls; ranked suggestions are fault-filtered before display |
| UC-04 Review and Compare | D-03, D-04, M-02 | Recommendation and comparison boundaries; only two/three eligible survivors compare |
| UC-05 Reconfigure Plan | D-04, D-03 | Immutable version plus feasibility/ranking/fault-filter controls |
| UC-06 Refresh and Fallback | D-03, D-04, M-02 | Snapshot/version/fallback controls; manual refresh rechecks marks |
| UC-07 Submit Charger Issue | D-05; report enters D-06 queue | `IssueReportControl`; Pending acknowledgement; submission alone does not exclude |
| UC-08 Moderate Charger Reports | D-06; effect appears in later D-03/D-04/M-02 | `ModerationDecision`, `ModerationControl`, derived station mark/filter |

Frame inventory: D-00 Account Access (UC-01); D-01 Vehicle Profile (UC-02);
D-02 Plan a Charging Stop (UC-03); D-03 Charging Recommendations
(UC-03/04/06); D-04 Compare & Reconfigure (UC-04/05/06 context); D-05 Report
a Charger Issue (UC-07); D-06 Moderator Report Review (UC-08); M-01 mobile Plan
Input (responsive UC-03); M-02 mobile Recommendations (responsive UC-04/06).

Functional requirement grouping: FR-01–02 map to account classes/D-00; FR-03–04
to profile/D-01; FR-05–07 to plan/external data/D-02/M-01; FR-08–17 to
route/connector/recommendation/feasibility/D-03/M-02/D-04; FR-18–20 to ranking
and comparison/D-03/D-04/M-02; FR-21 to immutable version/D-04; FR-22–23 to
refresh/fallback/D-03/M-02; FR-24 retains issue submission/D-05 and adds the
fault-filter refinement through D-03/D-04/M-02; FR-25 maps to moderation/D-06.

## 6. Consistency checks for diagram review

- Every profile has exactly one Driver owner; a Driver may temporarily have no
  profile. Every plan has exactly one Driver owner and at least one version.
- Every version has one strategy, one snapshot, and (for a calculated result)
  one or more routes; zero recommendations must carry an explicit reason.
- Every recommendation names one Connector, and every Connector belongs to one
  Station. Unknown/deleted connectors cannot be displayed or selected.
- Every report names one Station, optionally one Connector belonging to that
  Station, and one Driver reporter. Every decision names one report and one
  Moderator and has a reason.
- A connector-target faulty report resolves to its parent Station before the
  mark check. Raw/pending/non-fault reports can be visible as evidence but
  cannot set `/isFaultyAt` true.
- `faultFilterCheckedAt` and evidence references stay in the immutable version;
  later moderation changes affect future calculations only.
- Do not add orphan `FaultMark`, public report-feed, reservation, payment,
  background-monitoring, or telemetry entities; they are outside this Lab 2
  model's scope.
