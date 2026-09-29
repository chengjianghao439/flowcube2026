# 批 B3a 实施交接 · 2026-09-29

> 状态：**B3a（取货码分拣 + 复核真实 CHECK）已本地实施，套件 19 项全绿；未提交、未发布。**
> **B1/B2 已经独立审查接受**（见 `docs/plastic-box-batch-b-handover-2026-09-29.md` §3）；**B3a 也已独立审查接受**（独立复跑见 §3 末）。
> 本批覆盖范围仅 **API / service / 组件**，**不代表 GUI 与物理出纸**。
> **B3b（装箱配额与回收）与 B4（取消/减量归还闭环）本短批未做。**
> 本文件记录范围、证据、夹具处置与**仍未验**事项，供独立审查。

## 1. 范围（本轮已授权）

- **B3a-分拣**：扫**取货码**（B1 生成的整件 `I`）接入**既有** `sort-done` 推进链，落到 `sorted_qty` 与状态迁移；新增 `sorting_bin_items` 仅作**作业记录/防重**。
- **B3a-复核**：真实扫新 `I` 落 `scan_logs`(CHECK)，再由既有 `checkDone` 走 `assertTaskCheckScanClosure` 闭合。
- **不做**：B3b **装箱**（`package_items.label_container_id` 配额/回收/混合守卫）、B4（取消与减量归还）。

## 2. 代码改动

**后端**
- `backend/src/database/267_sorting_bin_items.sql`（新）：`sorting_bin_items` 作业记录表。`qty DECIMAL(12,2)`；索引按 AGENTS 用**独立幂等 DDL** 补（`information_schema` 判存在 + `PREPARE`）：`uk_task_container(task_id, container_id)`、`idx_bin(bin_id)`。
- `backend/src/modules/sorting-bins/sorting-bins.service.js`：
  - 新增 **`resolvePickCode(code, scopeWarehouseIds)`**——命中容器条码即按取货码处理并**绝不回落到商品码匹配**（否则一张本任务取货码会被错配到别的 SKU 的最早任务）；归属绑定**当前任务下的有效盒取货 PICK 行**（`scan_purpose=1` 且 `source_container_id` 非空）；校验 `wt.deleted_at`、取消闸、**改单闸**、商品与明细一致、任务处于 `2/3`。
  - `scanProduct` 取货码**优先且互斥**；旧商品码路径保留，并新增 `labelTotalQty` / `sortableQty = picked − A`。
- `backend/src/modules/warehouse-tasks/warehouse-tasks.sort.js`：
  - **`begin/replay` 判定前移到状态规则之前**（范围/设备仓、取消闸、改单闸仍在它之前）——否则分拣完成把状态 CAS 成 4 之后，原键重放会被 `assertWarehouseTaskAction('sortTask')` 拦掉，PDA 丢响应后永远查不回原回执。
  - `sortedItems` 支持两种形态：旧 `{itemId, sortedQty}` 与新 `{containerId, binCode}`。
  - **两个聚合严格区分，各自命名、不混用**：
    - **A = `pickLabelTotalQty()`**：该明细**全部有效盒取货量**（含**尚未分拣**的标签）。
    - **C = `confirmedPickLabelQty()`**：**已确认分拣**的标签份额（`sorting_bin_items` 有效记录）。
    - 旧商品码**上限 = `picked − A`**（不是 `picked − C`）：标签份额在**拣货那一刻**就已归属，未扫任何标签时旧码也只能报 `picked − A`，**超限直接拒绝**（不 `Math.min` 静默夹满）。
    - 总进度 **`sorted_qty = 旧码份额 + C`**；`items=null`（整任务完成）同样按 `(picked − A) + C` 写，**不是恒等式填满**，标签没扫完就不推进。
    - 取货码分拣超量**拒绝**（`PICK_CODE_EXCEEDS_PICKED`）而非截断。
  - 取货码项**真实锁分拣格**（任务 → 格位 → 容器）并复查 `current_task_id`/`status=2`/`warehouse_id`/`code`，不再只比任务行上的快照。
  - 容器 `FOR UPDATE` **之前先无锁 peek** 归属：明显不属于本任务的取货码立即拒绝，**不先锁住他任务的容器资源**（反向扫描时避免拖住对方）；正式锁到手后再复查一次。
  - **支持边界（第一期）**：单个请求**最多一张取货码**，多于一张由服务端**显式拒绝**（`PICK_CODE_MULTIPLE_NOT_SUPPORTED`），不依赖「PDA 一次只扫一张」这种隐含假设；请求内明细数上限 50。批量取货码需要「事务内先聚合记录、一次 `VALUES` 批量写入 + 按最终明细集合批量 `UPDATE`」，本期不做。
  - 旧路径对**原始输入**先做 `assertQtyPrecision`（两位小数 + 整数商品整数约束）**再**参与运算，避免静默舍入。
