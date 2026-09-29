# 塑料盒作业流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让塑料盒成为现场的「临时散件存放盒」：整件来源可全量倒入指定盒、**同商品不同批次可混放（不以批次为拒绝理由）**、散件可人工还原成整件、销售取货从盒取出并贴独立取货标签，且取出的货能接分拣/复核/装箱与**取消与减量**归还，全程库存唯一事实源不变。

**Architecture:** 不改容器事实源。库存量恒等于 `inventory_containers` 中 `status=ACTIVE` 行 `remaining_qty` 之和（`syncStockFromContainers`，`containerEngine.js:429`、SUM 在 `:449-455`）。放货/还原/取货都是**同事务内两容器一增一减**的守恒转移，复用既有 `splitContainer` / `createContainer` / `logContainerSplit` / `lockContainer` / `deductFromTaskLockedContainers`。取货把「盒里的量」转成「本任务锁定的新 `I`」，下游仍按既有「本任务锁定条码」口径工作；**拣货只锁、出库才扣**的时机不变。

**Tech Stack:** Node 22、Express、mysql2、MySQL 8、React、TypeScript、Vite、React Query、Vitest、`node --test`、agent-browser。

---

## 0. 已核实的关键事实（本轮只读核对，实现据此写死）

| 事实 | 证据 |
|---|---|
| PDA 路由登记文件是 `frontend/src/router/pdaRoutes.tsx`（**不是 `main.tsx`**） | `rg -ln "PdaSplitPage"` 只命中 `frontend/src/router/pdaRoutes.tsx` |
| PDA 提交用 `useCriticalPdaAction<T>({ action, label, onConfirmed, resolveServerState })`，返回 `{ run((requestKey)=>…), pendingRecord, phase, lastErrorMessage }` | `frontend/src/hooks/useCriticalPdaAction.ts:19,48-63,101-139`；用法 `frontend/src/pages/pda/task.tsx:124,233,246` |
| 请求键生成 `createRequestKey(prefix)`；头 `X-Request-Key` | `frontend/src/lib/requestKey.ts:1,6-9` |
| 后端取键 `extractRequestKey(req)` | `backend/src/utils/requestKey`（`scan-logs.controller.js:3,13` 等引用） |
| 资源级幂等 `beginResourceOperationRequest(conn, { requestKey, action, userId, resourceType, resourceId })`，`scopedAction = `${action}.${resourceId}``，同 `resourceType+resourceId` 的 SUCCESS 走重放 | `backend/src/utils/operationRequest.js:146-166` |
| 扫码用途常量 `{ PICK:1, CHECK:2, CANCEL_RETURN:3 }`（`scan-logs.service.js` 内） | `scan-logs.service.js:186-203` 附近 |
| 复核 = 状态迁移 + `assertTaskCheckScanClosure(conn, id)`（**按「锁定集合 == 扫码集合」**） | `warehouse-tasks.check.js:38`；校验体 `warehouse-tasks.helpers.js:73-92` |
| 分拣**并非只有查询**（**2026-09-29 纠正**：原写「只有查询无写入」是不完整调用链）：PDA 分拣页 `handleBinScan` 调 **`PUT /api/warehouse-tasks/:id/sort-done`**（路由挂 `pdaOnly` + `pdaSessionRequired()`）→ `sortTaskWithinTransaction`。**真实顺序（以 `warehouse-tasks.sort.js:17-90` 为准，全文档只此一处，勿再抄第二套）**：锁任务行 → `assertTaskScope`（范围/设备仓）→ 取消闸 → 改单闸 → **状态规则**（`assertWarehouseTaskAction` + `isValidTransition`，`:30-31`）→ **`beginResourceOperationRequest`（`:32-38`；命中 `replay` 则在 `:39-41` 直接 `return` 原回执）** → 分拣格检查（`sorting_bin_id`，`:42-44`）→ `assertTaskPickScanClosure`（`:46`）→ 写 `sorted_qty`（**绝对累计量**，`:52` 起，先校验 `<= picked_qty`）→ 状态推进 / CAS。只有 `scanProduct(code)`（按 `wti.product_code` 匹配取候选）是纯查询 | `warehouse-tasks.routes.js:83`、`warehouse-tasks.sort.js:16-90`、`frontend/src/pages/pda/sort.tsx:99-111`、`sorting-bins.service.js:32` |
| 装箱 `packages` / `package_items`：`package_items` 只有 `product_id/product_code/product_name/unit/qty`，**无 `label_id`** | `028_create_packages.sql` 全文 |
| 装箱既有路径：`addItem(packageId,{productCode,qty})`、`removeItem`、`voidPackage`、`voidCompletedPackage`、`finishPackage`、`cancelByTaskId`；作废登记表 `sale_order_adjustment_package_voids` | `packages.service.js:152,272,336,382`；`109_create_sale_order_adjustment_package_voids.sql` |
| 打印机绑定类型白名单（**路径纠正**：不在 `print-jobs/` 下） | `backend/src/modules/printer-bindings/printer-bindings.routes.js:18-24` |
| 标签模板类型 5–10 已用，**11 空闲**；`defaultLabelLayout` 未知类型抛「未知标签类型」 | `print-jobs/labelRasterDefaults.js:2-14` |
| 补打中心按 `ref_type`（`inventory_container`）而非 `jobType` 过滤；且**排除 `plastic_box_create`** | `print-jobs.query.js:128,303,317,381,395` |
| 既有 PDA 拆分页前端自校验 `q >= remaining` 即拒绝 | `frontend/src/pages/pda/split.tsx:102` |
| 迁移最大编号 `264_product_items_revision.sql`（开工前当场重核） | `ls backend/src/database/*.sql \| sort -n \| tail -1` |

## 0.1 消费者对「一盒一批次」的依赖（**只有真到期事实 `exp_date` 相关路径依赖**）

| 消费者 | 依赖批次？ | 证据 |
|---|---|---|
| 盘点 | 否 | `stockcheck.service.js:32`（`GROUP BY product_id` 汇总 `remaining_qty`）、`:119`、`:173` |
| 调拨 / 库位移动 | 否 | `transfer.service.js:259`、`:361` |
| 报表 / 库存查询 | 否（逐容器返回，不分组） | `inventory.service.js:441-472`、`:944`、`:1001`；`reports.query.js` 只按商品/仓库 |
| **效期告警** | **是（按 `exp_date`）** | `inventory.aging.js:122-165 getExpiryAlerts` |
| **FEFO 扣减/建议** | **是（3 处按 `exp_date` 排序）** | `containerEngine.js:281-285`、`:367-371`、`warehouse-tasks.pick.js:194-207` |
| 并盒批次校验 | **是（本批要改的点）** | `containerEngine.js:1067-1100`（`splitContainer` 的 `targetContainerId` 分支内联）、空盒继承 `:1092` |
| 补打中心 | 否（按 `ref_type`/条码分类） | `print-jobs.query.js:128` |
| 销售退货 / 改单归还 | 否 | `return-tasks.service.js:260-320`、`warehouse-tasks.adjust.js:416-470`、`warehouse-tasks.cancel-return.js:53-97` |

**由该表得出的唯一范围闸**：混批只在**来源与盒都无真到期事实（`exp_date IS NULL`）**时放行（见 A2）。**`batch_no` / `mfg_date` 不是保质期依据，不作为拒绝理由。**

---

## 基线、执行边界与文件职责

- 起点：本工作树，`docs/plastic-box-workflow-design-2026-09-29.md` 已核对。实现前 `git status --short --branch`、`git worktree list --porcelain`；**不使用** `reset` / `clean` / `git add .`。
- 约束来源：`AGENTS.md`、`docs/inventory-transaction-invariants.md`、`docs/backend-api-sql-conventions.md`、`docs/frontend-pda-conventions.md`、`docs/print-deploy-ops.md`、`docs/verification-commands.md`。
- **不授权**：push、tag、发布、版本号变更、生产连接、生产配置或客户账款读取。v0.11.4 本地候选保持不动。
- **迁移**：放 `backend/src/database/*.sql`，**开工第一步当场重核最大编号**，新增从 `max+1` 起，幂等写法参照 `017_alter_inventory_containers.sql`（`information_schema` 判列 + `PREPARE`）。**不改旧迁移**，**尽量少加表/列**（本计划共 2 列 + 1 张新表，见各 Task）。
- **数据库**：`source "$HOME/.config/flowcube/dev-env.sh"` 切 Node 22；只用显式回环 `127.0.0.1:3307`、独立库 `flowcube_plastic_box_20260929_test`、可写 `APP_UPDATE_DOWNLOADS_DIR`；迁移前断言库名与端口；口令只注入不回显；**禁止**自动迁移 `flowcube_dev8` 或任何 finance/acceptance/GUI 旧库。
- **浏览器**：独立 session `flow-plastic-box-20260929`，复用标签页，`finally` 里 `close` + `session list` 复核；只停本批资源。
- **夹具**：走合法业务入口建立并收尾；**不为凑测试删历史**。
- **证据分层**：代码 / 隔离库 API / 真实 PDA Web / Electron / 真机 / 物理打印分层。**测试必须证明真实缺功能或真实风险，不能只断言「路由 404」「类型不存在」当验收**（红测用于定位缺口，绿测必须证明业务事实）。未实跑项如实写未验；实跑以自然退出为准。
- **批次提交**：批 A、批 B 各自独立提交；每 Task 提交前逐路径暂存 + `git diff --cached --check`。

