# PlugPlan SG: Comprehensive Internal Proposal

> **Status:** Internal alignment draft, not a Lab submission
> **Research snapshot:** 27 August 2026

## 1. Product definition

### One-sentence pitch

**PlugPlan SG helps Singapore EV drivers decide where and when to charge near a destination, explains the trade-offs, and coordinates a voluntary handover between participating drivers when public chargers are occupied.**

### Product boundary

PlugPlan SG is a **decision and coordination application**. It is not:

- an official charger reservation system;
- a charging-network operator;
- a payment application;
- a remote charger controller;
- a guarantee that a bay will remain available; or
- merely an islandwide charger map.

Actual charging, payment, enforcement, and operator support remain with the charging operator. The application should deep-link users to the relevant operator or official channel when possible.

## 2. Problem and proposed value

A driver can see that a connector is free now, but still choose badly. By the time the driver arrives:

- the connector may be occupied;
- the carpark may be full;
- the charger may not support the vehicle's plug or desired speed;
- charging plus parking may cost more than an alternative;
- the available charger may not finish the requested charge within the driver's dwell time; or
- another driver may already be waiting without any orderly handover.

PlugPlan turns these factors into a trip-specific choice and then supports the complete journey from planning through queueing and session completion.

### User value

- Fewer wasted trips to incompatible, occupied, or unsuitable chargers.
- A transparent explanation of why one option fits the trip better.
- A fallback plan when conditions change.
- Voluntary, time-limited coordination between participating drivers.
- Clear separation of official status, community activity, and reported issues.

## 3. Target users and actors

| Actor | Responsibility or goal |
|---|---|
| **Driver** | Maintains vehicle preferences, creates charging plans, joins a community queue, checks in, records a session, and reports an issue. |
| **Moderator** | Reviews evidence, merges duplicate reports, resolves abuse, and handles disputed queue or report activity. |
| **LTA DataMall** | Supplies EV charging point, traffic, and possible carpark context. |
| **OneMap** | Resolves Singapore places and supplies routes or travel estimates. |
| **Notification Service** | Delivers queue offers, availability changes, and plan warnings. This can be email or in-app notification in the MVP. |

`Moderator` should be a genuine role with a small, defined workload. It should not exist only to inflate the Use Case Diagram.

## 4. Data sources and how they combine

The application should consume external data through backend adapters. No screen should call providers directly.

