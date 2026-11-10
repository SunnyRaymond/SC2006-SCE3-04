import { connector, decision, defineCases, hasWarning, plan, route, station, type LabCase } from './lab4.helpers';

/**
 * Basis-path tests of the two most complex PlanEngine methods.
 * failureForStation is private, so its paths are driven through calculatePlan
 * with a single station and observed from the recommendation or exclusion code.
 * Infeasible basis paths (FS-27, CP-14) are documented in the report and not executed.
 */
const one = (...connectors: ReturnType<typeof connector>[]) => [station('s1', connectors)];
const hours = (openingHours: string | null) => [station('s1', [connector()], { openingHours })];
const accepted = 'RECOMMENDED s1';

const failureForStationCases: LabCase[] = [
  { id: 'FS-01', design: 'Baseline: all gates pass, one DC connector, per-kWh price', trace: 'Baseline', input: 'Baseline fixture', expected: accepted, run: () => decision(plan()) },
  { id: 'FS-02', design: 'D1 true: no usable route', trace: 'D1', input: 'routes=[]', expected: 'EXCLUDED NO_ROUTE', run: () => decision(plan({ routes: [] })) },
  { id: 'FS-03', design: 'D2 true: negative arrival energy', trace: 'D2', input: 'to-station 200 km', expected: 'EXCLUDED UNREACHABLE', run: () => decision(plan({ routes: [route('s1', {}, 200)] })) },
  { id: 'FS-04', design: 'D3 true: detour over limit', trace: 'D3', input: 'maxDetourMinutes=5; detour 10', expected: 'EXCLUDED DETOUR_LIMIT', run: () => decision(plan({ input: { maxDetourMinutes: 5 }, routes: [route('s1', {}, 20, 100, 40, 60)] })) },
  { id: 'FS-05', design: 'D4 true: no compatible connector', trace: 'D4', input: 'CHAdeMO connector', expected: 'EXCLUDED NO_COMPATIBLE_CONNECTOR', run: () => decision(plan({ stations: one(connector({ plugType: 'CHAdeMO' })) })) },
  { id: 'FS-06', design: 'D5 true: walking distance unknown', trace: 'D5', input: 'walkingMeters=undefined; limit 600', expected: 'EXCLUDED WALKING_UNVERIFIED', run: () => decision(plan({ routes: [route('s1', { walkingMeters: undefined })] })) },
  { id: 'FS-07', design: 'D6 true: walking over limit', trace: 'D6', input: 'walking 101 m; limit 100 m', expected: 'EXCLUDED WALKING_LIMIT', run: () => decision(plan({ profile: { maxWalkingM: 100 }, routes: [route('s1', { walkingMeters: 101 })] })) },
  { id: 'FS-08', design: 'D7 true: no available connector', trace: 'D7', input: 'connector OCCUPIED', expected: 'EXCLUDED NO_AVAILABLE_CONNECTOR', run: () => decision(plan({ stations: one(connector({ status: 'OCCUPIED' })) })) },
  { id: 'FS-09', design: 'D8 true: target above capacity', trace: 'D8', input: 'onward 241 km', expected: 'EXCLUDED DESTINATION_UNREACHABLE', run: () => decision(plan({ routes: [route('s1', {}, 20, 241)] })) },
  { id: 'FS-10', design: 'D9 true: manual target too low', trace: 'D9', input: 'manualTargetSoc=50', expected: 'EXCLUDED MANUAL_TARGET_TOO_LOW', run: () => decision(plan({ input: { manualTargetSoc: 50 } })) },
  { id: 'FS-11', design: 'D10 true: no charging required', trace: 'D10', input: 'onward 50 km; target 22 kWh, arrival 26 kWh', expected: 'EXCLUDED NO_CHARGING_REQUIRED', run: () => decision(plan({ routes: [route('s1', {}, 20, 50)] })) },
  { id: 'FS-12', design: 'D11 second iteration: two feasible connectors', trace: 'D11', input: 'connectors 10 kW and 100 kW', expected: 'connector=fast', run: () => `connector=${plan({ stations: one(connector({ id: 'slow', powerKw: 10 }), connector({ id: 'fast', powerKw: 100 })) }).recommendations[0].connectorId}` },
  { id: 'FS-13', design: 'D12 true: AC connector uses AC limit', trace: 'D12', input: 'AC 22 kW; vehicle AC 7 kW', expected: 'powerKw=7', run: () => `powerKw=${plan({ stations: one(connector({ powerType: 'AC', powerKw: 22 })) }).recommendations[0].powerKw}` },
  { id: 'FS-14', design: 'D13 true: invalid connector power', trace: 'D13, D26', input: 'powerKw=0', expected: 'EXCLUDED INVALID_CONNECTOR_POWER', run: () => decision(plan({ stations: one(connector({ powerKw: 0 })) })) },
  { id: 'FS-15', design: 'D14 true: below minimum power', trace: 'D14, D25', input: 'minChargerKw=60', expected: 'EXCLUDED BELOW_MINIMUM_POWER', run: () => decision(plan({ profile: { minChargerKw: 60 } })) },
  { id: 'FS-16', design: 'D15 true: charging time over limit', trace: 'D15, D24', input: 'maxChargingMinutes=7', expected: 'EXCLUDED DWELL_LIMIT', run: () => decision(plan({ input: { maxChargingMinutes: 7 } })) },
  { id: 'FS-17', design: 'D16 true: opening hours missing', trace: 'D16', input: 'openingHours=null', expected: 'assumedOpen=true', run: () => `assumedOpen=${hasWarning(plan({ stations: hours(null) }), 'assumed open all day')}` },
  { id: 'FS-18', design: 'D17 true: closed during charging', trace: 'D17, D23', input: 'openingHours=09:00-17:00', expected: 'EXCLUDED CLOSED_DURING_CHARGING', run: () => decision(plan({ stations: hours('09:00-17:00') })) },
  { id: 'FS-19', design: 'D18 true: free price type', trace: 'D18', input: 'priceType=free', expected: 'freeWarning=true', run: () => `freeWarning=${hasWarning(plan({ stations: one(connector({ price: null, priceType: 'free' })) }), 'Free pricing is unsupported')}` },
  { id: 'FS-20', design: 'D19 true: unsupported price type', trace: 'D19', input: 'priceType=unknown', expected: 'unsupportedWarning=true', run: () => `unsupportedWarning=${hasWarning(plan({ stations: one(connector({ price: null, priceType: 'unknown' })) }), 'price type or unit price')}` },
  { id: 'FS-21', design: 'D20 true: invalid unit price', trace: 'D20', input: 'priceType=kWh; price=null', expected: 'invalidWarning=true', run: () => `invalidWarning=${hasWarning(plan({ stations: one(connector({ price: null })) }), 'unit price is invalid')}` },
  { id: 'FS-22', design: 'D21 true: target above 80%', trace: 'D21', input: 'manualTargetSoc=85', expected: 'taperWarning=true', run: () => `taperWarning=${hasWarning(plan({ input: { manualTargetSoc: 85 } }), 'above 80%')}` },
  { id: 'FS-23', design: 'D22 true after a rejected connector', trace: 'D22', input: 'connectors 0.5 kW and 100 kW', expected: 'connector=good', run: () => `connector=${plan({ stations: one(connector({ id: 'weak', powerKw: 0.5 }), connector({ id: 'good' })) }).recommendations[0].connectorId}` },
  { id: 'FS-24', design: 'D23 true while low power also seen', trace: 'D23', input: '09:00-17:00; connectors 100 kW and 0.5 kW', expected: 'EXCLUDED CLOSED_DURING_CHARGING', run: () => decision(plan({ stations: [station('s1', [connector({ id: 'ok' }), connector({ id: 'weak', powerKw: 0.5 })], { openingHours: '09:00-17:00' })] })) },
  { id: 'FS-25', design: 'D24 true while low power also seen', trace: 'D24', input: 'minChargerKw=6; connectors 6 kW and 5 kW', expected: 'EXCLUDED DWELL_LIMIT', run: () => decision(plan({ profile: { minChargerKw: 6 }, stations: one(connector({ id: 'dwell', powerKw: 6 }), connector({ id: 'weak', powerKw: 5 })) })) },
  { id: 'FS-26', design: 'D25 true while invalid power also seen', trace: 'D25', input: 'connectors 0.5 kW and 0 kW', expected: 'EXCLUDED BELOW_MINIMUM_POWER', run: () => decision(plan({ stations: one(connector({ id: 'weak', powerKw: 0.5 }), connector({ id: 'bad', powerKw: 0 })) })) },
];