| 文件组 | 职责 |
|---|---|
| `backend/src/engine/containerEngine.js` | 守恒转移、建码、并盒、来源流水、锁定；**混批放行与混合标识**、**盒取货转移**都在此 |
| `backend/src/modules/inventory/inventory.service.js` | `splitContainerOp`、`getContainerLogs`（来源贡献读取扩展） |
| `backend/src/modules/plastic-boxes/*` | 塑料盒 CRUD；**新增 `fill` 与 `repack`** |
| `backend/src/modules/scan-logs/scan-logs.service.js` | 拣货扫码；**新增「扫盒取货」分支** |
| `backend/src/modules/sorting-bins/*` **+ `backend/src/modules/warehouse-tasks/warehouse-tasks.sort.js`（分拣推进真实链）** | 分拣：**新取货码接入既有 `sort-done` → `sortTaskWithinTransaction` 链**；`sorting_bin_items` 仅作作业记录/防重 |
| `backend/src/modules/packages/*` | 装箱；**新增 `labelId` 分配与配额回收** |
| `backend/src/modules/print-jobs/*` | **新增 `pick_label` 用途**（模板 11） |
| `frontend/src/router/pdaRoutes.tsx`、`frontend/src/pages/pda/*`、`frontend/src/pages/plastic-boxes/*`、`frontend/src/api/*` | 放货/还原入口、取货标签、取货码识别 |
| `backend/src/database/*.sql` | 迁移 265（`inventory_containers.is_mixed_batch`）、266（`scan_logs.source_container_id`）、267（`package_items.label_container_id`）、268（新表 `sorting_bin_items`）——**编号以当场重核为准，可合并为更少文件** |

---

## 批 A：放货 + 同商品混批 + 散件还原整件

### Task A1：放货——扫来源整件 `I` → 扫指定 `B`，**按来源全部放入**

**Files:** `backend/src/engine/containerEngine.js`（复用 `splitContainer` 的 `targetContainerId` 分支，`974` 起）；`backend/src/modules/plastic-boxes/plastic-boxes.service.js`、`.controller.js`、`.routes.js`；`frontend/src/api/inventory.ts`、`frontend/src/pages/pda/fill.tsx`（新建）、`frontend/src/router/pdaRoutes.tsx`；测试 `tests/plastic-box-fill.smoke.test.js`（新建）。

**接口（新增）：** `POST /api/plastic-boxes/:id/fill`

- 权限：`PERMISSIONS.INVENTORY_CONTAINER_SPLIT`
- 请求体：`{ sourceContainerId: number, expectedSourceQty?: number }`
  **只收「来源整件全部」**——**不设可选 `qty`**，服务端取来源当前 `remaining_qty` 全量；`expectedSourceQty` 为**并发快照守卫**（与提交时读到的来源量不符 → 409，要求重扫）。
- 响应：`{ sourceContainerId, sourceBarcode, sourceRemainingAfter, targetContainerId, targetBarcode, targetQtyAfter, mixedBatch: boolean, replayed: boolean }`
- 头：`X-Request-Key`

- [ ] **Step 1 — 红测（证明真实缺功能）。** 独立库用真实 API 建：整件来源 `I`（`initial_qty=200`、`exp_date=NULL`）+ 空盒 `B`。断言 `POST /api/plastic-boxes/:id/fill` 当前 404。
- [ ] **Step 2 — 后端幂等接入（不能只在前端 `createRequestKey`）。** controller 用 `extractRequestKey(req)` 取键并下传；service 在**同一 conn** 上调
      `beginResourceOperationRequest(conn, { requestKey, action: 'plastic_box.fill', userId, resourceType: 'inventory_container', resourceId: boxId })`
      （`operationRequest.js:146`，`scopedAction = plastic_box.fill.<盒id>`）；事务成功后 `completeOperationRequest(conn, state, { data, message, resourceType: 'inventory_container', resourceId: boxId })`；失败 `failOperationRequest`。**同一稳定键重放须返回原已提交结果**——**来源已空（`remaining_qty=0`）时重放仍返回成功结果，不得报「来源为空」**。
- [ ] **Step 3 — service 函数 `fill(id, { sourceContainerId, expectedSourceQty }, { userId, userName }, scopeWarehouseIds)`。锁序（与引擎全局约定一致，`containerEngine.js:983-991`）：**先 `lockStockDimension(商品,仓库)`，再 `FOR UPDATE` 目标盒**，随后引擎内对来源加锁。
      校验：`assertInScope` 目标盒仓库 → 来源为 `container_type=1`、同商品、同仓库、`status=ACTIVE`、`locked_by_task_id IS NULL`、非 `isIndividualContainer`（`909`）→ 目标为 `barcode LIKE 'B%'`、`container_type=2`、`locked_by_task_id IS NULL` → 若传 `expectedSourceQty` 且 ≠ 来源当前 `remaining_qty` → 409。
      调 `splitContainer(conn, { containerId: 来源, qty: 来源当前 remaining_qty, targetContainerId: id, operatorId, operatorName })`。**不加** `DIRECT_ACTIVE` 白名单、**不新增事实源**。
      **重放也要核对权限**：命中 `beginResourceOperationRequest` 重放时，**返回前仍要做一次目标盒的 `assertInScope`**（不能因命中重放就跳过仓库权限核对）。资源/用户归属由 `beginResourceOperationRequest` 的 `resourceType+resourceId+userId` 限定；**PDA 设备仓保护（`pdaWarehouseId`）保持与既有 PDA 接口同口径**。
- [ ] **Step 4 — 路由与校验。** `plastic-boxes.routes.js` 增 `POST /:id/fill`，`validateBody(z.object({ sourceContainerId: z.number().int().positive(), expectedSourceQty: z.number().positive().optional() }))`，权限同上。
- [ ] **Step 5 — 绿测（证明业务事实）。** 200→盒 200；`inventory_stock.quantity` **不变**；`inventory_logs` 出现盒视角一条（`container_id=盒`、`log_source_ref_id=来源ID`、`quantity=200`）；来源行保留、`status=2`。
- [ ] **Step 6 — 反向断言（**5 种**，每种断言 400/409 且库存与流水零变化）。** ①跨商品 ②跨仓库 ③来源已被拣货锁定 ④目标非 `B`（`I` 或普通容器）⑤来源为单件个体容器（`isIndividualContainer`）。
- [ ] **Step 7 — 旧接口兼容用例（**不混进 green**）。** 用既有 `POST /api/inventory/containers/:id/split` 带 `targetContainerId` 转 **partial 50**：断言旧接口行为**不变**（来源剩 150、盒 50）。这是**回归兼容**用例，不是 `fill` 的通过条件。
- [ ] **Step 8 — 前端入口（PDA）。** 新页 `frontend/src/pages/pda/fill.tsx`，路由登记到 `frontend/src/router/pdaRoutes.tsx`：扫来源条码（`parseBarcode`）→ 回显商品/数量 → 扫/选目标盒 → 提交。提交走 `useCriticalPdaAction`（`action: 'plastic_box.fill.<盒id>'`），沿用其 `pendingRecord` / `resolveServerState` 恢复；提交前记录来源量快照，作为 `expectedSourceQty`。
- [ ] **Step 9 — 提交边界。** 只暂存引擎、service/controller/routes、前端页与路由、API、测试、主题文档。

### Task A2：同商品混批放行 + 混合标识 + 来源贡献可查

**Files:** `backend/src/engine/containerEngine.js`（`1066-1100`）；`backend/src/modules/inventory/inventory.service.js`（`getContainerLogs`，`486` 起）；`backend/src/modules/plastic-boxes/plastic-boxes.service.js`（`findMovements`、`fmt`）；迁移 **265**（`inventory_containers.is_mixed_batch`）；`docs/inventory-transaction-invariants.md`；测试 `tests/plastic-box-mixed-batch.smoke.test.js`（新建）。