- `backend/src/modules/scan-logs/scan-logs.service.js`：`createCheckScanLog` 加 **`pdaWarehouseId`**；**范围/设备仓校验前移到幂等 `begin` 之前**（覆盖首次与重放），**行锁到手后再复查一次**。
- `backend/src/modules/scan-logs/scan-logs.controller.js`：透传 `pdaWarehouseId`。
- `backend/src/modules/warehouse-tasks/warehouse-tasks.controller.js`：`sortDone` 透传 `operatorName`（作业记录留痕）。

**前端**
- `frontend/src/pages/pda/sort.tsx`：
  - 扫到取货码时按 `{ containerId, binCode }` 提交，商品码保持 `{ itemId, sortedQty }`；两条路都走同一个 `sort-done`，**不新增平行接口**。
  - `BinHint` 增加 `isPickCode` / `containerId` / `scannedCode`；商品码路径用 `sortableQty`（= `picked − A`）。
  - **待确认冻结原目标**：`handleProductScan`、`scanner`、`取消/重扫` 按钮都受 `submitBlocked` 约束。
  - **冻结记录持久化原目标**（task/item/containerId/原 barcode/bin/qty）；待确认期间页面显示**冻结记录**里的定位（重挂后 hint 已丢失，不从新 hint 取数）。
  - **恢复按 `data.allSorted` 区分部分进度与整任务完成**，恢复成功重置扫码态并 `refetch`；`resolveServerState` **校验 metadata**（正整数 task/item、非空 binCode），残缺/旧版记录一律**不推断成功**。
- `frontend/src/api/sorting-bins.ts` / `frontend/src/api/warehouse-tasks.ts`：`SortScanResult`、`SortDoneItem` 联合类型。

## 3. 测试（`tests/pick-code-downstream.smoke.test.js`，**19 项**）

命令（显式回环专库 + Node 22 + 可写下载目录）：

```
set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
export DB_NAME=flowcube_plastic_box_20260929_test NODE_ENV=test APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-pb-downloads
export DB_HOST=127.0.0.1 DB_PORT=3307
node tests/pick-code-downstream.smoke.test.js
```

结果：**19 passed / 0 failed，natural exit 0**（`/tmp/fc-pb-b3a-green.log`）。用例：

