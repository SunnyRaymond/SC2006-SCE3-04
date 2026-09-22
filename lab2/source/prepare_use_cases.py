"""Carry the Lab1 baseline forward and apply the agreed moderation refinement."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
tree = ast.parse((ROOT / 'Lab 1/source/build_srs.py').read_text(encoding='utf-8'))
baseline = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'use_cases' for t in n.targets))
cases = {u['id']: u for u in baseline}
for cid in ['UC-03', 'UC-06']:
    cases[cid]['actor'] = 'Driver; supporting actors: OneMap and LTA DataMall'
cases['UC-02']['assumptions'] = 'The MVP permits at most one EV Profile per Driver; a valid profile is required before planning. Zero profiles is the state before creation or after deletion.'
cases['UC-03']['flow'][5] = 'After the algorithm generates ranked suggestions, the system removes stations with an active Moderator faulty mark, takes up to three surviving recommendations, and stores and displays the Plan Version with explanations, timestamps, and data-state labels.'
cases['UC-03']['alts'] += ['UC-03.AC.4 - If filtering leaves one option, show that option and disable comparison; if none remain, explain that no eligible option remains. Fill a shortlist from the next-ranked unmarked candidates when available.']
cases['UC-03']['trace'] += '; FR-24 refinement'
cases['UC-04']['pre'] = ['The Driver is authenticated and owns the displayed plan.', 'A Plan Version exists; at least two eligible recommendations are required for the comparison branch.']
cases['UC-04']['alts'][0] = 'UC-04.AC.1 - The Driver changes the fixed ranking strategy through UC-05; a new Plan Version explains the changed order.'
cases['UC-05']['pre'].append('The Driver is authenticated and owns the plan.')
cases['UC-05']['flow'][4] = 'The system repeats feasibility and ranking using the new values, then filters stations with active Moderator faulty marks before forming the new shortlist.'
cases['UC-05']['trace'] += '; FR-24 refinement'
cases['UC-06']['pre'].append('The saved plan belongs to the authenticated Driver.')
cases['UC-06']['flow'][2] = 'The system recalculates feasibility and ranking using existing inputs, then filters stations with active Moderator faulty marks before forming the refreshed shortlist.'
cases['UC-06']['flow'][4] = 'If the selected connector is unsuitable or its station is marked faulty, the system explains the change and identifies the next-ranked feasible, unmarked option.'
cases['UC-06']['trace'] += '; FR-24 refinement'
cases['UC-07']['post'] += ['The report is available in the Moderator review workspace; the Driver receives a Pending acknowledgement. Submission alone does not exclude a station.']
cases['UC-07']['special'] += ' Moderator-confirmed faulty status is made useful to other Drivers by excluding that station after suggestion generation and before display, through UC-03, UC-05 and UC-06. No new public report feed is required.'
cases['UC-08']['post'] += ['A verified fault can mark its station faulty; the mark is used by subsequent generation, recalculation and manual refresh.']
cases['UC-08']['flow'][5] = 'The system records the actor, action, reason, timestamp and resulting status; verification of a fault activates the station faulty mark, while resolution or expiry removes that report as support for the mark.'
cases['UC-08']['assumptions'] += ' A non-fault report does not create a faulty mark. A station stays marked while at least one verified, unexpired fault report supports it; a merge preserves the valid target report and does not create duplicate support. Pending, rejected, resolved and expired reports do not cause exclusion.'
cases['UC-08']['trace'] += '; FR-24 refinement'
(ROOT / 'lab2/source/use_cases.json').write_text(json.dumps(list(cases.values()), indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
