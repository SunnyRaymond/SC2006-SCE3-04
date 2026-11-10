# Calculation fixture and branch-coverage evidence

## Status and limits

The source requirements are NFR-04 and NFR-10 in [`Lab 1/source/build_srs.py`](../../Lab%201/source/build_srs.py). The values below are a fixed implementation regression set prepared for team review. They have not yet been recorded as team-approved acceptance fixtures, and this document is not evidence of testing with five real users or approval by an external assessor. NFR-04 acceptance therefore remains pending fixture approval.

NFR-04 calls for 100% correct feasibility decisions and numerical error no greater than ±0.1 SOC percentage point, ±0.1 kWh, ±1 minute, and ±S$0.01 across approved fixtures. NFR-10 calls for 100 consecutive successful fixture-based recommendation journeys and at least 80% branch coverage in each of the energy, feasibility, cost, and ranking modules. This report measures the calculation-test evidence only.

This evidence covers the pure calculation tests in `tests/domain.engine.test.ts`. The NFR-10 repeat check invokes `calculatePlan` with fixed synthetic data; it does not exercise the API journey, persistence, compare/select/refresh/reconfigure flows, or live providers. It cannot satisfy the full journey acceptance gate in `docs/acceptance.md`.

## Shared hand-calculation fixture

Unless a case states an override, the `calculate()` helper in `tests/domain.engine.test.ts` fixes the following synthetic baseline:

| Input | Value |
|---|---:|
| Usable battery capacity | 60 kWh |
| Consumption | 20 kWh/100 km |
| Current SOC / reserve SOC | 50% / 20% |
| Vehicle DC limit / minimum charger power | 50 kW / 1 kW |
| Station connector | CCS2, DC, 100 kW, S$0.30/kWh, available |
| Route to station | 20 km, 30 min |
| Route from station to destination | 100 km, 60 min |
| Direct route | 200 km, 90 min |
| Opening hours | 24/7 |
| Departure / calculation time | 20:00 / 12:00 SGT, 15 Oct 2026 |

The values are marked `DEMO_FIXTURE`; none describes a live Singapore station or route. The independent hand calculation is:

| Result | Calculation | Hand-calculated value |
|---|---|---:|
| Battery energy on arrival | 60 × 0.50 − 20 × 20/100 | 26 kWh |
| Arrival SOC | 26/60 × 100 | 43.33333333% |
| Automatic target energy | 100 × 20/100 + 60 × 0.20 | 32 kWh |
| Automatic target SOC | 32/60 × 100 | 53.33333333% |
| Required battery energy | 32 − 26 | 6 kWh |
| Required charger/grid energy | 6/0.90 | 6.66666667 kWh |
| Effective charging power | min(100, 50) | 50 kW |
| Charging time | (6.66666667/50) × 60 | 8 min |
| Estimated cost | 6.66666667 × S$0.30 | S$2.00 |
| Extra drive time | max(0, 30 + 60 − 90) | 0 min |
| Total journey time | 30 + 60 + 8 | 98 min |

The 26 kWh arrival energy and 32 kWh target energy are hand-calculated intermediates, not fields in `PlanResult`; the test checks their derived arrival/target SOC and required-energy outputs. Those returned decimal values use `toBeCloseTo(expected, 8)`, stricter than the SRS bands. It checks 50 kW, 0 min detour, and `noChargeNeeded=false` exactly. The SRS bands remain absolute error ≤0.1 SOC percentage point, ≤0.1 kWh, ≤1 minute, and ≤S$0.01. Feasibility and exclusion codes are exact categorical expectations, not rounded values.

## Fixed regression-case inventory

The current engine suite has 22 Vitest tests. Some tests contain multiple variants; the denominator below is the runner's test-case count, not the number of `expect` calls. The following are the input differences and required results encoded in that set:

| Test case | Frozen input variation | Expected result |
|---|---|---|
| Independent numeric oracle | Shared baseline above | All nine returned numeric metrics in the hand-calculation table; one eligible recommendation and `noChargeNeeded=false`. |
| Arrival-energy boundary | To-station leg 150 km; compare SOC 50% and 49.9% | At 50%, arrival battery is exactly 0 kWh and remains reachable; at 49.9%, arrival is −0.06 kWh and exclusion is `UNREACHABLE`. |
| Destination-energy increment | From-station leg 100 km versus 100.5 km | Destination energy rises from 20.0 to 20.1 kWh; required battery charge rises from 6.0 by exactly 0.1 kWh. |
| Efficiency, vehicle limit, and supported price | Connector 100 kW; DC vehicle limit 50 kW; compare S$0.80/hour and S$0.31/kWh | Effective power 50 kW; the 6 kWh battery charge needs 6.66666667 kWh from the charger and 8 min; hourly price is S$0.10666667 and S$0.31/kWh cost is S$2.06666667. |
| Unsupported or missing price | `free`/`unknown` with null price, `unknown` with S$0.30, and `kWh` with null price | Estimated cost and unit price remain null; the result discloses unsupported or invalid pricing instead of reporting zero. |
| Destination and manual-target feasibility | Destination leg 241 km; then manual target 50% against the automatic target | 48.2 kWh destination energy plus 12 kWh reserve exceeds the 60 kWh battery (60.2 kWh): `DESTINATION_UNREACHABLE`. A 50% manual target is below 53.3333%: `MANUAL_TARGET_TOO_LOW`. |
| High manual target | Manual target 85% | Candidate stays feasible, target remains 85%, and the above-80% taper warning is present. |
| Dwell, power, walking, and plug constraints | Maximum charge 7 min; minimum charger 60 kW; walking limit 50 m; unsupported CHAdeMO-only station | Expected exclusions are `DWELL_LIMIT`, `BELOW_MINIMUM_POWER`, `WALKING_LIMIT`, and `NO_COMPATIBLE_CONNECTOR`. |
| Connector statuses | Compatible connectors are occupied and unavailable | No recommendation; `NO_AVAILABLE_CONNECTOR` explains one occupied and one unavailable connector. |
| Plug aliases | Profile `Combo 2` with station `CCS2`; profile `Type 2` with station `Type2` | Both match; recommendation preserves the connector's original display label. |
| Walking data | `maxWalkingM=0`, then positive limit with no walking estimate | Zero means no hard limit; positive limit with missing distance is excluded as `WALKING_UNVERIFIED`. |
| Opening windows | 09:00–17:00 at 20:30 arrival; overnight 20:00–06:00 with 00:00 arrival; malformed text | Daytime-closed candidate is excluded; overnight candidate is retained; malformed window is treated as assumed open and disclosed. |
| Offset-free departure | `2026-10-15T20:00:00` with 20:00–21:00 hours | Time is interpreted in Asia/Singapore and that assumption is disclosed. |
| Ranking strategies and ties | Four fixed stations A–D with different route times, costs, availability, and detours | Fastest, Availability, Detour, and Balanced top choice is C; Cheapest top choice is B; unknown-price D follows known-price options; equal candidates sort by ID (`a`, then `z`). |
| One connector per station / shortlist | One station with 10 and 100 kW connectors plus three other stations | Faster connector selected for that station; at most three stations returned with ranks 1–3. |
| Fault filtering | Active fault on faster station; expired fault on fallback; unrelated active fault | Active station removed after ranking; fallback is rank 1; only relevant active evidence is returned with the fixed check time. |
| Zero/one recommendation and no-stop case | Direct route 50 km/45 min; separately one station or empty station list | Direct travel leaves 20 kWh, above the 12 kWh reserve, so `noChargeNeeded=true`; result supports one or zero options without claiming a required stop. |
| Freshness boundary | Observation at 11:50:01 then 11:50, with calculation at 12:00 | 9:59 stays fresh; 10:00 is `STALE`; DEMO_FIXTURE label remains intact. |
| Missing or assumed hours | Missing hours; assumed 09:00–17:00 hours | Missing hours assume all-day access with a warning; explicit assumed hours are still checked and the 20:30 arrival is excluded. |
| Static DEMO fixture branches | Fixed six-plus-station `DEMO_*` data | Synthetic source is retained and the fixture yields the expected incompatible, unreachable, closed, dwell, unavailable, and active-fault exclusions plus an unknown-price recommendation. |
| Determinism | Fixed `DEMO_*` values and fixed `now` | One reference calculation plus 100 repeat calculations serialize identically (101 pure-engine calls total). |
| Dynamic DEMO scenario | 60 kWh, 17.5 kWh/100 km, SOC 18%, reserve 20%, 45 min charge, 15 min detour, unlimited walking | Synthetic direct route is 30 km/30 min; three options have distinct powers and prices. At 100% SOC the test asserts `noChargeNeeded=true`. |

