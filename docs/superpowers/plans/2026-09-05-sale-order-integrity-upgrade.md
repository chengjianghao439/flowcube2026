# Sales Order Integrity Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复销售订单折扣、授信、仓库权限、分批发货和履约追溯缺陷，并升级 ATP、输入校验和服务端数据权威性。

## 复审补强

- [x] 禁止从仓库任务入口单独取消销售任务，整单取消统一处理多仓任务和预占。
- [x] 占库期、执行期改单后重新校验原折扣上限。
- [x] 资源写操作幂等 action 绑定销售单 ID，隔离跨订单重放。
- [x] 授信审批按客户、额度、本单净额和获批超额范围校验快照。
- [x] 销售数量限制 4 位小数，单位折算后低于 0.0001 时拒绝。

**Architecture:** 把销售请求 Schema 与纯业务计算提取为可单测模块，路由只消费统一契约；保留现有事务和状态机，在事务内补逐仓权限、净额口径和按数量派发。前端沿用现有销售页面视觉体系，统一通过专用弹窗提交危险操作。

**Tech Stack:** Node.js, Express, Zod, MySQL, React, TypeScript, React Query, Vitest/Node test.

---

### Task 1: API contracts and finance calculations

**Files:**
- Create: `backend/src/modules/sale/sale.contracts.js`
- Create: `tests/sale-order-contract.test.js`
- Modify: `backend/src/modules/sale/sale.routes.js`
- Modify: `backend/src/modules/sale/sale.service.js`
- Modify: `backend/src/utils/creditExposure.js`

- [x] Write failing tests proving discount, manual credit override, row warehouse and decimal quantities survive parsing.
- [x] Write failing tests for amount-based discount allocation and net order credit amount.
- [x] Run `node --test tests/sale-order-contract.test.js` and confirm the expected missing-contract failures.
- [x] Implement shared schemas and pure money helpers, then wire routes and receivable/credit calculations to them.
- [x] Re-run the focused test to green.

### Task 2: Server-authoritative snapshots and warehouse scope

**Files:**
- Modify: `backend/src/modules/sale/sale.service.js`
- Modify: `backend/src/modules/sale/sale.controller.js`
- Modify: `tests/sale-order-contract.test.js`
- Modify: `tests/warehouse-scope.smoke.test.js`

- [x] Add failing assertions for create scope and per-row reserve/ship scope.
- [x] Pass scope into create and validate header plus every target row warehouse.
- [x] Resolve customer, warehouse and product snapshot fields from current database rows; reject inactive/missing records during create and draft edit.
- [x] Re-run focused unit checks; leave DB smoke execution for an isolated test database.

### Task 3: Quantity-based dispatch and trace attribution

**Files:**
- Modify: `backend/src/modules/sale/sale.contracts.js`
- Modify: `backend/src/modules/sale/sale.controller.js`
- Modify: `backend/src/modules/sale/sale.service.js`
- Modify: `frontend/src/api/sale.ts`
- Modify: `frontend/src/hooks/useSale.ts`
- Modify: `frontend/src/types/sale.ts`
- Modify: `frontend/src/pages/sale/components/ShipSelectDialog.tsx`
- Modify: `frontend/src/pages/sale/form/index.tsx`

- [x] Add failing contract tests for partial quantities and over-dispatch rejection inputs.
- [x] Accept `items: [{id, qty}]` while preserving legacy `itemIds`; increment dispatched quantity by the requested amount.
- [x] Attribute scans using task warehouse plus product so multi-warehouse duplicate products do not share logs.
- [x] Add per-row quantity inputs and complete product identity to the ship dialog.

### Task 4: Safe list actions and inventory dialogs

**Files:**
- Modify: `frontend/src/pages/sale/index.tsx`
- Modify: `frontend/src/pages/sale/components/SaleRowActions.tsx`
- Modify: `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx`
- Modify: `frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx`
- Modify: `frontend/src/types/sale.ts`

- [x] Route list shipping and partial release through the detail review workflow.
- [x] Disable reserve confirmation for ATP shortage and release confirmation for invalid quantities.
- [x] Rename ATP fields and show physical, reserved, expected and promiseable quantities separately.

### Task 5: Business input completeness and close-remaining accounting

**Files:**
- Modify: `backend/src/modules/sale/sale.routes.js`
- Modify: `backend/src/modules/sale/sale.service.js`
- Modify: `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx`
- Modify: `frontend/src/pages/sale/components/AddressBookDialog.tsx`
- Modify: `frontend/src/pages/sale/form/components/SaleOrderItemsTable.tsx`
- Modify: `frontend/src/pages/sale/form/validate.ts`

- [x] Permit positive decimal sales quantities.
- [x] Support longer receiver names, normal phone/landline/international characters and full addresses.
- [x] Recompute receivable after closing unshipped remainder and clamp discount to the final order gross amount.
- [x] Add request keys to cancel and delete operations.

### Task 6: Documentation and verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/internal-ui-redesign-2026-09-05.md`
- Modify: `docs/02-flowcube-流程测试矩阵.md`

- [x] Update current rules for net discount, ATP labels, partial quantity shipment, scope and authoritative snapshots.
- [x] Run backend lint, frontend lint, TypeScript, focused Node tests, frontend unit tests and production build.
- [x] Run `git diff --check` and inspect the final diff.
- [x] Document DB smoke tests that remain pending if no isolated test database is configured.

**Verification note:** 使用临时独立库 `flowcube_sale_test` 执行全部 233 个迁移；销售改单 61 项、并发与取消归还 87 项、ATP 8 项均通过。迁移 233 也已应用到本地 `flowcube_dev8` 并核验两个扩展字段。隔离浏览器会话到达本地登录门禁且无控制台错误；用户真实数据下的登录后页面交互仍需在已有会话验收。
