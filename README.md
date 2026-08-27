# SC2006-SCE3-04

Repository for the SC2006 Software Engineering project by group SCE3-04.

## Current status

The team is in **Lab 1: Requirements Elicitation**. The immediate goal is to select a Singapore-focused application that uses authorized real-world APIs and is substantial enough for a 4-6 person team to design, implement, test, and demonstrate in about 10 weeks.

This project and API review was completed on **27 August 2026**. API availability, fields, quotas, and access rules can change, so the selected APIs must be tested again before the proposal is fixed.

## What the course project requires

The project brief and current lab manuals impose the following constraints:

- Build a medium-size application that a team of 4-6 students can complete within the course period.
- Use one or more government data APIs and/or other authorized public APIs for real-world data.
- Any programming language is acceptable, but the team must be able to build, test, demonstrate, and explain the chosen stack.
- Do more than present API records on a map, list, or dashboard. The data must support a useful decision, recommendation, alert, transaction, or coordination workflow.
- State clear target users, application features, and user or market value by the end of the proposal stage.
- Avoid a mainly tourism- or weather-oriented application unless the idea is unusually compelling. These categories are explicitly at risk of being vetoed.
- Keep API cost and quota exposure under control. The team is responsible for any charges.
- Demonstrate a rigorous Software Development Life Cycle (SDLC), traceability, sound architecture and design, testing, and a working prototype.
- Explicitly disclose the use of Artificial Intelligence (AI) or low-code tools. Every member must still be able to explain the system's technical details. A strong project must contain non-trivial, hand-coded components.
- Keep work products in GitHub and update them regularly. The overview recommends protected `main`, shared `dev`, short-lived feature branches, release branches, and version tags. Each submission should clearly identify its authors and member contributions.

### Deliverables roadmap

The detailed lab manuals are the best source for the current requirements.

| Stage | When it is reviewed or due | Required work products |
|---|---|---|
| **Lab 1 - Requirements Elicitation** | In `lab1/` before Lab 2 starts | Functional Requirements; Non-Functional Requirements; Data Dictionary; initial Use Case Model consisting of a Use Case Diagram and Use Case Descriptions; User Interface (UI) Mockups; PDF report on an AI critique of the submitted requirements and Use Case Diagram |
| **Lab 2 - Requirements Analysis** | In `lab2/` before Lab 3 starts | Complete Use Case Diagram; refined Use Case Descriptions; Class Diagram of Entity Classes; key Boundary Classes and Control Classes; initial Dialog Map, which is a UI State Machine; PDF report evaluating an AI technology-stack recommendation |
| **Lab 3 - Design and Implementation** | In `lab3/` before Lab 4 starts | Complete Use Case Model; Design Model with Class Diagram and Dialog Map; System Architecture; hand-reviewed Application Skeleton or in-progress prototype; PDF report on the repeated technology-stack exercise and AI-generated skeleton; the separate ZIP of the raw AI-generated minimal skeleton required by Section 3.3.5 |
| **Lab 4 - Implementation, Testing, and Demo Preparation** | Prepared for Lab 5 | Working Application Prototype; Source Code; Test Cases and Testing Results, including equivalence classes and boundary values for one important Control Class and basis-path testing for two complex methods; Demo Script; PDF report reflecting on the two required coding-agent exercises; a prepared screen recording for the final submission |
| **Lab 5 - Demo and Final Submission** | Final material by 23:59 on Sunday of the team's demo week | Live Demo; Source Code and tests; final Software Requirements Specification (SRS) with updated Use Case Model; current Class Diagrams of key classes; current Dialog Map; any Meeting Minutes kept; repository index; 5-7 minute Demo Video; confidential individual Peer Review |

### Current Lab 1 checklist

Before Lab 2, the team should have all of the following in `lab1/`:

- [ ] Team name, Team Leader, team registration, and a fair task allocation
- [ ] Short system description with target users, user problem, proposed value, in-scope features, and out-of-scope features
- [ ] Functional Requirements written as atomic, uniquely identified, verifiable statements using **must** or **shall**
- [ ] Quantified Non-Functional Requirements covering areas such as performance, availability, security, privacy, usability, reliability, and maintainability
- [ ] Data Dictionary containing important terms, attributes, and relationships
- [ ] Initial UML Use Case Diagram with a clear system boundary, actors, Use Cases, and justified `include`, `extend`, or generalization relationships
- [ ] Initial Use Case Descriptions; each main flow should usually remain within about 6-7 steps, with preconditions, postconditions, alternative flows, and exceptions
- [ ] UI Mockups that cover the main user journeys and help refine the requirements
- [ ] AI critique performed against the same requirements and Use Case Diagram that will be submitted
- [ ] AI critique PDF containing the prompt, original response, one selected useful or incorrect critique, and a short justification
- [ ] Contribution or authorship record for the submitted work products

The supplied [SRS Template](lab/SRS_Template.doc) is broader than the minimum Lab 1 submission. The FAQ says it may be adapted, but the final SRS must at least contain the requirements, Data Dictionary, Use Case Model, and UI Mockups. The supplied [Use Case Template](lab/UseCase_Template.doc) provides fields for identification, actors, description, preconditions, postconditions, priority, frequency, normal flow, alternatives, exceptions, included Use Cases, special requirements, assumptions, and open issues.

### UML clarification: Sequence Diagrams

The older overview table still mentions Sequence Diagrams. The current **Lab 3 Manual** explicitly says that Sequence Diagrams were required by previous versions of the lab, are **no longer required**, and are **no longer examinable**. The current detailed Lab 2 and Lab 3 deliverable lists therefore take precedence. One stale sentence in the Lab 4 Manual also refers to Sequence Diagrams, so the team should confirm with the Teaching Assistant (TA) if local instructions differ, but should not spend project time producing them without such confirmation.

### Final demonstration and assessment signals

- The overview allocates 15% to continuous assessment for Lab 1-3 deliverables, 15% to the live demo, and 15% to final documentation. Individual contribution is adjusted using Peer and Supervisor assessment.
- The Lab 5 session is about 20 minutes: roughly 13-15 minutes for the live product, 2-3 minutes for software-engineering practices and design, and 2-3 minutes for traceability.
- The final demonstration should trace one or two important Use Cases from requirements to design, implementation, and tests.
- A Lab 1-4 submission is marked as it existed at its deadline. It may still be revised later for the final Lab 5 documentation.
- Maintain a separate backup. The FAQ warns that repository access will not be restored after the final deadline for backup purposes.

## Lessons from public SC2006 repositories

The following public repositories were reviewed as examples of project scale and presentation. They are precedents, not course rules and not designs to copy.

