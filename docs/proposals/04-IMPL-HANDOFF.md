# 04 序列号管理 · 实现交接（会话中途停靠）

> 用途：这批实现工作在 2026-07-31 因**当前会话工具输出间歇损坏**（grep 造假、Read 重复行、git log 重复、"思考蹦 0/1"）而在一个干净提交点停靠，等重启会话（/clear 或新会话）后继续。
> **接手第一件事**：读本文件 + 记忆 `erp-wms-feature-design-docs`、`user-hands-off-full-autonomy`、`mobile-session-port-exposure`、`env-tooling-output-corruption`（环境坑）。设计依据是 `docs/proposals/04-序列号管理.md`。

## 停靠点（已提交，本地未 push）

- 提交 `3b23039`（大快照：06 完整 + 04 基础层 + 存量改动）+ `7404ffc`（products serial_managed 开关）。
- **06 电子面单已完整交付并验证**（见 `docs/proposals/HANDOFF.md` 同级的 06 部分 / 记忆）；本次会话主要新增 06 + 04 基础层。

## 04 已完成（基础层，已提交）

1. **迁移 168–171**（已跑）：
   - `168_product_serial_managed.sql`：`product_items.serial_managed TINYINT`（AFTER shelf_life_days）
   - `169_product_serials.sql`：主表（`uk_product_serial(product_id,serial_no)`，status 1在库/2已出库/3已退货）
   - `170_serial_events.sql`：事件流水
   - `171_seed_serial_permissions.sql`：serial.view→角色2/3，serial.manage→角色2
2. **权限码三处同步完成**：后端 `permissions.js`（SERIAL_VIEW/SERIAL_MANAGE）+ 前端 `permission-codes.ts`（含 PERMISSION_GROUPS 展示项）+ seed 迁移。`test:permissions` 前后端各 159 一致 PASS。
3. **`backend/src/engine/serialEngine.js`（完整，286 行）**——序列号唯一合法写入口，只接 conn 不自开事务。导出：
   - `registerSerials(conn, { productId, warehouseId, containerId, serialNos, inboundTaskId, inboundTaskItemId, purchaseOrderId, operatorId })` — 收货登记；在库重复拒绝，已出/已退复用同行改回在库。
   - `putawaySerials(conn, { containerId, warehouseId, refId, operatorId })` — 上架留痕。
   - `dispatchSerials(conn, { productId, serialNos, allowedContainerIds, expectedQty, warehouseId, warehouseTaskId, saleOrderId, returnRefType, returnRefId, operatorId })` — 出库核销；校验 SN 属 allowedContainerIds + 台数==expectedQty + 核销后逐容器 assertSerialCountMatchesContainer。
   - `assertSerialCountMatchesContainer(conn, containerId)` — 核心不变量断言（容器 remaining_qty == 在库SN数，仅 serial_managed 商品）。
   - `assertNoSerialManaged(conn, productIds, actionName)` — 逆向路径 Phase1 防护（有 serial_managed 商品就抛错挡住）。
   - `isSerialManaged` / `normalizeSerialList` / `SERIAL_STATUS`。
4. **商品开关 serial_managed 接入**（products.service.js：fmt/create/update；products.routes.js：zod）。客观往返验证过（测试脚本需带 categoryId）。

## 04 剩余（未做，高风险，重启后继续）——精确调用链已摸清

> 以下行号是 2026-07-31 摸清的，重启后**务必用 Read 复核**（工作区脏 + 行号会漂）。原则：`serialEngine` 全部搭在现有建容器/扣容器事务里，改完必跑 smoke + 端到端一致性脚本。

### A. 收货逐台登记（`modules/inbound-tasks/inbound-tasks.command.js`）
- `receive` 函数（~363）。事务 beginTransaction ~422 / commit ~702；幂等 beginOperationRequest('inbound.receive') ~423，completeOperationRequest ~696。
- 商品 SELECT ~380-383（`batch_managed, shelf_life_days`）→ 追加 `serial_managed`。
- 批次强制校验块 ~400-408 → 仿它加"serial_managed 时 serialNos 必填 + 数量==本次收货量"校验。
- `normalizedPackages` ~370-373（`{lineNo, qty}`）→ 扩成 `{lineNo, qty, serialNos}`；payload 形态 `packages:[{qty, serialNos:[...]}]`。
- 建容器循环 ~545-569，每箱 `createContainer(...)` 返回 `{containerId}`（~546）→ **在 546 之后、564 push 之前**插 `serialEngine.registerSerials(conn, { containerId, productId, serialNos: pkg.serialNos, warehouseId, inboundTaskId: taskId, inboundTaskItemId, purchaseOrderId })`。收货是**每箱一容器**，serialNos per-container。
- zod：`inbound-tasks.routes.js` `receiveSchema`（~41-93，union 三分支）→ packages 子对象加 `serialNos: z.array(z.string().trim().min(1)).optional()`。

### B. 上架留痕（`modules/inbound-tasks/inbound-tasks.putaway.js`）
- `putaway`（~82），事务 85/307。容器 4→1 promote 是**手写 UPDATE**（~166-172，不走 promotePendingContainerToActive，因要同时写库位）。lockStockDimension ~124；c.product_id/warehouse_id/containerId 由 ~126-132 加锁读到。
- **在 172 UPDATE 之后**同事务调 `serialEngine.putawaySerials(conn, { containerId, warehouseId, refId: taskId })`。