- [ ] **Step 1 — 红测（证明真实缺功能）。** 两个同商品来源 `I`，`batch_no` **不同**（如 `L1`/`L2`），**`exp_date` 均为 `NULL`**。先后放入同一盒：断言**当前第二个被拒**（`CONTAINER_BATCH_MISMATCH`，`containerEngine.js:1073-1078`），盒里只有第一批。
- [ ] **Step 2 — 迁移 265（幂等）。** `inventory_containers` 加 `is_mixed_batch TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=盒内混有多个来源批次，盒上的 batch_no 不再代表单一批次'`。
- [ ] **Step 3 — 读取两端的 `is_mixed_batch`。** 源 SELECT（`splitContainer` 的 `993-999`）与目标 SELECT（`1041-1047`）的字段列表都加 `is_mixed_batch`。**放行判定只认真到期事实**：

  ```js
  // 放行判定只看「真正的到期事实」exp_date。
  // batch_no / mfg_date 不是保质期依据：同商品不同批次允许混放正是本需求，
  // 即使两个来源 batch_no 不同、且 exp_date 均为 NULL，也必须允许。
  // batch_managed 是商品级策略开关，同样不等于「本盒有到期事实」，不参与本判定。
  const allowMixedBatch = row.exp_date == null && target.exp_date == null
  const isRealMerge = !targetEmpty && !sameBatch
  if (isRealMerge && !allowMixedBatch) {
    throw new AppError(/* 原文案与错误码 CONTAINER_BATCH_MISMATCH 不变 */)
  }
  ```

- [ ] **Step 4 — 混合标识的**完整传递**（不得丢、不得误清）。** 在同一个数量 UPDATE 里带出 `is_mixed_batch` 与批次，规则：

  ```js
  const targetWasMixed = Number(target.is_mixed_batch) === 1
  const sourceWasMixed = Number(row.is_mixed_batch) === 1
  // 新的混货条件：本次真混批，或来源/目标任一侧本就是混合来源。
  const becomesMixed = isRealMerge || sourceWasMixed || targetWasMixed

  let nextMixed
  if (targetEmpty) {
    // 空盒承接来源身份：来源是混合 → 盒也是混合；来源是单批 → 盒单批（重置 0）
    nextMixed = sourceWasMixed ? 1 : 0
  } else {
    nextMixed = becomesMixed ? 1 : 0
  }
  ```

  | 情形 | `nextMixed` | `batch_no` / `mfg_date` |
  |---|---|---|
  | 空盒 ← 单批来源 | `0` | **继承来源批次**（现有 `1092` 行为） |
  | 空盒 ← 混合来源（含复装出的混合 `I`） | **`1`** | **置空**（不冒充单批） |
  | 非空目标 + 同批次 | 保持（`targetWasMixed` 则 `1`，否则 `0`） | 保持目标原值；`targetWasMixed` 时置空 |
  | 非空目标 + 不同批次（无 `exp_date`） | **`1`** | **置空** |
  | **非空目标已是 `mixed=1`**（哪怕本次同批次或 `batch_no` 均为 `NULL`） | **`1`（不得被清成 `0`）** | 保持置空 |
  | **单批来源 ← 已清空的旧混盒** | **重置 `0`** | **继承新来源批次** |

  **理由**：混批后盒上那个 `batch_no` 已不代表整盒，**不得继续冒充单一批次**；原批次靠 `inventory_logs` 来源历史查。**`mixed=1` 会随货传递**：复装出的混合 `I` 再倒入另一盒时，另一盒也置 `1`。
- [ ] **Step 5 — 来源贡献读取（不加表、不加列）。** `getContainerLogs`（`inventory.service.js:486`）`SELECT` 增加 `il.log_source_type, il.log_source_ref_id`，返回增加 `sourceContainerId: r.log_source_ref_id`、`logSourceType: r.log_source_type`。数据**已存在**（`logContainerSplit` 在 `958` 行写 `log_source_ref_id=sourceContainerId`，`container_id` 为 target 视角）。
- [ ] **Step 6 — 塑料盒来源接口与展示。** `plastic-boxes.service.js` 增 `GET /api/plastic-boxes/:id/sources`（权限 `INVENTORY_VIEW`）：join 来源容器取 `barcode`/`batch_no`/`quantity`，返回 `[{ sourceContainerId, sourceBarcode, sourceBatchNo, contributedQty }]`。`fmt`（`:160`）增加 `mixedBatch: Number(row.is_mixed_batch) === 1` 与 `batchLabel`（混合时为「混合来源」，否则 `batch_no`）。**口径固定为「来源贡献」，不折算当前剩余、不做 FIFO**。
- [ ] **Step 7 — 绿测（证明业务事实）。** 两批 `L1`/`L2`（均无 `exp_date`）各 100/50 放入同一盒：合计 = 150；盒 `is_mixed_batch=1` 且 `batch_no IS NULL`；`GET /:id/sources` 返回两条来源贡献（各带 `sourceBatchNo`）；`inventory_stock` 与单批情形一致；**响应不含任何「某批还剩多少」字段**。
- [ ] **Step 8 — 反向断言。** 来源带 `exp_date` 时第二个放货仍被拒（维持原 409 + 同一错误码）；第二个来源 `batch_no` **相同**时不置 `is_mixed_batch`（仍是单批）；混批后 `deductFromContainers`/`deductFromTaskLockedContainers` 的 `ORDER BY exp_date` 在 `exp_date IS NULL` 下按 `created_at, id` 稳定排序，不产生错误分配。
- [ ] **Step 9 — 落档。** 把 §0.1 表与 Step 3 的判定依据写入 `docs/inventory-transaction-invariants.md`；与 A2 同批提交。

### Task A3：散件还原整件——人工逐箱 `qty`，余量留盒

**Files:** `backend/src/engine/containerEngine.js`（复用 `createContainer`，`109` 起）；`backend/src/modules/plastic-boxes/plastic-boxes.service.js`（新增 `repack`）、`.controller.js`、`.routes.js`；`frontend/src/api/inventory.ts`、`frontend/src/pages/plastic-boxes/*`；测试 `tests/plastic-box-repack.smoke.test.js`（新建）。

**接口（新增）：** `POST /api/plastic-boxes/:id/repack`，权限 `INVENTORY_CONTAINER_SPLIT`。

- 请求体（二选一，同传 400）：`{ perBoxQty: number, boxCount: number }`（等量快捷）**或** `{ items: number[] }`（逐箱清单，长度即箱数）。
- 响应：`{ boxId, boxRemainingAfter, created: [{ containerId, barcode, qty }], printJobIds: [], noPrinterCount: number, replayed: boolean }`
- 头：`X-Request-Key`

- [ ] **Step 1 — 红测（证明真实缺功能）。** 盒含 500 散件；断言 `POST /api/plastic-boxes/:id/repack` 当前 404。
- [ ] **Step 2 — 后端幂等接入。** 与 A1 Step 2 同构：`extractRequestKey` → `beginResourceOperationRequest({ action: 'plastic_box.repack', resourceId: boxId, resourceType: 'inventory_container' })` → 成功 `completeOperationRequest`（带 `created` 清单）→ 失败 `failOperationRequest`。稳定键重放返回原结果（**含原生成的容器清单**），**不重复建码**。
- [ ] **Step 3 — service 函数 `repack(...)`。** 开事务 → `assertInScope` → **锁序与 A1 完全一致：先 `lockStockDimension(盒.product_id, 盒.warehouse_id)`，再 `FOR UPDATE` 盒**（**绝不能先锁盒再锁库存维度**——否则与上架/出库路径构成 ABBA 死锁面，`containerEngine.js:983-991` 的全局约定即为此）→ 校验盒 `container_type=2`、`ACTIVE`、未锁定 → 归一化 `qtys`（`items` 或 `Array(boxCount).fill(perBoxQty)`）→ **服务端上限**：`qtys.length <= 100`（常量 `REPACK_MAX_BOXES = 100`）且 `boxCount` 为整数，超则 400（**不让无限数组造码**）→ 逐项精度校验（`assertQtyScale` + `roundQty`；**新数量一律 `DECIMAL(_,2)`**）→ 每箱 `> 0` 且 **`Σqtys <= 盒 remaining_qty`（允许 `Σ = 盒余量`，盒随之清空 → `status=2`）** → 盒 `remaining_qty -= Σqtys` → 逐箱 `createContainer(conn, { productId, warehouseId, initialQty: qty, unit, batchNo: 盒.is_mixed_batch ? null : 盒.batch_no, mfgDate: 盒.is_mixed_batch ? null : 盒.mfg_date, expDate: 盒.exp_date, sourceType: SOURCE_TYPE.CONTAINER_SPLIT, sourceRefType: 'plastic_box_repack', sourceRefId: 盒.id, barcodePrefix: 'I', containerType: 1, locationId: 盒.location_id, containerStatus: ACTIVE })`，**并给新 `I` 写 `is_mixed_batch = 盒.is_mixed_batch`**（混合盒还原出的 `I` 仍是混合来源；它再倒入别盒时别盒也置 `1`）→ 每个新 `I` 调 `logContainerSplit`（source=盒, target=新 `I`）→ `syncStockFromContainers` → 逐箱 `enqueueContainerLabelJob`（模板 6，`conn` 透传）→ `commit`。
      `container_type=1` + `SOURCE_TYPE.CONTAINER_SPLIT` **已在** `DIRECT_ACTIVE_SOURCE_TYPES`（`containerEngine.js:48-51`），**无需新增白名单**。
