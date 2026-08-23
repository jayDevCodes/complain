# Deep Research Pipeline

The investigation now performs tender-driven iterative research before final synthesis.

## Tender anchors
The deep research engine recursively uses available tender fields such as tender ID, NIT/notice, bid number, work name, department/division, estimate/cost/value, contractor/agency, award/LOA, work order, agreement, BOQ, specifications, dates, EMD/security, measurements, inspections, tests, bills/payments, complaints, inquiries, audits and court identifiers as search anchors.

## Research rounds
Each round searches multiple evidence tracks, verifies candidate URLs, records HTTP status/content metadata/hash where retrievable, extracts newly discovered identifiers, and uses those identifiers in subsequent rounds. A dedicated contradiction pass searches for evidence that could disprove an apparent finding.

## Artifacts
- `<case>.evidence-ledger.json` — claim/evidence/source status registry.
- `FINAL-MASTER-DOSSIER-<case>-v<version>.pdf` — consolidated final report after comparative intelligence, cross-case analysis and RTI evidence completion.
- `/app/reports.html?case_id=<case>` — frontend report vault.

## Controls
Use `backend/.env.example` to configure research rounds, query count, result count and source fetch limits. Longer research increases coverage and cost/time; it does not automatically make a claim true.