| Source | Candidate data | Contribution to the decision |
|---|---|---|
| [LTA DataMall EV Charging Points and Batch feed](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf?ref=public_apis) | Location, operating hours, operator, charger identifier, plug type, speed, price, connector status, update time | Compatibility, live availability, expected charging duration, and cost factors |
| [LTA DataMall Dynamic Datasets](https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html) | Traffic Speed Bands, Traffic Incidents, Carpark Availability where a reliable mapping exists | ETA, disruption, and parking-context factors |
| [OneMap Search](https://www.onemap.gov.sg/apidocs/search) | Address, postal code, building, and coordinates | Resolves the user's destination and station context |
| [OneMap Routing](https://www.onemap.gov.sg/apidocs/routing) | Driving route, distance, and time | Detour and arrival-time factors |
| **PlugPlan database** | Saved plans, five-minute official snapshots, voluntary queues, check-ins, charging-session updates, reports, moderation decisions | Historical time-window tendency, active community demand, and issue confidence |

### Required data separation

Every status shown in the UI must say which layer produced it:

1. **Official connector status** from LTA DataMall.
2. **Community queue or session status** created inside PlugPlan.
3. **Community issue report** submitted by a user and optionally verified by a moderator.

These layers must never be merged into a single ambiguous word such as “reserved” or “unavailable”.

### API limitations that shape the scope

The current LTA guide documents public read access but no public endpoint for payment, charger control, official reservation, or a driver's remaining charging time. `EVCBatch` download links expire, and dynamic access requires an `AccountKey`. Therefore:

- the application cannot hold a charger;
- “offered” means a voluntary turn in the PlugPlan community queue;
- historical arrival estimates require snapshots stored by our own backend;
- provider timestamps and stale-data warnings are mandatory; and
- deterministic demo fixtures are required.

### Why this is not a one-API display

1. **Data fusion:** LTA charger records are joined with a destination route, traffic/carpark context where reliable, and clearly separated first-party queue/report data.
2. **Decision logic:** compatibility constraints, arrival context, dwell time, cost, evidence quality, and user preferences change the recommendation and its explanation.
3. **Stateful workflow:** plans, watches, queue offers, check-ins, sessions, reports, moderation decisions, and notifications exist independently of the public feed.

Removing the APIs would remove the evidence. Removing PlugPlan's processing and lifecycle would remove the product. A status map alone satisfies neither side.

## 5. Functional feature groups

### F1. Account, vehicle, and preference management

- Register and sign in.
- Store one or more EV profiles with supported plug types and useful charging assumptions.
- Store preferences such as maximum detour, minimum speed, price sensitivity, target charge, and acceptable walking distance from destination.
- Keep notification settings separate from ranking preferences.

### F2. Destination charging plan

- Enter a destination, expected arrival or departure, current charge estimate, target charge, and dwell-time window.
- Resolve the place through OneMap.
- Retrieve nearby or route-compatible stations from the normalized LTA cache.
- Reject incompatible or closed options before scoring.
- Preserve the input and result as a versioned `ChargingPlan`.

### F3. Explainable recommendation and comparison

- Rank feasible stations using live availability, ETA/detour, plug compatibility, speed, charging price, possible parking context, requested dwell time, and community activity.
- Show the contribution of every factor.
- Let the driver compare two or three candidates side by side.
- Allow a what-if change such as “arrive 30 minutes later” or “prefer cheaper charging” and show why the order changes.
- Show missing, stale, or low-sample data rather than silently treating it as zero.

### F4. Plan monitoring and fallback

- Watch a selected plan until a chosen cut-off time.
- Refresh official data through the backend cache.
- Warn when the selected station becomes unsuitable.
- Offer a ranked fallback without discarding the original plan.
- Record whether the user accepts, dismisses, or stops monitoring.

### F5. Voluntary community queue

- Join one active queue for a station.
- Show the user's position and the number of active participants.
- Allow withdrawal or a short snooze.
- When the preceding participant completes or leaves, offer the next participant a time-limited turn.
- Expire unanswered offers and no-shows.
- State repeatedly that the queue does not create a legal or operator-backed reservation.

### F6. Check-in and charging-session handover

- Permit check-in only near the station or through a controlled demo condition.
- Start a self-reported community session.
- Optionally record an expected completion window without claiming it came from the charger.
- Mark the session complete and notify the next participant.
- Handle cancellation, expiry, no-show, early departure, and disputed occupancy.

### F7. Issue reporting and moderation

- Report a blocked bay, suspected faulty connector, misleading location, or access problem.
- Attach a note and optional image.
- Give reports a short default expiry and confidence state.
- Allow moderators to verify, reject, merge, resolve, or expire reports.
- Link users to the operator's official reporting channel for actual repair or enforcement.

### F8. Provenance, freshness, and graceful degradation

- Display `source`, `observedAt`, and `retrievedAt`.
- Label screens as **Live**, **Cached**, **Stale**, or **Demo Fixture**.
- Retain the last usable snapshot when a provider times out.
- Never hide a provider failure behind a normal-looking score.

## 6. Brief Use Case catalogue

These descriptions are for alignment. They are not substitutes for the formal Lab Use Case template.

| ID | Use Case | Primary actor | Brief success flow | Main alternatives or exceptions |
|---|---|---|---|---|
| **P-UC01** | Manage EV Profile | Driver | The driver records a vehicle, compatible plugs, charging assumptions, and defaults; the system validates and saves them. | Duplicate vehicle; unsupported or incomplete values; profile currently used by a plan. |
| **P-UC02** | Create Destination Charging Plan | Driver | The driver supplies destination, timing, charge target, and dwell window; the system resolves the location and creates a plan. | Address is ambiguous; route unavailable; no feasible station; provider data stale. |
| **P-UC03** | Review Ranked Charging Options | Driver | The system applies hard filters, calculates factor scores, and presents feasible options with explanations. | A factor is missing; all options violate a soft preference; official data changes during calculation. |
| **P-UC04** | Compare or Reconfigure Plan | Driver | The driver compares candidates or changes time, price, speed, or detour preferences; the system versions and recalculates the plan. | A previously selected station becomes infeasible; a route call fails; unsaved changes are discarded. |
| **P-UC05** | Monitor Selected Plan | Driver | The driver watches one candidate; the system refreshes it and sends a warning or availability update. | Watch expires; notification delivery fails; user disables monitoring. |
| **P-UC06** | Accept Fallback Recommendation | Driver | A material change triggers alternatives; the driver reviews the reason and switches the active plan. | Driver keeps the original; no alternative meets hard constraints; data is too stale to recommend. |
| **P-UC07** | Join or Leave Community Queue | Driver | The driver joins an eligible station queue, sees the position, and may later withdraw or snooze. | Driver already has an active queue; station queue is paused; duplicate request; queue entry expires. |
| **P-UC08** | Respond to Queue Offer | Driver | The next driver receives a time-limited offer and accepts it before checking in. | Offer declined, snoozed, expired, or superseded; user cannot reach the station. |
| **P-UC09** | Check In and Record Charging Session | Driver | The driver checks in, starts a self-reported session, updates it, and completes the handover. | Location check fails; no active offer; session abandoned; conflicting community report. |
| **P-UC10** | Submit Charger Issue | Driver | The driver selects a category, station/connector, note, and evidence; the system creates a time-limited pending report. | Duplicate report; invalid evidence; user cancels; report rate limit exceeded. |
| **P-UC11** | Moderate Charger Reports | Moderator | The moderator reviews provenance and related reports, then verifies, merges, rejects, resolves, or expires the item. | Evidence is inconclusive; an official status supersedes it; moderator action is appealed. |
| **P-UC12** | Moderate Queue Abuse | Moderator | The moderator reviews audit history, invalidates abusive activity, and applies a proportionate restriction. | False complaint; concurrent session update; restriction expires or is reversed. |

## 7. Stateful workflows

### Community queue

```text
WAITING -> OFFERED -> ACCEPTED -> CHECKED_IN -> CHARGING -> COMPLETED
   |          |          |             |             |
   +-> LEFT   +-> EXPIRED+-> CANCELLED  +-> NO_SHOW   +-> ABANDONED
   +-> SNOOZED -> WAITING
```

Important invariants:

- One driver has at most one active queue entry.
- One station has at most one current offer for a given community turn.
- Offers expire atomically.
- Completing or expiring a turn advances the queue exactly once.
- Queue state never changes official connector status.

### Charging plan

```text
DRAFT -> READY -> MONITORING -> EN_ROUTE -> ARRIVED -> CHARGING -> COMPLETED
   |        |           |           |          |
   +------> CANCELLED <--+-----------+----------+
```

### Issue report

```text
PENDING -> VERIFIED -> RESOLVED
    |          |
    +-> REJECTED
    +-> MERGED
    +-> EXPIRED
```

## 8. Decision logic

### Step 1: hard filters

Remove a station when any non-negotiable rule fails, for example:

- no connector is compatible with the selected vehicle;
- the site will be closed during the requested window;
- the required charging speed is unavailable;
- ETA exceeds the driver's maximum detour or arrival limit; or
- official data is older than the team's agreed safety threshold and the user has rejected stale options.

### Step 2: factor calculation

For each remaining station, calculate normalized factors in the range 0–1:

- `availability`: free compatible connectors divided by compatible connectors;
- `travelFit`: inverse normalized ETA or detour;
- `speedFit`: expected ability to deliver the requested energy within the dwell window;
- `priceFit`: inverse normalized charging and known parking cost;
- `arrivalEvidence`: time-window tendency from stored snapshots, with sample count;
- `queueFit`: penalty for active voluntary demand;
- `issueFit`: penalty based on recent verified or corroborated reports.

An example score is:

```text
score = wA*availability
      + wT*travelFit
      + wS*speedFit
      + wP*priceFit
      + wH*arrivalEvidence
      + wQ*queueFit
      + wI*issueFit
```

The UI must show the factors, weights, timestamp, and missing data. The score is a planning heuristic, not a probability or guarantee.

### Step 3: confidence and explanation

- Mark the result **low evidence** when historical samples are insufficient.
- Explain hard exclusions separately from soft ranking.
- Provide at least one alternative optimized for a different objective, such as lowest cost or shortest detour.
- Never describe a self-collected tendency as official LTA forecasting.

## 9. Candidate design model

### Entity Classes

`User`, `DriverProfile`, `VehicleProfile`, `ChargingPlan`, `PlanVersion`, `ChargingStation`, `ChargingPoint`, `Connector`, `OfficialSnapshot`, `RouteEstimate`, `CarparkSnapshot`, `Scorecard`, `ScoreFactor`, `WatchSubscription`, `Queue`, `QueueEntry`, `QueueOffer`, `CommunitySession`, `IssueReport`, `Evidence`, `ModerationDecision`, `Notification`.

### Control Classes

| Control Class | Responsibility |
|---|---|
| `ChargingPlanController` | Validates inputs and coordinates plan creation/versioning. |
| `StationCompatibilityController` | Applies vehicle, plug, speed, hours, and freshness constraints. |
| `StationRankingController` | Calculates normalized factors, score, alternatives, and explanation. |
| `PlanMonitoringController` | Detects material changes and proposes fallbacks. |
| `CommunityQueueController` | Enforces queue invariants, offers, expiry, snooze, and advancement. |
| `CommunitySessionController` | Handles check-in, self-reported session, and completion. |
| `IssueModerationController` | Deduplicates, expires, verifies, and resolves reports. |
| `ExternalDataController` | Coordinates provider adapters, caching, freshness, and fixtures. |
| `NotificationController` | Delivers idempotent in-app or email events. |

### Boundary Classes or screens

`VehicleProfileView`, `PlanInputView`, `RecommendationView`, `StationComparisonView`, `PlanMonitorView`, `QueueView`, `CheckInView`, `SessionView`, `IssueReportView`, `ModeratorDashboard`.

## 10. Initial quality targets to validate in Lab 1

These are planning targets, not approved Non-Functional Requirements.

| Area | Candidate target |
|---|---|
| Performance | Return a ranking from cached provider data within 3 seconds for 95% of requests under the agreed demo load. |
| Freshness | Show official timestamps; label EV data stale after a team-defined threshold based on the five-minute source interval. |
| Availability | Continue with cached data and an explicit degraded-state banner when one provider is unavailable. |
| Queue correctness | Process join, offer, expiry, and completion atomically; repeated requests must be idempotent. |
| Security | Keep all provider keys server-side; use role checks for moderation; never log credentials. |
| Privacy | Store only the location history needed for saved plans; let users delete plans and profiles. |
| Explainability | Every recommendation exposes factor values, weights, source dates, and exclusions. |
| Accessibility | Core web journeys should target WCAG 2.1 AA keyboard and contrast requirements. |
| Testability | Ranking must run against deterministic fixtures; queue timing must use an injectable clock. |

## 11. Scope

### MVP

- Responsive web application.
- Driver and Moderator roles.
- One vehicle per driver initially.
- Destination-based planning within Singapore.
- LTA EV data plus OneMap routing and one traffic/carpark context source where mapping is reliable.
- Hard compatibility filters and transparent ranking.
- Candidate comparison and saved plan monitoring.
- One voluntary queue per station with offer, expiry, check-in, session, and completion.
- Issue report and moderation lifecycle.
- Cached, stale, and demo-fixture modes.

### Stretch features

- Multiple vehicles.
- Historical time-window tendency from stored five-minute snapshots.
- Richer charging-curve estimates.
- Station steward role for a controlled pilot location.
- Push notifications or Progressive Web App installation.
- More advanced abuse detection and reputation.

### Explicitly out of scope

- Official reservation or bay enforcement.
- Payment, wallet, subscriptions, or commercial transactions.
- Remote charger activation or charger telemetry.
- Operator account integration.
- CarPlay, Android Auto, native mobile clients, or in-car navigation.
- Machine Learning presented as availability prediction without sufficient data.

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PlugLah and similar products already cover live maps, filters, price, alerts, and vehicle estimates | Weak differentiation if these are presented as the product | Treat them as baseline; demonstrate arrival-aware explanation and the queue/session/report lifecycles. |
| Users mistake the queue for a reservation | Safety and trust problem | Use “voluntary community queue,” repeat the disclaimer, never use “reserved,” and link to operator rules. |
| Low participation makes the queue inaccurate | Core workflow loses value | Use the workflow as a controlled community pilot; auto-expire, show participant count, and keep official status separate. |
| False check-ins or reports | Bad decisions and abuse | Rate limits, proximity check, evidence, expiry, audit history, and moderator review. |
| External feed changes or fails during the demo | Broken user journey | Provider adapters, cached snapshots, contract tests, and a visible demo-fixture mode. |
| Charger-to-carpark mapping is incomplete | Incorrect parking factor | Use parking context only where a mapping is verified; otherwise show “unknown” rather than infer. |
| Historical samples are sparse | Misleading arrival claim | Show sample size and confidence; keep history as stretch if the collection window is too short. |
| Queue concurrency defects | Duplicate offers or unfair advancement | Database transaction/locking strategy, idempotency keys, injectable clock, and concurrency tests. |

## 13. Demonstration slice

1. A driver selects an EV profile and plans charging near a destination for a specific arrival and dwell time.
2. PlugPlan rejects an incompatible station and ranks three feasible alternatives using official charger data, route time, cost, and community context.
3. The driver opens the score explanation and changes the preference from “fastest” to “lowest total cost.”
4. The selected connector becomes occupied in a scripted official snapshot; the app explains the change and proposes a fallback.
5. The driver instead joins the original station's voluntary queue.
6. Another simulated driver completes a community session; the first driver receives and accepts a time-limited offer.
7. The driver checks in, records charging, submits a blocked-bay report for another connector, and completes the session.
8. A moderator merges or verifies the report and the audit trail is shown.

This single story exercises external data, ranking, UI states, persistence, role-based access, concurrency, notifications, and moderation.

## 14. Open decisions for the team

- Is the primary job **destination charging** or **charging along a route**? The MVP should choose one; destination charging is more distinctive in Singapore and easier to scope.
- Which EV assumptions can be entered accurately without vehicle telemetry?
- Is parking context reliable enough for the MVP or should it remain an optional factor?
- What evidence is required for a community check-in or issue report?
- What is a fair offer duration and no-show policy?
- Will the team collect enough historical snapshots to support a time-window factor, or will that remain a scripted stretch feature?

## 15. Comparable-product implication

Current Singapore products already provide maps, filters, favourites, alerts, price information, and vehicle estimates. PlugPlan is course-worthy only when the team implements and demonstrates its combined decision, queue, session, and verification workflows.
