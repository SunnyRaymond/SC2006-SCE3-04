# PlugPlan SG: Comprehensive Internal Proposal

> **Status:** Internal alignment draft, not a Lab submission
> **Research snapshot:** 27 August 2026
> **Scope update:** 4 September 2026

## 1. Product definition

### One-sentence pitch

**PlugPlan SG helps Singapore EV drivers decide where, when, and how much to charge for a planned journey, with transparent estimates of arrival feasibility, charging time, and cost.**

### Product boundary

PlugPlan SG is a **charging decision-support application**. It is not:

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
- the charger may not support the vehicle's plug or desired speed;
- the charging stop may add too much travel time or detour;
- the available charger may not deliver enough energy within the driver's dwell time;
- the driver may charge substantially more than the planned journey requires; or
- the estimated charging cost may be higher than a suitable alternative.

PlugPlan turns these factors into a trip-specific recommendation. It identifies feasible chargers, estimates the smallest useful target charge with a safety reserve, calculates charging time and cost, and lets the driver compare different prioritisation strategies.

### User value

- Fewer wasted trips to incompatible, occupied, or unsuitable chargers.
- A transparent explanation of whether the driver can reach and use a charger.
- A "charge enough, not full" target based on the planned route and a visible reserve.
- Estimated charging time and cost before the driver commits to a stop.
- Strategy-based comparison for speed, cost, availability, detour, or a balanced choice.
- Clear separation of official connector status, calculated estimates, and community issue reports.

## 3. Target users and actors

| Actor | Responsibility or goal |
|---|---|
| **Driver** | Maintains a vehicle profile, creates charging plans, compares recommendations, refreshes a plan, and reports an issue. |
| **Moderator** | Reviews evidence, merges duplicate reports, and resolves disputed or abusive reports. |
| **LTA DataMall** | Supplies EV charging-point details, connector availability, charging speed, and price. |
| **OneMap** | Resolves Singapore places and supplies routes or travel estimates. |

`Moderator` should be a genuine role with a small, defined workload. It should not exist only to inflate the Use Case Diagram.

## 4. Data sources and how they combine

The application should consume external data through backend adapters. No screen should call providers directly.

