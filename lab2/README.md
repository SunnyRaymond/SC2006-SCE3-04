# PlugPlan SG Lab 2

SC2006 Team SCE3-04. This folder follows the literal `lab2` submission location in the Lab 2 Manual. Deliverables are in English.

## Submission files

| Manual requirement | File |
|---|---|
| Complete Use Case diagram and all eight Use Case descriptions | `Deliverables.docx` and reading copy `Deliverables.pdf` |
| Entity class diagram and key boundary/control classes | Class diagrams in `Deliverables`, editable copies in `diagrams/` |
| Initial Dialog Map | Dialog maps in `Deliverables`, editable copies in `diagrams/` |
| Short PDF report on AI technology stack recommendation | `AI-Critique-Report.pdf`; editable `AI-Critique-Report.docx` |

`diagrams/manifest.json` lists the diagrams and their order. Native `.drawio` files and PNG exports are supplied. `source/` contains the source text and document builders. `ai-evidence/` retains the exact prompt, original independent AI response and selected technology opinion.

## Lab 1 continuity

Lab 1 files have not been rewritten. All original requirements continue to apply except the agreed FR-24 / UC-07 refinement: after the algorithm produces ranked charging-station suggestions, filter stations actively marked faulty by a Moderator before displaying the shortlist. Apply the same rule to generation, reconfiguration and manual refresh/fallback. Pending reports alone do not exclude stations.

The lifecycle interpretation reuses existing verification, resolution and expiry states. A station remains marked while any verified, unexpired fault report supports its mark. Historical Plan Versions retain the evidence used when generated. The model does not add public report feeds, automatic refresh, reservations, payment or charger control.

## Reading order

1. Use the opening page index in `Deliverables` to locate each required item.
2. Review UC-01 to UC-08 against the complete diagram.
3. Follow the entity relationships, boundary/control responsibilities and UI state transitions.
4. Read the independent AI stack recommendation and the short opinion in `AI-Critique-Report`.

The technology discussion is provisional, as permitted by Lab 2 Manual 3.4.1. Team technology experience has not been assumed. The class model and Dialog Map remain analysis models for refinement in Lab 3.

## Rebuilding

Run `source/prepare_use_cases.py`, `source/build_entities.py`, `source/build_ui_diagrams.py` and `source/build_documents.py` in that order using the Codex bundled Python runtime. Diagram export uses the installed draw.io Desktop. `source/render_documents.ps1` exports Word documents to PDF using Microsoft Word and rasterizes them for QA with the bundled Poppler runtime. Rendering is lightweight local document preparation, not a cluster compute task.

The exact AI response is retained unchanged: rerun the AI exercise if the submitted system description or conceptual entity model changes materially after that response.