| Public project | Main concept | Lesson for this team |
|---|---|---|
| [FeedItForward](https://github.com/xJQx/sc2006-feeditforward) | Hawker surplus food matched to families in need | Multi-role workflows and supporting documentation make a data-based idea richer than a locator |
| [MakanMap](https://github.com/YameeOhira/sc2006-makanmap) | Hawker discovery, clearance deals, orders, maps, parking, and buses | Food and hawker discovery is a crowded category |
| [CarKaki](https://github.com/RussellArvin/CarKaki) and [OneParkSG](https://github.com/minhtuan-ne/2006-oneparksg) | Real-time parking discovery and parking management | A generic carpark finder has a high originality risk |
| [Eventure](https://github.com/callmegerlad/eventure) | Singapore event discovery | General event discovery is already well represented |
| [School4U](https://github.com/ppeixinn/Right-School-For-Your-Kids) | School search, comparison, and parent discussion | A generic school recommender is also crowded |
| [ResaleSense](https://github.com/lihang2025/ResaleSense) | HDB resale valuation and comparison | Housing analytics can be substantial, but another generic HDB comparison tool would be hard to distinguish |
| [CommuteBuddy](https://github.com/IAmGreyBunny/SC2006-CommuteBuddy) | Public-transport commuting | A transport idea needs a clearly defined underserved user or workflow rather than generic route planning |
| [SilverConnect](https://github.com/lucascheongwai/NTU-SC2006-Software-Engineering-Web-App--SilverConnect) | Elderly activity discovery, caregiver support, and volunteer companionship | Elderly support is viable, but the new proposal should not duplicate activity discovery |
| [Idenguefy](https://github.com/c10se/Idenguefy) | Dengue cluster visualization and alerts | A dengue map or alert application has high overlap risk |
| [SportsGo](https://github.com/StevenShi-23/SportsGo) | Sports-facility search and recommendations | Sports-facility discovery is another established theme |

Strong public repositories commonly expose their setup instructions, frontend and backend separation, API documentation, tests, demo video, requirements, diagrams, architecture, design patterns, and traceability. We should copy that **documentation discipline**, not their product concepts.

## Idea shortlist

Scores below are a team-planning judgment on a 1-5 scale, not course marks. **API fit** asks whether official data directly drives the application's value. **SE richness** asks whether the idea naturally produces meaningful Use Cases, entities, controls, UI states, access control, and tests.

| Rank | Working title | API fit | SE richness | 10-week feasibility | Originality against reviewed repositories | Main risk |
|---:|---|:---:|:---:|:---:|:---:|---|
| 1 | **PlugPlan SG** | 5 | 5 | 4 | 4 | It cannot make an official charger reservation |
| 2 | **AccessPath SG** | 5 | 5 | 3 | 5 | Accessibility data coverage and safety claims |
| 3 | **SchoolGate SG** | 4 | 5 | 4 | 5 | Privacy, identity, and safeguarding requirements |
| 4 | **SiteSense SG** | 4 | 4 | 3 | 5 | Public data is a proxy for demand, not a revenue forecast |
| 5 | **RecycleRun SG** | 3 | 5 | 4 | 4 | Some recycling datasets are old |
| 6 | **ShiftShield SG** | 5 | 5 | 4 | 3 | Generic commuting is crowded, so scope discipline is essential |

### 1. PlugPlan SG - EV charging decision and community queue coordinator

**Recommendation:** best overall balance of current government data, clear user value, stateful workflows, and achievable scope.

**Target users:** Electric Vehicle (EV) drivers; optional moderator or charging-site representative.

**Problem:** A charger shown as available now may be occupied by the time a driver arrives. Connector type, charging speed, price, operating hours, traffic, and expected trip detour all affect the decision. A map pin alone does not resolve that trade-off.

**Core workflow and features:**

1. Save a vehicle profile with compatible plug type and preferred charging speed.
2. Search from a destination or route and filter incompatible charging points.
3. Rank alternatives by live availability, estimated arrival time, charging price, detour, and user preferences.
4. Compare the best options and explain each score rather than returning a black-box recommendation.
5. Join a **community waitlist**, check in, start or end a session, and notify the next user.
6. Report a blocked or faulty point, with moderation and expiry of old reports.
7. Save favorite stations and receive an availability alert.

**Government APIs:**

- [LTA DataMall API Guide](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf): `EVChargingPoints` and `EVCBatch` provide charger location, connector status, plug type, speed, price, and availability, with a stated five-minute update frequency.
- LTA Traffic Incidents and Traffic Speed Bands for disruption-aware arrival estimates.
- [OneMap Search](https://www.onemap.gov.sg/apidocs/search) and [OneMap Routing](https://www.onemap.gov.sg/apidocs/routing) for Singapore addresses and driving routes.

**Why it fits SC2006:** API data changes the user's decision; the application includes persistent profiles, preferences, rankings, alerts, reports, moderation, and a waitlist state machine. Likely Entity Classes include `Driver`, `VehicleProfile`, `ChargingStation`, `ChargingPoint`, `AvailabilitySnapshot`, `Recommendation`, `QueueEntry`, `ChargingSession`, and `IssueReport`. Useful Control Classes include `StationRankingController`, `QueueController`, `SessionController`, and `NotificationController`.

**Scope guardrail:** The application must say that its waitlist is community coordination and **not an official reservation**. The minimum viable product (MVP) should omit payment, charger control, and commercial operator integration.

### 2. AccessPath SG - accessibility-aware journey planning and barrier verification

**Target users:** wheelchair users, people using mobility aids, older commuters, and caregivers; optional community moderator.

**Problem:** A nominally valid route may become impractical because of MRT lift maintenance, crowding, difficult transfers, or temporary barriers. Users need a route confidence view and a way to share verified local obstacles.

**Core workflow and features:**

1. Create an accessibility profile covering mobility aid, maximum walking distance, crowd tolerance, and transfer preferences.
2. Compare routes using travel time, transfer count, lift maintenance, station crowd level, and known infrastructure.
3. Subscribe to a saved journey and receive alerts or a suggested re-plan.
4. Report a barrier with location, category, evidence, and expiry time.
5. Let trusted users or moderators verify, reject, merge, or resolve a report.
6. Share a journey plan and status with a caregiver.

**Government APIs and datasets:**

- LTA Facilities Maintenance for ad hoc MRT lift maintenance.
- LTA Station Crowd Density Real Time and Forecast, Train Service Alerts, Bus Arrival, Bus Routes, and Bus Stops.
- LTA geospatial layers including `Footpath`, `CoveredLinkWay`, `RoadCrossing`, and `PedestrainOverheadbridge_UnderPass`.
- OneMap Search and walking/public-transport routing.
- [OneMap Barrier-Free Access (BFA) Routing](https://www.onemap.gov.sg/apidocs/bfa) is attractive, but it is available only by request to approved users and only in covered areas. It must remain an optional enhancement, not an MVP dependency.

**Why it fits SC2006:** It turns several live feeds into a personalized route decision and adds a complete report-verification-resolution workflow. Candidate entities include `AccessibilityProfile`, `Journey`, `JourneySegment`, `InfrastructureFeature`, `MaintenanceAlert`, `CrowdSnapshot`, `BarrierReport`, and `Verification`. The ranking policy is testable with boundary values such as maximum distance, crowd level, and transfer limits.

**Scope and ethics guardrail:** Present an **accessibility confidence score**, the data source, and its timestamp. Do not claim that a route is guaranteed safe or fully accessible. Cache a small approved map area and scripted maintenance events for the demo.

### 3. SchoolGate SG - safe school pickup and carpool coordination

**Target users:** parents or guardians, approved drivers, and a school coordinator or moderator.

**Problem:** Informal school pickup and carpool arrangements are fragmented. The application can coordinate recurring pickup requests without becoming another school-selection website.

**Core workflow and features:**

1. Register a guardian or driver and request role verification.
2. Create a recurring pickup request or offer for a selected school and time window.
3. Match compatible requests using school, schedule, seats, route detour, and guardian preferences.
4. Accept or reject a match and record consent from both parties.
5. Use a one-time pickup code and a trip state machine: `Scheduled -> Driver En Route -> Arrived -> Child Collected -> Completed`, with cancellation and incident states.
6. Send traffic-aware delay notifications and allow the school coordinator to moderate accounts or reports.

**Government APIs and datasets:**

- [MOE School Directory and Information](https://data.gov.sg/datasets/d_688b934f82c1059ed0a6993d2a829089/view) for current school names, addresses, and transport information.
- LTA geospatial `SchoolZone` and `PassengerPickupBay` layers.
- LTA Traffic Incidents and Traffic Speed Bands.
- OneMap Search and walk/drive routing.

**Why it fits SC2006:** It has clear multi-role access control, matching logic, consent, notifications, audit history, and a rich UI state machine. Candidate entities include `Guardian`, `DriverProfile`, `StudentAlias`, `School`, `PickupRequest`, `RideOffer`, `Match`, `Consent`, `Trip`, `PickupCode`, and `Incident`.

**Scope and privacy guardrail:** Limit the MVP to one school and simulated users. Store the minimum child information, never reveal an exact home address before a match is accepted, avoid background tracking, and do not claim school endorsement.

### 4. SiteSense SG - evidence-based location comparison for a small business

**Target users:** aspiring hawkers, pop-up retailers, small service businesses, and business advisers.

**Problem:** A founder may compare neighborhoods using intuition but cannot easily combine expected customer profile, public-transport activity, nearby amenities or competitors, and broad rental trends.

**Core workflow and features:**

1. Define a business concept and target customer profile.
2. Choose and weight decision criteria such as transport activity, target-age population, competitor density, amenity proximity, and rental trend.
3. Generate a transparent suitability score for candidate planning areas or sites.
4. Compare scenarios, explain score components, and identify weak or missing evidence.
5. Save a shortlist, add team comments, and export a decision report with data dates and assumptions.

**Government APIs and datasets:**

- LTA Passenger Volume by Bus Stop or Train Station and quarterly Traffic Flow.
- [OneMap Population Query](https://www.onemap.gov.sg/apidocs/populationquery), Planning Area, Themes, Search, and Routing.
- [NEA Hawker Centres](https://data.gov.sg/datasets/d_4a086da0a5553be1d89383cd90d07ecd/view) or other relevant OneMap themes for nearby facilities.
- [URA Commercial Rental Index](https://data.gov.sg/datasets/d_862c74b13138382b9f0c50c68d436b95/view) as a broad trend indicator.

**Why it fits SC2006:** The data supports a repeatable decision process rather than a dashboard. Candidate entities include `BusinessConcept`, `TargetProfile`, `CandidateLocation`, `Criterion`, `WeightProfile`, `MetricSnapshot`, `ScoreExplanation`, `Shortlist`, `Comment`, and `DecisionReport`. Different scoring strategies provide a natural Strategy design pattern and good unit-test targets.

**Scope guardrail:** Narrow the MVP to one business type and 3-5 planning areas. Clearly label passenger volume and demographics as proxies; do not present the result as a revenue forecast or exact rental quotation.

### 5. RecycleRun SG - recycling route planner and community collection workflow

**Target users:** households, volunteer collection organizers, and moderators.

**Problem:** Different recycling points accept different material categories, and residents with several items may need more than a nearest-bin map. Some residents also need help transporting bulky e-waste.

**Core workflow and features:**

1. Add items to a disposal list and classify their material or e-waste category.
2. Match each item to compatible collection points and explain the acceptance rule.
3. Build a multi-stop drop-off plan with opening schedule and route.
4. Create a community collection event with capacity and accepted-item rules.
5. Request a pickup, allow a volunteer to claim it, and track `Requested -> Claimed -> Collected -> Delivered -> Completed`.
6. Verify or flag a collection point and show the age of its official data.

**Government APIs and datasets:**

- [NEA Recycling Bins](https://developers.data.gov.sg/datasets/d_4dde14826642f49eefff48b7832b90db/view).
- [NEA E-waste Recycling](https://data.gov.sg/datasets/d_db40d004afeb5a7f0f555fdcc34934cc/view).
- [NEA Cash For Trash](https://data.gov.sg/collections/1432/datasets/d_51995b625307f3953f7ba344722acd79/view).
- OneMap Search and walking/driving routing.

**Why it fits SC2006:** Compatibility matching, route planning, event capacity, pickup assignment, moderation, and state transitions produce substantial requirements, classes, and tests. Candidate entities include `Item`, `MaterialCategory`, `AcceptanceRule`, `CollectionPoint`, `RoutePlan`, `CollectionEvent`, `PickupRequest`, `VolunteerAssignment`, and `Verification`.

**Data guardrail:** The e-waste dataset states that its underlying data is from June 2022, while the recycling-bin and Cash For Trash pages were last updated in June 2024. The app must show freshness, allow verification, and avoid promising that a site currently accepts an item. This freshness risk keeps the idea below the top three.

### 6. ShiftShield SG - last-service planning and check-ins for late-shift workers

**Target users:** healthcare, hospitality, security, logistics, and other workers whose shifts end near or after the last public-transport service; optional trusted contact.

**Problem:** A conventional route planner answers how to travel now, but a shift worker needs to know the latest safe departure time, whether a delayed shift will miss the final connection, and what fallback remains.

**Core workflow and features:**

1. Save work locations, shift end times, and transport preferences.
2. Calculate the latest feasible departure time using scheduled last services and transfers.
3. Re-evaluate the saved journey using live Bus Arrival and Train Service Alerts before the shift ends.
4. Present a fallback ladder such as a different bus, a barrier-free Taxi Stand, or an available taxi area.
5. Send a departure warning and allow a user to start and complete a trusted-contact check-in.
6. Record missed-service reasons so the user can adjust the next plan.

**Government APIs:**

- LTA Bus Routes for scheduled first and last bus times; Bus Arrival for live estimates.
- LTA Train Service Alerts, Taxi Availability, and Taxi Stands, including the barrier-free field.
- OneMap Search and public-transport/walk routing.

**Why it fits SC2006:** It has scheduling, route feasibility, alerts, fallbacks, saved preferences, and check-in states. Candidate entities include `Worker`, `Shift`, `CommutePlan`, `TransportLeg`, `ServiceDeadline`, `Disruption`, `FallbackOption`, `Alert`, `TrustedContact`, and `CheckIn`.

**Scope guardrail:** Keep the product about last-service decisions for shift workers. Do not turn it into a generic journey planner, taxi booking service, personal-safety guarantee, or employer surveillance tool.

## Recommendation

### Preferred choice: PlugPlan SG

Choose **PlugPlan SG** if the team can obtain and smoke-test an LTA DataMall Account Key during Lab 1. It uses a newly documented five-minute EV charging feed, creates clear decision logic and lifecycle states, and remains feasible without payment or operator integration. Its proposal must emphasize **connector-aware ranking and community queue/session coordination**, because "find a nearby carpark" is already a saturated project category.

### Strong alternative: AccessPath SG

Choose **AccessPath SG** if the team prefers a stronger social-impact story and is comfortable handling incomplete infrastructure data carefully. Build the MVP without depending on the request-only OneMap BFA API.

### Strong multi-role alternative: SchoolGate SG

Choose **SchoolGate SG** if the team wants the clearest access-control, matching, consent, and state-machine work. It demands the most careful privacy requirements.

## API engineering decisions to make in Lab 1

- Apply for an [LTA DataMall Account Key](https://datamall.lta.gov.sg/) immediately if any shortlisted idea uses LTA. Dynamic feeds are available only to registered subscribers, and requests send the `AccountKey` header.
- Register a [OneMap API account](https://www.onemap.gov.sg/apidocs/register). Search and Routing require a token; the official Authentication documentation says tokens remain valid for three days and must be refreshed.
- Call third-party APIs from the backend. Never commit LTA or OneMap credentials, tokens, passwords, or `.env` files.
- Add one adapter per external provider, server-side caching, request timeouts, retries with a limit, and a circuit-breaker or graceful fallback.
- Store each external record with `source`, `retrievedAt`, and, where available, `observedAt`.
- Display whether the UI is using **Live**, **Cached**, or **Demo Fixture** data.
- Record representative API responses as test fixtures. The final demo must remain coherent when a live feed is empty, unchanged, rate-limited, or unavailable.
- LTA responses are generally capped at 500 records and use `$skip` for later pages. Data.gov.sg also publishes rate limits; use caching instead of calling it on every UI render.
- Do not use the request-only OneMap BFA API as a required feature until access is approved.
- Do not introduce a chargeable API unless the free quota, billing controls, and demo fallback are understood and documented.

## Scope rule for the selected project

A sensible MVP for this course should contain:

- 2-3 meaningful human roles, including an administrator only when administration has real responsibilities
- 6-8 core Use Cases that form complete user goals
- one transparent recommendation, matching, prioritization, or scheduling algorithm
- one stateful write workflow such as queueing, verification, assignment, or trip completion
- one notification or subscription workflow
- role-based access control and validation
- an external-API adapter and cache
- automated tests for important Control Classes and deterministic API fixtures
- one responsive web client, unless the team already has strong mobile-development experience

Avoid adding payment, chat, Machine Learning, Computer Vision, native mobile and web clients, or multiple microservices merely to appear complex. Add one only if it is central to the chosen user problem and the team can test and explain it.

## Immediate Lab 1 next steps

1. Each member independently scores the six ideas for personal interest, relevant skills, user access for elicitation, and perceived risk.
2. Select two finalists and test their essential API calls. Reject an idea if its core data cannot be obtained reliably.
3. Ask the TA for an early scope check using a one-page pitch containing target users, problem, value, main features, APIs, and non-goals.
4. Choose one idea and write a 150-250 word Product Scope before drawing UML.
5. Interview or role-play at least two target-user perspectives and record assumptions separately from confirmed needs.
6. Write atomic Functional Requirements and measurable Non-Functional Requirements, then build the Data Dictionary from their nouns.
7. Derive the Use Cases from user goals, write the first descriptions, and create UI Mockups for the same flows.
8. Run the required AI critique only after the requirements and Use Case Diagram are internally consistent. Submit the exact critiqued versions.

Suggested Lab 1 repository structure:

```text
lab1/
|-- README.md
|-- requirements/
|   |-- functional-requirements.md
|   |-- non-functional-requirements.md
|   `-- data-dictionary.md
|-- use-cases/
|   |-- use-case-diagram.png
|   `-- use-case-descriptions.md
|-- ui-mockups/
|   `-- ui-mockups.pdf
|-- ai-critique/
|   `-- ai-critique-report.pdf
`-- contributions.md
```

## Source material

### Course files reviewed

- [Project Description](lab/CECZ2006ProjectDescription.pdf)
- [Laboratory Manual Overview](lab/CECZ2006LabManual.Overview.pdf)
- [Lab 1 Manual](lab/Lab%201%20Manual.pdf)
- [Lab 2 Manual](lab/Lab%202%20Manual.pdf)
- [Lab 3 Manual](lab/Lab%203%20Manual.pdf)
- [Lab 4 Manual](lab/Lab%204%20Manual%20%283%29.pdf)
- [Lab 5 Manual](lab/Lab%205%20Manual.pdf)
- [Course Project FAQ](lab/Some%20FAQs%20%28v4.1%29.pdf)
- [Fox pages 126-130: Requirements Specification Heuristics](lab/Fox126-130.pdf)
- [Fox pages 341-345: Drafting a Design Class Model](lab/Fox341-345.pdf)
- [Fox page 420: Dialog Maps](lab/Fox420.pdf)
- [SRS Template](lab/SRS_Template.doc)
- [Use Case Template](lab/UseCase_Template.doc)

### Official API references

- [Data.gov.sg API Overview](https://guide.data.gov.sg/developer-guide/api-overview)
- [Data.gov.sg API Rate Limits](https://guide.data.gov.sg/developer-guide/api-overview/api-rate-limits)
- [LTA DataMall](https://datamall.lta.gov.sg/)
- [LTA DataMall API User Guide, Version 6.9 dated 3 August 2026](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf)
- [OneMap API Documentation](https://www.onemap.gov.sg/apidocs/)
- [OneMap Authentication](https://www.onemap.gov.sg/apidocs/authentication)
- [OneMap Search](https://www.onemap.gov.sg/apidocs/search)
- [OneMap Routing](https://www.onemap.gov.sg/apidocs/routing)
- [OneMap Themes](https://www.onemap.gov.sg/apidocs/themes)
- [OneMap Population Query](https://www.onemap.gov.sg/apidocs/populationquery)
- [OneMap BFA Routing](https://www.onemap.gov.sg/apidocs/bfa)
