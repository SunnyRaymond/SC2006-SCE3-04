```mermaid

classDiagram

&#x20;   %% ===== PRESENTATION LAYER =====

&#x20;   class PlugPlanApp {

&#x20;       -session: Session

&#x20;       -data: AppBootstrap

&#x20;       -view: View

&#x20;       -mode: Mode

&#x20;       -draft: Draft

&#x20;       -profileDraft: VehicleProfile

&#x20;       -currentPlanId: string

&#x20;       -activeVersionId: string

&#x20;       -compareIds: string\[]

&#x20;       +navigate(view)

&#x20;       +submitPlan(e)

&#x20;       +refreshPlan()

&#x20;       +saveProfile(e)

&#x20;       +selectRecommendation(r)

&#x20;       +submitReport(e)

&#x20;       +moderate(e)

&#x20;       +logout()

&#x20;   }

&#x20;   class AuthScreen {

&#x20;       -mode: signin|signup

&#x20;       -email: string

&#x20;       -password: string

&#x20;       +socialSignIn(provider)

&#x20;       +submit(e)

&#x20;   }

&#x20;   class PlacePicker {

&#x20;       -query: string

&#x20;       -places: Place\[]

&#x20;       -active: number

&#x20;       +choose(place)

&#x20;   }

&#x20;   class JourneyMap {

&#x20;       -map: L.Map

&#x20;       -layer: L.LayerGroup

&#x20;       +render(origin, destination, recommendations)

&#x20;   }

&#x20;   class Modal {

&#x20;       +showModal()

&#x20;   }

&#x20;   class Button

&#x20;   class Field

&#x20;   class Empty

&#x20;   class DataBadge

&#x20;   class StatusBadge



&#x20;   %% ===== CLIENT API LAYER =====

&#x20;   class ApiClient {

&#x20;       +api\~T\~(action, payload) T

&#x20;       +formatSG(value) string

&#x20;       +localSG(value) string

&#x20;       +currency(value) string

&#x20;   }

&#x20;   class SupabaseClient {

&#x20;       +auth

&#x20;       +storage

&#x20;       +from(table)

&#x20;       +rpc(fn, args)

&#x20;   }

&#x20;   class ApiError {

&#x20;       +message: string

&#x20;       +status: number

&#x20;       +fields: Record

&#x20;       +retryAfter: number

&#x20;   }



&#x20;   %% ===== API ROUTE / CONTROLLER LAYER =====

&#x20;   class RouteHandler {

&#x20;       +POST(request) Response

&#x20;       -readBody(request) string

&#x20;       -DRIVER\_ACTIONS: Set

&#x20;   }

&#x20;   class ServiceHandler {

&#x20;       +handleAction(context, body) Record

&#x20;   }

&#x20;   class RequestContext {

&#x20;       +token: string

&#x20;       +sessionId: string

&#x20;       +db: SupabaseClient

&#x20;       +user: AppUser

&#x20;       +authUser: User

&#x20;   }

&#x20;   class AuthGuard {

&#x20;       +requireUser(request, deadline) RequestContext

&#x20;       +requireDriver(context)

&#x20;       +requireModerator(context)

&#x20;   }

&#x20;   class ErrorMapper {

&#x20;       +errorResponse(error) Response

&#x20;       +validationError(issues) ApiError

&#x20;       +databaseError(error) ApiError

&#x20;   }



&#x20;   %% ===== DOMAIN / ENGINE LAYER =====

&#x20;   class PlanEngine {

&#x20;       -CHARGING\_EFFICIENCY: number

&#x20;       -BALANCED\_WEIGHTS: object

&#x20;       +calculatePlan(params) PlanResult

&#x20;       -assignScores(candidates, strategy) RankedCandidate\[]

&#x20;       -compareCandidates(a, b, strategy) number

&#x20;       -failureForStation(...) result

&#x20;       -estimateCost(connector, kWh, min) number

&#x20;       -coversChargingWindow(...) boolean

&#x20;       -parseOpeningHours(value) OpeningWindow

&#x20;   }

&#x20;   class ValidationSchemas {

&#x20;       +profileSchema: ZodType

&#x20;       +planInputSchema: ZodType

&#x20;       +reportSchema: ZodType

&#x20;   }

&#x20;   class DemoFixtures {

&#x20;       +DEMO\_PROFILE

&#x20;       +DEMO\_INPUT

&#x20;       +DEMO\_SNAPSHOT

&#x20;       +DEMO\_ROUTES

&#x20;       +DEMO\_FAULTS

&#x20;       +createDemoScenario(input, profile) scenario

&#x20;   }

&#x20;   class PolylineDecoder {

&#x20;       +decodePolyline(encoded) \[number,number]\[]

&#x20;   }



&#x20;   %% ===== PROVIDER LAYER =====

&#x20;   class ProviderGateway {

&#x20;       +createProviderDeadline(fetch, budget) Deadline

&#x20;       +searchPlaces(query, mode, deadline) Place\[]

&#x20;       +getLiveSnapshot(origin, dest, deadline) snapshot

&#x20;       +getRoutes(origin, dest, stations, profile, deadline) routes

&#x20;       +formatCachedOfficialStatus(...) string

&#x20;       +attachCachedOfficialStatuses(reports) reports

&#x20;   }

&#x20;   class ProviderCache {

&#x20;       -memoryCache: DiskCache

&#x20;       +loadCache() DiskCache

&#x20;       +saveCache(value) void

&#x20;   }

&#x20;   class Deadline {

&#x20;       +at: number

&#x20;       +fetch: typeof fetch

&#x20;   }



&#x20;   %% ===== PERSISTENCE LAYER =====

&#x20;   class PlanRepository {

&#x20;       +getProfile(context) VehicleProfile

&#x20;       +saveProfile(context, profile) VehicleProfile

&#x20;       +deleteProfile(context) void

&#x20;       +listPlans(context) SavedPlan\[]

&#x20;       +getOwnedPlan(context, planId) SavedPlan

&#x20;       +savePlanVersion(context, planId, result, reason) SavedPlan

&#x20;       +selectRecommendation(context, planId, recId) SavedPlan

&#x20;       +deletePlan(context, planId) void

&#x20;   }

&#x20;   class ReportRepository {

&#x20;       +listReports(context) IssueReport\[]

&#x20;       +getReport(context, reportId) IssueReport

&#x20;       +submitReport(context, input) result

&#x20;       +moderateReport(context, input) IssueReport

&#x20;       +getActiveFaults(context) FaultEvidence\[]

&#x20;       +createImageUrl(context, reportId) string

&#x20;   }

&#x20;   class BootstrapRepository {

&#x20;       +bootstrap(context) AppBootstrap

&#x20;       +revokeSession(context) void

&#x20;   }



&#x20;   %% ===== DOMAIN TYPES (data classes) =====

&#x20;   class AppUser {

&#x20;       +id: string

&#x20;       +email: string

&#x20;       +role: Role

&#x20;       +status: string

&#x20;   }

&#x20;   class VehicleProfile {

&#x20;       +name: string

&#x20;       +capacityKWh: number

&#x20;       +consumptionKWhPer100Km: number

&#x20;       +plugTypes: string\[]

&#x20;       +maxAcKw: number

&#x20;       +maxDcKw: number

&#x20;       +reserveSoc: number

&#x20;       +defaultDetourMinutes: number

&#x20;       +minChargerKw: number

&#x20;       +maxWalkingM: number

&#x20;   }

&#x20;   class Place {

&#x20;       +label: string

&#x20;       +lat: number

&#x20;       +lng: number

&#x20;       +postal: string

&#x20;       +address: string

&#x20;   }

&#x20;   class PlanInput {

&#x20;       +origin: Place

&#x20;       +destination: Place

&#x20;       +currentSoc: number

&#x20;       +departureAt: string

&#x20;       +maxChargingMinutes: number

&#x20;       +maxDetourMinutes: number

&#x20;       +strategy: Strategy

&#x20;       +manualTargetSoc: number

&#x20;   }

&#x20;   class Station {

&#x20;       +id: string

&#x20;       +name: string

&#x20;       +address: string

&#x20;       +postal: string

&#x20;       +lat: number

&#x20;       +lng: number

&#x20;       +operator: string

&#x20;       +openingHours: string

&#x20;       +connectors: Connector\[]

&#x20;   }

&#x20;   class Connector {

&#x20;       +id: string

&#x20;       +plugType: string

&#x20;       +powerType: AC|DC

&#x20;       +powerKw: number

&#x20;       +price: number

&#x20;       +priceType: priceType

&#x20;       +status: status

&#x20;   }

&#x20;   class OfficialSnapshot {

&#x20;       +source: string

&#x20;       +state: DataState

&#x20;       +observedAt: string

&#x20;       +retrievedAt: string

&#x20;       +stations: Station\[]

&#x20;   }

&#x20;   class RouteEstimate {

&#x20;       +distanceKm: number

&#x20;       +durationMinutes: number

&#x20;       +geometry: string

&#x20;   }

&#x20;   class CandidateRoute {

&#x20;       +stationId: string

&#x20;       +toStation: RouteEstimate

&#x20;       +fromStation: RouteEstimate

&#x20;       +walkingMeters: number

&#x20;   }

&#x20;   class Recommendation {

&#x20;       +id: string

&#x20;       +stationId: string

&#x20;       +connectorId: string

&#x20;       +stationName: string

&#x20;       +chargingMinutes: number

&#x20;       +estimatedCost: number

&#x20;       +arrivalSoc: number

&#x20;       +targetSoc: number

&#x20;       +detourMinutes: number

&#x20;       +totalJourneyMinutes: number

&#x20;       +availability: number

&#x20;       +score: number

&#x20;       +rank: number

&#x20;       +explanations: string\[]

&#x20;       +warnings: string\[]

&#x20;   }

&#x20;   class PlanResult {

&#x20;       +inputs: PlanInput

&#x20;       +profileAssumptions: VehicleProfile

&#x20;       +recommendations: Recommendation\[]

&#x20;       +excluded: Exclusion\[]

&#x20;       +noChargeNeeded: boolean

&#x20;       +directRoute: RouteEstimate

&#x20;       +snapshot: snapshotInfo

&#x20;       +faultEvidence: FaultEvidence\[]

&#x20;       +summary: string

&#x20;   }

&#x20;   class SavedPlan {

&#x20;       +id: string

&#x20;       +title: string

&#x20;       +createdAt: string

&#x20;       +selectedRecommendationId: string

&#x20;       +currentVersionId: string

&#x20;       +versions: PlanVersion\[]

&#x20;   }

&#x20;   class PlanVersion {

&#x20;       +id: string

&#x20;       +planId: string

&#x20;       +number: number

&#x20;       +createdAt: string

&#x20;       +reason: reason

&#x20;       +result: PlanResult

&#x20;   }

&#x20;   class IssueReport {

&#x20;       +id: string

&#x20;       +userId: string

&#x20;       +stationId: string

&#x20;       +stationName: string

&#x20;       +category: ReportCategory

&#x20;       +status: ReportStatus

&#x20;       +note: string

&#x20;       +imagePath: string

&#x20;       +expiresAt: string

&#x20;       +revision: number

&#x20;       +decisions: ModerationDecision\[]

&#x20;       +officialStatus: string

&#x20;   }

&#x20;   class ModerationDecision {

&#x20;       +id: string

&#x20;       +action: ModerationAction

&#x20;       +reason: string

&#x20;       +moderatorId: string

&#x20;       +createdAt: string

&#x20;       +resultingStatus: ReportStatus

&#x20;   }

&#x20;   class AppBootstrap {

&#x20;       +user: AppUser

&#x20;       +profile: VehicleProfile

&#x20;       +plans: SavedPlan\[]

&#x20;       +reports: IssueReport\[]

&#x20;   }



&#x20;   %% ===== RELATIONSHIPS =====

&#x20;   PlugPlanApp --> AuthScreen : uses

&#x20;   PlugPlanApp --> PlacePicker : uses

&#x20;   PlugPlanApp --> JourneyMap : uses

&#x20;   PlugPlanApp --> Modal : uses

&#x20;   PlugPlanApp ..> ApiClient : calls

&#x20;   PlugPlanApp ..> SupabaseClient : auth/storage



&#x20;   ApiClient --> ApiError : throws

&#x20;   ApiClient ..> RouteHandler : POST /api/app



&#x20;   RouteHandler --> AuthGuard : validates

&#x20;   RouteHandler --> ServiceHandler : delegates

&#x20;   RouteHandler --> ErrorMapper : on error



&#x20;   ServiceHandler --> PlanEngine : calculate

&#x20;   ServiceHandler --> PlanRepository : persist

&#x20;   ServiceHandler --> ReportRepository : persist

&#x20;   ServiceHandler --> BootstrapRepository : load

&#x20;   ServiceHandler --> ProviderGateway : fetch live/demo

&#x20;   ServiceHandler --> ValidationSchemas : validates

&#x20;   ServiceHandler --> DemoFixtures : demo mode

&#x20;   ServiceHandler --> AuthGuard : role check



&#x20;   ProviderGateway --> Deadline : uses

&#x20;   ProviderGateway --> ProviderCache : reads/writes



&#x20;   PlanEngine --> PlanInput

&#x20;   PlanEngine --> VehicleProfile

&#x20;   PlanEngine --> OfficialSnapshot

&#x20;   PlanEngine --> RouteEstimate

&#x20;   PlanEngine --> CandidateRoute

&#x20;   PlanEngine --> PlanResult

&#x20;   PlanEngine --> Recommendation : creates



&#x20;   PlanResult "1" \*-- "many" Recommendation

&#x20;   PlanResult "1" \*-- "many" Exclusion

&#x20;   SavedPlan "1" \*-- "many" PlanVersion

&#x20;   PlanVersion "1" \*-- "1" PlanResult

&#x20;   IssueReport "1" \*-- "many" ModerationDecision

&#x20;   Station "1" \*-- "many" Connector

&#x20;   OfficialSnapshot "1" \*-- "many" Station

&#x20;   CandidateRoute "1" \*-- "2" RouteEstimate

&#x20;   Recommendation --> RouteEstimate : toStation/fromStation



&#x20;   AppBootstrap --> AppUser

&#x20;   AppBootstrap --> VehicleProfile

&#x20;   AppBootstrap --> SavedPlan

&#x20;   AppBootstrap --> IssueReport



&#x20;   RequestContext --> AppUser

&#x20;   RequestContext --> SupabaseClient



&#x20;   JourneyMap ..> PolylineDecoder : decodes geometry

&#x20;   DemoFixtures ..> OfficialSnapshot

&#x20;   DemoFixtures ..> CandidateRoute

&#x20;   DemoFixtures ..> VehicleProfile

```

