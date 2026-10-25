# PlugPlan SG — Class Diagram

## UML mapping and design notes

This is a design view of the Lab 3 implementation. React function components, TypeScript modules, SDK objects, and TypeScript interfaces are marked with stereotypes; only ApiError is a project class in the browser client, and the server has a separate class with the same name. Operations on modules/components name their actual exported functions or component functions. ApplicationStartup is a design abstraction for app startup, mapped to src/app/page.tsx's Page() and PlugPlanApp's session/bootstrap effects.

The main patterns are layered client–server coordination (handleAction), repository-style functions in src/lib/server/db.ts, provider gateway/cache functions in providers.ts, and strategy-based ranking in calculatePlan. Browser sign-in and report-image upload use the public Supabase client directly. On API requests, requireUser validates the Supabase user, active-session RPC, and app_users row; the route applies the driver/moderator role gate, and database calls keep the user's JWT so RLS remains in force.

Persistence mapping: a driver's optional VehicleProfile is stored in vehicles.data; a SavedPlan owns immutable PlanVersion history, with currentVersionId pointing to one version. selectedRecommendationId is an optional pointer into that current version and is checked by the database trigger. Reports persist category and status (there is no type field); officialStatus is computed from the provider cache and is not stored. OAuth UI is conditional on Supabase provider configuration and is not enabled in the baseline.

