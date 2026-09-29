# 批 B（B1+B2）实施交接 · 2026-09-29

> 状态：**B1 + B2 已本地实施、测试 17 项全绿，已经独立审查接受；未提交、未发布。**
> 下游 B3a（取货码分拣 + 复核真实 CHECK）见 `docs/plastic-box-batch-b3a-handover-2026-09-29.md`（**待独立审查**）。
> 本文件记录范围、证据、夹具处置与**仍未验**事项，供独立审查。

## 1. 范围（本轮已授权）

- **B1**：扫塑料盒 `B` 取货 → 生成**本任务锁定的新整件码 `I`**（销售取货独立身份）。
- **B2**：该新码的**独立取货标签**（`pick_label` / 模板 type 11）——用途解析、绑定/回退、变量取值、模板链、补打链。
- **不做**：B3（分拣/复核/装箱）、B4（取消/减量闭环）。

## 2. 代码改动

**后端**
- `backend/src/database/266_scan_logs_source_container_id.sql`（新，幂等）：`scan_logs.source_container_id` + 索引。
- `backend/src/engine/containerEngine.js`：新增 **`extractFromPlasticBoxToTask`**——锁序**任务 → 维度 → 容器**；`createContainer` **携带 `isMixedBatch`**；**批次/日期继承**（盒混合 ⇒ 三项全空；盒单批 ⇒ **继承真实 `batch_no`/`mfg_date`/`exp_date`**）；库存日志取 **`syncStockFromContainers` 真实快照**；新 `I` 置 `locked_by_task_id`。
- `backend/src/modules/scan-logs/scan-logs.service.js`：
  - **范围/设备仓校验前移到幂等 `begin` 之前**（覆盖**首次与重放**；`pdaWarehouseId` 由 controller 传入）。
  - **B 分支只对 `sale_out`（兼容历史 null）且 `container_type=2`**，位置在**旧 I 的累计 SUM / 5 秒去重 / 整件去重 / `lockContainer` 之前**——盒不锁给任务、不进 `scan_logs.container_id`。
  - PICK 行落**新 I**，`source_container_id` 记盒；数量按**当前盒余量 + 未拣需求**判定。
  - **取货标签入队不做 broad catch**：预期降级由入队内部落 FAILED 记录；**打印记录存储本身失败照常冒泡回滚**。
- `backend/src/modules/scan-logs/scan-logs.controller.js`：传 `pdaWarehouseId: req.pda?.warehouseId ?? null`。
- `backend/src/modules/print-jobs/print-jobs.label-command.js`：新增 **`enqueuePickLabelJob`**（`jobType='pick_label'`/`templateType=11`，`jobUniqueKey=pick_label:<scanLogId>`；**变量读取与渲染分别定界**：来源缺失落 FAILED、读取异常落 FAILED、渲染失败落 FAILED）；**`reprintInboundBarcode` 按 `source_ref_type` 分派**（取货码走 `pick_label`；定位不到 PICK 行则明确 409 `PICK_LABEL_SOURCE_MISSING`，不臆测恢复）。
- `backend/src/modules/print-jobs/labelVariables.js`：`SOURCES[11]`（变量取自**真实 PICK 行**，保留 `d.barcode`；**筛选 `scan_purpose=PICK`、`source_ref_type='plastic_box_pick'`、排除 VOID**）；by-id 对 11 用 **`sl.id`**；`vars` 增加 type 11 分支。
- `backend/src/modules/print-jobs/print-dispatch.js` / `printer-bindings.routes.js` / `labelRasterDefaults.js` / `labelZplTemplate.js` / `print-jobs.service.js`：`pick_label` 用途、绑定白名单、type 11 光栅默认与模板类型、导出转发。
- `backend/src/modules/print-templates/print-templates.routes.js` / `.service.js`：type 11 的预览权限、**`TYPE_NAME`/`validateLayout`/`paperSize`/`applyAsTypeDefault` 全部放行 11**（否则「保存成功但实际打印不生效」）。

