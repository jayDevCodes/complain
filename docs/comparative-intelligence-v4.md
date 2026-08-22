# Comparative Intelligence v4

This stage starts from an existing investigation case and performs a second-pass research program. It does not assert that a comparable case proves the current case.

## Workflow

1. Load the existing case JSON created by the first-pass investigation.
2. Build parallel research tracks:
   - similar works
   - prior complaints and allegations
   - audit/control-failure patterns
   - court or tribunal outcomes
   - contractor history leads
   - inspection/measurement failures
   - procurement loophole/control-gap patterns
   - repair, recovery, penalty and reconstruction outcomes
3. Search each track in parallel through the configured search provider.
4. Deduplicate sources and attach query-track provenance.
5. Send the structured research packet to all configured AI providers in parallel.
6. Preserve model disagreements and calculate consensus as an investigation-priority signal, not as proof.
7. Generate a comparative intelligence PDF with visual source-reference cards, finding categories and an upgrade queue.
8. Save the complete v2 intelligence layer back into the same case JSON so later runs can re-research and improve it.

## API

### Start second-pass research

`POST /api/case/:id/comparative-research`

Response includes `findings`, `signals`, `sources`, `modelReview` and `reports.comparativePdf`.

### Read current comparative report data

`GET /api/case/:id/comparative-report`

### Frontend

Open `frontend/comparative.html` after serving the frontend. Enter an investigation ID to start the second-pass workflow.

## Evidence rules

- A similar tender, complaint, audit finding or news report is a lead until linked to the current case with primary documentation.
- Prior allegations are not treated as established facts without a source that proves their status and outcome.
- A loophole/control-gap is a structural risk indicator, not proof of deliberate misuse.
- Model agreement raises follow-up priority but never converts an allegation into a fact.
- Source excerpts and URLs remain attached to every comparative finding so later review can trace provenance.

## Environment

Set at least one search provider:

- `TAVILY_API_KEY`
- `SERPER_API_KEY`

Set any desired combination of AI provider keys from `.env.example`.
