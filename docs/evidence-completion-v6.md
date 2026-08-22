# Evidence Completion v6

## Workflow

`Field evidence → tender/quality research → comparative intelligence → living case graph → cross-case graph → unresolved evidence gaps → department-wise RTI drafts → records returned → graph re-ingestion → re-analysis`

## Cross-case intelligence

Every case has stable entity IDs for important objects such as locations, tenders, works, contractors, complaints, audits and court references. The cross-case graph merges case graphs and links cases when stable non-source entities overlap.

A match is an investigative lead. It is not proof that two works, people or events are legally the same.

## Evidence completion

`POST /api/case/:id/complete-evidence-plan` ensures comparative research exists, rebuilds the cross-case graph, identifies unresolved evidence needs, generates department-wise RTI drafts and creates a consolidated RTI PDF.

The result is also persisted in the case JSON under `crossCase`, `rti` and `reports`.

## RTI drafting rules

The generator asks for existing records: certified copies, file references, inspection, measurement and test records, payment records, correspondence and action-taken records. It avoids presenting allegations as facts and avoids relying on an AI model to invent the identity of a PIO.

For Rajasthan, the default fee profile follows the published Rajasthan RTI rules as a configurable profile; current SPIO/PIO identity, address, filing route and fee/payment method must be verified from the relevant authority before submission.

## Important evidence discipline

- A graph match is a lead, not a finding.
- Multiple model agreement is not documentary proof.
- Comparable complaints/cases do not establish the current case by analogy.
- RTI requests should be targeted to the public authority likely to hold the requested record.
- Every RTI response should be ingested back into the case and cross-case graph.