- [ ] **Step 4 — 逐箱边界。** `qty=1` 时生成的是个体容器（`isIndividualContainer`：`container_type=1` 且 `initial_qty=1`，`909`）——**仍打印标签**，保持既有「一件一码」口径，**不为本功能改全局建容器语义**。
- [ ] **Step 5 — 绿测（证明业务事实）。** 盒 500、`{perBoxQty:100, boxCount:3}`：生成 3 个 `I` 各 100；盒剩 200 且 `ACTIVE`；`inventory_stock` **不变**；`inventory_logs` 出现盒视角 3 条来源流水；每个新 `I` 的 `source_ref_type='plastic_box_repack'`、`source_ref_id=盒id`。**再断言 `Σqtys = 盒余量` 的用例**（盒清空 → `status=2`）。
- [ ] **Step 6 — 反向断言。** `Σqtys > 盒余量`、某箱 `qty <= 0`、`items` 与 `perBoxQty` 同传、盒已被任务锁定、盒内混批但……（不改批次规则）各断言 400/409 且**零副作用**。
- [ ] **Step 7 — 打印两种失败**分别**实测，不混同文案。** (a) **无可用打印机**：`enqueueContainerLabelJob` 返回 `unprintable`，记录原因 `NO_PRINTER_REASON`；(b) **标签渲染失败**：`buildLabelBody` 抛错走 `renderFailureReason(e)`（`label render failed: <code>`，`label-command.js:127-157`）。两种都断言**业务事务已提交**、盒与新 `I` 已落库、打印记录页出现可补打失败记录；**并断言两者的失败原因文案不同**（不把「无打印机」当成「渲染失败」）。**只入队、失败不回滚库存**。
- [ ] **Step 8 — 混批盒还原的批次。** 盒 `is_mixed_batch=1` 时，新 `I` **不带 `batch_no`/`mfg_date`**、`source_ref_id=盒id`（来源靠盒的来源历史查）；盒 `is_mixed_batch=0` 时新 `I` 继承盒批次。
- [ ] **Step 9 — 前端入口（**PDA 必须改，不能只加 PC 按钮**）。**
      - **PDA `frontend/src/pages/pda/split.tsx` 真正改为**：扫 `B` 盒 → 人工填**各箱 qty**（等量快捷）→ 生成 `I`（走本 Task 的 `repack`）。**替换**原「从 `I` 拆出新 `B`」的反方向语义；`q >= remaining` 的旧拒绝（`split.tsx:102`）**删除**（本功能允许取满、允许等量）。
      - **旧的非塑料盒拆分能力不丢**：若仍需要「从 `I` 拆出散件盒」，**保留后端能力**，在页面上作为另一分支/入口保留，**本批不删除**。
      - **PC 塑料盒详情**加「还原整件」与「查看来源」：等量或逐箱清单；本地校验合计 ≤ 盒余量并回显「将生成 N 个整件码、盒内留 X」。
      - 本批「完成」的说法**必须覆盖实际 PDA 入口**，不能只 PC 有按钮而 PDA 仍是原反方向页面。
- [ ] **Step 10 — 提交边界。** 只暂存引擎、service/controller/routes、前端、API、测试、主题文档。

### Task A4：批 A 验收与交接（**停在审查，不提交**）

- [ ] **Step 1 — 集中验证（只跑受影响集合）。** 容器/库存/塑料盒相关 DB 回归（`docs/verification-commands.md`）；两端 lint；`tsc -p frontend/tsconfig.app.json --noEmit`；受影响前端单测。**高风险项（锁序、混合标识传递、幂等重放）在其 Task 内先做最小红绿**。
- [ ] **Step 2 — 隔离库 API 复跑。** A1（5 种反向 + 旧接口 partial 兼容 + **同键重放「来源已空仍成功」** + **新键第二次合法操作不挡**）、A2（混合标识**全 6 情形**）、A3（取满、箱数上限、精度、混合继承）。记录自然退出码。
- [ ] **Step 3 — 真实 GUI（PDA 为主）。** session `flow-plastic-box-20260929`：**PDA 放货扫码**、**PDA 拆分页新语义（`B` → 各箱 qty → `I`）**；PC 查看来源 + 复装；**断网/丢响应后原提交快照恢复并展示原结果**。核对盒/新码数量与打印记录。
- [ ] **Step 4 — 写验收交接。** 记录：本批 diff、自然退出的测试/API/GUI 证据、未验项、**资源关闭证据**（服务/浏览器 session 已停、`session list` 复核）。
- [ ] **Step 5 — 停在审查。** **不提交、不 `git add` 全部、不开始批 B、不发布**；交 Codex 独立审查。

---

## 批 B：销售取货独立身份与标签 + 下游 + 取消/减量闭环

> **状态（2026-09-29）**：**B1+B2 已本地实施（17 项全绿）、已经独立审查接受**（见 `docs/plastic-box-batch-b-handover-2026-09-29.md`）；**B3a 已本地实施（19 项全绿）、已经独立审查接受**（见 `docs/plastic-box-batch-b3a-handover-2026-09-29.md`）；**B3b（装箱配额按来源取货标签分行 + remove/void 回收）已本地实施（套件 8 项 + 组件 3 例全绿）、已经独立审查接受**（见 `docs/plastic-box-batch-b3b-handover-2026-09-29.md`）；**B4（取货码取消 / 减量归还闭环）已本地实施（套件 5 项全绿）、已经独立审查接受**（见 `docs/plastic-box-batch-b4-handover-2026-09-29.md`）。
> 实施边界：B3a 只做「取货码接入既有 `sort-done`」与「复核真实 CHECK 闭合」，未做装箱与取消/减量；**不提交、不发布**，B3b/B4 待审查后放行。
> 下方 B1/B2 已并入 2026-09-29 事实修正：①锁序（任务→维度→容器、同 conn）；②批次/日期继承（单批继承真实 `batch_no`/`mfg_date`/`exp_date`，混合则全空）；③controller 必须传真实 `pdaWarehouseId` 且范围/设备仓校验覆盖首次与重放；④`pick_label` 打通「用途解析→绑定/回退→模板变量与渲染→前后端类型/字段/编辑/预览→补打保留原用途」；⑤迁移当场 `max+1`、数量 2 位。

> **【批 B 状态：设计待补全，不可实施】** 批 A 通过独立审查后再修订下列各点并开工：
>
> **B1（锁序反转）** — 现有 `createScanLog` 在 `FOR UPDATE` 容器**之后**才准备新 helper，会把「维度 → 容器」反转成「容器 → 维度」。必须在**首次容器锁之前**对 B 路径先 `lockStockDimension(任务.商品, 任务.仓库)`，之后再锁 `B`；**`I` 路径的原语义照旧保留**。
>
> **B3（分拣）** — `sorting_bin_items.qty` 必须 **`DECIMAL(_,2)`**（不是 4）；`confirm` 接口需 **`taskId` + 格码/格 ID + `code`**（不能只 `code/qty`，否则无法判他任务/错目标），并覆盖**设备仓、取消/改单、锁「任务 → 格位」**；**分拣重试应按稳定 key 重放原成功结果，而不是一律 409**。
>
> **B3（装箱）** — 保留 `min(required_qty, checked_qty)` 的期间/任务保护，**不得只按 `required_qty` 放行未复核量**；总量上限只能防「总数超量」，**不能防商品码绕过标签** ⇒ **旧商品码最多消费「未被取货标签覆盖的已复核量」**，**新标签只消费自己的未装配额**，新旧**各自互斥份额 + 合计守卫**；`package_items` 的**查询/UPDATE 必须区分 `label_container_id`**（否则新标签会并进旧商品行）；**回收与删/作废需同事务并保护锁序**。
>
> **B4** — 取消 **与** 减量都要验证真实闭环。