### C. 出库逐台核销（`modules/warehouse-tasks/warehouse-tasks.ship.js`）
- `shipWithinTransaction(conn, id, operator, saleData, {requestKey})`（~21，接调用方 conn）；外层 `ship()` ~181-190 开/提交事务 + **需给 ship()/shipWithinTransaction() 签名加 serialNos 入口**（PDA 出库确认扫入；saleData.items 目前无 SN）。
- 扣减：~85-102 `for item of shipOrder` 调 `moveStock(conn, {moveType:TASK_OUT, lockedByTaskId:id})`，moveStock 内部调 `deductFromTaskLockedContainers`（`containerEngine.js:335-397`）。moveStock **不外传扣减明细**。
- 本任务容器：`locked_by_task_id = taskId`。**dispatchSerials 必须在 ship.js ~134 的 `unlockContainersByTask` 之前**（届时按 locked_by_task_id 还能定位）。建议插在 102 与 134 之间：先 `SELECT id FROM inventory_containers WHERE locked_by_task_id=? AND product_id=?` 得 allowedContainerIds，再 `serialEngine.dispatchSerials(conn, { productId, serialNos, allowedContainerIds, expectedQty: item.qty, warehouseTaskId:id, saleOrderId })`。

### D. 逆向路径 Phase1 防护（挡 serial_managed，不做回冲）
- 撤回收货 `inbound-tasks.void.js` `voidReceipt`（~20）：containers 读出 ~48-54 后、循环 ~72 前，`assertNoSerialManaged(conn, 涉及productIds, '撤回收货')`。
- 改单减量 `warehouse-tasks.adjust.js` `applyProductDeltaWithinTransaction`（~57）：减量分支入口 ~104，`assertNoSerialManaged`。
- 容器拆分 `containerEngine.js` `splitContainer`（~832-956）：~839 读 row 后判 serial_managed 抛错。
- 取消归还 `cancel-return.js`：**无需处理**（只 unlockAndRelocateContainer，remaining_qty 不变、SN 仍挂原容器仍在库，一致性无影响）。

### E. serials 模块（新建 `modules/serials/` routes+controller+service）
- `GET /serials`（台账，scopeFilter 按仓）、`GET /serials/trace?serialNo=`（追溯：主行 + serial_events 时间线 + JOIN 单号/客户/供应商）、`GET /serials/check-consistency`（逐容器比对 remaining_qty vs 在库SN数）。
- app.js 注册区（~107 `/api/inventory` 后）加 `app.use('/api/serials', require('./modules/serials/serials.routes'))`。
- **注意**：工作区已有**空的** `backend/src/modules/serials/`、`frontend/src/pages/serials/`、`frontend/src/api/serials.ts`（0字节）、`frontend/src/types/serials.ts`（0字节）——残留占位，直接往里写即可。

### F. 前端（ERP + PDA）
- `types/products.ts` + `pages/products/form.tsx`：加 serialManaged 开关（仿 batchManaged，EMPTY_FORM/回填/JSX/handleSubmit 四处）。
- `api/serials.ts` + `types/serials.ts`（空文件待填）+ `pages/serials/index.tsx`（台账）+ `pages/serials/trace.tsx`（追溯时间线，可复用 06 的 TrackTimeline 思路）。
- `router/routeRegistry.ts`：加 `/serials`（nav.group 库存，permission SERIAL_VIEW）+ `/serials/trace` routePattern。**详情页读参数用 `useContext(TabPathContext)` 不是 useParams**（06 踩过，见 `pages/inbound-tasks/detail.tsx` 范式）。
- PDA：`pda/receive/:id`（收货扫SN面板）、`pda/ship/:id`（出库扫SN），走 useCriticalPdaAction 不做离线重放、带 X-Client:pda + X-Request-Key。**PDA 页面验证要 tabs_create 开新标签页**。

### G. 验证（04-9）
- 端到端一致性硬脚本：serial_managed 商品 收货N台→上架→出库M台，每步断言 每容器 remaining_qty==在库SN数、全局Σ一致。放 `backend/scripts/serial-e2e-tmp.js`，跑完删、造数据清理。
- 回归：mainline（非serial商品零回归）+ p0/p1/concurrency（动收货出库事务）+ warehouse-scope（/serials 不越权）+ 幂等（连点两次/断网重试不重复登记核销）。
- tsc + 两端 lint。浏览器截图台账/追溯；PDA 新标签页测扫码面板。

## 环境坑（本会话踩到，重启后仍需防）

1. **工具输出间歇损坏**：grep 曾"报告"两个 create 定义（假）、Read 重复同一行 5 次、git log 重复行、思考里蹦 0/1。**对策**：关键判断用 Read 复核，别信单条 grep/Bash 输出；改动靠 Edit（服务端精确匹配，可靠）；正确性靠客观 smoke/端到端脚本（确定性 pass/fail）兜底。若加剧到 Edit/commit 也失败，停靠重启。
2. **IDE git 集成在命令间清暂存区**：`git add` 与 `git commit` 分两条命令时，暂存区在中间被清空（commit 报 nothing staged）。**对策**：git 操作用**单条命令** `git add ... && git commit ...`。无 husky hook。
3. **脏工作区**：main 上有大量存量未提交改动（多会话积累）；发版要精确 git add（见记忆 `release-dirty-worktree-technique`）。已在 3b23039 快照固化。
4. **手机远程会话**：展示要 expose 0.0.0.0 端口 8000-9000（见 `mobile-session-port-exposure`）；06 预览曾在 8347。