```mermaid
classDiagram
    %% ===== STARTUP AND PRESENTATION =====
    class ApplicationStartup {
        <<design abstraction>>
        +Page()
    }
    class PlugPlanApp {
        <<React function component>>
        -session: Session | null
        -data: AppBootstrap | null
        -view: View
        -mode: Mode
        -draft: Draft
        -profileDraft: VehicleProfile
        -currentPlanId: string | null
        -activeVersionId: string | null
        -compareIds: string[]
        -selectedReport: IssueReport | null
        -moderationAction: ModerationAction
        +reload()
        +navigate(next)
        +submitPlan(e)
        +refreshPlan()
        +saveProfile(e)
        +selectRecommendation(r)
        +submitReport(e)
        +moderate(e)
        +logout()
    }
    class AuthScreen {
        <<React function component>>
        -mode: signin | signup
        -email: string
        -password: string
        -providers: {google: boolean; github: boolean} | null
        +socialSignIn(provider)
        +submit(e)
    }
    class PlacePicker {
        <<React function component>>
        -query: string
        -places: Place[]
        -active: number
        +choose(p)
    }
    class JourneyMap {
        <<React function component>>
        +JourneyMap(origin, destination, recommendations, selectedId)
    }
    class Modal {
        <<React function component>>
        +Modal(title, children, onClose, wide)
    }
    class Button {
        <<React function component>>
        +Button(children, props)
    }
    class Field {
        <<React function component>>
        +Field(label, hint, error, children)
    }
    class Empty {
        <<React function component>>
        +Empty(icon, title, description, children)
    }
    class DataBadge {
        <<React function component>>
        +DataBadge(state)
    }
    class StatusBadge {
        <<React function component>>
        +StatusBadge(status)
    }

    %% ===== CLIENT API AND SUPABASE SDK =====
    class ApiClient {
        <<TypeScript module>>
        +api(action, payload)
        +formatSG(value, options)
        +localSG(value)
        +currency(value)
    }
    class SupabaseClient {
        <<SDK type>>
        +auth
        +storage
        +from(table)
        +rpc(fn, args)
    }
    class ClientApiError {
        <<ApiError in src/lib/client.ts>>
        +message: string
        +status: number
        +fields: Record
        +retryAfter: number
    }

    %% ===== API CONTROL AND ACCESS CONTROL =====
    class RouteHandler {
        <<Next.js route module>>
        +POST(request)
        -readBody(request)
        -DRIVER_ACTIONS: Set
    }
    class ServiceHandler {
        <<TypeScript module>>
        +handleAction(context, body)
    }
    class RequestContext {
        <<TypeScript interface>>
        +token: string
        +sessionId: string
        +db: SupabaseClient
        +providerDeadline: Deadline
        +user: AppUser
        +authUser: User
    }
    class AuthGuard {
        <<TypeScript module>>
        +getPublicSupabaseClient(accessToken)
        +requireUser(request, providerDeadline)
        +requireDriver(context)
        +requireModerator(context)
    }
    class ErrorMapper {
        <<TypeScript module>>
        +errorResponse(error)
        +validationError(issues)
        +databaseError(error)
    }
    class ServerApiError {
        <<ApiError in src/lib/server/errors.ts>>
        +message: string
        +status: number
        +fields: Record
        +retryAfter: number
    }

    %% ===== DOMAIN AND VALIDATION =====
    class PlanEngine {
        <<TypeScript module>>
        +calculatePlan(input, profile, snapshot, directRoute, routes, faults)
    }
    class ValidationSchemas {
        <<TypeScript module>>
        +profileSchema
        +planInputSchema
        +reportSchema
    }
    class DemoFixtures {
        <<TypeScript module>>
        +DEMO_PROFILE
        +DEMO_INPUT
        +DEMO_SNAPSHOT
        +DEMO_DIRECT_ROUTE
        +DEMO_ROUTES
        +DEMO_FAULTS
        +createDemoScenario(input, profile)
    }
    class PolylineDecoder {
        <<TypeScript module>>
        +decodePolyline(encoded)
    }

    %% ===== PROVIDER INTEGRATION =====
    class ProviderGateway {
        <<TypeScript module>>
        +createProviderDeadline(fetchImpl, budgetMs)
        +searchPlaces(query, mode, deadline)
        +getLiveSnapshot(origin, destination, deadline)
        +getRoutes(origin, destination, stations, profile, deadline)
        +formatCachedOfficialStatus(report, station, observedAt, detailRetrievedAt, now)
        +attachCachedOfficialStatuses(reports)
        +getDemoPlaces(query)
    }
    class ProviderCache {
        <<module-local cache functions>>
        -memoryCache
        +loadCache()
        +saveCache(value)
    }
    class Deadline {
        <<TypeScript interface>>
        +at: number
        +fetch: function
    }

    %% ===== REPOSITORY RESPONSIBILITIES =====
    class ProfileRepository {
        <<repository functions>>
        +getProfile(context)
        +saveProfile(context, profile)
        +deleteProfile(context)
    }
    class PlanRepository {
        <<repository functions>>
        +listPlans(context)
        +getOwnedPlan(context, planId)
        +savePlanVersion(context, planId, result, reason)
        +selectRecommendation(context, planId, recommendationId)
        +deletePlan(context, planId)
    }
    class ReportRepository {
        <<repository functions>>
        +listReports(context)
        +getReport(context, reportId)
        +submitReport(context, input)
        +moderateReport(context, reportId, action, reason, expectedRevision, mergeTargetId)
        +getActiveFaults(context)
    }
    class BootstrapRepository {
        <<repository functions>>
        +bootstrap(context)
        +revokeSession(context)
        +createImageUrl(context, reportId)
    }

    %% ===== DOMAIN TYPES AND PERSISTED RECORD VIEWS =====
    class AppUser {
        <<TypeScript interface>>
        +id: string
        +email: string
        +role: Role
        +status: string
    }
    class VehicleProfile {
        <<TypeScript interface; vehicles.data>>
        +name: string
        +capacityKWh: number
        +consumptionKWhPer100Km: number
        +plugTypes: string[]
        +maxAcKw: number
        +maxDcKw: number
        +reserveSoc: number
        +defaultDetourMinutes: number
        +minChargerKw: number
        +maxWalkingM: number
    }
    class Place {
        <<TypeScript interface>>
        +label: string
        +lat: number
        +lng: number
        +postal: string
        +address: string
    }
    class PlanInput {
        <<TypeScript interface>>
        +origin: Place
        +destination: Place
        +currentSoc: number
        +departureAt: string
        +maxChargingMinutes: number
        +maxDetourMinutes: number
        +strategy: Strategy
        +manualTargetSoc: number | null
    }
    class Station {
        <<TypeScript interface>>
        +id: string
        +name: string
        +address: string
        +postal: string
        +lat: number
        +lng: number
        +operator: string
        +openingHours: string | null
        +openingHoursAssumed: boolean
        +connectors: Connector[]
    }
    class Connector {
        <<TypeScript interface>>
        +id: string
        +plugType: string
        +powerType: AC | DC
        +powerKw: number
        +price: number | null
        +priceType: kWh | h | free | unknown
        +status: AVAILABLE | OCCUPIED | UNAVAILABLE
    }
    class OfficialSnapshot {
        <<TypeScript interface>>
        +source: string
        +state: DataState
        +observedAt: string
        +retrievedAt: string
        +stations: Station[]
    }
    class RouteEstimate {
        <<TypeScript interface>>
        +distanceKm: number
        +durationMinutes: number
        +geometry: string (optional)
    }
    class CandidateRoute {
        <<TypeScript interface>>
        +stationId: string
        +toStation: RouteEstimate
        +fromStation: RouteEstimate
        +walkingMeters: number (optional)
    }
    class Recommendation {
        <<TypeScript interface>>
        +id: string
        +stationId: string
        +connectorId: string
        +stationName: string
        +chargingMinutes: number
        +estimatedCost: number | null
        +arrivalSoc: number
        +automaticTargetSoc: number
        +targetSoc: number
        +requiredBatteryKWh: number
        +requiredChargerKWh: number
        +detourMinutes: number
        +travelMinutes: number
        +totalJourneyMinutes: number
        +availability: number
        +score: number
        +rank: number
        +explanations: string[]
        +warnings: string[]
        +toStation: RouteEstimate
        +fromStation: RouteEstimate
    }
    class Exclusion {
        <<TypeScript interface>>
        +stationId: string
        +stationName: string
        +reason: string
        +code: string
    }
    class FaultEvidence {
        <<TypeScript interface>>
        +stationId: string
        +reportId: string
        +decisionId: string (optional)
        +expiresAt: string
    }
    class PlanResult {
        <<TypeScript interface>>
        +inputs: PlanInput
        +profileAssumptions: VehicleProfile
        +recommendations: Recommendation[]
        +excluded: Exclusion[]
        +noChargeNeeded: boolean
        +directRoute: RouteEstimate
        +snapshot: {source, state, observedAt, retrievedAt}
        +faultFilterCheckedAt: string
        +faultEvidence: FaultEvidence[]
        +summary: string
    }
    class SavedPlan {
        <<TypeScript interface; plans row>>
        +id: string
        +title: string
        +createdAt: string
        +selectedRecommendationId: string | null
        +currentVersionId: string | null
        +versions: PlanVersion[]
    }
    class PlanVersion {
        <<TypeScript interface; plan_versions row>>
        +id: string
        +planId: string
        +number: number
        +createdAt: string
        +reason: CREATE | RECONFIGURE | REFRESH
        +result: PlanResult
    }
    class IssueReport {
        <<TypeScript interface; issue_reports row>>
        +id: string
        +userId: string
        +stationId: string
        +stationName: string
        +connectorId: string | null
        +category: ReportCategory
        +status: ReportStatus
        +note: string
        +imagePath: string | null
        +expiresAt: string
        +createdAt: string
        +updatedAt: string
        +revision: number
        +mergedIntoId: string | null
        +decisions: ModerationDecision[]
        +officialStatus: string (optional)
    }
    class ModerationDecision {
        <<TypeScript interface; moderation_decisions row>>
        +id: string
        +action: ModerationAction
        +reason: string
        +moderatorId: string
        +createdAt: string
        +resultingStatus: ReportStatus
    }
    class AppBootstrap {
        <<TypeScript interface>>
        +user: AppUser
        +profile: VehicleProfile | null
        +plans: SavedPlan[]
        +reports: IssueReport[]
    }

    %% ===== RELATIONSHIPS =====
    ApplicationStartup --> PlugPlanApp : renders
    PlugPlanApp --> AuthScreen : renders
    PlugPlanApp --> PlacePicker : uses
    PlugPlanApp --> JourneyMap : renders
    PlugPlanApp --> Modal : renders
    PlugPlanApp --> Button : uses
    PlugPlanApp --> Field : uses
    PlugPlanApp --> Empty : uses
    PlugPlanApp --> DataBadge : uses
    PlugPlanApp --> StatusBadge : uses
    PlugPlanApp ..> ApiClient : calls
    PlugPlanApp ..> SupabaseClient : session
    AuthScreen ..> SupabaseClient : sign-in
    ApiClient --> ClientApiError : throws
    ApiClient ..> RouteHandler : POST /api/app
    JourneyMap ..> PolylineDecoder : decodes geometry
    PlugPlanApp ..> SupabaseClient : uploads report image

    RouteHandler --> AuthGuard : authenticates and gates role
    RouteHandler --> ServiceHandler : dispatches
    RouteHandler --> ErrorMapper : maps errors
    ErrorMapper --> ServerApiError : returns
    AuthGuard --> RequestContext : creates
    RequestContext --> AppUser
    RequestContext --> SupabaseClient : user-JWT client
    ServiceHandler --> PlanEngine : calculate
    ServiceHandler --> ValidationSchemas : validates
    ServiceHandler --> DemoFixtures : demo mode
    ServiceHandler --> ProfileRepository
    ServiceHandler --> PlanRepository
    ServiceHandler --> ReportRepository
    ServiceHandler --> BootstrapRepository
    ServiceHandler --> ProviderGateway : fetches provider data

    ProviderGateway --> Deadline : uses
    ProviderGateway --> ProviderCache : reads and writes
    ProviderGateway --> Station
    ProviderGateway --> RouteEstimate
    ProviderGateway --> CandidateRoute

    PlanEngine --> PlanInput
    PlanEngine --> VehicleProfile
    PlanEngine --> OfficialSnapshot
    PlanEngine --> CandidateRoute
    PlanEngine --> FaultEvidence
    PlanEngine --> PlanResult : returns
    PlanResult "1" *-- "0..3" Recommendation : shortlist
    PlanResult "1" *-- "0..*" Exclusion : excluded
    PlanResult "1" *-- "0..*" FaultEvidence : evidence
    PlanResult "1" *-- "1" PlanInput : inputs
    PlanResult "1" *-- "1" VehicleProfile : assumptions
    PlanResult "1" *-- "1" RouteEstimate : directRoute
    Recommendation "1" *-- "2" RouteEstimate : toStation and fromStation
    CandidateRoute "1" *-- "2" RouteEstimate : toStation and fromStation
    OfficialSnapshot "1" *-- "0..*" Station : stations
    Station "1" *-- "0..*" Connector : connectors

    AppUser "1" --> "0..1" VehicleProfile : profile
    AppUser "1" --> "0..*" SavedPlan : owns
    AppUser "1" --> "0..*" IssueReport : submits
    SavedPlan "1" *-- "1..*" PlanVersion : versions
    SavedPlan "0..1" --> "0..1" PlanVersion : currentVersionId
    SavedPlan "0..1" --> "0..1" Recommendation : selectedRecommendationId
    PlanVersion "1" *-- "1" PlanResult : immutable result
    IssueReport "1" *-- "0..*" ModerationDecision : decisions
    ModerationDecision "0..*" --> "1" AppUser : moderator
    AppBootstrap --> AppUser
    AppBootstrap --> "0..1" VehicleProfile
    AppBootstrap --> "0..*" SavedPlan
    AppBootstrap --> "0..*" IssueReport

    Note for ProfileRepository "ProfileRepository, PlanRepository, ReportRepository, and BootstrapRepository group functions in src/lib/server/db.ts. report.moderate sends moderationAction and expectedRevision; handleAction maps moderationAction to action, then db.ts sends p_action and p_expected_revision to the RPC."
    Note for SavedPlan "The current-version FK is constrained to the same plan. The selected ID is checked against recommendations in the current version; it is not a separate SQL table."
    Note for PlanVersion "The plan_versions row stores result as JSONB. A database trigger rejects updates to existing versions."
    Note for IssueReport "officialStatus is cache-derived for moderator views and is not persisted."
    Note for AuthGuard "requireUser calls Supabase Auth getUser, is_current_session_active RPC, then reads app_users. Route role gates and RLS enforce access."
```