### Task B1：扫盒取货——从 `B` 转出 150 到本任务锁定的新 `I`

**Files:** `backend/src/modules/scan-logs/scan-logs.service.js`（`createScanLog`，`67` 起）；`backend/src/engine/containerEngine.js`（新增 `extractFromPlasticBoxToTask`）；迁移 **266**（`scan_logs.source_container_id`）；测试 `tests/plastic-box-pick.smoke.test.js`（新建）。

**接口（语义扩展既有）：** `POST /api/scan-logs` —— 扫到 `container_type=2`（`B`）走「盒取货」分支；扫到 `container_type=1` 行为**完全不变**（含既有 I 累计校验）。

- [ ] **Step 1 — 红测（**按新事实断言，不期待被拒**）。** 现已能扫 `B` 取 150（走旧路径：锁定 `B` 本身）。红测断言**新事实**，这些断言在旧代码上必然失败：①`B` 200 → 取 150 后 `B.remaining_qty == 50`；②存在一条 `locked_by_task_id=任务` 的**新 `I`** 且 `remaining_qty == 150`、`container_type=1`；③`scan_logs` 一条 `container_id=新I`、`source_container_id=盒.id`；④**取货标签打印记录出现**（`jobType='pick_label'`）。旧代码下 ①(盒不减)②(无新 I)③④ 全不成立。
- [ ] **Step 2 — 迁移 266（幂等）。** `scan_logs` 加 `source_container_id BIGINT UNSIGNED NULL` + `KEY idx_scan_logs_source (source_container_id)`。**先例**：`inventory_logs` 的 `container_id`/`log_source_type`/`log_source_ref_id` 就是后续迁移补上的（`006` 建表 → `038` 补列）。
- [ ] **Step 3 — 转移函数 `extractFromPlasticBoxToTask(conn, { taskId, boxContainerId, productId, warehouseId, qty, operatorId, operatorName })`（新，加在 `containerEngine.js`）。**
      **锁序（第一把容器锁之前必须先取维度锁）**：**`lockStockDimension(商品, 仓库)` → `FOR UPDATE` 盒 → …**。
      **该维度锁只加在「扫 B 取货」这条新分支上**；**不得**改动既有「扫 `I`」路径的锁序（`scan-logs.service.js` 既有分支保持原样，`scope`/`device` 保护也不动）。
      随后 `createContainer(conn, { …, **isMixedBatch: 盒.is_mixed_batch ? 1 : 0** })`：
      - `container_type=1`、`initialQty=qty`、`SOURCE_TYPE.CONTAINER_SPLIT`、`sourceRefType='plastic_box_pick'`、`sourceRefId=盒.id`、`barcodePrefix='I'`、`containerStatus=ACTIVE`；
      - **批次 / 日期继承规则（2026-09-29 修正）**：盒 `is_mixed_batch=1` ⇒ 新 `I` 同样置混合，且 `batchNo=null`、`mfgDate=null`、`expDate=null`（**混合不含单批信息**）；盒为**单批** ⇒ 新 `I` **继承真实的 `batch_no` / `mfg_date` / `exp_date`**——**空盒可以合法承接带真实到期日的单批来源**，原文「本路径下 `exp_date` 恒为 NULL」**不成立**。**不得**把单一批次信息挂到混合码上（与 A 的「混合标识不得冒充单一批次」同一红线）。**无需**为此新增任何保质期管理。
      - **source 标记与 A 的 `createContainersBatch` 同口径**：`source_type` / `source_ref_type` / `source_ref_id` / `source_ref_no` / `source_audit_missing` 等沿用 A 的既有取值，**不得自造新枚举**。
      再：盒 `remaining_qty -= qty`（0 则 `status=2`）→ 新 `I` 置 `locked_by_task_id=taskId, locked_at=NOW()` → **`logContainerSplit`（source=盒, target=新 `I`）**：**库存日志必须写当时真实的库存快照值**（`before_qty` / `after_qty` 取自真实 `inventory_stock`，**不得写 0 或占位**——A 的 `logContainerSplitBatch` 已是此口径）→ `syncStockFromContainers`。
      **新 `I` 与盒的增减同事务**；`syncStockFromContainers` 只汇总 `ACTIVE` ⇒ 总量不变。
- [ ] **Step 4 — 接进 `createScanLog`。** 当 `containerRow.container_type === 2`：
  - **校验口径（修正双扣）**：只按**当前 `B.remaining_qty`** 与**任务未拣需求**校验——`qty <= B.remaining_qty` 且 `itemRow.picked_qty + qty <= itemRow.required_qty`。**不再**用 `SUM(scan_logs.qty) + qty <= B 当前余量`（那会双扣：B200 取 100 后余 100，再合法取 100 会被挡）。历史 `SUM`**只用于审计展示**，不参与判定；并发由**盒行锁（`FOR UPDATE`）+ 任务行锁**保证。
  - **既有 `I` 路径的累计校验保持不动**（`scan-logs.service.js:192-203`）。
  - 调 `extractFromPlasticBoxToTask` 得新 `I`；
  - `lockContainer(conn, 新I.id, taskId, { expectedProductId, expectedWarehouseId, expectedBarcode: 新I.barcode, minRemainingQty: qty, expectedStatus: ACTIVE })`（`containerEngine.js:819`）；
  - `INSERT INTO scan_logs (... container_id=新I.id, barcode=新I.barcode, source_container_id=盒.id, qty, scan_purpose=PICK ...)`；
  - `warehouse_task_items.picked_qty += qty`（沿用 `250-258` 语句）；
  - 入队取货标签（B2）。
- [ ] **Step 5 — 闭合校验不失败（**关键**）。** `assertTaskCheckScanClosure`（`warehouse-tasks.helpers.js:73-92`）断言「`locked_by_task_id` 集合 == `scan_logs.container_id` 集合」。**因此 `scan_logs` 只落新 `I`、绝不另插一条扫 `B` 的记录**：`B` 既未锁定也不进 `scan_logs`。原 `B` 来源由 `scan_logs.source_container_id`（Step 2）承载；`B` 的数量流水另由 `logContainerSplit` 写 `inventory_logs`。（**口径已由 Codex 确认**。）
- [ ] **Step 6 — 绿测（证明业务事实）。** 盒 200、任务需 150：新 `I` 150 且锁定于本任务；盒剩 50 `ACTIVE`；`inventory_stock` **不变**；`scan_logs` 一条（`container_id=新I`, `source_container_id=盒`）；`inventory_logs` 盒视角一条；**复核通过**（`assertTaskCheckScanClosure`）；出库 `deductFromTaskLockedContainers`（`351`）**扣的正是新 `I` 的 150**，盒剩 50 不被扣。
- [ ] **Step 7 — 双扣回归用例。** 盒 200：先取 100（新 I₁ 100、盒剩 100），**再合法取 100**（新 I₂ 100、盒剩 0、`status=2`）——断言**第二次不被挡**。
- [ ] **Step 8 — 反向断言（真实风险）。** 扫盒数量 > 盒实存；盒已锁定给其它任务；盒商品与任务商品不符；`qty > 任务未拣需求`。各断言 400/409 且**零副作用**（盒余量不变、无新 `I`、无 `scan_logs`）。
- [ ] **Step 9 — 二次取货。** 对同一盒做**合法第二次取货**：断言**新建第二个新 `I`**（不复用第一个），且第一个不被改动。

### Task B2：取货标签（新打印用途，**不得用库存标签假充**）

**Files:** `backend/src/modules/print-jobs/print-dispatch.js`（`15-30`、`32-44`）；**`backend/src/modules/printer-bindings/printer-bindings.routes.js`（`18-24`）——路径纠正：实际不在 `print-jobs/` 下**；`backend/src/modules/print-jobs/labelRasterDefaults.js`（`2-14`）；`backend/src/modules/print-jobs/print-jobs.label-command.js`（新增 `enqueuePickLabelJob`）；`backend/src/modules/scan-logs/scan-logs.service.js`（B1 事务内入队）；**模板链（新增 type 11 必须一并覆盖）**：后端 `backend/src/modules/print-templates/`（type 查询校验与权限映射）、前端 `frontend/src/types/print-template.ts`（`TemplateType`，现仅 `1..10`）、前端标签字段定义 `frontend/src/constants/printFieldDefs.ts`、设置页模板**编辑器**与**预览**；`docs/print-deploy-ops.md`；测试 `tests/pick-label.smoke.test.js`（新建）。