1. 扫取货码精确解析自身任务/明细/格位与 PICK 有效量，**不回落他 SKU**
2. 分拣原键重放①：纯旧商品码路径（整件 `I` 直接拣 ⇒ A=0），完成 3→4 后重放返回原回执、不重复推进
3. 分拣原键重放②：新取货码路径，同上且不新增作业记录
4. 复核设备仓 ≠ 任务仓必须拒绝（**service 直调**）
5. 复核限仓范围校验必须覆盖重放（**service 直调**）
6. 取货码经真实 `sort-done`：任务 3→4、`sorted_qty` 推进、落一条 `sorting_bin_items`
7. 同一明细连续两张取货码：`sorted_qty` 为两张之和（非第二张的值）
8. 他任务取货码 → 拒绝且零进度副作用
9. 实扫分拣格与任务占用格不一致 → 拒绝（服务端独立校验，不只靠前端）
10. 真实复核扫码：落 CHECK 行、`checked_qty` 累加、全量后自动进入待打包(5)
11. 复核同键重放返回原回执；新键重复扫同一取货码被拒
12. **混合来源两种顺序**（旧50→标60→标90 / 标60→标90→旧50）逐步累加不覆盖，**未扫完标签不得完成**
13. **反向**：未扫任何标签时旧码最多报 `picked − A`（含未分拣标签），报满量被拒
14. **整任务完成（`items=null`）按份额写**：未扫标签时只能写 `(picked − A) + C`，不得填满
15. 分拣**进度中（任务仍 3）**原键重放返回原回执；**换新键**重复同一取货码被拒
16. 分拣**范围 / 设备仓校验覆盖重放**（service 直调，沿用批 A 口径）
17. 复核**设备仓覆盖重放**；他任务取货码不能复核且 `checked_qty` 不变
18. 旧 `sortedQty` **三位小数必须 4xx**，且不产生任何进度（不静默舍入）
19. **支持边界**：一次提交多张取货码被服务端**显式拒绝**（4xx、明确文案），零进度、零作业记录

**红测证据（先失败后通过）**：红测阶段 **8 条失败**全部指向目标缺陷——取货码解析缺失、原键重放被状态规则挡在 replay 之前、复核无设备仓/无范围重放校验、新形态未支持、拒绝理由走格式而非归属。日志 `/tmp/fc-pb-b3a-red.log`。

**受影响的既有回归（本批自跑）**
- `tests/concurrency-guards.smoke.test.js`：**121 passed / 0 failed**（含 `sort-done` 传 `json: {}` 的 `items=null` 路径）
- `tests/sale-adjustment.smoke.test.js`：**72 passed / 0 failed**
- `tests/plastic-box-pick.smoke.test.js`（B1）：**17 passed / 0 failed**

**前端**
- `frontend/src/pages/pda/sort.test.tsx`（新，**4 passed**）：冻结定位来自**冻结记录**、扫码入口与取消重扫在待确认期间禁用、恢复 `allSorted=false` 说**部分进度**（不得说整任务完成）、`allSorted=true` 才说进入待复核、非恢复路径不重复提示。
- `tsc --noEmit -p tsconfig.app.json` exit 0；4 个前端文件 eslint exit 0；5 个后端文件 eslint exit 0。
- **前端全量单测的失败（归因范围严格限定）**：`npm run test:unit` 有 **15 个文件**失败。**已归因的只有 3 个代表文件**——在 **HEAD 基线 worktree**（未含本批改动）复跑 `DataTable.test.tsx` / `client.session.test.tsx` / `report-states.test.tsx`，**37/37 全失败**，据此只能说这 3 个与本批无依赖路径。**其余 12 个文件未做基线复跑、未归因**，**不得**当作「已确认非本批引入」。

**迁移 metadata（独立核对，2026-09-29）**：`sorting_bin_items` **列数 9**；`qty` = `decimal(12,2)`；索引按**名字与列序**核对：`PRIMARY(id)`、`uk_task_container(task_id → container_id, unique)`、`idx_bin(bin_id)`。**未连生产**。

**夹具**：全部由真实业务链建立（采购→收货→上架、销售→占库→发货、扫盒取货、ready、sort-done、复核扫码）；**未手改库存/状态/锁**。
**收尾**：`finally` 按自建 ID 逐笔 `/sale/:id/cancel` → `cancel-return-detail` → `/scan-logs/cancel-return`，**逐个断言响应**并只读回查 `task=8 且自身锁 0`，失败计入 `failed` 自然 `exit 1`；本轮 **24 笔全通过**。自建分拣格**逐格 `try/catch`** 删除，失败只 WARN 且**不跳过后续 `close`**。

**Codex 独立复跑（2026-09-29，非本会话自证）——结论：B3a 独立审查接受**