**前端**
- `frontend/src/hooks/useOfflineScan.ts`：`submitScan` **返回后端回执**（泛型，**流程语义不变**）。
- `frontend/src/pages/pda/task.tsx`：`pickAction` 改 `useCriticalPdaAction<PickScanResult>`；新增 **`notifyPickResult`** 统一提示（**正常提交与「查回执」恢复共用同一文案**；缺设备/渲染失败按 `reason` 分开说）；**仅恢复路径在 `onConfirmed` 提示**（`ctx.recovered`），避免与 `handleScan` 双发。
- `frontend/src/types/print-template.ts`、`frontend/src/constants/printFieldDefs.ts`、`pages/settings/print-templates/editor.tsx`、`pages/settings/printers/index.tsx`：`TemplateType`/字段/示例/默认画布/编辑器选项/**绑定类型**均加 11 与 `pick_label`。

## 3. 测试（`tests/plastic-box-pick.smoke.test.js`，**17 项**）

命令（显式回环专库 + Node 22 + 可写下载目录）：

```
set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
export DB_NAME=flowcube_plastic_box_20260929_test NODE_ENV=test APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-pb-downloads
export DB_HOST=127.0.0.1 DB_PORT=3307
node tests/plastic-box-pick.smoke.test.js
```

结果：**17 passed / 0 failed，natural exit 0**（日志 `/tmp/fc-pb-finally.log`）。套件 `finally` 现在**逐笔断言每个 HTTP 响应并只读回查**：`[INFO] 自建销售夹具 17 笔，收尾核对通过 17 笔，失败 0 笔`——**任何收尾失败都会计入 `failed` 并自然 `exit 1`**（不再无条件报"已收尾"）。用例：

1. 核心：盒 200→50、生成锁定本任务的新 `I`(150)、PICK **只落新 I** 且 `source_container_id=盒`、总量守恒
2. 同键重放：返回原回执、不新增新 `I`、不二次扣盒
3. 合法第二次取货（新键）：不被历史 SUM / 5 秒挡、`picked_qty` 为两次之和
4. 盒取 **1 个**（`scanMode=散件`）也应成功（不被当非法）
5. 超盒内实存 ⇒ **4xx（非 5xx）** 且零副作用
6. 旧「扫整件 I」路径**不回归**（锁 I 本身、`scan_logs` 指 I、不生成新 I）
7. 范围校验**覆盖重放**
8. 设备仓校验**覆盖重放**
9. 取货标签入队：`jobType=pick_label`、变量取自 **PICK 行**（数量=60）、同键重放不重复
10. 取满：盒 200 分两次 100+100 取空
11. 批次/日期继承：单批继承真实 `batch_no`/`exp_date`；混合则全空
12. **补打**：真实走 `/api/print-jobs/barcodes/reprint`，用途仍 `pick_label`，**容器/量/scan 数不变**
13. 降级①：**无可用打印机** ⇒ 落 `status=3`、业务已提交、回执标明未打印
14. 降级②：**渲染失败** ⇒ 落 `status=3`、原因写明 `label render failed`、业务已提交
15. 超**任务未拣量** ⇒ 4xx 且零副作用
16. 盒绑商品 ≠ 任务商品 ⇒ **引擎层独立拒绝**（直调，绕过 service 更早闸）
17. 新建 **type 11** 模板后自动成为该类型默认，**且实际渲染使用新布局**

**红测证据（先失败后通过）**：先写核心用例跑出 `盒余量应减到 50` 失败（旧码只锁 B 不减、不产生新 I），再实现后转绿（`/tmp/fc-pb-b1-red.log`）。

**Codex 独立复跑（2026-09-29，非本会话自证）**

- Node 22 实跑本套件 **17/17，natural exit 0**，日志 `/tmp/flow-plastic-box-pick-codex-review-20260929.log`；本轮 **17 笔销售夹具清理核对 17/17**。
- 全专库 `pb-pick` 历史 **180 笔全 `task=8`、锁定容器 0**；**stock 缓存差异 0**。
- 前端 `tsc`（app config）+ **6 个前端文件 eslint**、**12 个后端文件 eslint** 均 exit 0；`test:label`（raster **18/18**）、`test:print`、`agents-md-guard`，以及此前 `engine-transaction` / `stock-cache-write` / `qty-precision-coverage(6/6)` 均通过。

> **边界**：以上**不代表** GUI、**物理打印**或**整个批 B** 完成——**B3/B4 未开始**；未验项见 §4。

**夹具**：全部由真实业务链建立（采购→收货→上架、销售→占库→发货）；**未手改锁/状态/库存**。
**收尾**：`saleToTask` **逐笔登记** `createdSales`，套件 `finally` 按自建 ID 走 `/sale/:id/cancel` → `cancel-return-detail` → `/scan-logs/cancel-return` 归还（失败也不中断）。**历史遗留** `pb-pick-*` 另按白名单脚本一次合法收尾：**129 笔全部取消、锁定容器 0**；`pb-neg-*` 与 GUI 历史**未触碰**。

## 4. 证据边界与仍未验（如实）

**断言所处层次（不可一概称「HTTP 全链已验」）**

- 走 **HTTP 全链**：核心转移、同键重放、合法第二次、取 1 个、超盒存 4xx、旧 I 不回归、标签入队、取满、批次继承、**补打**、两类打印降级、超未拣量 4xx、type 11 模板保存。
- 走 **service 直调**：范围校验覆盖重放、设备仓校验覆盖重放（沿用批 A 的范围重放口径）。
- 走 **engine 直调且事务 rollback**：**盒绑商品 ≠ 任务商品**——只证明**引擎层**会独立拒绝，**未**走 HTTP 全链。
- **未实跑**：**盒被锁定**的反向用例——构造它需要真实存在「已锁定给某任务的盒」，而本批合法入口取货只锁**新 `I`**、不锁盒，当前**无合法入口**可造，故**未验**（引擎对该情形是「任何非 null 锁均拒绝」，仅有代码与注释，**无测试证据**）。

1. **GUI 全程未跑**（本轮未启浏览器/服务）：PDA 拣货页在「扫盒取货」后的**文案显示**（新取货码/取货量/打印状态，含缺设备与渲染失败的**分流文案**）、以及**丢响应 → 查回执**是否显示原结果（`ctx.recovered` 单点提示）——**代码已改但未在真实界面验证**。
2. **物理打印**未验：`pick_label`/type 11 的**真机出纸**与版面未验；模板**编辑器/预览页**的实际交互未验（仅验证了「保存即默认」+「实际渲染使用新布局」）。
3. **渲染失败**属**真实入口的异常注入**（`require.cache` 打桩 `LABEL_RENDER_BUSY` + 模板返回 null），**不是**真实 worker 故障，也**不是**物理打印失败。
4. **减量/归还后的补打恢复**：`warehouse-tasks.adjust.js` 的 `reducePickScanLogForContainer` 会**减少或 DELETE 原 PICK 行**，届时 `readLabelVariables(11, {id: scanLogId})` 取不到来源——当前实现**明确 409 `PICK_LABEL_SOURCE_MISSING`**，**不宣称「减量/归还后可补打」已支持**；该项**留待 B4**。
5. **B3/B4** 未开始（分拣/复核/装箱、取消/减量闭环）。
6. **17 项仅为本阶段证据**，不等于批 B 全部验收。

## 5. 资源

- 本轮**未启动**常驻服务与浏览器；测试进程自起自停（`finally` 关服务与连接池），核验无残留监听。
- 共享 **3307** MySQL 保留；未触碰其它任务资源。
- **未提交、未打 tag、未发布。**

## 6. 续接要点（供 B3 / B4 在同一会话继续）

- **B1/B2 代码已定稿，不重做**：源码、测试、文档均已落地（见 §2/§3）。B3/B4 只做**扩展点**，不改动已验的 B1/B2 行为。
- **应接入的真实调用链**（不要新造平行路径）：
  - **分拣**：`frontend/src/pages/pda/sort.tsx` `handleBinScan` → `PUT /api/warehouse-tasks/:id/sort-done` → `warehouse-tasks.sort.js` `sortTaskWithinTransaction`（真实顺序：锁任务行 → `assertTaskScope` → 取消闸 → 改单闸 → **状态规则** → **`beginResourceOperationRequest`（begin/replay）** → 分拣格 → 扫码闭合 → 写 `sorted_qty`（**绝对累计量**）→ 状态推进/CAS）。取货码要成为该链上可归属「任务 + 格位」的输入；`sorting_bin_items` 仅作作业记录/防重。
  - **复核**：先**真实扫到新 `I`** 落 `scan_logs`(CHECK)，再 `checkDone` → `assertTaskCheckScanClosure`（锁定集合 == 扫码集合）。
  - **取消 / 减量**：`warehouse-tasks.cancel-return.js`、`warehouse-tasks.adjust.js`——注意 `reducePickScanLogForContainer` 会**减少或 DELETE 原 PICK 行**，届时取货标签的补打恢复需另行设计（当前实现明确 409，见 §4.4）。
- **边界**：**仅本地**；**禁止发布、禁止连接/迁移生产**；不 push、不打 tag；共享 **3307** 与其它任务资源不得触碰。
- **不要在 B3/B4 中把 §4 的未验项当作已通过**（GUI、物理打印、盒锁定反向、错商品 HTTP 全链、减量后补打）。
