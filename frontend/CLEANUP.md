# Generated-data cleanup

Use `/app/cleanup.html` to reset runtime-generated investigation data before starting a fresh batch.

The cleanup flow:

1. Reads the current generated file count and storage size.
2. Shows the exact scope: `backend/cases/` and `backend/reports/` generated contents only.
3. Requires a browser confirmation and then the exact word `DELETE`.
4. Calls `DELETE /api/cleanup-old-data` with `{ "confirm": true }`.
5. Verifies that generated data is empty after the reset.

Source code, frontend assets, workflows, `.env` configuration and other repository files are not part of the cleanup operation.