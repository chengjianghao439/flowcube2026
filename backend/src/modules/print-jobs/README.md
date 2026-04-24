# Print Jobs Domain Boundaries

This module is intentionally split by responsibility. New code should not add
business logic to `print-jobs.service.js`.

- `print-jobs.template.js`: pure built-in label content builders only. No DB, no job creation.
- `labelZplTemplate.js` / `labelTsplTemplate.js`: load configured print templates and render raw ZPL/TSPL.
- `print-jobs.command.js`: create print job records and mutate print job state (`complete`, `fail`, `retry`).
- `print-jobs.label-command.js`: label-print orchestration commands (`enqueue*LabelJob`, barcode reprint). It may read source records, choose a label format, then call `print-jobs.command`.
- `print-jobs.query.js`: read-only print job and barcode query APIs.
- `print-jobs.dispatch.js`: client claim/dispatch/expiration lifecycle.
- `print-dispatch.js`: printer routing and binding resolution.
- `print-policy.js`: pure dispatch policy scoring.
- `print-jobs.service.js`: deprecated compatibility facade for existing imports. Do not extend it with new logic.

When adding a feature, depend on the narrow module above. Keep the facade only
for compatibility while callers are gradually migrated.