- Node 22 实跑本套件 **19/19，natural exit 0**，日志 `/tmp/flow-plastic-box-downstream-codex-20260929.log`；本轮 **24 笔销售夹具清理核对 24/24**。
- 全专库 `pb-down` 历史 **249 笔任务全 `task=8`、锁定容器 0**；**stock 缓存差异 0**；无自有监听端口 / 浏览器残留。
- 前端 `sort.test` + `sort.scan-ui` **两文件 6/6，natural exit 0**；`tsc`（app config）、**4 个前端文件 eslint**、**5 个后端文件 eslint**、`sql-identifier` guard、`git diff --check` 均 exit 0。
- 独立 metadata 核对：`sorting_bin_items` **9 列**、`qty` = `decimal(12,2)`、索引的**名字与列序（含 unique）**均与设计一致。
- 逐张取货码的**单码边界**经审查认为合理，**本期维持**（不做批量取货码）。

> **边界**：以上证据仅覆盖 **API / service / 组件**，**不代表 GUI 或物理出纸**；其它全套回归留待发版前。

## 4. 证据边界与仍未验（如实）

- 走 **HTTP 全链**：1、3、6、7、8、9、10、11、12、13、14、15、17（错 task 段）、18、19。
- 走 **service 直调**：2（重放口径沿用批 A）、4、5、16、17（设备仓重放段）——**不得**统称「HTTP 全链已验」。
- **未实跑**：`sorting_bin_items` 的 `uk_task_container` 冲突在**真实并发**下的表现（仅顺序重复）；分拣格在**抢锁期间被主管改配**的时序（只有锁后复查的代码路径，无并发夹具）；**多张取货码的批量写入路径**（本期显式拒绝，未实现）。
- **1. GUI 全程未跑**：本轮未启浏览器/服务。分拣页扫取货码后的提示、待确认定位展示、恢复文案均**代码已改但未在真实界面验证**。
- **2. 物理打印**未验（B2 遗留，未变）。
- **3. 取货码容器的生命周期未端到端验证**：新 `I` 被取消/归还后可合法作为普通整件给**下一个任务**再拣，此时容器上 `source_ref_type='plastic_box_pick'` 仍是**历史来源、不会自动变**。本批已按要求把归属判定绑到「**当前任务 + 有效盒取货 PICK 行 + 非空 `source_container_id`**」，`resolvePickCode` 与两个聚合都不选旧 task 的 PICK——但**「取消归还 → 再拣 → 该码不再算新任务标签」这条端到端链未实跑**（属 B4 范围）。
- **4. B3b 装箱 / B4 取消减量**：未实施。
- **5. 19 项仅为本阶段证据**，不等于批 B 全部验收。

## 5. 资源

- 本轮未启动常驻服务与浏览器；测试进程自起自停。共享 **3307** MySQL 保留，未触碰其它任务资源。
- 基线取证用的临时 worktree（`/tmp/fc-b3a-baseline`）已 `git worktree remove --force` 清理。
- **未提交、未打 tag、未发布。**

## 6. 续接要点（B3b / B4）

- **本批代码定稿，不重做**：`sort-done` 的 replay 前移、A/C 两个聚合、格位真实锁、取货码互斥解析、`createCheckScanLog` 的前置与锁后双校验。
- **B3b 装箱**（未做）：`package_items.label_container_id` 配额与回收；`addItem` 新旧两种入参；**旧商品码最多消费「未被取货标签覆盖的已复核量」，新标签只消费自己的未装配额**，合计不得超任务需求量（同一 A/C 思路：上限依据是标签**占走的量**，不是已装配量）；`removeItem`/`voidPackage` 按 `label_container_id` 释放配额；`pack.tsx` 默认数量改为标签未装余量。
- **B4 取消/减量**（未做）：`warehouse-tasks.cancel-return.js`、`warehouse-tasks.adjust.js`；注意 `reducePickScanLogForContainer` 会**减少或 DELETE 原 PICK 行**，届时取货标签的补打恢复需另行设计（B2 当前明确 409 `PICK_LABEL_SOURCE_MISSING`）。
- **边界**：**仅本地**；禁止发布、禁止连接/迁移生产；不 push、不打 tag；共享 **3307** 与其它任务资源不得触碰。
- **不要把 §4 的未验项当作已通过**（GUI、物理打印、并发冲突、取货码容器生命周期、装箱与 B4）。