- [ ] **Step 1 — 红测（证明真实缺功能）。** `normalizeJobType('pick_label')` 落到默认 `product_label`（`print-dispatch.js:22-29`）；`defaultLabelLayout(11)` 抛「未知标签类型」（`labelRasterDefaults.js:9`）；`printer-bindings.routes.js:18-24` 白名单不含 `pick_label`。
      **并须一并核对/红测模板链**（否则「能入队」≠「能编辑/预览/补打」）：① 后端模板接口的 type 校验 / 权限映射是否接受 `11`；② 前端 `TemplateType`（`print-template.ts:2`）为 `1..10`，编辑器无法选到 `11`；③ 预览链路对 `11` 有无字段定义；④（**待查项，勿先当缺口**）。
      **关于 ④（补打）**：现场只读到补打过滤与 `waybill` 相关，以及按 `ref_type`（`inventory_container`）过滤并排除 `plastic_box_create`（见 §0）。**`pick_label` 的 `ref_type` 取值、以及补打筛选是否已能覆盖它，须先只读查清再定性**——结论可能是「既有能力可直接复用」，也可能是「需扩展」；**无证据不得写成既有缺陷**。
- [ ] **Step 2 — 新用途。** `jobType='pick_label'`、模板 `templateType=11`：
  - `print-dispatch.js`：`normalizeJobType` 白名单（`22-24`）加 `'pick_label'`；`bindingFallbackChain`（`33-43`）加 `pick_label: ['pick_label', 'inventory_label']`。
  - `printer-bindings.routes.js:18-24` 白名单加 `'pick_label'`。
  - `labelRasterDefaults.js`：`barcodeKey`（`:3`）与 `fields`（`:4-8`）加 `11` 分支，字段集含 `sale_order_no`、`product_name`、`qty`，条码键用该标签自身条码。
  - **模板链（type 11 必须整条打通；缺一处就只是「能入队」，不等于「可编辑/可预览/可补打」）**：
    ① 后端模板接口的 type 校验与权限映射放行 `11`（现仅到 `10`）；
    ② 前端 `TemplateType`（`frontend/src/types/print-template.ts:2`）扩到含 `11`；
    ③ 前端标签字段定义 `frontend/src/constants/printFieldDefs.ts` 补 11 的字段与示例；
    ④ 设置页模板**编辑器**能选到 11 并保存；
    ⑤ **预览**链路对 11 渲染正确；
    ⑥ **补打中心**按 `ref_type` / 用途能查到并重印 `pick_label`。
  - **表述约束**：以上属于「**新增 type 11 尚未具备的能力**」，**不是旧产品缺陷**——不得写成修复既有 bug。
- [ ] **Step 3 — `enqueuePickLabelJob(payload)`。** 与 `enqueueContainerLabelJob`（`160`）同结构：先 `resolveLabelPrinter({ jobType:'pick_label' })`，无打印机 → `recordUnprintableJob`（**不抛错**）；`buildLabelBody({ templateType:11, vars })` 渲染异常 → 同样降级为可补打失败记录（**不回滚业务事务**，`label-command.js:209-221` 同模式）；`jobUniqueKey: pick_label:${scanLogId}` ⇒ 同一次取货重放**不重复出纸**。
- [ ] **Step 4 — 绑定入队。** 在 B1 的 `scan_logs` 插入后、`commit` 前调用，`conn` 透传（同 `splitContainerOp:1109` 模式）。**打印失败不影响库存与任务闭合**。
- [ ] **Step 5 — 绿测。** 有打印机：入队一条 `jobType='pick_label'`，绑定解析走 `pick_label`（回退链生效）；无打印机：落 `status=3` 失败记录且**业务事务已提交**；同一取货重放：**不新增第二条 job**。
- [ ] **Step 6 — 补打/重印不新增货。** 从打印记录页补打同一条 `pick_label`：断言**只重出标签、不新建容器、不改数量、不新增 `scan_logs`**。

### Task B3：分拣 / 复核 / 装箱接入（写实到接口与字段）

**Files:** `backend/src/modules/sorting-bins/sorting-bins.service.js`（`scanProduct`，`32`）+ 新增取货码解析；**分拣推进链（必须复用）**：`backend/src/modules/warehouse-tasks/warehouse-tasks.routes.js`（`83`）、`backend/src/modules/warehouse-tasks/warehouse-tasks.sort.js`（`16` `sortTaskWithinTransaction`）；迁移 **268**（新表 `sorting_bin_items`，仅作业记录/防重）；`backend/src/modules/warehouse-tasks/warehouse-tasks.check.js`（**只补测试，预期不改**）；`backend/src/modules/packages/packages.service.js`（`addItem:152`、`removeItem:272`、`voidPackage:336`、`voidCompletedPackage:382`）；迁移 **267**（`package_items.label_container_id`）；**前端** `frontend/src/pages/pda/sort.tsx`（`handleBinScan`，`99`）、`frontend/src/pages/pda/pack.tsx`、`frontend/src/api/warehouse-tasks.ts`（`177`）；测试 `tests/pick-code-downstream.smoke.test.js`（新建）。

**（a）复核 — 先证伪。**

- [ ] **Step 1 — 真实复核一次（**先真实扫码，再 checkDone**，顺序不可颠倒）。** ① 在复核页**真实扫到刚生成的 `I` 码**，经既有扫码链落一条 `scan_logs`（用途 `CHECK`）；② 再跑 `checkDone`，由 `assertTaskCheckScanClosure`（`warehouse-tasks.helpers.js:73-92`）按「锁定集合 == 扫码集合」比对。
      **不得跳过 ①**：新 `I` 未真实进 `scan_logs`，闭合校验必然失败——**禁止**用新表数据伪造「已复核」。断言通过则**不改代码**，只补一条测试；若失败，最小修正并在此记录原因。

**（b）分拣 — **新取货码必须接进既有 `sort-done` 推进链**（**2026-09-29 纠正**：原写「只有查询、无写入、无防重」是**不完整的调用链**）。

真实链路（已只读核对）：
`frontend/src/pages/pda/sort.tsx:99` `handleBinScan`（先校验扫到的正是提示的那个格，放错格直接拒绝）
→ `sortDoneApi(taskId, [{ itemId, sortedQty }], requestKey)`（`frontend/src/api/warehouse-tasks.ts:177`）
→ `PUT /api/warehouse-tasks/:id/sort-done`（`warehouse-tasks.routes.js:83`；`requirePermission(WAREHOUSE_TASK_SORT)` + `pdaOnly` + `pdaSessionRequired()`）
→ `sortTaskWithinTransaction`（`warehouse-tasks.sort.js:17-90`）**真实顺序（按文件核对，勿写反）**：
  ① 锁任务行（`lockStatusRow`，`:17-22`）→ ② `assertTaskScope`（范围 / 设备仓，`:23`）→ ③ 取消闸（`:24-26`）→ ④ 改单闸（`:27-29`）→ ⑤ **状态规则**（`assertWarehouseTaskAction('sortTask', status)` + `isValidTransition`，`:30-31`）→ ⑥ **`beginResourceOperationRequest(action='warehouse.sort', resourceId=id)`（`:32-38`）**；**命中 `replay` ⇒ `:39-41` 直接 `return` 原回执** → ⑦ 分拣格检查（`sorting_bin_id`，`:42-44`）→ ⑧ `assertTaskPickScanClosure`（`:46`）→ ⑨ 写 `sorted_qty`（`:52` 起，先校验 `sortedQty <= picked_qty`）→ ⑩ 状态推进 / CAS

**两个要点**：
1. 插一条 `sorting_bin_items` **≠** 分拣完成——完成与否以**任务状态与 `sorted_qty`** 为准。
2. **状态规则（⑤）在 `begin/replay`（⑥）之前** ⇒ **不能想当然**认为「任务已 `3→4` 后同键重放仍返回 200」。这条**必须实测**（见 Step 7），不得靠读码推断。

- [ ] **Step 2 — 取货码解析（服务端只读定位，不改库存）。** `sorting-bins.service.js` 增 `resolvePickCode(code, conn)`：
      - 命中某 `inventory_containers` 且其 `locked_by_task_id` 指向分拣中任务（`status IN (PICKING, SORTING)`）⇒ 返回**该任务 + 该取货码容器**（精确归属）；
      - 命中容器但 `locked_by_task_id` 为空或指向非分拣中任务 ⇒ **409**（非本任务取货码）；
      - 未命中容器 ⇒ 回退既有 `scanProduct(product_code)`（`sorting-bins.service.js:32`，**旧商品码路径保留**）。