## NFR-10 calculation branch report

The current code keeps several responsibilities in `src/lib/domain/engine.ts`: `failureForStation` contains both energy arithmetic and feasibility gates, while cost and ranking have their own functions. These are **logical line-range partitions**, not separate compiled modules. Each branch path is counted once by the `branchMap` line in `coverage/coverage-final.json`; a path counts covered when its corresponding counter in `b[branchId]` is greater than zero. Natural helpers are included with the calculation they support. Vitest currently enforces only its configured aggregate 80% branch threshold; these per-module calculations are an explicit report, not an automated per-module gate.

| Logical module | Included functions / line ranges in `engine.ts` | Branches hit / denominator | Coverage |
|---|---|---:|---:|
| Energy | `failureForStation` 189–196, 222–228, 233–238, and target taper warning 280; `calculatePlan` 344–348 | 10/10 | 100.00% |
| Feasibility | Time/opening/route/plug/warning helpers 20–77 and 142–166; `failureForStation` 175–188, 197–220, 229–231, 240–273, 318–324; `calculatePlan` validation/routing/summary 337–343, 361–368, 402–408 | 115/133 | 86.47% |
| Cost | `estimateCost` 168–173; price warnings 277–279 and unit-price output 303 | 21/21 | 100.00% |
| Ranking | `knownCost`, `minMax`, `assignScores`, `compareCandidates`, `strategyExplanation` 79–140; ranked connector/station/fault/shortlist flow 370–400 | 64/75 | 85.33% |

The freshness implementation at lines 349–359 is kept out of these four denominators because it belongs to NFR-03. It has 18/23 branch paths covered in this run; the 9:59/10:00 boundary itself is tested. The four NFR-10 calculation partitions total 210/239 covered branches, and each separately exceeds 80%. The engine file is 228/262 (87.02%). The engine-only test command below also covers validation branches, yielding 242/278 (87.05%) across the domain; the final complete 41-test suite covers one additional validation path, yielding 243/278 (87.41%). Do not use the all-domain percentage as a substitute for the four rows above.

To reproduce the run and emit the JSON branch map, from `PlugPlan SG/` run:

```powershell
npm run test:coverage -- tests/domain.engine.test.ts
```

The Vitest reporter writes `coverage/coverage-final.json`. Use the same current source line ranges in the table to recalculate each module; the following PowerShell fragment does so:

```powershell
$report = Get-Content -Raw coverage\coverage-final.json | ConvertFrom-Json
$engine = $report.PSObject.Properties | Where-Object Name -Like '*\src\lib\domain\engine.ts' | Select-Object -First 1 -ExpandProperty Value
$groups = @{
  Energy = @(189..196 + 222..228 + 233..238 + 280 + 344..348)
  Feasibility = @(20..77 + 142..166 + 175..188 + 197..220 + 229..231 + 240..273 + 318..324 + 337..343 + 361..368 + 402..408)
  Cost = @(168..173 + 277..279 + 303)
  Ranking = @(79..140 + 370..400)
}
foreach ($name in 'Energy', 'Feasibility', 'Cost', 'Ranking') {
  $hit = 0; $total = 0
  foreach ($branch in $engine.branchMap.PSObject.Properties) {
    if ($groups[$name] -contains $branch.Value.line) {
      foreach ($count in @($engine.b.($branch.Name))) {
        $total++; if ($count -gt 0) { $hit++ }
      }
    }
  }
  '{0}: {1}/{2} ({3:N2}%)' -f $name, $hit, $total, (100 * $hit / $total)
}
```

**Recorded result (2026-10-15):** `tests/domain.engine.test.ts` passed 22/22 tests. The test containing the 100 repeats passed; this is deterministic pure-engine evidence only, not a pass of the 100-journey API acceptance. The per-module line mapping is reviewable and all four calculated partitions meet 80%; the team should review and approve these boundaries together with the candidate fixtures before marking NFR-04/10 accepted.
