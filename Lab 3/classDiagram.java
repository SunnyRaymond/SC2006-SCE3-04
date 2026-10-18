```mermaid
classDiagram
    %% ===== PRESENTATION LAYER =====
    class PlugPlanApp {
        -session: Session
        -data: AppBootstrap
        -view: View
        -mode: Mode
        -draft: Draft
        -profileDraft: VehicleProfile
        -currentPlanId: string
        -activeVersionId: string
        -compareIds: string[]
        +navigate(view)
        +submitPlan(e)
        +refreshPlan()
        +saveProfile(e)
        +selectRecommendation(r)
        +submitReport(e)
        +moderate(e)
        +logout()
    }
    class AuthScreen {
        -mode: signin|signup
        -email: string
        -password: string
        +socialSignIn(provider)
        +submit(e)
    }
    class PlacePicker {
        -query: string
        -places: Place[]
        -active: number
        +choose(place)
    }
    class JourneyMap {
        -map: L.Map
        -layer: L.LayerGroup
        +render(origin, destination, recommendations)
    }
    class Modal {
        +showModal()
    }
    class Button
    class Field
    class Empty
    class DataBadge
    class StatusBadge

    %% ===== CLIENT API LAYER =====
    class ApiClient {
        +api~T~(action, payload) T
        +formatSG(value) string
        +localSG(value) string
        +currency(value) string
    }
    class SupabaseClient {
        +auth
        +storage
        +from(table)
        +rpc(fn, args)
    }
    class ApiError {
        +message: string
        +status: number
        +fields: Record
        +retryAfter: number
    }

    %% ===== API ROUTE / CONTROLLER LAYER =====
    class RouteHandler {
        +POST(request) Response
        -readBody(request) string
        -DRIVER_ACTIONS: Set
    }
    class ServiceHandler {
        +handleAction(context, body) Record
    }
    class RequestContext {
        +token: string
        +sessionId: string
        +db: SupabaseClient
        +user: AppUser
        +authUser: User
    }
    class AuthGuard {
        +requireUser(request, deadline) RequestContext
        +requireDriver(context)
        +requireModerator(context)
    }
    class ErrorMapper {
        +errorResponse(error) Response
        +validationError(issues) ApiError
        +databaseError(error) ApiError
    }

    %% ===== DOMAIN / ENGINE LAYER =====
    class PlanEngine {
        -CHARGING_EFFICIENCY: number
        -BALANCED_WEIGHTS: object
        +calculatePlan(params) PlanResult
        -assignScores(candidates, strategy) RankedCandidate[]
        -compareCandidates(a, b, strategy) number
        -failureForStation(...) result
        -estimateCost(connector, kWh, min) number
        -coversChargingWindow(...) boolean
        -parseOpeningHours(value) OpeningWindow
    }
    class ValidationSchemas {
        +profileSchema: ZodType
        +planInputSchema: ZodType
        +reportSchema: ZodType
    }
    class DemoFixtures {
        +DEMO_PROFILE
        +DEMO_INPUT
        +DEMO_SNAPSHOT
        +DEMO_ROUTES
        +DEMO_FAULTS
        +createDemoScenario(input, profile) scenario
    }
    class PolylineDecoder {
        +decodePolyline(encoded) [number,number][]
    }

    %% ===== PROVIDER LAYER =====
    class ProviderGateway {
        +createProviderDeadline(fetch, budget) Deadline
        +searchPlaces(query, mode, deadline) Place[]
        +getLiveSnapshot(origin, dest, deadline) snapshot
        +getRoutes(origin, dest, stations, profile, deadline) routes
        +formatCachedOfficialStatus(...) string
        +attachCachedOfficialStatuses(reports) reports
    }
    class ProviderCache {
        -memoryCache: DiskCache
        +loadCache() DiskCache
        +saveCache(value) void
    }
    class Deadline {
        +at: number
        +fetch: typeof fetch
    }

    %% ===== PERSISTENCE LAYER =====
    class PlanRepository {
        +getProfile(context) VehicleProfile
        +saveProfile(context, profile) VehicleProfile
        +deleteProfile(context) void
        +listPlans(context) SavedPlan[]
        +getOwnedPlan(context, planId) SavedPlan
        +savePlanVersion(context, planId, result, reason) SavedPlan
        +selectRecommendation(context, planId, recId) SavedPlan
        +deletePlan(context, planId) void
    }
    class ReportRepository {
        +listReports(context) IssueReport[]
        +getReport(context, reportId) IssueReport
        +submitReport(context, input) result
        +moderateReport(context, input) IssueReport
        +getActiveFaults(context) FaultEvidence[]
        +createImageUrl(context, reportId) string
    }
    class BootstrapRepository {
        +bootstrap(context) AppBootstrap
        +revokeSession(context) void
    }

    %% ===== DOMAIN TYPES (data classes) =====
    class AppUser {
        +id: string
        +email: string
        +role: Role
        +status: string
    }
    class VehicleProfile {
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
        +label: string
        +lat: number
        +lng: number
        +postal: string
        +address: string
    }
    class PlanInput {
        +origin: Place
        +destination: Place
        +currentSoc: number
        +departureAt: string
        +maxChargingMinutes: number
        +maxDetourMinutes: number
        +strategy: Strategy
        +manualTargetSoc: number
    }
    class Station {
        +id: string
        +name: string
        +address: string
        +postal: string
        +lat: number
        +lng: number
        +operator: string
        +openingHours: string
        +connectors: Connector[]
    }
    class Connector {
        +id: string
        +plugType: string
        +powerType: AC|DC
        +powerKw: number
        +price: number
        +priceType: priceType
        +status: status
    }
    class OfficialSnapshot {
        +source: string
        +state: DataState
        +observedAt: string
        +retrievedAt: string
        +stations: Station[]
    }
    class RouteEstimate {
        +distanceKm: number
        +durationMinutes: number
        +geometry: string
    }
    class CandidateRoute {
        +stationId: string
        +toStation: RouteEstimate
        +fromStation: RouteEstimate
        +walkingMeters: number
    }
    class Recommendation {
        +id: string
        +stationId: string
        +connectorId: string
        +stationName: string
        +chargingMinutes: number
        +estimatedCost: number
        +arrivalSoc: number
        +targetSoc: number
        +detourMinutes: number
        +totalJourneyMinutes: number
        +availability: number
        +score: number
        +rank: number
        +explanations: string[]
        +warnings: string[]
    }
    class PlanResult {
        +inputs: PlanInput
        +profileAssumptions: VehicleProfile
        +recommendations: Recommendation[]
        +excluded: Exclusion[]
        +noChargeNeeded: boolean
        +directRoute: RouteEstimate
        +snapshot: snapshotInfo
        +faultEvidence: FaultEvidence[]
        +summary: string
    }
    class SavedPlan {
        +id: string
        +title: string
        +createdAt: string
        +selectedRecommendationId: string
        +currentVersionId: string
        +versions: PlanVersion[]
    }
    class PlanVersion {
        +id: string
        +planId: string
        +number: number
        +createdAt: string
        +reason: reason
        +result: PlanResult
    }
    class IssueReport {
        +id: string
        +userId: string
        +stationId: string
        +stationName: string
        +category: ReportCategory
        +status: ReportStatus
        +note: string
        +imagePath: string
        +expiresAt: string
        +revision: number
        +decisions: ModerationDecision[]
        +officialStatus: string
    }
    class ModerationDecision {
        +id: string
        +action: ModerationAction
        +reason: string
        +moderatorId: string
        +createdAt: string
        +resultingStatus: ReportStatus
    }
    class AppBootstrap {
        +user: AppUser
        +profile: VehicleProfile
        +plans: SavedPlan[]
        +reports: IssueReport[]
    }

    %% ===== RELATIONSHIPS =====
    PlugPlanApp --> AuthScreen : uses
    PlugPlanApp --> PlacePicker : uses
    PlugPlanApp --> JourneyMap : uses
    PlugPlanApp --> Modal : uses
    PlugPlanApp ..> ApiClient : calls
    PlugPlanApp ..> SupabaseClient : auth/storage

    ApiClient --> ApiError : throws
    ApiClient ..> RouteHandler : POST /api/app

    RouteHandler --> AuthGuard : validates
    RouteHandler --> ServiceHandler : delegates
    RouteHandler --> ErrorMapper : on error

    ServiceHandler --> PlanEngine : calculate
    ServiceHandler --> PlanRepository : persist
    ServiceHandler --> ReportRepository : persist
    ServiceHandler --> BootstrapRepository : load
    ServiceHandler --> ProviderGateway : fetch live/demo
    ServiceHandler --> ValidationSchemas : validates
    ServiceHandler --> DemoFixtures : demo mode
    ServiceHandler --> AuthGuard : role check

    ProviderGateway --> Deadline : uses
    ProviderGateway --> ProviderCache : reads/writes

    PlanEngine --> PlanInput
    PlanEngine --> VehicleProfile
    PlanEngine --> OfficialSnapshot
    PlanEngine --> RouteEstimate
    PlanEngine --> CandidateRoute
    PlanEngine --> PlanResult
    PlanEngine --> Recommendation : creates

    PlanResult "1" *-- "many" Recommendation
    PlanResult "1" *-- "many" Exclusion
    SavedPlan "1" *-- "many" PlanVersion
    PlanVersion "1" *-- "1" PlanResult
    IssueReport "1" *-- "many" ModerationDecision
    Station "1" *-- "many" Connector
    OfficialSnapshot "1" *-- "many" Station
    CandidateRoute "1" *-- "2" RouteEstimate
    Recommendation --> RouteEstimate : toStation/fromStation

    AppBootstrap --> AppUser
    AppBootstrap --> VehicleProfile
    AppBootstrap --> SavedPlan
    AppBootstrap --> IssueReport

    RequestContext --> AppUser
    RequestContext --> SupabaseClient

    JourneyMap ..> PolylineDecoder : decodes geometry
    DemoFixtures ..> OfficialSnapshot
    DemoFixtures ..> CandidateRoute
    DemoFixtures ..> VehicleProfile
```