- [ ] **Step 3 — 并入既有 `sort-done` 事务（不新造平行写入路径）。** 让 `sort-done` 的 `items[]` 能携带取货码归属（形如 `{ containerId }`，或服务端用 `resolvePickCode` 解析），由 `sortTaskWithinTransaction` **在同一事务内**：
      - 复用其**任务行锁、范围与设备仓校验、取消/改单闸、状态迁移 `3→4`、`sorted_qty` 进度**；
      - **重试必须走既有 `replay` 分支**返回原成功结果——**不得**一律 409，也**不得**绕开该分支另写一条；
      - **不得**因分拣改任何容器 `remaining_qty`。
- [ ] **Step 4 — `sorting_bin_items` 仅作作业记录/防重（迁移 268，幂等 `CREATE TABLE IF NOT EXISTS`）。**
      `id, bin_id BIGINT, task_id BIGINT, container_id BIGINT, product_id BIGINT, **qty DECIMAL(12,2)**, operator_id, operator_name, created_at`；**`UNIQUE KEY uk_task_container (task_id, container_id)`**；`KEY idx_bin (bin_id)`。
      **数量精度红线：`DECIMAL(_,2)`，不得写成 4 位**（本仓库数量口径统一两位）。
      **定位**：作业记录与防重，**不是库存事实源**，也**不是「分拣完成」的判据**（不改 `remaining_qty`、不参与 `syncStockFromContainers`）。
- [ ] **Step 5 — 设备仓/范围校验沿用服务层现有闸。** `pdaSessionRequired()` 只保证**票据有效**，**不会自动核对目标任务仓**；`sortTaskWithinTransaction` 已接 `pdaWarehouseId` / `scopeWarehouseIds`，新入口必须**沿用**，不得另写一套。
- [ ] **Step 6 — 分拣绿测。** 本任务取货码经 `sort-done` 成功后：任务 `sorted_qty` 推进、状态按规则迁移、并落一条 `sorting_bin_items`；**他任务取货码 → 409**；**跨仓（设备仓 ≠ 任务仓）→ 拒绝**；**旧商品码路径不回归**。
      （**同键回放的期望不在本步预设**——它取决于状态规则与 replay 的先后，见 Step 7 实测。）
- [ ] **Step 7 — 关键路径实测：原键回放 vs 状态规则的先后（**不得只靠读码推断**）。** 由于状态规则校验（⑤）发生在 `begin/replay`（⑥）**之前**：
      - 新取货码**完成分拣后**，**用原键回放** ⇒ 期望 **200** 且**进度不重复累加**（`sorted_qty` 不变、`sorting_bin_items` 不新增、任务状态不二次推进）；
      - **若回放被状态规则拒绝（非 200）**，即说明该路径**当前并不支持**：必须在**不破坏状态机**的前提下解决（例如把 replay 判定前移到状态检查之前，或让新链路在 CAS 前落回执），列为**本批必须解决项**；
      - **不得**以「调用方换新键重试」当作绕过——那会掩盖重复推进风险；
      - **换新键重复扫同一取货码** ⇒ 可**明确拒绝**（幂等由 `uk_task_container` 保证）；
      - 全程保留 `scope` 与**设备仓（`pdaWarehouseId`）**保护：被拒路径必须**零进度副作用**。
- [ ] **Step 8 — 进度语义：单次量 ≠ 绝对累计量（**防止第 2 张码抹掉第 1 张**）。**
      `warehouse_task_items.sorted_qty` 是**该 item 的绝对累计量**（`UPDATE ... SET sorted_qty=?`），而取货标签的 `qty` 是**本次取货量**。**禁止**用单张标签的 qty 直接覆盖 `sorted_qty`。
      同一事务内的正确口径：`新 sorted_qty = min(picked_qty, 已确认标签量累计 + 旧商品码份额)`，其中
      - 「已确认标签量累计」= 本任务该 item 下**已确认的取货标签量之和（含本次）**；
      - 「旧商品码份额」= 该 item 经**旧商品码路径**已分拣的量；**旧商品码不得一把标完尚未扫标签的量**（它只能记自己那部分）；
      - 两类份额之和**不得超过 `picked_qty`**（沿用既有校验），越界 400。
      绿测必须覆盖：**同一 item 连续两张取货码** ⇒ `sorted_qty` 为**两张之和**（而非第二张的值）；**标签 + 旧商品码混合** ⇒ 互不覆盖、总额不超 `picked_qty`。

**（c）装箱 — 配额分配与回收。**

- [ ] **Step 6 — 迁移 267（幂等）。** `package_items` 加 `label_container_id BIGINT UNSIGNED NULL COMMENT '来源取货标签（取货码容器ID）；NULL=按商品码装箱'` + `KEY idx_pi_label (label_container_id)`。
- [ ] **Step 7 — `addItem` 扩展（`packages.service.js:152`）。** 兼容两种入参：
      - 旧：`{ productCode, qty }`（行为不变）；
      - 新：`{ labelContainerId, qty }`——校验该 `labelContainerId` 是**本任务锁定**的取货码容器、`qty <= 该标签的「未装余量」`（= 该标签容器 `remaining_qty` 之和 减 已按该 `label_container_id` 分配的量），超量 **409**；写入 `package_items.label_container_id`。
      - **新旧同商品混合守卫**：按 `productCode` 累计时，**旧商品码不得再消费已由取货标签绑定的同一份量**——`addItem` 计算「本任务该商品可装上限」时，**上限 = 任务该商品 `required_qty`**，且按 `label_container_id` 已分配的部分计入该上限，禁止 `Σ(旧码分配) + Σ(标签分配)` 超过任务需求量；越界 409。
- [ ] **Step 8 — 回收（删除/作废）。** `removeItem`（`:272`）与 `voidPackage`（`:336`）/`voidCompletedPackage`（`:382`）在扣减/作废时，**按 `label_container_id` 释放对应配额**（删除行即释放；作废走既有 `sale_order_adjustment_package_voids` 登记流程，确认后配额归还可重装）。断言：删除/作废后同一标签可再次装箱。
- [ ] **Step 9 — 装箱绿测（证明业务事实）。** 扫一次取货标签入 **150**（不是 1）；重复扫同一标签**不超量**（`Σ <= 未装余量`）；`label_container_id` 落库正确；**旧商品码路径不回归**；新旧混合时总分配不超任务需求量；删除/作废后配额可回收再装。
- [ ] **Step 10 — 前端。** `pda/sort.tsx` 的 `handleBinScan`（`99`）**扩展为同时接受取货码**——仍先校验格位、仍走 `sortDoneApi` 那条既有链，**不新增平行接口**；`pda/pack.tsx:424-436` 增加「扫取货标签」入口，默认数量改为**该标签未装余量**（不再固定 1），保留现有 `product/unknown` 扫码路径。
- [ ] **Step 11 — 门槛落档。** 在 `docs/inventory-transaction-invariants.md` 写明：分拣确认键与防重约束、装箱 `labelId` 配额口径与回收路径。**若某子项无法在本批落地，如实写「未实施」而不是留空泛承诺**。

### Task B4：取消 / 减量——实物归还闭环（**与 B3 同一可验收闭环**）

**Files:** `backend/src/modules/scan-logs/scan-logs.service.js`（`createCancelReturnScanLog:438`、`createCancelReturnBoxScanLog:570`）；`backend/src/modules/warehouse-tasks/warehouse-tasks.cancel-return.js`；`backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js`（`416-470`）；`frontend/src/pages/pda/task.tsx`；测试 `tests/pick-cancel-return.smoke.test.js`（新建）。