| Source | Candidate data | Contribution to the decision |
|---|---|---|
| [LTA DataMall EV Charging Points and Batch feed](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf?ref=public_apis) | Location, operating hours, operator, charger identifier, plug type, speed, price, connector status, update time | Compatibility, live availability, expected charging duration, and cost factors |
| [OneMap Search](https://www.onemap.gov.sg/apidocs/search) | Address, postal code, building, and coordinates | Resolves the user's destination and station context |
| [OneMap Routing](https://www.onemap.gov.sg/apidocs/routing) | Driving route, distance, and time | Detour, arrival-time, and trip-energy estimates |
| **Vehicle profile and plan input** | Battery capacity, current state of charge, usable efficiency, AC/DC charging limits, compatible plugs, reserve target, and dwell time | Reachability, recommended target charge, charging time, and compatibility |
| **PlugPlan database** | Saved plans, plan versions, five-minute official snapshots, reports, and moderation decisions | Recalculation, optional historical time-window evidence, and issue confidence |

### Required data separation

Every status or estimate shown in the UI must say which layer produced it:

1. **Official connector status** from LTA DataMall.
2. **PlugPlan calculation** based on declared vehicle values, route data, and documented assumptions.
3. **Community issue report** submitted by a user and optionally verified by a moderator.

An estimate must never be presented as official charger telemetry or a guaranteed outcome.

### API limitations that shape the scope

The current LTA guide documents public read access but no public endpoint for payment, charger control, official reservation, or a driver's remaining charging time. `EVCBatch` download links expire, and dynamic access requires an `AccountKey`. Therefore:

- the application cannot hold a charger;
- historical arrival estimates require snapshots stored by our own backend;
- energy, time, and cost results must expose their input assumptions;
- missing or unsupported price formats must be shown as unknown rather than zero;
- provider timestamps and stale-data warnings are mandatory; and
- deterministic demo fixtures are required.

### Why this is not a one-API display

1. **Data fusion:** LTA connector records are joined with OneMap route distance and time, a declared EV profile, plan inputs, and clearly separated issue-report data.
2. **Decision logic:** reachability, compatibility, required energy, dwell time, charging time, cost, evidence quality, and a selected strategy change the recommendation and its explanation.
3. **Application workflow:** saved plan versions, manual recalculation, issue reports, and moderation decisions exist independently of the public feed.

Removing the APIs would remove the evidence. Removing PlugPlan's processing and lifecycle would remove the product. A status map alone satisfies neither side.

## 5. Functional feature groups

### F1. Account, vehicle, and preference management

- Register and sign in.
- Store one or more EV profiles with usable battery capacity, supported plug types, estimated consumption in `kWh/100 km`, and separate AC/DC charging limits.
- Store a visible reserve-SOC default and preferences such as maximum detour, minimum charger speed, and acceptable walking distance from the destination.
- Treat user-entered vehicle values as planning assumptions rather than live telemetry.

### F2. Planned-journey charging plan

- Enter an origin or current location, destination, current state of charge, expected timing, and dwell-time window.
- Use the automatic "charge enough" target by default, while allowing the driver to set a manual target for a known post-destination need.
- Resolve places and route legs through OneMap.
- Retrieve route-compatible or destination-nearby stations from the normalized LTA cache.
- Reject unreachable, incompatible, or closed options before scoring.
- Preserve the input and result as a versioned `ChargingPlan`.

### F3. Arrival-aware charging feasibility engine (Idea 1)

- Estimate the state of charge on arrival at each candidate from the current charge, route distance, usable capacity, and declared vehicle consumption.
- Calculate the energy and time needed to reach the selected target using the lower of the vehicle and connector charging limits.
- Determine whether the vehicle can reach the charger and whether the target can be achieved within the expected dwell time.
- Combine route time, detour, compatible-connector availability, charging speed, price, and evidence freshness in an explainable recommendation.
- Produce an explanation such as: “Recommended because this connector is compatible and can reach the suggested target within your 45-minute stay.”
- Label simplified charging-curve results as estimates, especially at high SOC where charging may taper.

### F4. "Charge Enough, Not Full" recommendation (Idea 4)

- Estimate the energy required from the charger to the destination and add the configured reserve energy.
- Recommend the smallest practical post-charge target rather than defaulting to 100%.
- Show the route, consumption, reserve, and charging-efficiency assumptions behind the target.
- State clearly when the driver already has enough charge and does not need a charging stop.
- Permit a manual target to override the automatic target, while preserving both values in the plan version.

### F5. Charging strategy preferences and comparison (Idea 5)

- Provide fixed strategies for **Fastest overall journey**, **Cheapest charging**, **Availability-first**, **Minimum detour**, and **Balanced**.
- Implement strategies as documented factor-weight presets over the same ranking engine, not as separate algorithms.
- Let the driver compare two or three candidates side by side and see why the ordering changes between strategies.
- Use current compatible-connector availability for **Availability-first**; do not call it a probability unless sufficient historical samples exist.
- Allow a what-if change such as a later arrival, shorter dwell time, or different strategy and version the recalculated result.

### F6. Charging cost estimator (Idea 6)

- For `$ / kWh`, estimate cost from the required charger energy and the latest published unit price.
- For `$ / h`, estimate cost from the calculated charging duration and the latest published hourly price.
- Display the price timestamp and label the result as an estimate.
- Show **Price unavailable** when a price or supported price type is missing; never treat missing data as zero.
- State when parking, idle, session, or operator-specific fees are not represented by the feed.

### F7. Manual refresh and fallback

- Refresh official data through the backend cache only when the driver requests it or reloads a plan.
- Reapply hard filters, calculations, and the selected strategy using the latest usable snapshot.
- Explain if the selected charger is no longer suitable and present the next-ranked alternative.
- Preserve the previous plan version so the reason for the change is traceable.
- Do not run continuous background monitoring or promise automatic alerts in the MVP.

### F8. Issue reporting and moderation

- Report a blocked bay, suspected faulty connector, misleading location, or access problem.
- Attach a note and optional image.
- Give reports a short default expiry and confidence state.
- Allow moderators to verify, reject, merge, resolve, or expire reports.
- Link users to the operator's official reporting channel for actual repair or enforcement.

### F9. Provenance, freshness, and graceful degradation

- Display `source`, `observedAt`, and `retrievedAt`.
- Label screens as **Live**, **Cached**, **Stale**, or **Demo Fixture**.
- Retain the last usable snapshot when a provider times out.
- Never hide a provider failure behind a normal-looking score.

## 6. Brief Use Case catalogue

These descriptions are for alignment. They are not substitutes for the formal Lab Use Case template.

| ID | Use Case | Primary actor | Brief success flow | Main alternatives or exceptions |
|---|---|---|---|---|
| **P-UC01** | Manage EV Profile | Driver | The driver records battery capacity, consumption, compatible plugs, charging limits, reserve, and defaults; the system validates and saves them. | Duplicate vehicle; incomplete values; assumptions outside accepted ranges; profile currently used by a plan. |
| **P-UC02** | Create Planned-Journey Charging Plan | Driver | The driver supplies origin, destination, current SOC, timing, and dwell window; the system resolves the route and creates a plan. | Address is ambiguous; route unavailable; vehicle cannot reach a candidate; provider data stale. |
| **P-UC03** | Review Charging Recommendations | Driver | The system applies hard filters, estimates arrival SOC, target SOC, charging time and cost, and presents ranked options with explanations. | No feasible station; unsupported price type; calculation input missing; charging target exceeds the dwell window. |
| **P-UC04** | Compare or Reconfigure Plan | Driver | The driver compares candidates or changes the strategy, timing, reserve, dwell time, or manual target; the system versions and recalculates the plan. | A previous option becomes infeasible; a route call fails; unsaved changes are discarded. |
| **P-UC05** | Refresh Plan and Select Fallback | Driver | The driver requests fresh data; the system recalculates the plan and explains any change before the driver selects an alternative. | The original remains suitable; no fallback meets hard constraints; only cached or stale data is available. |
| **P-UC06** | Submit Charger Issue | Driver | The driver selects a category, station or connector, note, and evidence; the system creates a time-limited pending report. | Duplicate report; invalid evidence; user cancels; report rate limit exceeded. |
| **P-UC07** | Moderate Charger Reports | Moderator | The moderator reviews provenance and related reports, then verifies, merges, rejects, resolves, or expires the item. | Evidence is inconclusive; an official status supersedes it; moderator action is appealed. |

## 7. Stateful workflows

### Charging plan

```text
DRAFT -> READY -> SELECTED -> COMPLETED
   |        |         |
   +------> CANCELLED +-> SUPERSEDED
```

Each recalculation creates a new `PlanVersion`; it does not rewrite the assumptions or explanation attached to the previous result.

### Issue report

```text
PENDING -> VERIFIED -> RESOLVED
    |          |
    +-> REJECTED
    +-> MERGED
    +-> EXPIRED
```

## 8. Decision logic

### Step 1: route-energy and automatic-target calculation

For each candidate charger, use OneMap route distances and the selected vehicle assumptions:

```text
currentEnergy = usableBatteryCapacity * currentSOC / 100
energyToCharger = originToChargerKm * consumptionKWhPer100Km / 100
arrivalEnergy = currentEnergy - energyToCharger
arrivalSOC = 100 * arrivalEnergy / usableBatteryCapacity

destinationEnergy = chargerToDestinationKm * consumptionKWhPer100Km / 100
reserveEnergy = usableBatteryCapacity * reserveSOC / 100
automaticTargetEnergy = min(usableBatteryCapacity, destinationEnergy + reserveEnergy)
requiredBatteryEnergy = max(0, automaticTargetEnergy - arrivalEnergy)
requiredChargerEnergy = requiredBatteryEnergy / chargingEfficiency
```

If a manual target is selected, calculate `manualTargetEnergy = usableBatteryCapacity * manualTargetSOC / 100` and use it in place of `automaticTargetEnergy`, while continuing to display the automatic "charge enough" value for comparison.

### Step 2: arrival-aware feasibility and hard filters

Remove a station when any non-negotiable rule fails, for example:

- the vehicle cannot reach the station using the declared consumption assumption;
- no connector is compatible with the selected vehicle;
- the site will be closed during the requested window;
- the required charging speed is unavailable;
- ETA exceeds the driver's maximum detour or arrival limit;
- the estimated target cannot be reached within a mandatory dwell-time limit; or
- official data is older than the team's agreed safety threshold and the user has rejected stale options.

For a compatible connector:

```text
effectivePower = min(connectorPower, matchingVehicleChargingLimit)
chargingTimeHours = requiredBatteryEnergy / (effectivePower * chargingEfficiency)
```

The MVP uses a documented linear estimate. It must warn that real charging can be slower because of battery temperature, charger power sharing, losses, and high-SOC tapering.

### Step 3: charging-cost estimate

```text
if priceType == "$ / kWh":
    estimatedCost = requiredChargerEnergy * unitPrice

if priceType == "$ / h":
    estimatedCost = chargingTimeHours * unitPrice
```

Unsupported or missing prices produce **Price unavailable**, not a zero-cost result. Parking, idle, session, and operator-specific fees remain excluded unless the source explicitly supplies them.

### Step 4: strategy-based factor calculation

For each remaining station, calculate normalized factors in the range 0–1:

- `availability`: free compatible connectors divided by compatible connectors;
- `travelFit`: inverse normalized ETA or detour;
- `chargeTimeFit`: expected ability to deliver the required energy within the dwell window;
- `priceFit`: inverse normalized estimated charging cost;
- `arrivalEvidence`: time-window tendency from stored snapshots, with sample count;
- `issueFit`: penalty based on recent verified or corroborated reports.

An example score is:

```text
score = wA*availability
      + wT*travelFit
      + wC*chargeTimeFit
      + wP*priceFit
      + wH*arrivalEvidence
      + wI*issueFit
```

Use a small set of fixed, documented weight presets:

| Strategy | Primary emphasis |
|---|---|
| **Fastest overall journey** | Travel time and charging time |
| **Cheapest charging** | Estimated charging cost |
| **Availability-first** | Current compatible-connector availability and evidence freshness |
| **Minimum detour** | Extra route distance or time |
| **Balanced** | A documented mixture of the available factors |

The UI must show the selected strategy, factors, weights, timestamps, assumptions, and missing data. The score is a planning heuristic, not a probability or guarantee.

### Step 5: evidence and explanation

- Mark historical availability as **low evidence** when samples are insufficient; do not create an overall numeric Reliability Score.
- Explain hard exclusions separately from soft ranking.
- Show estimated arrival SOC, automatic target SOC, required energy, charging time, and charging cost for each shortlisted option.
- Provide alternatives optimized for different strategies, such as lowest cost or shortest detour.
- Never describe a self-collected tendency as official LTA forecasting.

## 9. Candidate design model

### Entity Classes

`User`, `DriverProfile`, `VehicleProfile`, `ChargingPlan`, `PlanVersion`, `RankingStrategy`, `ChargingStation`, `ChargingPoint`, `Connector`, `OfficialSnapshot`, `RouteEstimate`, `EnergyEstimate`, `ChargingEstimate`, `CostEstimate`, `Scorecard`, `ScoreFactor`, `IssueReport`, `Evidence`, `ModerationDecision`.

### Control Classes

| Control Class | Responsibility |
|---|---|
| `ChargingPlanController` | Validates inputs and coordinates plan creation/versioning. |
| `VehicleEnergyController` | Estimates route energy, arrival SOC, reserve energy, and the automatic target SOC. |
| `StationCompatibilityController` | Applies reachability, vehicle, plug, speed, hours, and freshness constraints. |
| `ChargingFeasibilityController` | Calculates required energy, charging time, dwell fit, and estimation warnings. |
| `ChargingCostController` | Handles supported price types and produces an itemized estimate or an unknown result. |
| `StationRankingController` | Applies strategy weights and calculates factors, alternatives, and explanations. |
| `IssueModerationController` | Deduplicates, expires, verifies, and resolves reports. |
| `ExternalDataController` | Coordinates provider adapters, caching, freshness, and fixtures. |

### Boundary Classes or screens

`VehicleProfileView`, `PlanInputView`, `RecommendationView`, `StationComparisonView`, `IssueReportView`, `ModeratorDashboard`.

## 10. Initial quality targets to validate in Lab 1

These are planning targets, not approved Non-Functional Requirements.

| Area | Candidate target |
|---|---|
| Performance | Return a ranking from cached provider data within 3 seconds for 95% of requests under the agreed demo load. |
| Freshness | Show official timestamps; label EV data stale after a team-defined threshold based on the five-minute source interval. |
| Availability | Continue with cached data and an explicit degraded-state banner when one provider is unavailable. |
| Calculation correctness | Match approved route-energy, target-SOC, charging-time, and cost examples, including boundary and missing-data cases. |
| Security | Keep all provider keys server-side; use role checks for moderation; never log credentials. |
| Privacy | Store only the location history needed for saved plans; let users delete plans and profiles. |
| Explainability | Every recommendation exposes factor values, weights, source dates, and exclusions. |
| Accessibility | Core web journeys should target WCAG 2.1 AA keyboard and contrast requirements. |
| Testability | Energy, time, cost, and ranking logic must run against deterministic route and provider fixtures. |

## 11. Scope

### MVP

- Responsive web application.
- Driver and Moderator roles.
- One vehicle per driver initially.
- Planned-journey charging within Singapore using an origin, destination, current SOC, and expected dwell time.
- LTA EV data plus OneMap Search and Routing.
- Arrival-aware reachability, compatibility, dwell-fit, and charging-time calculations.
- Automatic "charge enough" target with a visible reserve and optional manual target.
- Charging-cost estimate for supported `$ / kWh` and `$ / h` prices.
- Five fixed ranking strategies and side-by-side comparison of two or three candidates.
- Manual refresh and fallback recalculation without background monitoring.
- Issue report and moderation lifecycle.
- Cached, stale, and demo-fixture modes.

### Stretch features

- Multiple vehicles.
- Historical time-window tendency from stored five-minute snapshots.
- Richer charging-curve estimates.
- User-adjustable ranking weights after the fixed strategies are validated.
- Parking, idle, or session fees from an authoritative source.
- More advanced issue-report deduplication and reputation.

### Explicitly out of scope

- Official reservation or bay enforcement.
- Community queues, waitlists, offers, check-ins, charging-session handovers, or queue notifications.
- Continuous background plan monitoring, automatic alerts, or a numeric charger Reliability Score.
- Traffic Speed Bands, Traffic Incidents, carpark availability, or charger-to-carpark mapping.
- Payment, wallet, subscriptions, or commercial transactions.
- Remote charger activation or charger telemetry.
- Operator account integration.
- CarPlay, Android Auto, native mobile clients, or in-car navigation.
- Machine Learning presented as availability prediction without sufficient data.

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PlugLah and similar products already cover live maps, filters, prices, and basic vehicle estimates | Weak differentiation if these are presented as the product | Demonstrate the combined arrival-SOC, minimum useful target, dwell-fit, time, cost, strategy, and explanation workflow. |
| Simplified energy or charging estimates differ from the real vehicle | Unsafe confidence or poor recommendations | Show assumptions, retain a visible reserve, validate ranges, warn about high-SOC taper, and describe every result as an estimate. |
| Vehicle input is incomplete or inaccurate | Calculation cannot be trusted | Save validated profile defaults, show the values used, and block the calculation when a required input is missing. |
| Published price is missing, stale, or excludes fees | Misleading cheapest-option ranking | Show the timestamp and exclusions, return **Price unavailable**, and reduce or omit `priceFit` rather than substituting zero. |
| Availability changes after the recommendation | Selected connector may be occupied on arrival | Show the five-minute source timestamp, provide manual refresh and fallback, and never guarantee availability. |
| False issue reports | Bad decisions and moderation workload | Apply rate limits, evidence, expiry, audit history, and moderator review. |
| External feed changes or fails during the demo | Broken user journey | Provider adapters, cached snapshots, contract tests, and a visible demo-fixture mode. |
| Historical samples are sparse | Misleading arrival claim | Show sample size and evidence level; keep history as stretch if the collection window is too short. |

## 13. Demonstration slice

1. A driver selects an EV profile containing usable battery capacity, consumption, compatible plugs, AC/DC limits, and a reserve target.
2. The driver enters an origin, destination, current SOC, and a 45-minute dwell window.
3. PlugPlan uses OneMap route legs and LTA connector data to reject an unreachable option and an incompatible option.
4. For three feasible candidates, PlugPlan shows arrival SOC, the automatic "charge enough" target, required energy, charging time, and estimated cost.
5. The driver compares the candidates and switches from **Balanced** to **Cheapest charging**, causing a transparent ranking change.
6. The driver selects a manual target to see how the dwell fit and cost change, then restores the automatic target.
7. A scripted official snapshot marks the selected connector occupied; the driver refreshes the plan and reviews the explained fallback.
8. The driver submits a blocked-bay report for another connector, and a moderator verifies or merges the report with an audit trail.

This single story exercises external data, calculation logic, strategy-based ranking, missing/stale-data handling, UI states, persistence, role-based access, testing boundaries, and moderation.

## 14. Open decisions for the team

- What default reserve SOC is conservative but understandable, and may the driver change it?
- Which consumption and charging-efficiency assumptions can be entered accurately without vehicle telemetry?
- At what target SOC should the linear charging-time estimate show a stronger taper warning?
- Does **Fastest overall journey** mean arrival at the charger, completion of charging, or arrival at the destination after charging?
- Which price types and exclusions can the team represent without implying a final operator bill?
- What evidence is required for a community issue report?
- Will the team collect enough historical snapshots to support a time-window factor, or will that remain a scripted stretch feature?

## 15. Comparable-product implication

Current Singapore products already provide maps, filters, favourites, alerts, price information, and basic vehicle estimates. PlugPlan is course-worthy only when the team implements and demonstrates its combined arrival-feasibility, "charge enough," time-and-cost estimation, strategy comparison, explanation, and report-verification workflows.
