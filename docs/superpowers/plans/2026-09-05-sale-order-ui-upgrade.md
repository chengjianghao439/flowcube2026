# Sales Order UI Upgrade Implementation Plan

> **For agentic workers:** Execute this plan inline in the current `codex/internal-ui-redesign` branch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the approved sales-order list visual language across sales order creation, editing, adjustment, detail views, and supporting dialogs without changing business behavior.

**Architecture:** Keep all existing hooks, mutations, URL parameters, permission checks, and state transitions. Add narrow presentational components for the order summary and detail overview, then compose the existing form and dialog logic around them. Use existing system theme tokens and responsive Tailwind layouts.

**Tech Stack:** React, TypeScript, Tailwind CSS, Radix UI, React Query, existing Flowcube shared components.

---

### Task 1: Form information hierarchy

**Files:**
- Create: `frontend/src/pages/sale/form/components/SaleOrderSummaryCard.tsx`
- Modify: `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx`
- Modify: `frontend/src/pages/sale/form/components/SaleOrderItemsTable.tsx`
- Modify: `frontend/src/pages/sale/form/index.tsx`

- [x] Build a reusable order summary using existing totals, discount state, item counts, and below-cost warning.
- [x] Group customer, fulfillment, delivery, and remark fields with responsive layouts.
- [x] Apply the summary layout consistently to create, draft edit, and execution adjustment modes.
- [x] Preserve every existing validation, finder, and mutation callback.

### Task 2: Detail hierarchy and fulfillment

**Files:**
- Create: `frontend/src/pages/sale/form/components/SaleOrderOverview.tsx`
- Modify: `frontend/src/pages/sale/form/components/FulfillmentProgressCard.tsx`
- Modify: `frontend/src/pages/sale/form/index.tsx`

- [x] Add a compact overview row for customer, warehouse, amount, item count, and receivable state.
- [x] Refine detail tabs and information blocks using system theme tokens.
- [x] Make fulfillment progress responsive and remove hard-coded light-theme colors.
- [x] Preserve order actions and all detail table data.

### Task 3: Supporting dialogs

**Files:**
- Modify: `frontend/src/pages/sale/SaleQueryDialog.tsx`
- Modify: `frontend/src/pages/sale/components/AddressBookDialog.tsx`
- Modify: `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx`
- Modify: `frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx`
- Modify: `frontend/src/pages/sale/components/ShipSelectDialog.tsx`
- Modify: `frontend/src/pages/sale/components/StockShortageDialog.tsx`

- [x] Standardize dialog descriptions, section spacing, table surfaces, empty states, and footer hierarchy.
- [x] Keep selection, quantity, submit, and close behavior unchanged.

### Task 4: Documentation and verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/internal-ui-redesign-2026-09-05.md`

- [x] Synchronize the current sales order UI rules.
- [x] Run focused ESLint and TypeScript checks.
- [x] Run existing frontend unit tests and a production build.
- [x] Inspect list, create, detail, and at least one dialog in the authenticated local browser at desktop and narrow widths.
