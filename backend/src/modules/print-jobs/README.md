# Print Jobs Domain Boundaries

This module is intentionally split by responsibility. New code should not add
business logic to `print-jobs.service.js`.

- `labelVariables.js`: shared read-only variables for label previews and enqueue commands; scoped latest selection and transaction-aware reads. Optional field catalog: `docs/label-optional-fields-2026-09-09.md`.
- `print-jobs.template.js`: pure built-in label content builders only. No DB, no job creation.
- `labelZplTemplate.js`: load configured templates; canvas layouts use `labelRasterService.js`, raw bodies retain `labelZpl.js` substitution.
- `labelRaster*.js`: bounded worker rendering with bundled CJK font; one 1-bit bitmap feeds PNG previews and ASCII ^GFA. `labelRasterDefaults.js` supplies fallback layouts. Legacy exported string builders remain for compatibility, not the canvas enqueue path.
- `print-jobs.command.js`: create print job records and mutate print job state (`complete`, `fail`, `retry`).
- `print-jobs.label-command.js`: label-print orchestration commands (`enqueue*LabelJob`, barcode reprint). It may read source records, choose a label format, then call `print-jobs.command`.
- `print-jobs.query.js`: read-only print job and barcode query APIs.
- `print-jobs.dispatch.js`: client claim/dispatch/expiration lifecycle.
- `print-dispatch.js`: printer routing and binding resolution.
- `print-policy.js`: pure dispatch policy scoring.
- `print-jobs.service.js`: deprecated compatibility facade for existing imports. Do not extend it with new logic.

When adding a feature, depend on the narrow module above. Keep the facade only
for compatibility while callers are gradually migrated.

## Queue contracts

- Both complete and fail require the current claim ackToken and a PRINTING CAS. Missing token is 400; stale token is 409. Older clients must update their failure payload; uncertain outcomes remain for expiry and manual confirmation, never automatic reprinting.
- Claim SELECT and UPDATE exclude expired jobs; only successful claims are returned.
- Waybills require an explicit waybill binding. Ordinary label fallback (including environment selection) stays within the target warehouse or global devices.
- copies is a numeric integer from 1 to 100 (default 1). Desktop submits all copies in one RAW batch. A template containing ^PQ cannot combine with task copies > 1; a single-copy task preserves the original template.
- Canvas labels store optional `layout.dpi` (203 or 300; absent = 203). ^PW/^LL and PNG use the same dot dimensions; ^GFA is split into fields of at most 99999 bytes. Text wraps and clips inside its box; barcodes retain quiet zones and integer module widths, rejecting invalid/undersized/out-of-paper codes.
- Only referenced variables enter the worker; long display text is bounded to 4096 characters and clipped by its box, so large unused package summaries cannot block packing. Queue depth is 16 with a 15-second deadline; errors do not fall back to incomplete printing.
- Idempotent label responses return the stored job content, including when the template has changed. Old jobs are not re-rendered. Raw template variable replacement remains a single pass, sanitizes control/command characters, and preserves barcode spaces.
- See `docs/label-raster-2026-09-11.md` for renderer, endpoint, font licensing and verification boundaries.

Run `npm run smoke:print-queue` only with the independent test environment required by AGENTS.md. Software regression and OS submission are not physical-print acceptance. See `docs/label-print-audit-2026-09-09.md` for evidence and remaining device checks.