- [ ] **Step 1 — 取消：先证伪。** 新 `I` 是普通任务锁定容器。跑真实取消（`GET /warehouse-tasks/:id/cancel-return-detail` + `POST /api/scan-logs/cancel-return/box` + `/cancel-return`）：断言既有路径**是否已能处理**新 `I`；能则不改代码，只补测试；不能则最小修正并记录原因。
- [ ] **Step 2 — 减量：同样先证伪。** 走真实改单减量（`warehouse-tasks.adjust.js` → `sale_order_adjustment_container_returns`，`containerEngine.js:1190 splitTaskLockedContainerForReturn`）：断言新 `I` 能被正确拆出待归还量并登记。能则不改；不能则最小修正。
- [ ] **Step 3 — 归还口径（**不自动回盒**）。** 归还按扫码实物返还：新 `I` 的货**先进安全库存码 / 同仓库位流程**，**不自动加回 `B`**；要回盒必须**指定盒 + 人工确认**（不靠改数抹平）。
- [ ] **Step 4 — 绿测（证明业务事实，**取消与减量各一条**）。** 取消后：原 `B` 的剩余量**不因取消而回涨**（货在新 `I` 上，归还在新 `I` 上）；`locked_by_task_id` 释放；`scan_logs` 与 `inventory_logs` 各自留痕；`inventory_stock` 与取消前一致。减量后：`sale_order_adjustment_container_returns` 登记正确、归还确认后新 `I` 解锁、总量守恒。
- [ ] **Step 5 — 闭环落档。** `docs/inventory-transaction-invariants.md` 写明：**P4（取货标签）与 P5（取消/减量归还）是同一个可验收闭环**，不得「先上线取货标签、以后再补归还路径」。

### Task B5：批 B 验收与提交

- [ ] **Step 1 — 集中验证。** 受影响 DB 回归；两端 lint；`tsc --noEmit`；受影响前端单测（分拣 / 装箱 / 拣货 / 打印）。
- [ ] **Step 2 — 隔离库 API 复跑。** B1–B4 主路径 + 反向断言 + 双扣回归，记录自然退出码。
- [ ] **Step 3 — 真实 GUI 全链。** session `flow-plastic-box-20260929`：出库任务 → 扫盒取 150 → 取货标签打印 → 分拣 → 复核 → 装箱 → 出库；再跑**取消与减量各一次**归还。
- [ ] **Step 4 — 提交批 B。** 逐路径暂存；`git diff --cached --check`。

---

## 汇总验证（两批完成后）

- [ ] **Step 1 — 受影响集合。** 两端 lint、`tsc --noEmit`、受影响前端单测、受影响 DB 回归、桌面与 PDA renderer build。**不重复跑**无关全量；**不跑**整套 CI / 安装包 / 生产。
- [ ] **Step 2 — 台账。** 逐项记录自然退出码与库名；未实跑项（物理打印、真机、整套 CI、生产发布）**如实写未验**。
- [ ] **Step 3 — 文档同步。** `docs/inventory-transaction-invariants.md`、`docs/print-deploy-ops.md`、`docs/plastic-box-workflow-design-2026-09-29.md`（已实施项从「建议」改为「已实现 + 证据」）。
- [ ] **Step 4 — 边界。** 结束停止本批服务/浏览器 session；不 push、不 tag、不发版；v0.11.4 本地候选不动。

---

## 本轮已按 Codex 意见收紧的点（无待拍板项）

1. **混批不按 `batch_no` 拒绝**：`batch_no` / `mfg_date` **不是**保质期依据；`batch_managed` 也不等同。范围闸**只认真到期事实 `exp_date`**（A2 Step 3）。两个来源 `batch_no` 不同且 `exp_date` 均为 `NULL` → **允许混**。
2. **混合标识**：混批后盒置 `is_mixed_batch=1` 且清空 `batch_no`/`mfg_date`，**不冒充单一批次**；还原出的 `I` 同样不带单一批次，来源靠 `source_ref_id=盒` + 来源历史查（A2 Step 4/6、A3 Step 8）。
3. **B1 红测按新事实**（盒减量 + 新锁定 `I` + 取货标签记录），**不期待被拒**（B1 Step 1）。
4. **B1 校验去除双扣**：只按**当前盒余量 + 任务未拣需求**；历史 `SUM` 只审计；既有 `I` 累计校验保持（B1 Step 4）。
5. **`scan_logs.source_container_id=B`**（同一条记录），不给 `B` 另插 `scan_logs`（B1 Step 5）。
6. **A1/A3 后端幂等**：`extractRequestKey` + `beginResourceOperationRequest`/`completeOperationRequest` 同 conn、action 绑定盒 id、稳定键重放（A1 Step 2、A3 Step 2）。
7. **fill 只按来源全部**，不设可选 `qty`；`expectedSourceQty` 作并发快照守卫（A1 接口块）。
8. **A1 反向断言 5 种**；**partial 50 移为旧接口兼容用例**（A1 Step 6/7）。
9. **PDA 路由登记文件 `frontend/src/router/pdaRoutes.tsx`**；repack 允许 `Σqtys = 盒余量`，不沿用 `q >= remaining` 拒绝（A3 Step 3/9）。
10. **B3 写实**：分拣确认 + `sorting_bin_items` 防重唯一键；装箱 `label_container_id` 配额与回收；新旧同商品混合守卫；**取消与减量各自真实路径**（B3、B4）。
11. **测试证明真实缺功能/风险**，不只 404/类型缺失（各 Task Step 1/绿测口径）。
12. **最小新增**：2 列 + 1 新表（`inventory_containers.is_mixed_batch`、`scan_logs.source_container_id`、`package_items.label_container_id`、`sorting_bin_items`），编号当场 `max+1`，不改旧迁移。

---

## B 审查修订（2026-09-29，**仅设计，未实施**）

> 依据 Codex 现场只读核对与本次复核。**批 A 收尾优先，本节不实施。**

### R1 分拣必须接真实进度链，不能只插新表

**链路与逐步顺序以 Task B3 正文为唯一出处**（本节**不再重复抄写**，避免两套描述互相漂移；凡两处不一致，一律以 B3 为准）。

要点：
- 分拣**并非只有查询**：PDA 分拣页已有 `handleBinScan` → `sort-done` → `sortTaskWithinTransaction` 的完整推进链（锁任务行、范围/设备仓、取消与改单闸、状态规则、`begin/replay`、分拣格与扫码闭合、写 `sorted_qty`、状态推进）。原计划「只有查询、无写入」的判断**已作废**。
- **取货码（新 `I` 码）接进度的正确方式**：让它成为这条链上「可被归属到某任务 + 某格位」的输入，**不新造平行的写入路径**——
  - 分拣动作仍走 `sort-done`，由服务端在**同一事务内**解析取货码 → 定位其所属任务与格位 → 落到既有 `sorted_qty` 与状态推进；

**取货码（新 `I` 码）接进度的正确方式**：让它成为这条链上「可被归属到某任务 + 某格位」的输入，**不新造平行的写入路径**——
- 分拣动作仍走 `sort-done`，由服务端在**同一事务内**解析取货码 → 定位其所属任务与格位 → 落到既有 `sorted_qty` 与状态推进；
- 若仍新增 `sorting_bin_items`，它只能是**作业记录/防重**（`UNIQUE(task_id, container_id)`），**绝不能被当成「分拣完成」的事实源**；`scanProduct` 的旧商品码路径必须继续可用；
- 重试必须按**同一稳定键重放原成功结果**（`sortTaskWithinTransaction` 已有 `replay` 分支），不得一律 409，更不得绕过该分支另写一条；
- 设备仓与范围校验在**服务层**：`pdaSessionRequired()` 只保证票据有效，**不自动核对目标任务仓**，必须显式比对。

### R2 复核必须真实扫码，不得凭新表推断

复核沿 `check` 链：先**真实扫到刚生成的 `I` 码**并落 `scan_logs`（用途 `CHECK`），再由 `checkDone` 触发 `assertTaskCheckScanClosure`（**锁定集合 == 扫码集合**）。新 `I` 码若没有真实进 `scan_logs`，闭合校验必然失败——因此**禁止**用新表数据伪造「已复核」。

### R3 type 11 新用途必须审完整链，不能只加两处

现场只读事实：`frontend/src/types/print-template.ts:2` 的 `TemplateType` 仅 `1..10`；后端模板接口的 type 查询与权限映射同样只到 10；`printFieldDefs.ts` 标签字段/示例、设置页编辑器、预览、补打链都需一并核对。
绑定与相关逻辑的**实际路径**是 `backend/src/modules/printer-bindings/`（**不是** `print-jobs/printer-bindings.routes.js`）。
**不得**因为「`labelRasterDefaults` 加了 11 + 入队加了一处」就声称新标签可编辑/可预览/可补打。扩展需覆盖：前后端类型定义、模板权限映射、编辑器与预览、补打按 `ref_type` 的过滤与配额。
同时：**这些是「新增 type 11 尚未具备的能力」，不是旧产品的缺陷**——不得表述成既有 bug。

### R4 其余 B 待审点（沿用原文，未变）

首个容器锁之前先取维度锁、数量 `DECIMAL(_,2)`、任务 + 格位绑定、稳定键重放、装箱 `min(required, checked)`、商品码与标签互斥配额、按 `labelContainerId` 分行、删除/作废回收、取消与减量各自真实验证。
