# Desktop Icons and Density Implementation Plan

> **For agentic workers:** Execute inline in this session. The user explicitly authorized continuous autonomous iterations; do not interrupt for execution choices. Preserve the existing dirty workspace and do not commit, push or deploy.

**Goal:** Improve desktop icon consistency, keyboard explanations, dashboard density and form reading while preserving business behavior and PDA.

**Architecture:** Retain Lucide with desktop-scoped stroke and size rules. Add an accessible icon-button wrapper using Radix Tooltip, used only for bounded dashboard controls; high-volume table rows keep their existing lazy menus. Let list widgets size to content within a scrolling limit in both display and editor modes. Shared limited fields receive styling hooks; desktop CSS controls disclosure without changing value, maxLength, focus events or PDA defaults.

**Tech Stack:** Existing React/TypeScript, Lucide, Radix primitives, Tailwind; @radix-ui/react-tooltip pinned to 1.2.8.

## Task 1 — Icon buttons

Files: create `frontend/src/components/shared/IconButton.tsx` and `.test.tsx`; modify dashboard toolbar and edit controls, `GlobalSearch.tsx`, and ERP stylesheet.

- [x] Add a failing regression for accessible label, one click, disabled state, focus/escape tooltip behavior and hidden-workspace cleanup.
- [x] Build `IconButton` with required `label` and Lucide `icon`, forwarded button props/ref, `type="button"`, Radix portal and section visibility gating. Use 16px/1.75 stroke, delay 400ms, no tooltip on disabled controls; preserve existing action eligibility and callback.
- [x] Replace handcrafted search/arrow SVG with Lucide Search/ArrowRight; retain existing search requests, keyboard and selection behavior.
- [x] Use the new wrapper on dashboard resize/hide controls with specific names, leaving drag target behavior intact.
- [x] Run `npx vitest run src/components/shared/IconButton.test.tsx src/pages/dashboard/index.test.tsx` under Node22 and record results outside the repository.

## Task 2 — Content density

Files: dashboard renderer, `WidgetShell.tsx`, `StatTile.tsx`, `desktop-page-samples.css`, `LimitedInput.tsx`, `LimitedTextarea.tsx`, and sale header fields.

- [x] Give list wrappers a stable sizing hook and content-sized shell with a bounded scroll body. Keep chart sizes and saved width/order/visibility.
- [x] Quiet ordinary dashboard icon backplates and standardize stroke; preserve warning/error/accent semantics and exact metrics.
- [x] Add limited-field/counter hooks and near-limit attributes; show counters in ERP on focus or near limit, retain previous PDA display and limits.
- [x] Correct address icon semantics; preserve labels, IDs, address-book and submission behavior.
- [x] Review the actual full-width and 1024px pages, long values, empty/loaded states, keyboard tools and both dashboard modes. Iterate on observed issues.

## Task 3 — Verification and cleanup

- [x] Review exact diffs, lockfile changes and scope; confirm backend/PDA business paths unchanged.
- [x] Run frontend unit suite, lint, `tsc -p tsconfig.app.json --noEmit`, ERP build to `/tmp/flowcube-desktop-samples-preview/icons-final-dist`, frontend conventions and documentation guard once for the final batch.
- [x] Update `docs/frontend-pda-conventions.md` and `docs/desktop-ui-review-2026-10-24.md` with actual evidence and limitations.
- [x] Restore temporary fixtures and viewport, close only the task QA tab, retain one user-facing preview and existing workspace tabs.

## Additional iteration from live review

- [x] Move dashboard edit tools into a dedicated 36px toolbar after observing overlap with titles and KPI icons; preserve card content size.
- [x] Extend content sizing from the workbench to all 12 list widgets after observing excess empty space in Top Customer and Incoming boards; preserve all saved layout fields.
- [x] Integrate the notification entry with IconButton, retain its badge and Popover trigger composition, and validate Escape focus return.
- [x] Reproduce nested finder focus on the close button (two failing cases), then focus search in Radix onOpenAutoFocus for both record and product finders. Keep paused-read and return-focus guards.