const calculatePlanCases: LabCase[] = [
  { id: 'CP-01', design: 'Baseline: fresh LIVE, one feasible station', trace: 'Baseline', input: 'Baseline fixture', expected: 'state=LIVE recs=1 summary=1 ranked charger option remain after feasibility and fault checks.', run: () => { const result = plan(); return `state=${result.snapshot.state} recs=${result.recommendations.length} summary=${result.summary}`; } },
  { id: 'CP-02', design: 'P1 true: unusable direct route', trace: 'P1', input: 'directRoute.distanceKm=-1', expected: 'ERROR RangeError', run: () => decision(plan({ directRoute: { distanceKm: -1, durationMinutes: 90 } })) },
  { id: 'CP-03', design: 'P2 true: invalid calculation time', trace: 'P2', input: 'now=not-a-time', expected: 'ERROR RangeError', run: () => decision(plan({ now: 'not-a-time' })) },
  { id: 'CP-04', design: 'P3 true: stale snapshot', trace: 'P3', input: 'observedAt=11:40', expected: 'state=STALE warning=true', run: () => { const result = plan({ observedAt: '2026-10-15T11:40:00+08:00' }); return `state=${result.snapshot.state} warning=${hasWarning(result, 'at least 10 minutes')}`; } },
  { id: 'CP-05', design: 'P4 true: unparseable observation time', trace: 'P4', input: 'observedAt=not-a-time', expected: 'warning=true', run: () => `warning=${hasWarning(plan({ observedAt: 'not-a-time' }), 'freshness could not be checked')}` },
  { id: 'CP-06', design: 'P5 true: observation in the future', trace: 'P5', input: 'observedAt=12:05', expected: 'warning=true', run: () => `warning=${hasWarning(plan({ observedAt: '2026-10-15T12:05:00+08:00' }), 'in the future')}` },
  { id: 'CP-07', design: 'P6 true: unparseable retrieval time', trace: 'P6', input: 'retrievedAt=not-a-time', expected: 'warning=true', run: () => `warning=${hasWarning(plan({ retrievedAt: 'not-a-time' }), 'retrieval time could not be parsed')}` },
  { id: 'CP-08', design: 'P7 true: calculation time without offset', trace: 'P7', input: 'now=2026-10-15T12:00:00', expected: 'warning=true', run: () => `warning=${hasWarning(plan({ now: '2026-10-15T12:00:00' }), 'Calculation time has no time-zone offset')}` },
  { id: 'CP-09', design: 'P8 true: Demo Fixture snapshot', trace: 'P8', input: 'state=DEMO_FIXTURE', expected: 'state=DEMO_FIXTURE warning=true', run: () => { const result = plan({ state: 'DEMO_FIXTURE' }); return `state=${result.snapshot.state} warning=${hasWarning(result, 'synthetic example data')}`; } },
  { id: 'CP-10', design: 'P9 zero iterations: empty station list', trace: 'P9', input: 'stations=[]', expected: 'NO_OPTIONS', run: () => decision(plan({ stations: [], routes: [] })) },
  { id: 'CP-11', design: 'P11 zero iterations: every station excluded', trace: 'P11, P15', input: 'one station, connector OCCUPIED', expected: 'summary=No eligible charging option remains; review the exclusions or change the plan inputs.', run: () => `summary=${plan({ stations: [station('s1', [connector({ status: 'OCCUPIED' })])] }).summary}` },
  { id: 'CP-12', design: 'P10 true with a ranked candidate', trace: 'P10', input: 'one excluded and one feasible station', expected: 'recs=s2 excluded=NO_AVAILABLE_CONNECTOR', run: () => { const result = plan({ stations: [station('s1', [connector({ status: 'OCCUPIED' })]), station('s2')] }); return `recs=${result.recommendations.map((item) => item.stationId).join(',')} excluded=${result.excluded.map((item) => item.code).join(',')}`; } },
  { id: 'CP-13', design: 'P12 false: second connector of a station', trace: 'P12', input: 'one station, two feasible connectors', expected: 'recs=1 connector=c2', run: () => { const result = plan({ stations: [station('s1', [connector({ id: 'c1', powerKw: 10 }), connector({ id: 'c2' })])] }); return `recs=${result.recommendations.length} connector=${result.recommendations[0].connectorId}`; } },
  { id: 'CP-15', design: 'P13 entered: fault removes one of two stations', trace: 'P13', input: 'active fault on s1; s1 and s2 feasible', expected: 'RECOMMENDED s2', run: () => decision(plan({ stations: [station('s1'), station('s2')], faults: [{ stationId: 's1', reportId: 'r1', expiresAt: '2026-10-16T12:00:00+08:00' }] })) },
  { id: 'CP-16', design: 'P15 false: fault removes the only station', trace: 'P15', input: 'active fault on s1; only station', expected: 'EXCLUDED ACTIVE_FAULT_MARK', run: () => decision(plan({ faults: [{ stationId: 's1', reportId: 'r1', expiresAt: '2026-10-16T12:00:00+08:00' }] })) },
  { id: 'CP-17', design: 'P16 true, P17 true: enough charge, options remain', trace: 'P16, P17', input: 'direct 50 km', expected: 'summary=Current charge is sufficient to reach the destination with reserve; charger options are optional.', run: () => `summary=${plan({ directRoute: { distanceKm: 50, durationMinutes: 90 } }).summary}` },
  { id: 'CP-18', design: 'P16 true, P17 false: enough charge, no options', trace: 'P17', input: 'direct 50 km; stations=[]', expected: 'summary=Current charge is sufficient to reach the destination with reserve; no charger stop is needed.', run: () => `summary=${plan({ directRoute: { distanceKm: 50, durationMinutes: 90 }, stations: [], routes: [] }).summary}` },
];

defineCases('basis-failureForStation', failureForStationCases);
defineCases('basis-calculatePlan', calculatePlanCases);
