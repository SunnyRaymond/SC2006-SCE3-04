export type Role = 'DRIVER' | 'MODERATOR';
export type Strategy = 'BALANCED' | 'FASTEST' | 'CHEAPEST' | 'AVAILABILITY' | 'DETOUR';
export type DataState = 'LIVE' | 'CACHED' | 'STALE' | 'DEMO_FIXTURE';
export type ReportCategory = 'BLOCKED_BAY' | 'SUSPECTED_FAULTY_CONNECTOR' | 'INCORRECT_LOCATION' | 'ACCESS_PROBLEM';
export type ReportStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'MERGED' | 'RESOLVED' | 'EXPIRED';
export type ModerationAction = 'VERIFY' | 'REJECT' | 'MERGE' | 'RESOLVE' | 'EXPIRE';
export interface AppUser { id: string; email: string; role: Role; status: string }
export interface VehicleProfile {
  name: string; capacityKWh: number; consumptionKWhPer100Km: number; plugTypes: string[];
  maxAcKw: number; maxDcKw: number; reserveSoc: number;
  defaultDetourMinutes: number; minChargerKw: number; maxWalkingM: number;
}
export interface Place { label: string; lat: number; lng: number; postal?: string; address?: string }
export interface PlanInput {
  origin: Place; destination: Place; currentSoc: number; departureAt: string;
  maxChargingMinutes: number; maxDetourMinutes: number; strategy: Strategy;
  manualTargetSoc: number | null;
}
export interface Connector {
  id: string; plugType: string; powerType: 'AC' | 'DC'; powerKw: number;
  price: number | null; priceType: 'kWh' | 'h' | 'free' | 'unknown';
  status: 'AVAILABLE' | 'OCCUPIED' | 'UNAVAILABLE';
}
export interface Station {
  id: string; name: string; address: string; postal: string; lat: number; lng: number;
  operator: string; openingHours: string | null; openingHoursAssumed: boolean;
  connectors: Connector[]; operatorUrl?: string;
}
export interface OfficialSnapshot {
  source: string; state: DataState; observedAt: string; retrievedAt: string; stations: Station[];
}
export interface RouteEstimate { distanceKm: number; durationMinutes: number; geometry?: string }
export interface CandidateRoute { stationId: string; toStation: RouteEstimate; fromStation: RouteEstimate; walkingMeters?: number }
export interface FaultEvidence { stationId: string; reportId: string; decisionId?: string; expiresAt: string }
export interface Recommendation {
  id: string; stationId: string; connectorId: string; stationName: string; address: string;
  lat: number; lng: number; operator: string; plugType: string; powerType: 'AC' | 'DC'; powerKw: number;
  status: Connector['status']; arrivalSoc: number; automaticTargetSoc: number; targetSoc: number;
  requiredBatteryKWh: number; requiredChargerKWh: number; chargingMinutes: number;
  estimatedCost: number | null; priceType: Connector['priceType']; unitPrice: number | null;
  detourMinutes: number; travelMinutes: number; totalJourneyMinutes: number; availability: number;
  score: number; rank: number; explanations: string[]; warnings: string[];
  toStation: RouteEstimate; fromStation: RouteEstimate;
}
export interface Exclusion { stationId: string; stationName: string; reason: string; code: string }
export interface PlanResult {
  inputs: PlanInput; profileAssumptions: VehicleProfile; recommendations: Recommendation[];
  excluded: Exclusion[]; noChargeNeeded: boolean; directRoute: RouteEstimate;
  snapshot: { source: string; state: DataState; observedAt: string; retrievedAt: string };
  faultFilterCheckedAt: string; faultEvidence: FaultEvidence[]; summary: string;
}
export interface PlanVersion { id: string; planId: string; number: number; createdAt: string; reason: 'CREATE' | 'RECONFIGURE' | 'REFRESH'; result: PlanResult }
export interface SavedPlan {
  id: string; title: string; createdAt: string; selectedRecommendationId: string | null;
  currentVersionId: string | null; versions: PlanVersion[];
}
export interface ModerationDecision {
  id: string; action: ModerationAction; reason: string; moderatorId: string; createdAt: string; resultingStatus: ReportStatus;
}
export interface IssueReport {
  id: string; userId: string; stationId: string; stationName: string; connectorId: string | null;
  category: ReportCategory; status: ReportStatus; note: string; imagePath: string | null;
  expiresAt: string; createdAt: string; updatedAt: string; revision: number; mergedIntoId: string | null;
  decisions: ModerationDecision[]; officialStatus?: string;
}
export interface AppBootstrap { user: AppUser; profile: VehicleProfile | null; plans: SavedPlan[]; reports: IssueReport[] }
export const STRATEGIES: { value: Strategy; label: string; short: string }[] = [
  { value: 'BALANCED', label: 'Balanced', short: 'A little of everything' },
  { value: 'FASTEST', label: 'Fastest journey', short: 'Drive + charging time' },
  { value: 'CHEAPEST', label: 'Cheapest charging', short: 'Lowest known cost' },
  { value: 'AVAILABILITY', label: 'Availability first', short: 'Available compatible plugs' },
  { value: 'DETOUR', label: 'Minimum detour', short: 'Stay close to your route' },
];
export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'SUSPECTED_FAULTY_CONNECTOR', label: 'Suspected faulty connector' },
  { value: 'BLOCKED_BAY', label: 'Blocked charging bay' },
  { value: 'INCORRECT_LOCATION', label: 'Incorrect location' },
  { value: 'ACCESS_PROBLEM', label: 'Access problem' },
];
