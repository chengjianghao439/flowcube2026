# 列表导出筛选透传修复 + 首轮全项目调查记录（2026-09-27）

> 执行：Claude，工作树 `claude/happy-mahavira-0a2b4b`（起点 `29f223e`，与 `main` 一致；本批两个本地提交见 §5）。方向与独立验收：Codex。
> 这是**持续记录**：覆盖矩阵、已确认缺陷、在途分支状态、验证边界、下一步。
> 规则已同步 `docs/finance-permission-time.md`（§2026-09-27）；命令说明已同步 `docs/verification-commands.md`。**未改 `AGENTS.md`**（遵嘱）。
> **状态：P1 已本地提交 `865d8f3`（未推送、未部署）——代码层与页面手工验收均已通过。页面验收只证明「筛选请求携带条件 + 返回 200 Excel MIME」，未确认文件落盘。**
> **P3（作废容器补打）已本地提交 `5f6ede9`（未推送、未部署），并已通过独立 GUI / 代码 / 数据库验收；见 §7。**
> **P2（成本口径）已本地提交 `0f4198e` + `f01ad51`（未推送、未部署），并已通过独立 GUI 验收（下载落盘未确认）；见 §3、§10。**

---

## 1. 本批改动（P1：对账单导出丢筛选）

### 1.1 缺陷

页面筛了、导出不过滤：`frontend/src/components/shared/StatementPanel.tsx:66-75`（及 `ReceiptPanel.tsx:71-80`）把
`statementNo/receiptNo/partyName/status/startDate/endDate/minAmount/maxAmount` 发给 `/export/statements`（`/export/payment-receipts`），
而后端只读取 `type/status/keyword`：

| 函数 | 位置 | 修复前透传 | 列表接口支持 |
|---|---|---|---|
| `getStatementsExportPayload` | `backend/src/modules/export/export.service.js` | 3 | 11（`reconciliation-statements.findAll`） |
| `getPaymentReceiptsExportPayload` | 同上 | 3 | 9（`payment-receipts.findAll`） |
| `getPaymentsExportPayload` | 同上 | 14 | 16（`payments.findAll`）——**2026-09-18 审计已修，是正确样板** |

后两者是同根因的漏网实例（"同一防护只装一半"）。**为何长期不可见**：既有
`tests/prelaunch-scope-export.smoke.test.js` 的导出循环恰好只断言 `keyword`——而 `keyword`
是当时唯一被正确透传的参数，其余参数无人验证。

**实际影响**：把别的往来方的账款一并导出，用户拿这份表去和对账页核对时会把**其他客户的金额交给对方**。属对外信息泄露，不只是数字不符。

### 1.2 改动文件

| 文件 | 用途 |
|---|---|
| `backend/src/modules/export/export.service.js` | 补透传：statements 补 8 项（含 `customerId`/`partyId`），receipts 补 6 项；新增 `optionalFilterId` 把可选 ID 的空串规范为 `null`（否则 `Number('')=0` 会 400） |
| `tests/export-list-filters-passthrough.test.js` | **新增**纯离线契约测试：从 `findAll` 签名解析筛选键，断言导出全部透传 |
| `tests/prelaunch-scope-export.smoke.test.js` | 导出循环的 stub 由「只断言 keyword」改为「断言全部透传」 |
| `package.json` | 新增 `test:export-filters` |
| `.github/workflows/test.yml` | static job 接入 `test:export-filters` |
| `docs/finance-permission-time.md`、`docs/verification-commands.md` | 规则与命令同步 |

`customerId`/`partyId`：导出路由 `/export/statements` 无参数白名单（`req.query` 全量进 controller），故一并透传；
前端当前不发这两个，透传为后续前端补筛选留出通路。

### 1.3 验证证据

| 验证 | 结果 |
|---|---|
| 修复前（新增测试） | 4 用例 **2 failed**（receipts 漏 6、statements 漏 8），**payments 通过** → 证明测试不是"必然失败" |
| 修复后（新增测试） | **4 passed / 0 failed** |
| 反向验证 A（摘 statements `partyName`） | 仅 statements 那条红，报错指名 `partyName` |
| 反向验证 B（`optionalFilterId` 改恒等） | 仅空串用例红，报错 `空串 customerId 必须规范为 null/undefined 后透传，实收 ""` |
| 真实库行为（回环 `flowcube_operations20260912_test` @ 127.0.0.1:3307，精确自洁） | 修复后：筛选 `partyName=A` → 导出 **1 行（仅 A）**；反向摘掉透传 → 导出 **122 行（全量，混入 B）** |
| `smoke:prelaunch-scope-export` | 修复后 **34 passed / 0 failed**（原 31 + 新增 3 条透传断言）；反向摘 receipts `partyName` → 仅 receipts 那条红 |
| `tests/deployment-resources.test.js` | **26 passed / 0 failed**（含 #25「每个 smoke/test 脚本必须 CI 可达」） |
| `npm run test:export`（既有回归） | 3 passed / 0 failed |
| `npm --prefix backend run lint` | 退出码 0 |
| **页面手工验收**（**Codex** 于真实浏览器实操，2026-09-27） | 在专用回环库 `flowcube_ui_export_test` 上，**对账单与收款单分别筛至一条后点击导出**：浏览器网络请求**确实携带了筛选条件**并返回 **200 + Excel MIME**。**边界**：**IAB 下载事件未捕获**，因此**不能声称文件已保存到磁盘**——只证明了「请求带筛选、响应正确」。 |

> `deployment-resources.test.js` 首次运行时 11 项失败，经**基线对比**（用 `git show HEAD:` 换回原标题文件）确认
> **基线同样 11 项失败、项号逐一相同**——根因是 `frontend/node_modules` 未装（`Cannot find module js-yaml`），
> 属环境问题，与本次改动无关。装前端依赖后全绿。

## 2. 首轮全项目调查 · 覆盖矩阵（2026-09-27）

| 区域 | 深度 |
|---|---|
| 销售主链（占库→拣货→复核→出库→取消→改单） | 已读实现（`sale.service.js` `cancel`/`deleteOrder` 全读） |
| 退货返货链 | 已读实现 |
| 财务期间闸门 | 已读实现 + **独立核实**：`assertFinancePeriodOpen` 确在三条资金入口（payments / payment-receipts / refund-orders） |
| 会计凭证 / 成本口径 | 已读实现 |
| 对账单 / 导出 | 已读实现（全链）+ **本轮实跑验证** |
| 打印 / 补打 | 已读实现 + **本轮实跑验证 + 独立 GUI 验收**（补打中心：作废行禁用补打、业务状态与最近任务结果并存） |
| 库存引擎 / 缓存 | 已读实现 + 守卫对照 |
| 权限 / 仓库范围 | 已读实现 + 红线标识符批量扫描（23 项中 22 项命中；唯一"缺"实为 SQL 生成列 `active_unique_guard`，非漂移） |
| 定时任务 / 恢复重试 | 仅定位（`scheduler.js` 13 个 worker） |
| 审批流（业务后果侧） | **部分已查**：三条链的发起/审批/拒绝/撤回/待办（见 §9.3）；发票 / 薪资 / HR / 固定资产**仍为盲区** |
| PDA 真机 / 物理打印 | **仍为盲区**（未做） |
| 浏览器实操 | **已做**：P1 的导出页与 P3 的补打中心均由 **Codex** 在真实浏览器实操（见 §1.3、§7.4） |
| 权限码语义（P6） | **已扫**：294 条写路由全量扫描，见 §9 |

## 3. 已确认缺陷清单（P1 / P2 / P3 已在本轮修复；其余未动）

| # | 问题 | 状态 |
|---|---|---|
| **P1** | 对账单/收付款单导出丢筛选 | **本批已修 + 已接 CI + 已实跑** |
| P2 | 成本口径分叉（**原缺陷，已修，此处保留根因**）：报表成本当时写 `COALESCE(cost_snapshot, cost_price, sale_price, 0)`，而凭证侧是 `COALESCE(cost_snapshot,0)`——快照为空且无进价时报表退到**售价**当成本，报表毛利与会计成本口径对不上 | **本轮已两轮修复**（去售价回退 + 行级来源下沉），并已独立 GUI 验收；见 §10.7 |
| P3 | 补打中心可补打已作废容器：`print-jobs.label-command.js:518` 只过滤 `deleted_at`，而 `inbound-tasks.void.js:149-151` 置 VOID 时不动 `deleted_at` → 打出 qty=0 的无效标签 | **本轮已修复**，并通过独立 GUI / 代码 / 数据库验收（见 §7） |
| P4 | ~~占库口径与「当前可拣现货」不同~~ → **已核为明示设计，非缺陷**：`docs/business-semantics.md:15`「**可承诺与当前可拣分开**」明确两者**本就不该同口径**——ATP 可承诺量按上式计算；界面「当前可拣现货」只汇总同仓未被其他任务整容器独占的 ACTIVE 容器，**仅作作业可执行性参考**，不增减合法预占。原「可用量可能虚高」的推测据此**撤回** | **已核清，非缺陷** |
| P5 | 数据新鲜度：`queryClient.ts:15` `refetchOnWindowFocus:false` + 5min `staleTime` | 机会项，**未动** |
| P6 | 权限码"选得对不对"无机械守卫（`route-permission-contract.test.js:15` 自陈只判"有没有"） | **本轮已扫**（294 条写路由）：7 处挂只读类权限码，**逐一核对后 7 处均为设计选择、未发现越权**；守卫的盲区仍在（它不判"选得对不对"），但本轮抽样没有因选错码而失守；见 §9 |
| P7 | 测试夹具自洁缺口未逐个排查（`warehouse-scope` 等） | 盲区，**未动** |
| P8 | ~~审批流未纳入一致性调查~~ → **业务后果侧已查三条链**（授信/采购申请/改价）。**曾发现 1 条真实缺陷并已修**：改价审批写入 `product_price_history.old_price` 原先用**申请时刻**的值（注释却称"审批瞬间读取当前价"），手工改价或并存申请时历史旧值会失真；现改为**审批事务内对商品行 `FOR UPDATE` 读真实当前价**，商品缺失/软删时 **fail-loud 409 `PRICE_CHANGE_PRODUCT_MISSING` 回滚整个审批事务**（不留"已批准却未改价"）。发票 / 薪资 / HR / 固定资产**仍未覆盖** | **部分已查；1 条真实缺陷已修（`PRICE_CHANGE_PRODUCT_MISSING` 回滚 + 历史旧价取审批瞬间当前价），见 §9.3** |

## 4. 在途分支（不属于本轮，未触碰）

`codex/fix-audit-f1-f2-f5-f6` @ **`5d04014`**（2026-09-27 04:45）：基于当前 `main` 的**未合并、未推送**分支，
含 F1（撤回收货在途了结）/F2（费用报销期间守卫）/F5（print-jobs 仓库范围）/F6（容器拆分幂等）
+ 4 个新 smoke（`inbound-void-transferred-container` 等）+ `AGENTS.md`/主题文档同步，2661+/45−。

**与本批无冲突**：`5d04014` **未触碰** `export.service.js`、`reports.query.js`、`print-jobs.label-command.js`。
但注意它**也改了 `.github/workflows/test.yml` 与 `package.json`**——若两者先后合入需解决这两处的文本冲突（本批只加 1 个脚本条目与 1 个 CI 步骤）。

## 5. 验证边界（未验证 / 未做）

- **提交状态**：P1 已本地提交 `865d8f3`、**P3 已本地提交 `5f6ede9`**；两者均**未推送、未部署**，全批未 push / 未 tag / 未发版。
- **PDA 真机、物理打印**：未做（本轮全程未触发物理打印）。
- **浏览器实操——已做**：P1 的导出页面与 P3 的补打中心均由 **Codex** 在真实浏览器实测（P3 为高风险独立验收，见 §7.4）。
- **`desktop` 依赖未安装**：本轮未跑桌面端任何检查（改动不涉及桌面端）。
- **未跑全量回归**：只跑了与本改动相关的套件（见 §1.3、§7.3）。发版前须按 `AGENTS.md` §3 对本批全部改动统一跑受影响端的 lint/类型检查/构建与专项回归。
- **前端**：P1 未改前端（`StatementPanel`/`ReceiptPanel` 本就发送全部参数）；P3 改了前端，已跑 `tsc -p tsconfig.app.json` 与**前端全量单测 627/627**。
- 本机环境：Node 22（`source dev-env.sh`）、测试库 `flowcube_operations20260912_test`（回环 **3307**，colima profile `flowcube`）。
  **未连接 3306 主库**。

## 6. 下一步建议

1. ~~独立验收本批（代码层）~~ —— **已完成**：Codex 复核新测试 4/0、既有导出 3/0、`smoke:prelaunch-scope-export` 34/0、
   CI 接线守卫 26/0、后端 lint、文档守卫、`git diff --check` 全部通过。
2. **页面手工验收——已完成**（2026-09-27，**Codex** 在真实浏览器实操）：对账单与收款单各筛至一条后点击导出，
   网络请求确实携带筛选条件、返回 200 + Excel MIME。**IAB 下载事件未捕获，不能声称文件已保存到磁盘**（见 §1.3 末行）。
3. ~~P3 方案复核 / 排期~~ —— **已完成并实施**：Codex 指出的两处（`voided` 的显示/筛选/计数一致性、「先读状态再入队」的并发竞态）
   与后续补的两项（真实 `voidReceipt` 路径、`readLabelVariables` 的 latest 分支）均已解决，并已通过独立验收，见 §7。
4. ~~P3 待授权后提交~~ —— **已完成**：本地提交 `5f6ede9`（未推送）。后续**推送 / 发版**仍等业务方授权。
5. **可选加固**：给 `export.service.js` 的列表导出加一条通用约定/守卫——新增导出函数时自动比对对应
   `findAll` 签名（把本批的测试口径从"点名的三个"推广到"全部列表导出"），避免第三个漏网实例。

---

## 7. P3：撤回收货后作废容器条码仍可补打、已排队任务仍可领取（已实施 · 已独立验收 · 已本地提交 `5f6ede9`）

**本轮方案边界（Codex 基于现行规则作出的判断；用户未单独就此表态）**：只禁止 `VOID`；`EMPTY`/`PENDING_PUTAWAY`/`PENDING_QA`/`REJECTED` 不扩大限制；保留打印历史并展示作废原因与最近打印结果；撤回事务内终结对应 PENDING 任务，**PRINTING 不宣称可撤销**；保证状态显示、筛选、计数、后端补打权限/状态校验一致。

### 7.1 机制（调查结论，全部带出处）

`voidReceipt` 把容器置 `VOID(3)` 并归零，收货单只回到**「待收货(1)」**（`inbound-tasks.void.js:179-192` 的 `voidReceipt: from:[2,3,4] → to:1`），**不删 `print_jobs`**；列表显示只按 `print_status` 派生、`container_status` 查询了却没用；`canReprint: true` 三处硬编码；补打接口原本无状态校验、无事务无锁。在途侧更直接：`claimClientJobs`（`print-jobs.dispatch.js:33-45`）只查任务状态与打印机归属、**不校验业务对象**，且 `print_jobs.status` 没有「取消」态、全仓没有取消路径——已入队的 PENDING 任务在容器作废后仍会被领取出纸。
**「已取消收货单」路径不存在**：`cancel` 要求零容器（`inbound-tasks.command.js:821-825`），而有容器的单不能取消，故 `inboundStatusClause('cancelled')` 在该列表恒空（另行记为独立小缺陷，未在本轮处理）。

### 7.2 改动文件

| 文件 | 用途 |
|---|---|
| `backend/src/modules/print-jobs/print-jobs.status.js` | 引 `CONTAINER_STATUS`（单一事实源）；`normalizeBarcodeRecordStatus` 白名单加 `voided`；`deriveInboundBarcodeStatus` 增 voided 优先分支 + `voidReasonLabel`；新增 `CONTAINER_VOID_MESSAGE` |
| `backend/src/modules/print-jobs/print-jobs.query.js` | `inboundStatusClause` 增 `voided` 分支并让**其余每个分支排除 VOID**；inbound 行输出 `canReprint` 按状态计算 + `voidReason`；导出该子句供契约测试 |
| `backend/src/modules/print-jobs/print-jobs.label-command.js` | `reprintInboundBarcode` 改**单事务 + 容器行 `FOR UPDATE`**；校验状态并抛 `PRINT_BARCODE_CONTAINER_VOID`；同 conn 入队 |
| `backend/src/modules/print-jobs/print-jobs.dispatch.js` | 新增 `voidPendingPrintJobsForContainers`（只动 PENDING，置 `FAILED` + `container voided`） |
| `backend/src/modules/print-jobs/print-jobs.service.js` | 转发导出上述函数 |
| `backend/src/modules/inbound-tasks/inbound-tasks.void.js` | 撤回事务内调用终结函数（与置 VOID 同事务） |
| `backend/src/modules/print-jobs/labelVariables.js` | 容器（type=6/9）取变量排除 VOID：**by-id 与 latest 两个分支都排除**（latest 分支供 `print-templates.preview.js` 挑样例数据） |
| 前端 `constants.ts` / `types/print-jobs.ts` / `utils/displayFormatters.ts` / `barcode-print-query/index.tsx` | 状态选项、类型、标签与「（原因：…）」展示 |
| `tests/print-barcode-void-guard.test.js`（新，纯离线） | 派生/归一化/逐分支筛选/不扩大限制 |
| `tests/print-barcode-void.smoke.test.js`（新，独立库） | 拒绝且不新增任务、终结 PENDING、两种并发顺序、产品补打确实持锁、列表筛选计数一致、**latest 取样排除 VOID** |
| `tests/print-barcode-void-receipt.smoke.test.js`（新，独立库） | **真实 `voidReceipt` 全链**：容器 VOID、单据回退「待收货(1)」、未领取任务终结且不可领取；**撤回被拒时不误终结** |

### 7.3 验证证据

| 验证 | 结果 |
|---|---|
| 新增离线契约（修复前） | **4 failed / 1 passed**（对照组通过 → 证明不是必然失败） |
| 新增离线契约（修复后） | **8 passed / 0 failed**（补缺口①②与「两维度分离」断言后的**最终值**；2026-09-27 本轮复核复跑确认 8/0） |
| 新增 smoke（独立库 `flowcube_printvoid_test`，自洁残留 0） | **11 passed / 0 failed**（补 latest 取样与「两状态并存」断言后的**最终值**；本轮复核复跑确认 11/0、RC=0） |
| **新增 receipt 路径 smoke**（独立库，真实 `voidReceipt`） | **12 passed / 0 failed** |
| `smoke:print-queue`（相关回归） | 14 passed / 0 failed |
| `test:query-loop` / `test:stock-cache-write` / `test:engine-transaction` | 均 PASS |
| `test:print-entry`（补打唯一入口） | PASS |
| 后端 lint / 前端 `tsc -p tsconfig.app.json` / 前端 lint | 退出码 0（31 个既有 warning 全在其他文件） |
| CI 接线守卫 `deployment-resources` | 26 passed / 0 failed |

**反向破坏验证（8 项，均精准红）**：① 去掉「其余筛选排除 VOID」→ 离线 §4 + 真实库「success 混入已作废行」；② 去掉补打侧 VOID 拒绝 → smoke §2、§6；③ 去掉 voided 派生分支 → 离线 §1 + 真实库「voided 筛选含非作废行」；④ 去掉产品补打的 `FOR UPDATE` → §7b「补打在锁被持有期间就完成」；⑤ 终结函数改 no-op → §5、§7；⑥ 去掉 `readLabelVariables` latest 分支的 VOID 排除 → 取样断言红；⑦ 后端把 `latestJob.statusKey` 回退为行级派生 → smoke「作废行同时给出业务状态与最近任务结果」红；⑧ 前端状态列忽略 `barcodeStatusKey` → 组件用例红（⑦⑧ 的构造与留档见 §7.6）。

**两次「反向验证抓出测试自身缺陷」（勿重蹈）**：
- **§7b 第一版用耗时阈值判定**，而测试自己固定等 300ms，把等待也算进去 ⇒ 恒真。改为判定「补打是否在容器行**仍被别人锁着**时就已结束」后才有效。
- **latest 取样断言第一版是假通过**：夹具条码写成 `${code}I9001`（以随机前缀开头），而该分支自带 `d.barcode LIKE 'I%'`，**根本不命中**，断言自然为真。改为 `I${code}9001` 后，反向 ⑥ 才精准红。

**并发口径的两点修正（重要，勿改回）**：
- **§7 通过并不依赖补打持容器锁**：撤回的 `UPDATE` 会去锁「并发插入的 PENDING 任务行」，未提交的新任务同样被挡住，终结逻辑自兜。故**不能**用「零新增记录」当断言——合法的「补打先成功、撤回随后提交」本就该留下一条历史 job。
- 因此另立 **§7b** 直接验证「产品补打确实在容器行锁内执行」：判定方式是「补打是否在容器行仍被别人锁着时就已经结束」（**不能用耗时阈值**——测试自身固定等待会把它算进去，恒真；这一点是被反向验证 ④ 抓出来的）。

### 7.4 未验证边界

- **PDA 真机、物理打印未做**（本轮全程未触发任何物理打印）。
- **GUI 页面实操——已完成**（**Codex** 高风险独立验收，2026-09-27）：补打中心筛 `voided` 只 1 条、筛 `success` 只 1 条；
  VOID 行禁用补打；ACTIVE 点击补打得「未绑定打印机，本次未出纸」，库内 `printers=0`、无 PENDING；
  **VOID 同一行明确显示「条码已作废 / 原因：入库撤回」与「最近任务：已打印」**。夹具与运行环境见 §7.5。
- **`voidReceipt` 走的是真实 service**（`print-barcode-void-receipt.smoke.test.js`），覆盖成功撤回与 409 拒绝两条路径；但**未覆盖**「撤回与补打真并发」在同一瞬间的业务交错（并发由夹具级 smoke 的两种顺序覆盖）。
- `EMPTY`/`REJECTED`/`PENDING_QA`/`PENDING_PUTAWAY` **不收紧**——这是**本轮方案判断**（只对 VOID 收紧），**不是用户单独表态的决定**；如业务上另有着眼，需要重新评估。

### 7.5 GUI 验收环境（2026-09-27 备好）

- **库**：`flowcube_ui_export_test` @ `127.0.0.1:3307`（回环，非 3306 主库）；后端 `:3000`（PID 见下）、ERP 前端 `:5173`。
- **页面路由**：`http://localhost:5173/#/settings/barcode-print-query`（补打中心，入库条码）。
- **合成条码**（筛选关键字 `IGUI-`）：

  | 条码 | 容器状态 | 预期展示 |
  |---|---|---|
  | `IGUI-VOID-601401` | VOID(3)，qty=0 | 「条码已作废」+「（原因：入库撤回）」+ **补打按钮禁用** |
  | `IGUI-ACT-601401` | ACTIVE(1)，qty=10 | 「已打印」+ 补打按钮可用 |

- **不触发物理打印/领取**：该库 **printers = 0**、无打印客户端；任何补打尝试只会落一条 `printer_id=NULL / FAILED / no printer available` 的记录，**不会出纸、不会被领取**。
- **所需权限**：页面列表 `print.job.view`、补打 `print.job.reprint`。现有临时账号（财务专员）**不含**这两个权限，需要 admin 或已授权的账号访问。
- 接口层已自测（字段语义见 §7.6）：`IGUI-VOID-601401` 返回 `barcodeStatusKey=voided / voidReason="入库撤回" / latestJob.statusKey=success / canReprint=false`；`IGUI-ACT-601401` 返回 `canReprint=true`。自测时临时授予的 `print.job.view` **已精确移除（残留 0）**。

### 7.6 GUI 验收发现的修正：作废吞掉了「最近任务结果」（2026-09-27）

**问题**（**Codex** 在页面上发现）：VOID 行原本只显示「条码已作废，不能再补打（原因：入库撤回）」，而该行最近一次打印任务其实是 **DONE**——**「已打印」这个事实被作废状态整个覆盖掉**。根因是行级业务状态与任务结果**共用了 `latestJob.statusKey` 一个字段**。

**修正**：拆成两个维度，同一条记录里并存——

| 维度 | 字段 | VOID 行取值 |
|---|---|---|
| 条码**业务状态**（行级） | `barcodeStatusKey` / `barcodeStatusLabel` | `voided` /「条码已作废」+ 原因「入库撤回」 |
| **最近任务结果**（任务级） | `latestJob.statusKey` / `printStateLabel` | `success` /「已打印」 |

- 后端：`deriveInboundPrintJobResult`（纯任务结果）从 `deriveInboundBarcodeStatus`（行级：作废 > 取消 > 任务结果）中拆出；因作废被撤回终结的任务新增 `voided_job` →「未出纸（容器已作废）」，**不复用「打印失败，可尝试补打」**；其余任务结果语义不变。
- 前端：`barcodeStatusBadge`（业务状态，含原因小字）与 `jobStatusBadge`（任务结果）分开；列名改为「条码状态」与「打印机 / 最近任务」，结果列加「最近任务：」前缀。出库/物流条码没有行级业务状态，退回任务结果，**行为与改动前一致**。
- 未把 VOID 放回 `success` 筛选，也未恢复补打。

**复验**（接口层，重启后端后）：`IGUI-VOID-601401` → `barcodeStatusKey=voided` + `latestJob.statusKey=success`（**并存**）+ `canReprint=false`。

**新增反向破坏 ⑦⑧**（均精准红）：⑦ 后端把 `latestJob.statusKey` 回退为行级派生 → smoke「作废行同时给出业务状态与最近任务结果」红；⑧ 前端状态列忽略 `barcodeStatusKey` → 组件用例「作废行同时显示两者」红。

**新增测试**：离线契约 3 条（任务级派生分离/未出纸文案/其余语义保持）、smoke 1 条（两状态并存）、前端组件 2 条 + 格式化 1 条。

---

## 8. P4 核对结论（2026-09-27，只读）

**P4 撤回，判为明示设计**：`docs/business-semantics.md:15` 的条目名就是「**可承诺与当前可拣分开**」——ATP 可承诺量按上式计算；界面「当前可拣现货」只汇总同仓未被其他任务整容器独占的 ACTIVE 容器，**仅作作业可执行性参考**，不增减合法预占；扫描与出库仍由事务内的容器锁与预占检查最终裁决。**两者本就不该同口径**，此前记录的「取消/拣货窗口期可用量可能虚高」属误读，不再追踪。

---

## 9. P6 权限码语义深查（2026-09-27，只读，**未改业务代码**）

**方法**：全量扫描 63 个 `*.routes.js` 的 **294 条写路由**（POST/PUT/PATCH/DELETE），提取其挂载的权限码，筛出「**写方法 + 只读类权限码**」的可疑组合（含 `view`/`read` 等字样）。

**结果：7 处可疑，逐一核对后全部判为设计选择，未发现越权。**

| # | 路由 | 权限码 | 判定与依据 |
|---|---|---|---|
| 1 | `locations:13` POST `/:id/print-label` | `LOCATION_VIEW` | **设计选择**：行内注释「库位标签打印（**只读业务，无需写权限**）」——入队打印不改库存 |
| 2 | `plastic-boxes:21` POST `/:id/print-label` | `INVENTORY_VIEW` | **设计选择**：同上口径（注释同）|
| 3 | `racks:13` POST `/scan-hint` | `RACK_VIEW` | **设计选择**：扫描提示，只读语义 |
| 4 | `print-templates:27` POST `/render-label` | `PRINT_TEMPLATE_VIEW` | **设计选择**：模板渲染预览，只读业务 |
| 5 | `dashboard:27` PUT `/layout` | `DASHBOARD_VIEW` | **设计选择**：仅影响本人的看板布局偏好 |
| 6-7 | `price-change:24/25` POST `/:id/approve`、`/:id/reject` | `APPROVAL_TASK_VIEW` | **设计选择**（有过初判为越权，**已被反例推翻**，见下） |

### 9.1 初判被推翻的记录（重要，防止后人重复误判）

**我曾把第 6-7 项判为「真实越权」——该判断是错的**，原因是只追到 `price-change.service.js` 就下结论，**漏追了审批引擎**。完整链路是 **routes → service → engine 两层闸门**：

- `price-change.service.approve/reject` 只做状态校验，随后调 `approvalEngine.approveStep` / `rejectStep`；
- `approvalEngine.js:143-153` 的 `assertCanApproveTask`：**超管（`roleId===1`）豁免，其余一律按 `approval_instance_task_approvers` 的当前节点快照校验 `user_id`**，不在快照即 **403 `APPROVAL_NOT_ASSIGNED`**；
- `approveStep`（:159）与 `rejectStep`（:188）**都调它**。

**合成反例（真实引擎、独立库，残留 0）**：造最小审批实例，快照里只放「审批人 A」，用三个合成 operator 走真实 `approveStep`：

| operator | 结果 |
|---|---|
| 快照外普通用户（`roleId=5`，模拟持有 `approval.task.view` 的只读角色） | **拒绝：`APPROVAL_NOT_ASSIGNED`（HTTP 403）** |
| 快照内审批人 | 放行（status=2） |
| （超管 `roleId=1` 按代码豁免，本轮未单测） | — |

⇒ **仅凭 `approval.task.view` 无法审批**，路由那一层只是入口粗筛，真正的裁决在引擎的快照校验。**故判为设计选择，不是越权；也不建议新增独立审批权限码**（现机制已足够）。

### 9.2 P6 的本义仍然成立

`route-permission-contract.test.js:15` 自陈「只做『有没有』的机械判定，不试图判断权限码选得对不对」——**这个盲区确实存在**（否则不会需要人工逐一核对这 7 处）。但**本轮抽样没有因选错码而失守**。若要机械化治理，方向是「建立权限码语义分类（读/写/管理）+ 断言写路由不得挂只读类码」，**仍需为每条例外写明理由**——本次这 7 处的注释正是范例。

**证据索引**：`/tmp/p6-scan.js`（扫描）、`/tmp/p6-approval-probe.js`（反例）；代码 `price-change.routes.js:24-25`、`price-change.service.js:157-190`、`engine/approvalEngine.js:142-189`、`constants/permissions.js:233-235`、`tests/route-permission-contract.test.js`。

### 9.3 审批链的业务后果侧（2026-09-27，只读）

挑三条**有业务后果**的链，追发起 → 指派/代办 → 同意/拒绝 → 撤回 → 重复提交 → 事务失败与状态回写。

| 链 | 审批通过的实际副作用 | 拒绝 / 撤回后 | 判定 |
|---|---|---|---|
| 授信超额放行 `credit-overrides` | **无持久副作用**——放行不是"改额度"，申请单只作为凭据，**出库时按客户/额度/本单净额快照核对** | 引擎 `rejectStep` + 状态→已驳回（记 `reject_reason`）/ `cancelInstance` + 已取消；同一事务 | **设计选择，自洽** |
| 采购申请 `purchase-requisitions` | 实例**最终**通过才 2→3 已批准；**不碰库存/账款** | `cancelInstance`（同事务）+ `submitted_at=NULL` | **设计选择，自洽** |
| 改价 `price-change` | **唯一有业务后果**：`applyApprovedPrice` 改 `product_items` 对应价格列 + 写 `product_price_history` | 状态机 `cancel: from [1]`（未生效）⇒ **已生效改价不可能被撤销** | **设计选择，自洽** |

**三链共性**：

- **待办不遗留**：`approvalEngine.cancelInstance` 把 `approval_instance_tasks` 中 `status=1` 的置 3（`comment='申请人撤销'`），而 `listPendingTasks` 只取 `status=1` ⇒ 撤销后不会留下悬挂待办。
- **权限两层**：业务侧 `assertOwner`/`assertInScope` + 引擎侧 `assertCanApproveTask`（按 `approval_instance_task_approvers` 当前节点快照，超管豁免）。
- **并发保护是「行锁 + 状态机 + CAS」，不是幂等重放**（**订正**：本节初版写"三链均走 `beginOperationRequest`"**有误**）。`rg` 实测：`credit-overrides.service.js` **0 处**、`price-change.service.js` **0 处**、`purchase-requisitions.service.js` **3 处但全在 `convert`（创建类）**——**submit / approve / reject / cancel / withdraw 一个都没有**，路由层也没有 `X-Request-Key` 中间件。
  真实保护是：每个动作先进事务 → `lockStatusRow`（业务单据行锁）→ `assertStatusAction`（状态机）→ `compareAndSetStatus`（CAS）；引擎侧再加 `lockActiveInstance`（`approval_instances FOR UPDATE`）与 `lockCurrentTask`（`task.status=1 FOR UPDATE`，节点已被处理时 **409 `APPROVAL_CONFLICT`**）。
  ⇒ 必须区分：这是「**状态机 / 行锁拒绝**」——第二次请求返回 400/409 且**不产生重复副作用**；**不是**「同一 `X-Request-Key` 返回原回执」的**幂等重放**。两者都"防重复"，但**对调用方的语义完全不同**，不可混称。

**待验收风险（本轮只读，未实测）**：

1. **重复提交的语义是"失败"而非"重放"**：客户端若把 409/400 当网络错误**重试**，用户会看到"操作失败"而实际**已成功**。**这不是数据不一致**（状态机确实挡住了重复副作用），但与本项目其它走 `beginOperationRequest` 的写路径**契约不一致**；审批类动作是否也需要幂等键，属**待业务/产品判断**。
2. **`applyApprovedPrice` 缺"已应用"标记，且注释与代码不符**：其跳过条件是 `if (!req || Number(req.status) !== 2) return`，注释写「**已应用过**或非通过态，跳过」——但**状态为 2（已应用）时并不会跳过**，代码实际只挡"非通过态"。它**只有 1 个调用点**（`approve` 内、`compareAndSetStatus(toStatus:2)` 之后），且第二次 `approve` 会被 `assertStatusAction('approve', 2)`（`from [1]`）拒绝 ⇒ **当前不可达**。但若将来引入**重试 / 修数据入口**，会**重复改价并重复写 `product_price_history`**。**属待验收风险，非当前缺陷**。

3. **改价审批的历史 `old_price` 可达失真 —— 真实缺陷（2026-09-27 复核，同轮已修）**：
   - `price-change.service.create()` 在**申请时刻**读 `product_items` 当前价写入 `price_change_requests.old_price`；
   - `applyApprovedPrice()` 的注释声称「审批通过**瞬间读取当前价**做 `old_price` 快照」，**但代码并不重读**：`UPDATE product_items SET <col>=? WHERE id=?` 只用 `req.new_price`，`INSERT product_price_history` 的 `old_price` 直接用 **`req.old_price`** ⇒ **注释与实现不符**；
   - **可达性已核**：① `create()` **不阻止**同商品并存申请（无 `EXISTS`/状态检查）；② `products.service.update()` **能直接改** `sale_price_a/b/c/d` 与 `cost_price`——**不经审批**（前端只把「申请改价」引导到审批页，接口本身未拦），且它写 history 时用的是**真实当前值**（那侧是对的）。
   ⇒ 两条路径都会让该审批写入的历史 `old_price` 与**真实变更前价格**不符。**后果限于审计追溯**（`product_price_history` 的旧值失真）；**不影响**当前售价（`new_price` 照写，最终价正确）、库存或账款。
   - **已按此边界实施**：`applyApprovedPrice` 在同一事务内 `SELECT <price_col> ... FROM product_items WHERE id=? AND deleted_at IS NULL FOR UPDATE` 取**审批瞬间真实当前价**作历史 `old_price`；`price_change_requests.old_price` **保留为申请时展示快照**（语义不变）；商品缺失/软删时 **fail-loud 抛 409 `PRICE_CHANGE_PRODUCT_MISSING` 回滚**（`return` 会 commit 出"已批准却未改价"）。**未动**状态机、并存申请规则、审批覆盖价格语义。回归 `npm run smoke:price-change-history`（含软删回滚反例）；反向破坏：把历史旧价改回 `req.old_price` → 该条精准红。
   - **附带**：产品删除**已**受 `price_change_requests` 引用保护（`products.service.js:271`），**正常删除路径不可达**，不构成本条的前提。

**本轮未发现其他真实缺陷**。**未覆盖**（未实测，属推测或盲区）：同意与驳回**并发**到达；`allow_self_approve` 的授予边界；各链**发起时无匹配审批流**的行为（文档称返回明确业务错误，本轮未逐链实测）；发票 / 薪资 / HR / 固定资产。

**证据索引**：`credit-overrides.service.js:118-190`、`purchase-requisitions.service.js:203-245`、`price-change.service.js:139-200`、`engine/approvalEngine.js:205-220`（`cancelInstance`）、`constants/documentStatusRules.js`（`priceChangeRequest` 状态机）。

---

## 10. P2 成本口径深查与实施（2026-09-27）

> **状态**：§10.1–10.6 是**只读深查**（当时未改口径）；**§10.7 是随后经业务方授权实施的最小修复**，已本地提交 `0f4198e`（未推送）。阅读时不要把两段的时态混起来。

### 10.1 先分清两种「不同」

- **A. 真实数值分叉**：同一笔业务，凭证与报表算出**不同成本**（有证据）。
- **B. 经营估算与会计成本口径本就不同**：报表侧是**经营估算**；凭证侧是**成本记账口径**（快照记账、成本未知即 0，**并不是一张完整会计利润表**——它不含费用与税等）。**用途不同、允许不同**，本身**不是缺陷**。

两者的分界不在于"数字不同"，而在于**报表在最坏情况下会拿「售价」当成本**——那不是另一种估算口径，而是**失真**。

| 层级 | 表达式 | 出处 |
|---|---|---|
| 快照产生 | `COALESCE(p.avg_cost, NULLIF(p.cost_price, 0))` | `warehouse-tasks.ship.js:231-241`（注释：「**利润分析用快照口径**，避免改进价导致历史毛利漂移」） |
| **凭证（会计）** | `cost_snapshot ?? 0` | `voucher-sale-periods.js:80`；退货侧 `voucher-engine.js:344` 同口径 |
| **报表（经营）** | `COALESCE(cost_snapshot, NULLIF(cost_price,0), sale_price, 0)` | `reports.query.js:705 / 730 / 853` |

### 10.2 触发条件与来源（**不是"唯一一种"**）

**真正的分叉条件**：`cost_snapshot IS NULL` **且报表侧回退值非零**（回退值也为 0 时两侧同记 0，不算分叉）。

快照为空有几种来源，须分开表述：

1. **出库时就算不出成本**：`avg_cost` 为空 **且** `cost_price = 0`。`cost_price` 是 `NOT NULL DEFAULT 0`，迁移 119 只给 `cost_price > 0` 的商品初始化 `avg_cost` ⇒ 未设进价的商品出库即得 NULL 快照。
2. **历史 NULL 快照**：迁移 119 之前出库的行**从未固化过快照**，与"当时有没有成本"无关。
3. **出库后主档价变化**：快照已固化的行**两侧都读快照，不会分叉**；但快照为空时，报表取的是**当前** `cost_price`——它随后续改价变化，**同一张历史单在不同时点会看到不同的报表成本**，而凭证侧始终记 0。这是"报表可漂移、凭证不追溯"的另一面。

综上：早期这条记录写成"未设进价的商品出库"**过窄**——它只是来源 1 的一种情形，且**单有 NULL 快照还不足以分叉**。

### 10.3 同库探针（合成夹具，独立库 `flowcube_printvoid_test`，残留 0）

场景：商品 `cost_price=0 / avg_cost=NULL / sale_price=100`。

| 明细 | 数量 | 快照 | 凭证口径 | 报表口径 | 分叉 |
|---|---|---|---|---|---|
| 1 | 10 | **NULL** | **0** | **1000** | **是** |
| 2 | 4 | 50 | 200 | 200 | 否（对照） |

**service 级坐实**：同库调 `fetchProfitAnalysisRows`（`/api/reports/profit-analysis`）→ `costAmount=1200 / gross_profit=800`；而凭证口径为 **200**。差额 1000 = `10 × 售价100`。

### 10.4 结论：哪些是问题、哪些不是

- **「两种口径存在差异」本身**：**允许**——报表是经营估算、凭证是会计利润表，用途不同，**不判为缺陷**。
- **「售价当成本」是真失真**：快照为空且 `cost_price=0` 时报表退到 `p.sale_price`。**它不等于"毛利恒为零"**——只有成交净收入恰等于 `数量 × 当前售价` 时毛利才为 0；本轮探针自身就是反例（`saleAmount=2000`、`cost=1200`、`毛利=800`）。准确说法是：**把售价当成本会系统性压低毛利**，偏差大小取决于成交价与当前售价之差 ⇒ **这一处应修**（至少去掉 `sale_price` 这一级回退）。
- **「报表毛利 vs 总账对不上」需业务定基准**：两者对同一批货可相差可观金额（探针里是 1000），若都被当"利润"使用会互相矛盾，需明确以哪一侧为准。注意**凭证侧是成本记账口径**（快照记账、成本未知即 0），并非一张完整的会计利润表（它不含费用、税等），所以严格说是"**报表毛利 ≠ 会计成本口径下的毛利**"，而不是"两张利润表对不上"。

### 10.5 凭证侧**不得**改用现价（明确否决"反向统一"）

把凭证侧改成 `cost_snapshot → cost_price → sale_price` 的**主档回退**是**错误方向**：
- `tests/audit-2026-09-18.smoke.test.js:808` 那条测试（标题即「**★P2**」）**已明确否决「凭主档均价记账」**，确立「成本未知 → 结转 0」，并同时约束出库与退货两侧（否则 1405/6401 单边歪）；
- 还会违背迁移 119 与 `ship.js` 注释共同确立的「快照首次固化、**事后不追溯**」语义，使历史毛利随主档改价漂移。

⇒ 若要统一，方向应是**报表侧向凭证侧靠**，**而不是反过来**。

### 10.6 生产规模**未知**（不得当作已知）

「未设进价的商品有多少、因此受影响的销售单有多少」**完全未知**——需在生产库做**只读统计**，本轮**无授权、未查**。上表所有金额影响只在**合成夹具**上成立，不代表生产现状。

**证据索引**：`/tmp/p2-cost-probe.js`；代码 `warehouse-tasks.ship.js:231-241`、`voucher-sale-periods.js:80`、`voucher-engine.js:331-344`、`reports.query.js:705/730/853`、`database/119_avg_cost_and_cost_snapshot.sql`；测试 `tests/audit-2026-09-18.smoke.test.js:808-875`。

### 10.7 本轮已实施的最小修复（2026-09-27，业务方授权；**已本地提交 `0f4198e`，未推送**）

**只改报表成本这一侧**：
- 利润分析（汇总 / 每单 / 每商品）与经营 KPI 的成本 SQL **去掉 `p.sale_price` 这一级回退**；**保留**迁移 119 已定的「非零现价进价」估算回退。
- 新增两个量：**按当前进价估算的金额**、**完全无成本的明细行数**（利润 `summary`；KPI `costBasis`，**只读补充、不进 `metrics` 数组**，避免多出指标卡）。
- 提示落到**三个可见处**：利润页指标 hint、KPI 页说明、**利润导出表内 `summaryRows`**（文件名只作简短标记——**文件一改名就没了，不能当唯一告知**）。
- KPI 的 `costBasis` **两期都给**：卡片展示"当期 vs 上期 + 环比"，只给当期会漏掉"上期不可靠"的情形；`trend` / `byWarehouse` 的外层聚合没有这两列，故**不输出该键**（避免把"没查"伪报成 0）。
- **未动**：凭证、历史快照、库存事实、生产数据；**库存估值（`total_value`）不在"成本 SQL"范围**，仍沿用原口径。

**续（可定位性，2026-09-27 二轮）**：业务方 GUI 验收发现「汇总提示正确，但缺失成本的订单在榜单里仍显示 100% 毛利且无来源标识」——只有全局汇总**定位不到问题行**。故：
- 销售订单榜 / 商品榜**每行**给出 `costBasis`（`snapshot`/`estimated`/`missing`/`mixed`）+ `estimatedCostAmount` + `missingCostLineCount`；判定在**后端** `costBasisOf`，由**同一个聚合 SQL** 推出、**零额外查询**（销售侧原本已有这两列，商品侧在同 SELECT 内补齐）；
- 页面「成本」列下方给简洁中文小字；**未知态（字段缺失/未知取值）显示「成本来源待核实」，前后端一致——只有显式 `snapshot` 才写「出库成本快照」**（避免滚动更新或漏字段时把"没查到"伪报成"全部可信"）；
- 导出表内新增「成本来源」列（`costBasisText`，与页面同一未知态语义）；导出映射必须透出这三个字段。

回归 `tests/report-cost-basis.smoke.test.js`（4 段：xlsx 读回 / 幽灵表头 / **行级来源 + 导出逐行定位** / 口径）。反向破坏：把 `sale_price` 加回、去掉伪报守卫、`header` 加回、**删掉导出的 `costBasisText` 映射**，四处均精准红。

**独立 GUI 验收（2026-09-27，业务方在隔离库实操）**：两单合计 **销售 2000 / 成本 600 / 毛利 1400**；销售榜的缺失单在**同一成本单元格**显示「成本缺失（1 行按 0 计，毛利偏高）」，估算单显示「按当前进价估算」；商品榜两种提示同样实见。点击「导出排行榜」后，后端日志确认带日期参数的 `GET /api/export/profit-analysis` **返回 200**，工作簿内的单元格内容由本套件的读回断言证明。

> **边界**：**浏览器下载文件是否落盘未确认**——只证明了"请求参数正确 + 响应 200 + 工作簿内容正确"，不等于文件已保存到本地。
> 验收收尾：合成订单/商品**按 ID 删除、残留 0**，标签已关闭，验收服务已停止。

---

## 11. 可接续状态（2026-09-27 收尾）

**本轮验收提交链末端 `ff0291f`**（**未推送、未部署**），含四批修复：

| 批 | 提交 | 内容 |
|---|---|---|
| P1 | `865d8f3` | 对账单/收付款单导出透传列表接口的全部筛选 |
| P3 | `5f6ede9` | 撤回收货后作废容器不得补打、未领取打印任务一并终结 |
| P2 | `0f4198e` + `f01ad51` | 报表成本去掉售价回退；成本来源下沉到榜单每行与导出 |
| P8 | `ff0291f` | 改价审批历史旧价取**审批瞬间当前价**；商品缺失/软删 fail-loud 409 回滚 |

（其间文档订正：`f97d1256` / `e6ac871` / `7be967a` / `63a3057` / `22aa0a3` / `3d63700` / `963e8ee`。）

**边界（重要）**：以上提交**全部仅本地**——**未推送、未打 tag、未发版、未部署**。**未做全量发版验证**（按 AGENTS §3 留发版前统一跑），也**未做生产数据统计** ⇒ 各缺陷的**生产受影响规模仍未知**，需生产只读查询（本轮无授权）。

**待核实风险（未证实，勿当缺陷）**：`products.update` 在**事务外**读取 `current` 价格，再于**事务内**写价与写历史——并发下（同一商品两个手工改价、或与审批通过并发）它写入的 `product_price_history.old_price` 可能**漂移**。**仅静态推断；本轮未复现、未实测**。这与 P8 已修的"审批侧读审批瞬间当前价"是**两件事**，不要混为一谈。

**下一批建议优先级**：
1. **`allow_self_approve`** 的**授予与撤销**边界（授予仅超管；收回是否即时生效、既往待办如何处理）——见 §9.3；
2. **发票 / 薪资 / HR / 固定资产**（§9.3 仍未覆盖的审批与财务盲区）；
3. **P5 数据新鲜度**（`queryClient.ts` 的 5min `staleTime` + `refetchOnWindowFocus:false`；多端协作时看到旧数据，属机会项）。

**环境事实**：验证用测试库 `flowcube_printvoid_test`（回环 **3307**）；夹具按 ID 自洁、残留 0。**主工作树与在途分支 `codex/fix-audit-f1-f2-f5-f6`（`5d04014`）全程未触碰**。

---

## 12. §11 第一优先级调查与修复：`allow_self_approve`（2026-09-27；**调查为只读，其后已实施，见 §12.1**）

**机制（已核实）**：统一入口 `utils/selfApprove.js`——`canSelfApprove(userId)` 直查 `sys_users.allow_self_approve`，**不做缓存**（注释明言：内控收紧必须立即生效）⇒ **撤销即时生效**（对该用户的下一次判定）；授予侧 `users.service.assertCanGrantSelfApprove` **只放行 `roleId===1`**，否则 403 `SELF_APPROVE_GRANT_DENIED`。`approvalEngine.startApproval` 在**提交时**用 `canSelfApprove(applicantId)` 决定是否把申请人保留在审批人快照里。

### A. 已确认值得处理：`price-change` 缺少「审批动作处」的第二层自批断言（**规则漂移**）

`assertNotSelfApproval` 在**五个**模块的 approve/reject 各出现 2 次（共 **10 处**）：`disposal`、`purchase-requisitions`、`credit-overrides`、`purchase`、`finance/expense-claims`。
**`price-change.service.js` 的 `approve`/`reject` 没有它**——它**只依赖**引擎在提交时把申请人剔出快照（**单层**），而其余五模块是**双层**（提交时剔除 **+** 审批动作时重查）。

**可定位行为差异（推断，未实测）**：用户 X 被授予自批 → X 提交改价申请（快照含 X）→ **撤销** X 的授予 →
- 其余五模块：审批动作处 `assertNotSelfApproval` → `canSelfApprove` **重查**（不缓存）⇒ **立即挡住 X** ✓
- `price-change`：无第二层，快照已固化 ⇒ **X 仍能批自己的单** ✗

**共同根因**：`selfApprove.js` 建了统一入口，但 `price-change` 未接入 → 与 §9.3「同一防护只装一半」同源。

### B. 风险未证实（需隔离库反例）

上述差异**本项目只做了静态调用链核对，未复现**。拟验证方式（**未执行**）：在独立回环库造「授予 → 提交 → 撤销 → 审批」四步，断言 `price-change` 的 approve 是否**仍被放行**，并对照 `credit-overrides`（应被 403 `SELF_APPROVAL_FORBIDDEN` 或同义码）——**两侧差异即为证据**。

### C. 既定设计 / 需区分

- **快照不回溯**：`finance-permission-time.md:72`「**运行中的审批实例按既有快照处理**」是**部门负责人**寻人场景的既定设计；**它与自批豁免是两件事**，不能直接套用——自批豁免若也"只认快照"，撤销就永远对既有单无效，而 `selfApprove.js` 的注释明确要求"内收紧紧急立即生效"。
- **两层豁免一致**：`assertNotSelfApproval` 内部**同样**走 `canSelfApprove` ⇒ 授予时两层都放行，行为一致；差异**只出现在"撤销之后"**。

**未做**：全量发版验证、生产统计、隔离库反例（容量受限）。**未改任何代码**。

**建议修复边界（待复核）**：只在 `price-change.service.approve/reject` 补 `assertNotSelfApproval`（与其余五模块同范式），**不动**引擎快照语义、不动授予规则。

### 12.1 已修（2026-09-27 续，安全单元）

**A 类确认并已修**：`price-change.service.approve/reject` 补上 `assertNotSelfApproval`（与其余五模块同范式），修复前**两条红例均被放行**：
1. **超管未授予自批时自提改价 → 自批被放行**。根因叠加：`assertCanApproveTask` 对 `roleId===1` **恒放行**，而 `price-change` 没有动作层的第二层自批校验 ⇒ 引擎的豁免把超管自提的单也一并批过。
2. **普通用户 授予→提交→撤销→自批 被放行**：撤销虽即时生效（`canSelfApprove` 不缓存），但快照已含本人、且 `price-change` 无动作层重查 ⇒ 撤销挡不住既有单；其余五模块因有第二层而在撤销后立即挡住。

**修复位置与理由**：**只在业务 service 的动作处**接入统一入口，**不动引擎**——避免改 `assertCanApproveTask` 的超管分支带来的锁序与全模块副作用。**既有断言的审批操作人已改为流程实际指定的 `smoke_limited`**（原用超管自批，补内控后会被挡，属测试误护旧行为）。

**"本人"必须按两个身份收口（2026-09-27 复核补正）**：只查 `request.applicant_id`（创建人）**仍有绕行**——A 创建/B 提交时，B 是提交人且被纳入节点快照，**B 撤权后可自批**、**B 为超管时被 `assertCanApproveTask` 的 `roleId===1` 恒放行**。故 `approve`/`reject` 现对 **`row.applicant_id`（创建人）与 `active.instance.applicant_id`（提交人）两个身份都做当前授权断言**（相同 ID 去重）；`active` 查询提到断言之前。

**回归 `tests/price-change-history-oldprice.smoke.test.js` 8/0**：P8 旧价、软删回滚、超管自提 403、撤权后自批 403、**A≠B 两身份各自自批均 403**——**approve 与 reject 两条路径都覆盖**（两个身份各自驳回同样断言 `SELF_APPROVAL_DENIED`，实例仍进行中），并断言申请/实例/商品/历史均未变。**反向破坏**：把身份集合收回只查创建人 → **A≠B 那条精准红（"提交人 B 自批…实际 被放行"）**，其余 7 条不受影响。共享夹具 `smoke_limited.allow_self_approve` 的**原值已读取并在 finally 按原值恢复**，超管用例前置断言其授权确为 0。

**新旧待办快照与即时撤销的关系（明确）**：`allow_self_approve` **撤销后**，
- **新提交**：`startApproval` 重查 ⇒ 申请人不再进快照 ⇒ 引擎直接挡；
- **既有未完结实例**：快照**不回溯**，但**动作层的 `assertNotSelfApproval` 每次审批都重查**（不缓存）⇒ **撤销对既有单同样立即生效**。
这两句合起来才是完整语义：**"快照不回溯"针对的是选人名单，不代表"撤销对既有单无效"**。

### 12.2 【已纠正的中间误判 → C】身份语义：只挡「创建人」是错的

**（中间误判，已纠正，属 C）** 本节初版判断"用 `row.applicant_id`（创建人）定义本人即可，B 自批交给引擎按快照处理，故留 B 待定"——**该判断是错的**：A 创建 / B 提交时，B 是**提交人**且被纳入节点快照 ⇒ **B 撤权后仍可自批**；**B 为超管时**被 `assertCanApproveTask` 的 `roleId===1` **恒放行**，即使 `allow_self_approve=0`。已在 **§12.1 纠正为两个身份都收口**（`row.applicant_id` + `active.instance.applicant_id`），并有 **A≠B 回归 + 反向验证**（只查创建人时该条精准红）。

**剩余的唯一待定（归属策略，与自批内控无关）**：`submit` 是否应**禁止 B 提交他人创建的申请**。两个身份的**自批**已经收口；这纯属流程归属策略，单列 **§12.3**。

**本轮未做**：全量发版验证、生产统计。**未推送/未部署**。

### 12.3 归属校验（单列待定，未并入本次改动）

`submit` 目前不校验"只能提交本人创建的申请"，故 A 创建 / B 提交**在数据上成立**——本次**已把两个身份的自批都收口**（§12.1）。**是否应禁止 B 提交他人的单**属**产品/流程决策**，单列待定，不在本安全单元扩大改动。

## 13. 本轮累计验收与续接基线（2026-09-27）

**基线**：工作树 `claude/happy-mahavira-0a2b4b`；§11 的 P1/P2/P3/P8 修复、自批修复（该段末端 `7bf34e4`）与 **§14 的费用报销跨期闸门修复**（`249156e`）均为**本地提交**，未推送、未打 tag、未部署。没有执行生产迁移或修改生产数据。主工作树仍单独保留。

**Codex 独立复核**：检查了用户更新路由与 service 的超管授予边界、`selfApprove` 实时查询、审批实例快照与改价动作调用链；发现并推动修正「只挡创建人」遗漏提交人自批，以及无活跃实例时 409 被 403 抢先覆盖。最终代码在 Node 22、`127.0.0.1:3307/flowcube_printvoid_test` 上重跑 `smoke:price-change-history` **8/0**（夹具残留 **0**）、`smoke:audit-finance-security` **17/0**；后端 lint 通过。改价专项同时覆盖了上一轮的价格历史旧价与软删回滚、超管未授权自批、撤权后的既有待办，以及 A≠B 的同意/驳回双身份拦截。新旧改动在这条已验证链上未出现语义冲突；其余累计范围仍待发版前统一验证。

**A — 已确认且值得立即处理**：本批（§14）新增一条——**费用报销付款缺跨期闸门**（第四条出钱路径，闭期付款会「钱出账户、凭证被跳过、界面无提示」）。已实测红例、已窄修复、已反向破坏验证。除此之外目前没有新的、证据充分而尚未处理的 A 项。不要为填清单制造缺陷。

**B — 继续调查或待决策**：① `price-change.submit` 允许 B 提交 A 创建的申请，是否允许代提交属流程归属策略（§12.3），自批已对两人收口；② **`products.update` 的并发旧价漂移已实测并已修**（**§18.1**：修复前并发 **12/12 轮**历史旧价链断裂；改为「事务内行锁读当前值」后 **0/12**，并做了反向破坏）；**另发现 `sale_price` 与 `sale_price_a` 是两套存储契约**——**修复前**任意商品编辑会把已批准的 `sale_price` **覆盖回 A**，**现已保护**（§18.4 方案三已实施：编辑不再覆写，并补了「真实审批 service → 商品更新 service → 标签消费者」的跨模块回归）；**仍留 B**：**价格权威**（`sale_price` 与 `sale_price_a` 谁是权威售价）**及 A 价审批是否应同步标签价**；**编辑页可见性已于 §18.6 完成**（只读字段 `labelSalePrice` + 只读行 + 审批后缓存失效）；**审批侧一行未改**；③ 发票侧（**§15 已核实、订正初判并已修**）：初版「对已结账期间则静默无效」是**错的**——已结账期间的税额差异是 **fail-loud 409**（销售 `ACCT_SALE_CLOSED_PERIOD_CONFLICT`／采购 `ACCT_PERIOD_CLOSED`，提示反结账）。**实测 A 已修**：界面路径录票时 `createInvoice` 把 `source_type` 写成 **`'invoice_order'`**（不在迁移 182 的约定内）⇒ **即使 `source_id` 正确关联订单，税额也不进任何凭证**；现按类型写约定值、身份与配额解耦、支持「单号」与「显式 id」两种输入（仅给 id 也过配额）、编辑按库内 `cur.invoiceType` 重算。**仍待办**：存量 `'invoice_order'` 的**生产只读评估**（规模未知；修正归属可能触发已结账期间的税额差异/反结账）——评估 SQL 见 §15.6，且**不新增自动改写存量的迁移**；`source_id` 为 NULL 的「先开票后发货」行是**旧写入**的可能遗留状态（**新写入已修**：身份与配额解耦后这类票仍会写入稳定关联）；它与「无单发票」是**另两条不同因果**（后者可能属既定设计）。§15.3 只记录「`invoice_date` 不参与凭证归属」这一**代码事实**，不对税法口径下判断。详见 §15；④ **费用报销的跨期补录通道**——`finance-backfills.service` 无 expense 分支，故报销付款闭期**缺少合规出路，需财务负责人人工决策处理方式**（**不能拿「改日期」当出路**——那是改事实）；§14 已据此把拒绝措辞改为「请联系财务负责人核实处理方式；请勿改动真实付款日期」，是否补齐属**产品待决项**；⑤ P5 多端数据新鲜度仍是机会项，未证实为缺陷；⑥ **`invoice-quota` 的夹具**：四个旧场景、已补自洁（**§17**，只清本轮）；但共享库里**历史遗留**（`fin_invoices` 140 / `sale_orders` 92 / `payment_records` 69，均为测试数据）**仍在、未清理**——**无归属证据就不动**，是否清理属独立决策；§17 另如实记录一处**测试内不一致**：`postInvoice` 未接 `cleanup` 参数（由其调用点手动登记），本批不扩大改动。不要重做 P1/P2/P3/P8。

**C — 已调查且不应重复当 bug**：ATP 与当前可拣量是不同既定口径；`approval.task.view` 只作入口粗筛，节点快照再裁决审批人；「行锁/状态机防重」不是请求键幂等重放；§12.2 的「只挡创建人、提交人由快照保证」已被反例推翻，双身份动作校验已落地；**资金账户余额调整（`finance_account_transactions` 的 `biz_type=4`）本来就不生成凭证**（`voucher-engine.js` 的 `buildFundVouchers` 只读 `IN (1,2,3,5)`），故无「钱动了账不记」；**HR 工资发放与固定资产计提/处置已有期间保护**——工资经 `upsertVoucher` 内部的 `assertPeriodOpen` 抛错回滚，固定资产在 `fixed-assets.service.js` 显式调 `assertPeriodOpen`，二者均非缺陷。

**仍未验收**：物理打印、PDA 真机、生产影响规模、发版前全量检查；不得把本地回归或 HTTP 200 写成这些事项的完成证据。（**浏览器下载文件真正落盘**已于 **§16** 在隔离库 + 本地栈验收通过；仍未验的是其它导出入口与生产环境。）本轮未保留浏览器会话或本地服务。

---

## 14. 跨模块调查：发票 / HR·薪资 / 固定资产 → 共同根因「闸门范围按错集合界定」（2026-09-27；调查只读，其后已窄修复）

**调查范围（有界）**：按 §13 B③ 只追**「资金/凭证写入是否都过会计期间闸门」**这一条跨模块主线，不穷举三模块全文。

### A. 已确认并已修：费用报销付款缺跨期闸门（第四条出钱路径）——**本地提交 `249156e`，未推送**

**共同根因（规则漂移）**：`finance-period.guard.js` 的落点按「**谁写 `payment_entries`**」界定（列了三个入口），而 `voucher-engine.buildFundVouchers` 实际按「**读 `finance_account_transactions` 的 `biz_type IN (1,2,3,5)`**」驱动 receipt_in / payment_out / expense_pay / refund_pay 四类凭证。两个集合**不等价**：费用报销付款**只写资金流水、不写 `payment_entries`**，被整条漏掉。（`voucher-engine.js:557` 的注释本身已预言此漏洞：「一旦命中，说明存在绕过闸门的写入路径」——而它列举的「三个入口」同样漏了报销。）

| 出钱路径 | 资金流水 | 驱动凭证 | 期间闸门（修复前） |
|---|---|---|---|
| 应付付款（直付）`payments.service.js` | ✓ biz 2 | PAYMENT_OUT | ✓ |
| 收付款单核销 `payment-receipts.service.js` | ✓ biz 1 | RECEIPT_IN | ✓ |
| 退货退款出账 `refund-orders.service.js` | ✓ biz 5 | REFUND_PAY | ✓ |
| **费用报销付款 `finance/expense-claims.service.js:pay`** | **✓ biz 3** | **EXPENSE_PAY** | **✗ 缺** |

**证据链（每环可定位）**：入口 `finance.routes.js` 的 `happenedAt` 可选且不限日期、controller 原样透传 → 状态规则 `documentStatusRules.js` 的 `pay` 只查「已批准」、无期间限制 → `pay()` 无闸门、`happenedAt || beijingTodayYmd()` 直接落库 → `buildFundVouchers` 会为 `biz_type=3` 产 `EXPENSE_PAY`（凭证日期 = `happened_at`）→ 落已结账期间会被 `generateVouchers` 跳过（`skippedClosed`）→ `closePeriod` 只校验结转凭证新鲜度、`checkConsistency` 只比对账户余额与流水，**界面无兜底**。

**证据强度（三层，勿混用）**：① 上述链路机制为**代码审阅**；②「闭期付款被放行，且状态／流水／余额三项照常变动」为**实测红例**（见下）；③「该笔流水的 EXPENSE_PAY 凭证确实缺失」为**代码审阅推断**——本轮**未**跑 `generateVouchers`（唯一生成入口、会写销售凭证污染共享库）；且 `logger.warn` 只在「真的去生成凭证并撞上已封期间」时才落，**不是付款当时就记**，界面自始至终无提示。

**可达场景**：界面付款弹窗只传 `accountId`、不传 `happenedAt`（`frontend/src/pages/finance/expenses/index.tsx`），付款日期**恒为今天** ⇒ 真实触发是「**当月已结账后又在本月付款**」（提前结账）；API 侧可传任意历史期间。

**实测红例（修复前，`127.0.0.1:3307/flowcube_printvoid_test`）**：先置 199001 已结账 → 对**已批准未付款**的报销单用 `happenedAt=1990-01-15` 付款 ⇒ **HTTP 200 放行**、单据 `3→4`、新增 1 条 `biz_type=3` 流水、账户余额 `¥0 → ¥-300`。（按业务方要求，红例是「**先结账、再付款**」，不是「先付款后结账」。）

**修复（窄）**：仅在 `expense-claims.service.pay` 的事务内、变更状态/写流水**之前**接入 `assertFinancePeriodOpen`（与其余三条同范式），**不动引擎、不动结账**。闸门置于行锁之前（账套锁为全链最外层，与直付登记、固定资产计提/处置同序「账套 → 单据 → 账户」）；有效业务日期只算一次并与落库共用（避免「判的期间」与「写的期间」错位）。闭期默认 **409 `FINANCE_PERIOD_CLOSED`**、整事务回滚。

**措辞同步**：`assertFinancePeriodOpen` 新增 `backfillHint`（默认 true，既有入口行为不变）；报销付款传 `false`，拒绝消息改为「**请联系财务负责人核实处理方式；请勿为了让系统接受而改动真实付款日期**」——`finance-backfills` 没有 expense 分支，引导补录是走不通的路；而**提示「改用未结账的日期」更糟**：那等于诱导操作人把真实发生的付款日期填成假的，事实失真比账实不符更难查。另外订正 `finance-period.guard.js` 头部过时的「三个入口」说明为「四个入口（写 `finance_account_transactions`）」。

**验证**：`tests/finance-period-guard.smoke.test.js` 新增 **§G**（套件 39 条断言，**39/0**），覆盖「闭期被拦（状态/流水/余额三不动）」与「开放期照常放行」；**反向破坏**：摘掉闸门 → **仅 §G 的 8 条精准红、前六节 31 条不受影响**。另跑 `smoke:finance` **118/0**。共享夹具 `smoke_limited` 的 `finance.expense.approve` 授权**按原值判断**（原本有则不插、收尾也不删）。

### B. 未证实 / 待决策

- **发票的期间语义**（§13 B③，**§15 已核实并订正初判**）：初判「对已结账期间静默无效」**错误**——已结账期间的税额差异是 **fail-loud 409**（销售 `ACCT_SALE_CLOSED_PERIOD_CONFLICT`／采购 `ACCT_PERIOD_CLOSED`，提示反结账）。**实测 A（§15.2，待复核后实施）**：界面路径录票时 `createInvoice` 把 `source_type` 写成 `'invoice_order'`（不在迁移 182 的约定内）⇒ **即使正确关联订单，税额也不进任何凭证**（隔离库实测：`source_id` 正确指向订单、按 `loadTaxMaps` 同条件汇总税额却为 0）。`source_id` 为 NULL、「无单发票」是**另两条不同因果**（后者可能是既定设计）。§15.3 只记录代码事实（`invoice_date` 不参与凭证归属），不含税法判断。详见 §15。
- **费用报销的跨期补录通道**：`finance-backfills.service` 无 expense 分支，**报销当前缺少合规的补录路径**，闭期报销付款需由**财务负责人人工决策处理方式**（不能用「改成别的日期」当出路——那是改事实）。是否补齐补录通道属**产品待决项**（本次据此只改措辞、不扩流程）。

### C. 已排除（不应重复当 bug）

- **资金账户余额调整**（`biz_type=4`）**本来就不生成凭证**（`buildFundVouchers` 只读 `IN (1,2,3,5)`，注释亦明示），无「钱动了账不记」。
- **HR 工资发放**：`payPayroll` 取排他账套锁，且四条凭证均经 `upsertVoucher` 内部的 `assertPeriodOpen`（排他锁）⇒ 闭期**抛错回滚**、工资单停在「已核算」，非缺陷。
- **固定资产计提/处置**：`fixed-assets.service.js` 在 `runDepreciation`/`disposeAsset` **显式**调 `assertPeriodOpen`，双保险。

### 未做 / 未验证

生产影响规模统计、全量发版验证、浏览器与真机验收均**未做**。本轮未推送、未打 tag、未部署。

---

## 15. 发票 B 深入核实（2026-09-27）：税额归期与界面路径 `source_type` 写错导致的税额丢失

**本批目的**：核实 §13 B③ / §14 B 对发票「期间语义」的判断。**结论：初判「对已结账期间静默无效」是错的**（实测方向相反，见 15.1）；另经独立核对 + 本批实测，确认一条**更直接的 A**——界面路径的发票 `source_type` 被写成 `'invoice_order'`，税额被 `loadTaxMaps` 排除（15.2）。

### 15.1 订正：已结账期间**不是**静默无效，而是 fail-loud

初判写「对已结账期间则静默无效（用户以为改好了、账上没变）」——**错误**。发票税额一旦变化并影响已结账期间已生成的凭证：

- **销售侧**：`voucher-sale-periods.reconcileSalePeriods` 在 `generateVouchers` **开头**对**全部**销售来源做差异检测，命中已结账期间即抛 **409 `ACCT_SALE_CLOSED_PERIOD_CONFLICT`**（「销售单 X 在期间 Y 的出库事实与已记凭证不一致，请先核对并反结账后重算」）。该检测**不受**「只生成某期间」影响——`voucher-engine.js` 的期间过滤发生在 reconcile **之后**。
- **采购侧**：`voucher-source-revisions.reviseSourceVoucher` 调 `assertPeriodOpen` ⇒ **409 `ACCT_PERIOD_CLOSED`**（「如需调整请先反结账」）。

⇒ 准确说法是「**变更会被拦下并要求反结账**」。**证据强度：代码审阅，未实测。**

### 15.2 ★ 实测 A：界面路径的发票 `source_type` 写成 `'invoice_order'`，税额被 `loadTaxMaps` 排除

**权威依据（均在仓库内）**：
- 迁移 `182_fin_invoices.sql:21` 列注释：`source_type ... COMMENT '关联业务：purchase_order/sale_order（可空，允许无单发票）'`——**合法值只有这两个或 NULL**。
- `voucher-engine.loadTaxMaps` 的进项分支 `source_type='purchase_order'`、销项分支 `source_type='sale_order'`，两者都要求 `source_id IS NOT NULL`。
- `accounting.invoice.service.js:191` 写入 `d.sourceType || (quota ? 'invoice_order' : null)`；而**前端表单（`frontend/src/pages/accounting/invoices/index.tsx` 的 submit）只发 `sourceNo`，不发 `sourceType`**。`'invoice_order'` 这个字面量**全仓仅此一处**，没有任何消费方。

**实测（隔离库真实 API，`tests/invoice-quota.smoke.test.js` 新增 §T）**：造一张有应收基准的销售单 → 按界面同参数（只传 `sourceNo`）录销项发票 ⇒

```
发票 source_type=invoice_order  source_id=5099（正确指向订单）  tax=65.00
[FAIL] source_type 必须是 sale_order —— 实际 invoice_order
[PASS] source_id 必须指向被关联的销售单
[§T] 按 loadTaxMaps 同条件汇总该单税额 = 0.00（期望 65）
```

⇒ **即使 `source_id` 正确关联到订单，税额也不被计入**——即「按界面录入并成功关联订单的发票」这条**最常用**路径，税额**完全不进凭证**。这比「未关联单号」更普遍：后者是用户没填，前者是**填了也没用**。

**因果分离（三件事，勿混）**：
1. **本条（实测）**：`source_type='invoice_order'` ⇒ 被排除，**与是否关联无关**。
2. **另一条（**旧写入**的可能状态；**新写入已修**，见下方 15.2「已修」的 ②）**：`source_id IS NULL`。修复前 `assertInvoiceQuota` 在「反查到单据但该单尚无 `payment_records` 账款基准」时返回 null（如「先开票后发货」），派生逻辑随之把 `source_id` 置空 ⇒ 亦被 `IS NOT NULL` 排除，但**原因与第 1 条不同**。新写入不再如此（身份与配额解耦，无基准也回报身份）。
3. **可能属既定设计、不判为 bug**：**无单发票**（用户不填「关联单号」，该字段界面标注「选填」）⇒ `source_type`/`source_id` 均为 NULL。迁移 182 明说「可空，**允许无单发票**」，故这是**设计内的合法状态**，本批不据此判缺陷。

**证据强度**：本条为**隔离库实测**（真实 API + 真实库读回）；2 为代码审阅，未实测。

**已修（2026-09-27，本地提交）**：详见主题文档 `docs/finance-permission-time.md` 的「2026-09-27 发票 `source_type` 与关联口径收口（A）」。要点：① 按发票类型写约定值（`sale_order`/`purchase_order`），`updateInvoice` 以**库内 `cur.invoiceType`** 重算，客户端改类型明确 400；② **订单身份与配额校验解耦**——只要单号/id 反查到订单就回报身份（「先开票后发货」保留稳定关联），配额仅在存在账面基准时校验；③ 支持「单号」与「显式 id」两种权威输入（**同给必须互相印证**：id 不符**或单号查不到**都算冲突，不得按 id 兜底吞掉打错的单号），**仅给 id 也过同一套配额校验**，补上绕过额度的历史缺口；④ 编辑时显式给出 `sourceNo`（含清空）只用本次 `d.sourceId`，不沿用旧 `cur.sourceId`；⑤ 只给 `sourceType` 而既无单号也无 id ⇒ 400 `INVOICE_SOURCE_INCOMPLETE`（不静默返回空关联）。
**不新增改写存量 `invoice_order` 的迁移**（转入下方 §15.6）。

### 15.3 代码事实：税额归期与开票日期解耦（本批不含税法判断）

`fin_invoices.invoice_date` **完全不参与凭证**——后端仅用于列表展示、排序、非空校验与写入（全仓 grep 无凭证侧引用）。凭证的税额归属期取**业务单（出库/收货）所属期间**：`projectSaleShipments` 的 `voucherDate` 来自 `shipped_at`，其余来源同理按业务锚点。因此「8 月发货、9 月开票」的销项税会被要求记在 **8 月**；叠加 §15.1 的 fail-loud，补开发票会**要求反结账 8 月**才能入账。

**本批不对「税额应归属开票月还是业务月」下判断**：仓库内未找到定义该口径的权威依据（迁移 182 与设计说明只说「税额只在凭证映射时按本表 `tax_amount` 拆分」）。是否需设计决策由业务方判断。

### 15.4 本批边界

§15.1 的 fail-loud 路径**未实测**；生产规模**未评估**。§15.2 的 A 已按独立复核意见实施并做反向破坏（两次：`source_type` 修复、`effective sourceId` 修复、以及「单号查不到+id 必须冲突 / 只给 type 必须拒绝」两条，均精准红）。**证据强度**：业务侧（API + DB 读回）为端到端；「税额是否落在 `loadTaxMaps` 谓词内」为**按该函数 SQL 复刻的谓词级验证**——**真实凭证生成（`generateVouchers`）本轮未跑**，故不宣称端到端入账。本轮未推送、未打 tag、未部署。

### 15.5 同批发现（测试侧）：`invoice-quota.smoke.test.js` 原无清理逻辑

本批为该文件新增场景时发现：该文件**四个既有场景都没有收尾清理**，在隔离库累积残留（实测：`fin_invoices` 54 张测试票、`sale_orders` 36 张测试单、`payment_records` 27 条应收）。本轮新增场景自洁为 0（按精确 ID 清理），**既有场景未动**——是否补清理待定（独立批次）。

### 15.6 B 项：存量 `'invoice_order'` 的生产只读评估需求（**未做**）

`createInvoice` 修复前的存量行（含早期只给 `d.sourceType`/`d.sourceId` 的用法）可能已把 `source_type` 写成 `'invoice_order'`。**本批不新增改写它们的迁移**，原因：① 旧值规模未知；② 修正归属后会改变 `loadTaxMaps` 的税额结果，若对应业务单据所属期间**已结账**，会触发 `ACCT_SALE_CLOSED_PERIOD_CONFLICT` / `ACCT_PERIOD_CLOSED`，可能需要反结账——这是**业务决策**，不能由迁移静默完成。

**需要的生产只读评估**（本轮无授权、未执行）：

```sql
-- 1) 规模
SELECT source_type, COUNT(*) FROM fin_invoices WHERE deleted_at IS NULL GROUP BY source_type;
-- 2) 「编辑可自愈」的规模**上限**：仍有单号或 id 且 status=1
--    （已认证/已抵扣的进项不可编辑、永远不自愈；此计数只是上限，实际还需能反查到订单）
SELECT COUNT(*) FROM fin_invoices WHERE source_type = 'invoice_order' AND (source_no IS NOT NULL OR source_id IS NOT NULL);
-- 3) 按账套/票种统计「已关联来源」的旧票数量（**本查询不判断期间归属**，只是规模分解）
SELECT f.company_id, f.invoice_type, COUNT(*) FROM fin_invoices f
 WHERE f.source_type = 'invoice_order' AND f.deleted_at IS NULL AND f.source_id IS NOT NULL
 GROUP BY f.company_id, f.invoice_type;
```

**闭期归属是另一件事，必须分两侧单独评估**（本轮**未做**——上面的计数**不能**当作"已判断期间是否已结账"）：

- **销项**：税额归属期取**销售出库月**（`projectSaleShipments` 的 `voucherDate` 来自 `wt.shipped_at`）。要判断某张旧票会不会撞已结账期间，需按 `source_id` 追到该销售单的**出库任务 `shipped_at`**（`warehouse_tasks`，`status=7` 且未删除）折成 `YYYYMM` 后与 `acct_periods.status=2` 比对。
- **进项**：走采购结算 / 来源修订链（`voucher-source-revisions`），期间取自该采购凭证/结算的**来源期间**，同样要按来源锚点折期间再与 `acct_periods` 比对。
- 两侧都需**先确认来源单据未软删、且有真实出库/收货事实**，否则归期本身不成立（会先撞 `ACCT_SALE_SOURCE_INVALID` 一类来源断言）。

⇒ **是否需要反结账，只能在生产只读里按上述口径另行统计**，不能由本轮任何结论替代。

**自愈通道是有限的，不要当作「迟早会好」**：`updateInvoice` 现在按 `cur.invoiceType` 重算派生值，但**仅在该行同时满足**① `status = 1`（待认证/已开具）**且**② 仍能按单号或 id 反查到订单时才修正。因此以下存量**不会自愈**：

- **已认证 / 已抵扣的进项票**：`updateInvoice` 直接 400 `INVOICE_LOCKED`，永远走不到重算；
- **`source_id` 与 `source_no` 都没有（或单号查不到且又没给 id）的行**：反查不到订单，重算结果仍是 NULL——与真正的「无单发票」同形，**无法区分**。

⇒ 这两类只能人工核对后处理（或由业务决定是否清理），**不能依赖编辑自愈**。

---

## 16. 浏览器导出**真正落盘**验收（2026-09-27，只读；隔离库 + 本地栈）

**验收命题**：§13「仍未验收」里的「浏览器下载文件真正落盘」——**不重做**已验过的筛选透传 / HTTP 200 / 工作簿读回正确性，只回答「浏览器点击导出后，文件是否真的写到磁盘上」。

**环境（全部隔离）**：前端 `:5173`（`VITE_ELECTRON=1 vite`）+ 后端 `:3000`（`node index.js`，`NODE_ENV=test`），数据库 **`flowcube_ui_export_test`** @ 127.0.0.1:3307（专用隔离库，142 表；`reconciliation_statements` 2 行，其余业务表为空）。账号取自本机 `~/.config/flowcube/ui-export-acceptance-45014.env`（**只读财务专员**角色，权限含 `report.view`/`invoice.view`；口令全程未回显）。

**安全边界核对（本轮中途发现并已收口，重要）**：
- `backend/index.js` 无条件 `startScheduler()`；`scheduler.js` 的物流 worker 条件是 **`bool('LOGISTICS_WORKER_ENABLED', true)`——默认开启**，且启动时**不检查是否有运单**。
- 首次启动（未显式关闭）时日志**确实**出现「物流取号/轨迹 worker 已启动」。但**未观察到外呼证据**：该库 `carriers`/`logistics_waybills`/`logistics_freight_bills`/`logistics_freight_settlements`/`logistics_tracking_events` **全部 0 行**，日志中**无**运单处理或 HTTP 记录；钉钉 webhook 在 `backend/.env` 与两个 env 文件中**均未设置**（只统计键出现次数，未读值），代码标注「未配置则静默」。
- **已停服务并用安全配置重启**：显式 `LOGISTICS_WORKER_ENABLED=0` + `DINGTALK_ALERT_WEBHOOK=`（空值覆盖；dotenv 不 override 已有 env）⇒ 重启日志中「物流取号/轨迹 worker 已启动」**为 0 行**。
- ⇒ 结论：**未观察到本轮触发真实物流调用或客户消息的证据**（该库物流表为空、日志无处理记录、webhook 未配置）。**本轮未做网络抓包**，所以这是「**未观察到外呼证据**」，不等于「已证明没有外呼」——不要把未做的观测当成负面证明。后续同场景验收应**默认**带上这两个开关。

**落盘证据（不以命令输出为准，全部独立核验）**：
| 项 | 实测值 |
|---|---|
| 下载前目录 | 空（`total 0`，排除残留文件被误当成本次产物） |
| 路径 | `/tmp/fc-ui-downloads/recon-summary.xlsx` |
| 大小 | **7133 字节**（非空） |
| 类型 | `file` ⇒ **Microsoft Excel 2007+**；魔数 `50 4b 03 04`（PK ZIP） |
| 可读性 | 可读；ExcelJS 成功解析 |
| 内容读回 | 1 个工作表「**客户对账单**」，3 行 × 10 列：表头（对账单号/客户/对账期间/笔数/汇总金额/已核销/未核销/状态/确认人/创建时间）+ 2 条数据 |
| 请求相关性 | 数据行 `SC-UIA-45014 / 验收甲方A-45014`、`SC-UIB-45014 / 验收乙方B-45014`，均「2026-09-01 ~ 2026-09-30 / 草稿」——与该隔离库 `reconciliation_statements` 的 **2 行完全对应**（单号含本任务标识 `45014`） |

⇒ **结论：浏览器点击「导出汇总」产生的文件确实落到了磁盘**，且是内容正确的真 xlsx。操作路径：落地页 → 进入系统 → 登录 → 财务 → 月结客户对账 → `#/reports/reconciliation/receivable` → 「导出汇总」；工具用 `agent-browser download <ref> <path>`（真实点击 + 指定落盘路径）。

**会话与进程收尾（按 `docs/local-preview-acceptance.md:22`）**：会话固定命名 `ui-export-acceptance` 并复用同一标签；结束后 `agent-browser close` ⇒ `agent-browser session list --json` 返回 `{"sessions":[]}`（已消失）。本轮自起的后端/前端进程按 PID 停止，`:3000`/`:5173` 均已释放；**未触碰其它任务的进程或浏览器**。

**未验证边界**：
- 只验了**一个**导出入口（客户对账单「导出汇总」）；收付款单、利润分析、发票等其它导出未在浏览器侧验落盘。
- 未验浏览器下载安全策略/磁盘配额等环境性拦截；仅 Chromium（agent-browser）。
- 未验**生产**环境落盘（本轮全程隔离库 + 本地栈）。
- 落盘文件留存在 `/tmp/fc-ui-downloads/` 供复核（非仓库文件，不入库）。

**下一批候选（本批未改）**：`tests/invoice-quota.smoke.test.js` 的**四个旧场景无收尾清理**，在共享测试库持续累积夹具（§15.5 已记实测数量）；补其自洁可作为独立批次。 → **已于 §17 完成**。

---

## 17. `invoice-quota` 四个旧场景的夹具自洁（2026-09-27）

**背景**：§15.5 记录该文件四个旧场景（`OverQuotaBlocked` / `RedFlushRestoresQuota` / `EditExcludesSelf` / `NoQuotaBypass`）**从无收尾清理**，在共享测试库持续累积夹具。

### 改动（只清本轮，绝不碰历史）

- `seedSaleWithReceivable` / `seedPurchaseWithPayable` 接受可选 `cleanup`，并**在单据插入后立刻登记 id**——不是等 helper 正常返回才登记；否则紧随其后的 `payment_records` 插入一旦失败，就会留下一张**没人认领**的订单（本轮独立复核指出）。
- `issueInvoice` 接受可选 `cleanup`，登记 API 返回的发票 id（被拒的请求没有 id，自动跳过）。
- **`postInvoice` 未接 `cleanup` 参数**——源码仍是 `async function postInvoice(http, token, overrides = {})`：它只被 §T 场景使用，而那些调用点本就持有返回对象、**就近手动登记** id。这是本批**如实记录的一处不一致**：统一它要牵动十余处调用点，本批**不扩大改动**，留作后续可选整理（记录在此以免被误当成"已统一"）。
- 四个旧场景改为接收 `cleanup`，在 `finally` 中按**依赖顺序**清理：**发票 → 账款 → 单据**（`fin_invoices` / `payment_records`(type 2、1) / `sale_orders` / `purchase_orders`）。失败路径同样经过 `finally` ⇒ 断言失败或中途抛错都能清。
- **删掉误导性无用夹具**：旧 `scenarioNoQuotaBypass` 插了一张「无账款基准的销售单」却**从未用它开票**（开的是不存在的单号），既没测到想测的东西、又留下垃圾。真正那条语义已由 §T 的 `scenarioInvoiceBeforeShipmentKeepsLink` 覆盖。
- **清理失败不再只打印告警**：收尾后**逐个 ID 复查**四张表，任何残留 ⇒ **失败断言**，避免套件假绿。
- **连接池关闭用外层 `try/finally` 兜底**（独立复核指出）：原先运行前快照在 `try` 之外、复查在 `finally` 内，任一步抛错都会**跳过 `ctx.close()`**（连接泄漏 ⇒ 占住库连接、进程挂着不退）。现改为「**外层 `try/finally` 只负责 close**，内层 finally 负责清理与复查」，且**复查自身也兜底**——它若抛错记一条失败断言，而不是把异常抛出去、把断言丢掉。
- **应收/应付分开复查**（同上）：`sale_orders.id` 与 `purchase_orders.id` 是**两条独立自增序列**，同一数字可同时存在于两张表；复查必须分别用 `(type=2, order_id IN 销售单 ids)` 与 `(type=1, order_id IN 采购单 ids)`，否则会串到另一类（含历史）账款上。
- **无单发票场景先显式断言拿到 id**：原先 `if (Number.isInteger(invId))` 会在「状态 201 但没返回 id」时**跳过**语义断言而假绿；现先断言「必须真的落库并返回 id」，再做语义断言。

### 业务语义审视（按复核要求）

四个旧场景中三个直接断言**配额业务规则**（超量拒绝 + 错误码、红冲恢复额度、编辑排除自身），属业务语义而非实现细节；`scenarioNoQuotaBypass` 原先**只断言 HTTP 状态**，已补一条 DB 断言——「该票落库为**无单发票**：保留单号快照，但 `source_id`/`source_type` 均为 NULL」——因为"没报错"不等于"语义正确"（它必须**不进任何税额合计**）。

### 其间发现并修正的一处**测试自身缺陷**

ID 级残留复查最初对 `payment_records` 用 `order_id IN (...)` **未带 `type`**；而 `sale_orders.id` 与 `purchase_orders.id` 是**两条独立自增序列**，同一数字可同时存在于两张表 ⇒ 采购单 id 会串到同号销售单的账款上，**误报残留 1 条**。旁证：运行前后快照完全一致、最近账款对应的销售单均仍在（非本轮产物）。已给复查补上 `AND type=2` / `AND type=1`。**这属于既有测试库的 id 空间重叠风险，不是业务数据残留。**

### 证据（隔离库 `127.0.0.1:3307/flowcube_operations20260912_test`，`NODE_ENV=test`）

| 运行 | 运行前快照 | 运行后快照 | ID 级复查 | 结果 |
|---|---|---|---|---|
| 第 1 次 | 140 / 92 / 0 / 69 | **同上** | 0 | 53/0 |
| 第 2 次 | 140 / 92 / 0 / 69 | **同上** | 0 | 53/0 |
| 第 3 次（补 DB 断言后） | 140 / 92 / 0 / 69 | 同上 | 1（**断言缺陷误报**） | 53/1 |
| 第 4 次（断言修正后） | 140 / 92 / 0 / 69 | **同上** | **0** | **54/0** |
| 第 5–7 次（三处收口后，含最终复跑） | 140 / 92 / 0 / 69 | **同上** | **0** | **55/0** |

（快照四元组 = `fin_invoices`(INV-CODE\*) / `sale_orders`(开票量测试) / `purchase_orders`(发票归属测试) / `payment_records`(两类测试往来方)。）

⇒ **连续运行前后计数完全不变** ⇒ **本轮无净新增残留**。历史遗留（140 / 92 / 0 / 69）**保持原样、未清理**——**无法证明归属的旧数据一律不动**，只作现状记录。

### 反向破坏（证明「净新增」断言非恒真）

临时让**运行后**快照比运行前多 1 ⇒ 只有「本轮没有留下净新增残留」这 **1 条红**（`后 invoices=141` vs `前 140`），其余 **54 条不受影响**；随后完整恢复并复跑 **55/0**（并用 grep 确认无破坏痕迹残留）。**没有**采用「摘掉删除语句」式的破坏——那会真的在共享库留下**无人认领**的残留（进程一结束 ID 就丢了，无法定点清理）。

### 未验证边界

未在**干净库**上重跑（故不能据此断言"从零开始也不残留"，只能说"不再增长"）；未审查其它测试文件的夹具自洁；历史遗留的 140/92/69 行仍是共享库的既有负担（是否清理属独立决策，需先确认归属）。

---

## 18. `products.update` 的价格历史一致性（2026-09-27）

### 18.1 已证实并已修：并发手工改价导致历史旧价失真

**根因**：`products.update` 原先在**事务外**用 `findById` 读当前行快照，两个并发改价会**各自以同一个旧价**写历史。

**实测（隔离库，真实 service 调用，12/12 轮）**：

```
cost链=[[100,150],[100,200]]  最终cost=200   ← 两条历史的旧价都是 100，链断裂
```

**修法（一处覆盖三个同源表现）**：把「读当前行」从事务外移入**事务内并加行锁**（`FOR UPDATE`），旧价、`allowDecimalQty` 继承都取**锁内**值；UPDATE 后校验 `affectedRows`。

**修后**：同一探针 **0/12 断裂**（链变为 `100→150→200` 或 `100→200→150`）。

**回归**：新增 `tests/product-price-history-integrity.smoke.test.js`（**10/0**）——并发链连贯 + 当前值 = 末条 `new`；`allowDecimalQty` 未传时保持原值；软删商品改价被拒且**无任何脏写**；按 ID 自洁复查为 0。
**反向破坏**：摘掉 `FOR UPDATE` ⇒ **恰好那 1 条红（6/6 断裂）**，其余 9 条不受影响（且已断言两次改价本身成功，排除"改价失败"的干扰）。

### 18.2 本轮我自己引入又修正的一处回归（如实记录）

改为读**裸列**后，`allowDecimalQty` 继承写成 `Number(current.allow_decimal_qty) ? 1 : 0` ⇒ **NULL 会被当成 0**（把"默认允许小数"误关成"禁止"）。已按既定语义修正为 `== null || === 1 ? 1 : 0`。
另：`allow_decimal_qty` 实为 **NOT NULL DEFAULT 1**（迁移 254），**列上造不出 NULL**，故测试改测两条**可达**路径（新建默认 1 / 显式 0 在未传字段时都保持），并注明 `== null` 是**防御性分支**。

### 18.3 软删的防护边界（不写成实测）

加行锁后，并发 `softDelete` 只有两种可能：**先于锁读完成**（那样锁内 SELECT 读不到 ⇒ 直接 404）或**等本事务提交后**才生效。故「锁读成功之后、UPDATE 之前被软删」这种交错**不可达**；`affectedRows` 检查是**兜底**（防将来新增写入路径），不是主要防线。测试只覆盖"对**已软删**商品改价 ⇒ 明确失败且无脏写"这一可达语义。

### 18.4 ★ 待业务决策：`sale_price` 与 `sale_price_a` 是**两套存储契约**（本轮**未改审批侧**）

**先前判断更正**：迁移 `060:71-76` 把 `sale_price` 回填为 A 是**一次性数据回填**，**不是持续约束**；不能据此认为两列"永远同值"。

**各自的消费者（现存代码）**：

| 列 | 消费者 | 位置 |
|---|---|---|
| `sale_price`（"销售价"） | **标签变量 `price`** | `print-jobs/labelVariables.js:100` |
| | **库存估值的售价回退** | `disposal` / `dashboard` / `inventory.aging` 的 `COALESCE(avg_cost, cost_price, sale_price, 0)` |
| `sale_price_a`（等级 A） | **商品 Finder / 详情**（`salePrice` 优先 A，A 为 NULL 才回落 `sale_price`） | `products.service.js` 的 `fmtProduct` / `findForFinder` |
| | **价目表**（按客户等级取 A/B/C/D 列） | `price-lists.service.js:41` 的 `fieldMap` |

**改价 UI**：`PRICE_TYPE_LABEL = { sale: '销售价', cost: '成本价', a: '等级A', … }`，且 `useState('sale')` —— **默认就是改「销售价」**（`PRICE_COLUMN.sale = 'sale_price'`）。

**隔离库复现（三条链路）**：

```
① 初始        sale_price=110  A=110   API salePrice=110
② 审批改 sale 后  sale_price=200  A=110   API salePrice=110  ← 详情/Finder 看不到 200；两列不再同值
③ 任意商品编辑后  sale_price=110（被 =spA 覆盖）  ← 审批结果丢失
                 历史记为 ["sale", 200, 110]       ← 覆盖行为被记录（旧代码用 fmtProduct 取旧价会漏记）
```

⇒ **结论**：`sale` 与 `a` 是**不同的存储契约**；**标签价**（`sale_price`）与**详情/Finder/价目表价**（A）在审批只改前者时会**漂移**；且 `products.update` 无条件写 `sale_price = spA` 会把审批结果**覆盖回 A**。
**注意**：本轮**不判断** `update` 的覆盖是否"合理"——它取决于业务认定哪一列是权威售价，属**口径决策**。

**本轮实施判断（2026-09-27，在用户授权的自主改进范围内选定方案三 · 受控止血；方案一/二未采纳）**：

> **口径未决**：这是**实施判断**，**不是**用户对"最终售价口径"的单独确认。`sale_price` 与 `sale_price_a` 究竟谁是权威售价、A 价审批是否该同步标签价，**仍待业务方明确**（见下方 B）。

- `products.update` **不再**把 `sale_price` 覆写为 A（UPDATE 去掉该列）；**新建**仍按 A 初始化（`create` 未改）。
- 手工价格历史**移除 `sale` 项**：编辑已不改销售价，若照旧按 `[current.sale_price, spA]` 写，就会在两者不同值时记一条 **“sale 变成 A” 的虚假变更**（实际分文未动）。
- **未改**审批侧写入范围（`PRICE_COLUMN.sale` 仍写 `sale_price`），**未**把 `sale` 与 `a` 合并。
- 理由：改价 UI 明确提供两种类型且默认 `sale`，而普通商品编辑会**静默抹掉已批准值**——已复现的数据丢失。

**验证（两层，勿混称）**：

- **真实跨模块回归**（`tests/price-change-history-oldprice.smoke.test.js` **场景 ⑤**）：先走**真实审批链路**——**直接调 service**：`price.create({ priceType: 'sale' })` → `submit` → `approve`（由 `applyApprovedPrice` 写 `sale_price`）；**再直接调** `products.update`（商品更新 service）；最后读**标签消费者函数** `readLabelVariables(8)` 取 `vars.price`（不是自己复刻 SQL）。
  **调用层级如实说明**：这是「**审批 service → 商品更新 service → 标签消费者**」，**不是「商品 HTTP 端到端」**——三处都直接 `require` service，未经过路由 / zod / 权限中间件。断言：`sale_price` 与标签价保持批准值 `200`、A 按编辑值 `130`、且无任何手工 `sale` 历史。套件 **9/0**、夹具残留 0。**反向破坏** ⇒ **恰好那 1 条红**（其余 8 条不动）。
- **模拟层**（`tests/product-price-history-integrity.smoke.test.js` 场景 ④）：用 `UPDATE product_items SET sale_price=200` **模拟审批的列效果**（A 不动），再**经 HTTP** `PUT /api/products/:id`（真实路由 + zod + 权限）执行普通编辑，断言不得覆写它。**这条不是「真实审批 → 编辑」的端到端**，测试名与注释已如实标注为「**模拟**审批列效果」。
  ⇒ 两层**互补**：④ 证「**HTTP 层**不覆写」；⑤ 证「**真实审批链路产生的值**在 service 更新下保持」。套件 **16/0**；反向破坏 ⇒ 恰好 2 条红（销售价被覆写为 130、标签价随之 130.00）。

**仍留待决策（B）**：
1. ~~**商品编辑页只读展示"销售价（标签）"**~~ ⇒ **已于 §18.6 完成**：后端详情新增只读字段 `labelSalePrice`，编辑页「销售价格」区加只读行（标注「销售价（标签使用，改价审批维护）」），并配套修好"审批通过后商品缓存不失效"。**未新增**经 `PRODUCT_UPDATE` 直接改该列的入口（避免绕过改价审批权限）。**本条不再待办。**
2. **A 价审批是否应同步标签价**：两列是否在审批时双写属**口径决策**，**证据不足不双写**。
3. 未在生产核对两列不一致的实际规模。

### 18.5 未验证边界

并发反例只覆盖"两次手工改价"；**未**构造"手工改价 × 审批通过"的并发用例（两者锁同一商品行，理论上已串行化，但未实测）；未跑全量商品模块回归；未评估生产上受影响的商品数量。

### 18.6 员工可见性修复与审批后的缓存新鲜度（2026-09-27；**仍不改口径**）

**背景**：§18.4 的 B 项之一（商品编辑页看不到与 A 不同的标签销售价）已做**可见性修复**。

- **后端**：详情（`findById`）新增**只读**字段 `labelSalePrice` = 原始 `product_items.sale_price`；`salePrice`（= 价格A）等既有契约、**列表与 Finder 均不变**。
- **前端**：商品编辑页的「销售价格」区（**现有区块**，未新建卡片/弹窗）加一行**只读**展示，标注「销售价（标签使用，改价审批维护）」，并说明"订单报价按客户等级价（上方「价格A~D」）或该客户的专属价目表，**与这里的标签销售价无关**"。**未新增**经 `PRODUCT_UPDATE` 直接写该列的字段或入口。
- **权限核对（未扩权）**：`GET /api/products/:id` 一直只要求 `PRODUCT_VIEW`，而该响应**本就**包含 `costPrice`（比标签售价更敏感）；本次只是同一张表上多返回一个**只读**列，**未新增权限、未放宽鉴权**。
- **配套修好的新鲜度缺陷（独立复核发现）**：`price-change` 的 `approveMut` 原先只失效 `['price-change']`，而 `useProduct` 走全局 **5min `staleTime`** ⇒ 审批通过后切回已缓存的编辑页会**继续显示旧 `labelSalePrice`**，正好削弱本次修复。现抽出 `invalidateAfterPriceChange(qc, result)`（由 `useProducts` 导出），**仅在** `finished` 时失效 `['products']` 前缀（详情/列表/Finder）；中间步骤不刷新，**不用轮询**。全仓核对：改价审批的**前端入口只有 `price-change/index.tsx` 一处**（通用审批待办页不调该接口）。

**验证**：

| 层 | 证据 |
|---|---|
| 后端 | `tests/product-price-history-integrity.smoke.test.js` **17/0**：新增断言——**真实详情 API 同时返回** `salePrice=130` 与 `labelSalePrice=200` |
| 前端**行为测试** | `src/hooks/useProducts.priceChange.test.tsx`（真实 `QueryClient` + 生产同口径 5min `staleTime`）：审批完成后 `useProduct` 取到新价；`finished=false` 不刷新。**反向破坏**：摘掉失效 ⇒ 第一条**精准变红**（`expected '110 / 110' to be '110 / 200'`）——即真的保护了"审批后页面取新价" |
| 浏览器实测 | 隔离库 `flowcube_operations20260912_test`；后端以 `LOGISTICS_WORKER_ENABLED=0` + 空 `DINGTALK_ALERT_WEBHOOK=` 启动（日志确认物流 worker 未启动）；独立会话 `product-label-visibility`。商品编辑页同时显示 **价格A=130**（输入框）与 **销售价（标签使用，改价审批维护）200.00**（只读行）。收尾：会话 `close` ⇒ `session list --json` = `{"sessions":[]}`；服务按 PID 停止、`:3000`/`:5173` 已释放；样例商品已删除 |

**仍未做**：**未判定**"谁是权威售价"、**未**让 A 价审批同步标签价、未在生产核对两列不一致的规模——口径决策仍待业务方（同 §18.4 B）。

---

## 19. 续接状态（2026-09-27 收尾）

**提交基线**：§11–§18 的提交链末端为 `f3b7c14`（本节自身的收尾提交紧随其后）。工作树 `claude/happy-mahavira-0a2b4b` **clean**，主工作树 `main` 亦 **clean**；浏览器会话无残留（`session list --json` 为 `{"sessions":[]}`），`:3000`/`:5173` 空闲。本文件涉及的全部改动均为**本地提交**——**未推送、未打 tag、未部署**，未执行生产迁移或生产数据写入。

**A — 已确认且已处理**：P1 导出筛选透传、P3 作废容器不得补打、P2 成本去售价回退、P8 改价审批历史旧价、`price-change` 自批内控（双身份）、费用报销付款跨期闸门、发票 `source_type` 口径、`products.update` 并发旧价与销售价覆写止血、编辑页标签销售价可见性 + 审批后缓存失效。**当前没有新的、证据充分而尚未处理的 A 项**；不要为填清单制造缺陷。

**B — 待决策 / 待核实**：① **价格权威未定**（`sale_price` 与 `sale_price_a` 谁是权威售价、A 价审批是否应同步标签价，§18.4 / §18.6）；② 存量 `'invoice_order'` 的**生产只读评估**（§15.6，评估 SQL 已写；**不新增自动改写存量的迁移**）；③ 费用报销的跨期补录通道（产品待决）；④ `price-change.submit` 的归属策略（§12.3）；⑤ P5 多端数据新鲜度（机会项）；⑥ 共享库测试残留 140/92/69（**无归属证据就不动**）。

**C — 已调查且不应重复当 bug**：ATP 与当前可拣量是**不同既定口径**；`approval.task.view` 只作入口粗筛；「行锁/状态机防重」不是请求键幂等重放；余额调整 `biz_type=4` **本就不生成凭证**；HR 工资与固定资产**已有**期间保护；发票对已结账期间是 **fail-loud** 而非静默；`sale_orders.id` 与 `purchase_orders.id` **序列独立**（复查须带 `type`）；旧 `NoQuotaBypass` 的无用订单已删。

**本轮累计验收范围（**仅限实际跑过的**；更完整的一轮累计验收见 §21）**：后端 `product-price-history-integrity` **17/0**、`price-change-history-oldprice` **9/0**、`invoice-quota` **55/0**、`finance-period-guard` **39/0**、`smoke:finance` **118/0**；前端 `tsc -p tsconfig.app.json --noEmit` 通过、`useProducts.priceChange.test.tsx` **2/2**；浏览器侧完成过**一次导出真实落盘**验收（§16）与**一次商品编辑页可见性实测**（§18.6）。**以上均为本轮专项，不等于发版前全量**——按 AGENTS §3，受影响端的 lint / 类型检查 / 构建与全量回归统一留到发版前执行。

**未验证边界**：物理打印、PDA 真机、生产影响规模、发版前全量检查均**未做**；发票存量规模与两列不一致规模**未在生产核对**；「手工改价 × 审批通过」的并发用例**未构造**；本文件多数结论为**隔离库 + 本地栈**证据，**不得当作生产结论**。

**下一步优先候选**：① 由业务方定「价格权威」口径（定了才动审批侧与 A 的同步）；② 发票存量 `'invoice_order'` 的生产只读评估（需授权）；③ `invoice-quota` 历史残留的清理决策（需先确认归属）。**不要重做 P1/P2/P3/P8。**

---

## 20. 发票编辑的并发静默覆盖（2026-09-27，仅本地）

### 20.1 判定为 A：并发编辑同一发票会互相静默覆盖

**核查**：`fin_invoices` **无版本列**、前端 `updateInvoiceApi` **不带版本**、`UPDATE` 的 WHERE 只有 `status = 1` —— 那是**状态 CAS**（"这张票还是不是可编辑状态"），**不是并发编辑的版本校验**。项目在 `carriers.binding.js:98` 已有 **`revision` CAS 拒绝过期覆盖**的先例（「账号资料已被其他人修改，请刷新后重新操作」），故**不能算作既定 last-write-wins**。

**可重复反例**（隔离库、真实 HTTP、`/tmp` 探针，未入库）：两个并发 `PUT /api/accounting/invoices/:id`（金额与备注都不同）⇒ **8/8 轮**「两次都 200、最终只留其一」。观察到的形态是**整条 UPDATE 原子覆盖**（金额与备注成对来自同一请求），**没有**字段级撕裂——这点如实记录，不夸大。

**证据边界（重要，勿越界表述）**：8/8 反例只让**金额与备注**不同 ⇒ **实测到的静默覆盖就是这两者**。`source_no`/`source_id` 与它们走**同一条全字段 `UPDATE`**、前端也是**整单提交**，因此按该路径**存在同样的覆盖风险**——但这属于**推断**，**本批未单独构造并发的来源字段反例**。来源若被覆盖会改变 `loadTaxMaps` 的税额归属，故风险值得处理；表述上仍应写"存在覆盖风险（未单独实测）"，不写"实测来源关联丢失"。

### 20.2 窄修复（按现有锁顺序与事务约束）

- **迁移 263**：`fin_invoices` 加 `revision INT NOT NULL DEFAULT 1`（幂等 DDL；AGENTS 要求编号最大 +1，原最大 262）。**不用 `updated_at`**：它是 `datetime`（**秒精度**），同秒并发取不到变化，做 CAS 会整体失效（反例正是同秒）。
- **`updateInvoice`**：事务内先 **`SELECT ... FOR UPDATE`** 锁发票行拿权威 `status`/`revision` → 校验（缺版本 **400 `INVOICE_REVISION_REQUIRED`**；过期 **409 `INVOICE_CONCURRENT_MODIFIED`**）→ `UPDATE ... SET revision = revision + 1 WHERE ... AND revision = ?`。**SQL CAS 是真正防线**，JS 预检只提供更友好的 409。
- **`Number(null) === 0` 的坑**：缺版本必须先判 `== null` 再判整数，否则"没传"会被当成 0 而误报 409（独立复核指出）。
- **`cur` 的定位（措辞更正）**：它仍在**事务外**读，只用于「未提供字段」的合并与载荷校验，**不承担并发安全**；安全前提是「**客户端 revision 与锁内 revision 匹配**」——先前"锁内读顺带修掉陈旧快照"的说法不准确。
- **锁顺序依据（调用链，非直觉）**：写 `fin_invoices` 仅 4 处（`createInvoice` INSERT / `updateInvoice` / `changeStatus` / `removeInvoice`），锁订单行的仅 `assertInvoiceQuota`；`updateInvoice` **先锁发票行再调它**，另两处单语句无锁 ⇒ **不存在「订单行 → 发票行」路径**，不成环。
- **前端**：编辑弹窗带 `revision`；409 时**提示由全局拦截器统一给出**（它已对 409 `toast.error(后端 message)` ⇒ 弹窗侧**不再重复 toast**，避免双重报错）；弹窗侧只做**失效列表（异步）+ 关闭弹窗**。原代码只处理 `onSuccess`、且 `editTarget` 是点击时的快照 state（列表刷新也不更新）⇒ 会一直用旧版本反复 409、**无法恢复**。准确表述：**列表刷新完成后**再重开才拿到新 `revision`（不是"关闭瞬间就有新版本"）。
- **既有测试兼容**：`invoice-quota` 的 9 处编辑调用改走 `putInvoice`（先读 `revision` 再提交，模拟真实前端），**55/0** 保持。

### 20.3 证据

| 层 | 结果 |
|---|---|
| 新专项 `tests/invoice-edit-concurrency.smoke.test.js` | **13/0**：并发恰一个 200 / 一个 409（冲突码正确）· 最终值 = 成功者 · `revision` 恰好 +1 · 缺版本 400 · **GET 详情/列表返回 `revision` 的读契约** · 用过期版本再提交 409 · 顺序编辑两次成功且 `revision` 累加 · 按 ID 自洁为 0 |
| 既有 `invoice-quota` | **55/0**（编辑调用已带版本） |
| 反向验证 | **同时**摘掉行锁与 SQL CAS ⇒ **恰好 4 条红**（回到 `200/200`、后者覆盖、`revision=3`）；单摘任一层则另一层兜住（说明**行锁负责串行、CAS 负责判定**）。新增的读契约断言不受影响 |
| 前端 | `tsc -p tsconfig.app.json --noEmit` 通过；`eslint` 通过 |

### 20.4 CI 接线与守卫（AGENTS §0 / §0.2：守卫必须 CI 可达）

- **脚本与接线**：新增 `smoke:invoice-edit-concurrency`，并接进 `.github/workflows/test.yml` 的 regression job——**紧跟 `smoke:invoice-quota` 之后**。该 job 的 step 是**串行**的，且**先跑 `npm --prefix backend run migrate`**（:346）⇒ **迁移 263 会先于本测试应用**，也不会与其它 smoke **抢同一测试库**（无并发夹具相撞）。
- **守卫与反向验证**：`tests/deployment-resources.test.js`（「每个 `smoke:*` / `test:*` 必须能在 CI 里被跑到」）**26/0**；**临时摘掉 CI 调用 ⇒ 恰好 1 条红**，消息为「`smoke:invoice-edit-concurrency` 没有任何 workflow 会执行，等于只在手工跑时才有意义…请接进 CI」，恢复后复绿。⇒ 这不是"只在本机手跑的守卫"。
- **迁移 263 幂等**：连跑两次 ⇒ `revision` 列仍为 1、无 NULL、无副作用。
- `npm run smoke:invoice-edit-concurrency` 实跑 **13/0**；改动的 `test.yml` 经 YAML 解析校验通过。

### 20.5 未验证边界

未在生产核对并发编辑的实际频率与受影响单据数；未构造"编辑 × 认证/红冲"的并发用例（`changeStatus` 是单语句 CAS，属另一条路径）；**迁移 263 仅在隔离库应用，未进生产**；未做发版前全量。

---

## 21. 累计验收（2026-09-27，§11–20 一起验）

**基线**：`a252e55`（clean）。**未开展新 bug 扫描**；未推送/打 tag/部署/碰生产。

### 21.1 环境（任务专属空库，绝不复用有未知数据的库）

- 目标（非密）：`NODE_ENV=test` · `DB_HOST=127.0.0.1` · `DB_PORT=3307` · `DB_NAME=flowcube_acceptance20260927_test` · Node **v22.23.2** · `APP_UPDATE_DOWNLOADS_DIR` 可写。
- **建库前不存在** ⇒ 全新专属库；迁移前 **0 表**；迁移退出码 0、共 **263** 个迁移（**含 `263_fin_invoices_revision.sql`**）。日志 `/tmp/fc-accept-migrate.log`。
- 未复用也未清理任何既有库（本机另有 50+ 个 `flowcube*` 库，全部未动）。

### 21.2 静态检查与构建（全部退出码 0）

| 项 | 结果 | 日志 |
|---|---|---|
| backend lint | rc=0（无输出） | `/tmp/fc-accept-be-lint.log` |
| frontend lint | rc=0；**0 errors / 32 warnings**（按文件归属确认为**既有**，无本轮新增） | `/tmp/fc-accept-fe-lint.log` |
| `tsc -p tsconfig.app.json --noEmit` | rc=0 | `/tmp/fc-accept-tsc.log` |
| ERP 构建（VITE_ELECTRON=1） | rc=0（4.89s） | `/tmp/fc-accept-erp-build.log` |
| PDA 构建（VITE_CAPACITOR=1） | rc=0（10.90s） | `/tmp/fc-accept-pda-build.log` |

### 21.3 受影响回归（按 §11–20 累计改动选取，全部在新库执行）

| 覆盖项 | 命令 | rc | 通过 | 日志 |
|---|---|---|---|---|
| 导出筛选（离线） | `test:export-filters` | 0 | 4/0 | `/tmp/fc-accept-exp-filters.log` |
| 导出筛选（真实服务+库） | `smoke:prelaunch-scope-export` | 0 | 34/0 | `/tmp/fc-accept-prelaunch-export.log` |
| 作废补打守卫（离线） | `test:print-barcode-void` | 0 | 8/0 | `/tmp/fc-accept-print-void-guard.log` |
| 作废补打 / 收货撤回 | `smoke:print-barcode-void` · `smoke:print-barcode-void-receipt` | 0 / 0 | 11/0 · 12/0 | `/tmp/fc-accept-print-void{,-rcpt}.log` |
| 打印队列 | `smoke:print-queue` | 0 | 14/0 | `/tmp/fc-accept-print-queue.log` |
| 报表成本口径 | `smoke:report-cost-basis` | 0 | 4/0 | `/tmp/fc-accept-cost-basis.log` |
| 改价双身份自批/历史/软删 | `smoke:price-change-history` | 0 | **9/0** | `/tmp/fc-accept-price-history.log` |
| 商品手工改价/小数开关/并发链 | `tests/product-price-history-integrity...` | 0 | **17/0** | `/tmp/fc-accept-pph-integrity.log` |
| 发票来源配额（含编辑自愈/清空/契约） | `smoke:invoice-quota` | 0 | **55/0** | `/tmp/fc-accept-invoice-quota.log` |
| 发票编辑并发乐观锁 | `smoke:invoice-edit-concurrency` | 0 | **13/0** | `/tmp/fc-accept-invoice-concur.log` |
| 费用报销 / 闭期付款 | `smoke:finance` | 0 | 118/0 | `/tmp/fc-accept-finance.log` |
| 资金期间闸门 | `tests/finance-period-guard.smoke.test.js` | 0 | **39/0** | `/tmp/fc-accept-fin-period-guard.log` |
| 跨模块主链 | `smoke:mainline` | 0 | 49/0 | `/tmp/fc-accept-mainline.log` |
| 会计 / 期间 | `smoke:accounting` · `smoke:accounting-period` | 0 / 0 | 11/0 · 20/0 | `/tmp/fc-accept-accounting{,-period}.log` |

### 21.4 过程中判定的一处**环境问题**（非本轮回归，未改门禁）

首轮 `smoke:price-change-history` **rc=1、8 passed**，失败信息为「需要至少一个商品分类」。查明：新库 `product_categories` **为 0**（`smoke_*` 用户在、分类 seed 不在），而该用例的场景 ⑤ 需要至少一个分类。**判定为环境缺 seed**——该用例在既有库能过正因那边有分类。
**处置**：给新库补**最小 seed**（1 个分类，仅满足"至少一个"），**未改测试、未调门禁**；重跑 **9/0** 通过。同时补跑了我漏掉的 `product-price-history-integrity` ⇒ **17/0**。

### 21.5 夹具与资源收尾

- **所列业务夹具按模式核对为 0**：`fin_invoices`(INV-CODE\*/EDIT-C/RACE-C) / `product_items`(PPH-/VIS-/RACE-) / `payment_records`(两类测试往来方) / `expense_claims`(用例标题) / `acct_periods`(199001、199501) —— **各 0**。
  **注**：§21.4 为 `smoke:price-change-history` 补入的 **1 条商品分类 seed 仍留在该独立测试库**（它是该库的 seed，不是用例残留，本就不该清）⇒ 上句是「所列模式核对为 0」，**不是**「该库全空」。
- `:3000` / `:5173` **空闲**；`agent-browser session list --json` = `{"sessions":[]}`；`git status --short` **空**（`dist/` 已被 `.gitignore` 忽略，构建产物未污染仓库）。

### 21.6 边界（如实保留）

- **本节只覆盖「按 §11–20 改动选取」的受影响专项，不等于全量回归**。受影响端的 lint / 类型检查 / 构建**本轮已在 `a252e55` 执行过**（见 §21.2，均 rc=0）；但**最终发版代码仍需重跑一遍**（此后只要再有改动），并按 AGENTS §3 做**发版前全量回归**。
- **物理打印、PDA 真机未验**；**生产影响规模未评估**；迁移 263 只在隔离库应用。
- 本节的通过数均为**隔离库 + 本地栈**证据，不得当作生产结论。

---

## 22. 商品价格列的版本保护（2026-09-27，仅本地）

### 22.1 判定为 A：旧编辑页保存会静默回退已审批的等级价/成本价

`products.update` 无差别写 `cost_price` 与 `sale_price_a/b/c/d`，而 `form.tsx` **全量回传**打开时读到的旧值 ⇒ 别处刚生效的价格变更（含改价审批 `cost`/`a`/`b`/`c`/`d`）会被一次普通编辑**静默回退**。

**隔离库实测**（仅自建夹具、按 ID 自洁、残留 0）：审批后 `cost_price` **150→100**、`sale_price_a` **200→100** 均被回退；`sale_price` 未被改 ⇒ 证明 §18.4 当时只护住一半。调用链：`useProduct`（缓存）→ `form.tsx` 表单 → payload 带旧 A–D/cost → `products.update` 写这些列。

### 22.2 窄修复（与发票 §20 同范式）

- **迁移 264**（幂等）：`product_items` 加 `revision INT NOT NULL DEFAULT 1`。
- `fmtProduct` 返回 `revision`；`products.update` **同事务 `FOR UPDATE` 锁行后比对**：缺 **400 `PRODUCT_REVISION_REQUIRED`**、过期 **409 `PRODUCT_VERSION_CONFLICT`**；UPDATE 带 `revision = revision + 1 AND revision = ?` + `affectedRows` 检查（**SQL 是真正防线**，JS 预检只给更友好的 409）。
- `price-change.applyApprovedPrice` 写价格列时**同事务递增** revision，否则「审批前打开、审批后保存」的旧草稿仍能通过商品侧校验。
- **不递增**：`inbound-tasks.putaway` 只写 `avg_cost`，与编辑页提交的列不重叠（避免收货导致编辑页频繁冲突）。
- **前端**：基线 revision 与表单初始值**同源**（`formRevisionRef`）；`useEffect` 只在**首次 / id 变**时重建表单与基线（后台 refetch 不再抹未保存草稿）；冲突时**保留草稿**、**不自动刷新详情**（刷新会抹草稿）、提示**只由全局拦截器发一次**；类型把 `UpdateProductParams.revision` / `Product.revision` 声明为**必填**，守住将来新增调用点。

### 22.3 证据

| 层 | 结果 |
|---|---|
| 新专项 `tests/product-price-version-guard.smoke.test.js` | **20/0**：旧版本 409 且**不改价、不写历史**；`cost`/`B` 同路径；连续编辑（用最新 revision）成功且 revision 累加；缺 revision 400；`sale` 列既有保护不变；**详情返回 revision 的读契约**；审批递增后旧页 409；用**刷新后新价**重试成功；自洁复查 0 |
| `product-price-history-integrity` | **17/0**：并发语义按新契约更新为 **1×200 + 1×409**，并让冲突者**重读详情后重做** ⇒ **保留**了历史链完整性断言 |
| `price-change-history-oldprice` | **10/0**：原 9 条 + 新增 ⑥ **真实审批**递增 revision 契约（非模拟 SQL） |
| **反向验证** | **同时**摘掉 JS 预检与 SQL CAS ⇒ **10 条红**（A/cost 被回退、缺版本放行）⇒ 复现原缺陷；恢复后回绿 |
| 守卫 | `deployment-resources` **26/0**；摘掉 CI 调用 ⇒ **1 条红**点名 `smoke:product-price-version-guard` ⇒ 接线有效 |
| 静态 | 前端 `tsc -p tsconfig.app.json` rc=0；前端 lint 32 既有 warnings / 0 errors（无本轮新增）；后端 eslint（改动文件）rc=0 |

### 22.4 未验证边界（如实）

- **前端未做行为验收**：曾写过一个"**镜像实现**"的模式级测试（自造 Probe），按仓库原则**已删除**——它不渲染真实 `ProductFormPage`，只会提供虚假覆盖。冲突提示条、草稿保留、基线一致性目前**只有代码审阅 + 类型检查**，**未做组件/浏览器层验收**。
- 未做发版前全量回归；未验生产影响规模；**迁移 264 只在隔离库应用**。
- **发布顺序**见 `docs/finance-permission-time.md`（迁移 → 后端 → 前端；前端先上会**静默失效**）。
- **发布兼容性边界（安全取舍，**不是**"无影响兼容"）**：新后端会**拒绝**未带 `revision` 的**旧桌面 / 浏览器客户端**的商品编辑（**400 `PRODUCT_REVISION_REQUIRED`**）——这是为堵住"旧表单静默回退已审批价"而**有意**付出的兼容代价，**不是**无影响变更。后续发版必须确认**浏览器与 Electron 的更新顺序**并准备**旧客户端提示**；**不得**把「旧客户端仍可编辑」写成已验证事实（本批**未**验证旧客户端的实际行为）。**不承诺**任何"回退顺序无中断"。当前**禁止发布**，本批不涉及发布流程改动。

### 22.5 接续状态

- **提交基线**：**业务代码末端 `a2b7fb7`**；此后**仅测试证据与主题文档收束**（不含业务代码改动）。**实时 HEAD 以 `git log` 为准**——本文档每次收束提交后不再追写 SHA。工作树 **clean**；全部改动均为**本地提交**：未推送、未打 tag、未部署。
- **A**：本轮的**商品价格列版本保护**（旧编辑页回退已审批的等级价/成本价）**已修**并做反向验证（同时摘掉 JS 预检与 SQL CAS ⇒ 10 条红复现原缺陷）。**2026-09-28 追加**：§23 实测出的两处前端缺陷（无编辑误报未保存 ③′ / 关闭重开不恢复 ④）经 Codex 列为 A 后已**窄修复**，见 §24（TDD 先红后绿 + 反向验证 + 真实浏览器原反例复验）；**本地实例脚本"启动顺带迁移"的目标库边界**亦已按方案 A 拆分并接入 CI 守卫，见 `docs/mysql8-dev-script-role-split-2026-09-28.md`（20 例契约 + 逐条反向变红 + 实际 start 已验）。当前**无**新的、证据充分而未处理的 A 项。
- **B（机会项）**：**跨客户端展示陈旧**——另一会话的**商品列表 / Finder** 在 `staleTime 5min` 内不会自动取新（`enabled` 切回 / 重挂载在 **fresh 时不会请求**，已用真实 QueryClient 探针实测）。**商品编辑页已于 §24 修复**（每次真正打开强制取一次，且等本次取数成功才初始化）；**列表与 Finder 仍未处理**——**Finder 部分已列入第三批（只读取证，先取证不改）**。
  - **下单价（不要无条件说"不影响报价"）**：**正常取价成功时**，订单单价由 `getCustomerPriceApi`（实时）覆盖；但**取价失败 / 该客户未设有效价**时页面会**提示人工确认单价** ⇒ **旧 Finder 参考价可能影响操作人的判断**。该**人工确认分支尚未做双会话行为验收**。
  - **最小方案（未实施，已收窄）**：`refetchOnMount:'always'` **只对 Finder 有效**（弹窗每次重开都会重新挂载）；对**已挂载的 keep-alive 商品编辑页无效**（组件不卸载 ⇒ 不触发挂载刷新）。编辑页若要取新，需**另有明确入口且必须保留草稿**（如显式"刷新最新数据"并保留未保存输入）。**不能**把它算作已解决「列表 / 编辑 / Finder 全部陈旧」。
- **C**：**审批 `sale` 与 Finder / 订单参考价不是同一列**——`sale` 改 `sale_price`（下游是标签与库存估值，均**后端实时**），只有 `a/b/c/d` 才改 `sale_price_a…`（下游是 Finder / 价目表）；**不要把两者混为一谈**。
- **边界**：**前端未做行为验收**（冲突提示条 / 草稿保留 / 基线一致性仅代码审阅 + 类型检查）；**迁移 264 仅隔离库**（**此句已被 §23.5 更正**——2026-09-28 实测发现 `flowcube_dev8` 亦已被迁移，见 §23.5）；**物理打印 / PDA 真机未验**；**未做发版前全量**；**新后端会拒绝旧客户端编辑（400）**，属**待发版协调项**（见 `docs/finance-permission-time.md`）。

---

## 23. §22 前端行为验收（2026-09-28，仅本地）与开发库误迁移记录

**范围**：只验 §22 的**前端行为**（真实 `ProductFormPage`），不改业务代码、不实施 §22.5 的 B 方案。**基线**：`d724f8b`（工作树 clean）；未推送 / 打 tag / 部署 / 碰生产。

### 23.1 环境与隔离（均非密）

- 目标：Node **v22.23.2** · `NODE_ENV=test` · 回环 **3307** · 库 **`flowcube_acceptance20260927_test`**（该库 `product_items.revision` 已存在、`db_migrations` 记 263/264，均 2026-09-27 执行，属上一批）。
- 后端 `:3000`（`env=test`，`LOGISTICS_WORKER_ENABLED=0`、`DINGTALK_ALERT_WEBHOOK=` 空 ⇒ 启动日志**无物流取号 worker**、钉钉静默；`APP_UPDATE_DOWNLOADS_DIR` 用 `/tmp` 可写目录）；前端 `:5173`（`VITE_ELECTRON=1`）。两进程 cwd 均属**当前工作树**。
- 浏览器：独立命名会话 `flow-autonomy-20260928`，阶段收尾已 `close` 并 `session list --json` 确认空；未 `close --all`。
- **未自造 Probe**：被测端是真实页面（含工作区标签 keep-alive）；"另一会话"用**真实 HTTP**（`smoke_admin` 登录后调 `PUT /api/products/:id`）驱动。口令只用于本次会话、未落仓库 / 文档 / 日志，临时文件已删。
- **夹具按 ID 自洁**：商品 `147/148/149/150`、供应商 `62`、相关 `product_price_history` 删除后复查**全 0**；未动该库 seed（分类 `1`「验收用分类」、商品 `SMOKE-P001`）。

### 23.2 验收结果（逐项，证据分级）

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| ① | 另一会话改价后旧页提交 **409**，**不回退价格**、**不写历史** | **通过** | 旧页 `form` 持 A=150/B=200（revision=1）；HTTP 侧改 A→300/B→250（revision→2）后旧页点保存得 409；DB 仍 **A=300/B=250**（未被回退为 150/200）；`product_price_history` 仅 2 条，均为 **21:54:39** 的 HTTP 改价所写，**409 零写入** |
| ② | 409 **单次 toast** 且**保留未保存草稿** | **通过** | 真 toast 容器 `[aria-label*="Notifications"] ol` 内**恰好 1 条**「该商品已被他人修改，请刷新后重新编辑」；内联冲突条在；备注草稿「草稿A-验收」保留 |
| ③ | 同商品**后台 refetch 不抹草稿**、`formRevision` 仍取**原始基线** | **通过** | 由另一商品保存成功触发 `invalidate [K]`；网络记录确认发过 `GET /api/products/147`（200）；147 备注草稿保留、`form` 价格**未被新数据覆盖**（仍 150）、再次提交**仍 409**（证明基线未被 refetch 更新） |
| ③′ | **无本地编辑**时后台 refetch 是否**误报 `isDirty`** | **不通过（缺陷）** | 149 从未编辑任何字段；被外部改价（A 20→99，revision→2）并经 `invalidate [K]` refetch 后，**149 标签出现未保存圆点、页面显示「未保存」徽标**（可见元素计数 1，见截图 `/tmp/fc-149-false-dirty.png`）；关闭该**未编辑**页时**误弹**「离开确认／当前内容尚未保存」（截图 `/tmp/fc-149-leave-confirm.png`） |
| ④ | 关闭重开（**5 min fresh 窗口内**）是否取到最新价 / revision 并**恢复编辑** | **不通过（缺陷）** | 干净场景（未触发任何 invalidate）：页面初载 revision=1 → HTTP 改 A→300（revision→2）→ 旧页 409 → **真正关闭标签并重开**（重开后 `GET /api/products/147` **未发生**，仅 notifications/categories/settings）；重开后表单仍 **A=150**（DB 为 300）、**无「未保存」也无任何"数据可能过期"提示**、点保存**仍 409** ⇒ **无法恢复** |

### 23.3 两个补充审查点的证据

1. **`useProduct` 无 `refetchOnMount:'always'` + 409 不失效缓存** ⇒ 5 min fresh 窗口内关闭重开**不重新取数**。已实测（④：重开零 `GET /api/products/147`）。全局默认见 `frontend/src/lib/queryClient.ts`（`staleTime 5min`、**未设** `refetchOnMount`、`refetchOnWindowFocus:false`）；`useProduct` 见 `frontend/src/hooks/useProducts.ts`；409 分支见 `frontend/src/pages/products/form.tsx`（`setConflict(true); return`，**不** invalidate）。
2. **`isDirty` 用随 `product` 重算的 `initialForm` 比较，而非入页快照**：`form.tsx` 中 `isDirty = JSON.stringify(formRef.current) !== JSON.stringify(initialForm)`，而 `initialForm` 是 `useMemo([product, isEdit])` ⇒ 后台 refetch 换 `product` 引用后 `initialForm` 即变为**新服务端值**，而 `form` 按**商品 id** 不重置（`initedProductIdRef` 机制）⇒ **未编辑即被判为"已改"**。已实测（③′）。

### 23.4 对 §22.5「B 最小方案」的**未实测**推断（**非结论**）

- **代码层推断**：若仅给 `useProduct` 加 `refetchOnMount:'always'`，重挂载时 React Query 会**先返回缓存旧值**，`useEffect` 按**商品 id** 完成 `setForm(initialForm)` 与 `formRevisionRef` 初始化；随后 refetch 到达的新数据因 **id 相同**被同一 `useEffect` 判定**跳过重置** ⇒ **表单与基线仍停在旧 revision**。故**"请求已发生"不等于"已恢复"**——需实测（含**缓存重挂载 + 延迟响应**）方可判定，本批**未实施该改动**（按指令暂不修改），因此**不将此推断写成已验证事实**。
- 另外两条**已实测**的限制：编辑页是**工作区标签 keep-alive**，"关闭重开"须**真正关闭标签**（有草稿时会弹「离开确认」）；仅切换标签**不卸载组件**、不会重挂载（本批先用过期 ref 点击时观察到该现象，故改用真实关闭流程）。

### 23.5 开发库误迁移（如实记录，**保持原状**）

- **事实**：本次为取得 3307 实例而执行了 `npm run dev:mysql8`（`scripts/mysql8-dev.sh start`）。该脚本**除启动 colima 容器外，后半段还会对固定开发库 `flowcube_dev8` 执行结构迁移**——脚本回显确认本次对 **`flowcube_dev8` 执行了 `263_fin_invoices_revision.sql` 与 `264_product_items_revision.sql`**（`dev8.db_migrations` 已记录两条）。此为本脚本**既有行为**，但**越过了"只迁移独立测试库"的边界**。
- **与 2026-09-26 那次的区别（不要混为一谈）**：`docs/dev8-migration-drift-2026-09-26.md` 记的 258/259 误入 dev8，根因是**一次性命令里 `source` 指向了不存在的文件**，导致 `migrate.js` 的 dotenv **回退到 `backend/.env`**（其 `DB_NAME=flowcube_dev8`）——**不是** `mysql8-dev.sh` 造成的。本次则源于**启动脚本 `start` 顺带迁移**。两次**机制不同**，但属**同一类**问题：**「迁移目标库的边界失效」**（本该只作用于独立测试库或显式目标，却落到了开发库）。**不得**表述为"同一脚本二次触发"。
- **处置**：**不回滚结构、不清理库、不猜路径**；`flowcube_dev8` 的 263/264 **保持现状**。此后**不再**运行该脚本，容器仅以已有实例复用，业务验证**全部**显式指向 `flowcube_acceptance20260927_test`。
- **更正**：§22.5 / §22.4 中"迁移 264 仅隔离库"的表述**不再准确**；**准确表述为**：迁移 264（及 263）**同时在 `flowcube_dev8` 与 `flowcube_acceptance20260927_test` 生效**，其中 dev8 的生效**源于本次启动脚本的附带迁移**，非经独立测试库流程。
- **候选（下一批）→ 已实施**：该启动脚本**默认附带 schema 修改**的风险已按**方案 A** 拆分——`start` 只启动实例，迁移必须由显式的 `npm run dev:mysql8:migrate` 触发且目标固定。**独立记录见 `docs/mysql8-dev-script-role-split-2026-09-28.md`**（与商品批次**分开提交**）。

### 23.6 边界与未验证（如实）

- 本节仅覆盖 §22 **前端行为**的上述四项 + 两个补充点；**未**做发版前全量回归；**未**验生产影响规模；**未**验证旧客户端（无 `revision`）的实际表现。
- ③′ / ④ 为**证据充分的缺陷**，按指令**先报反例与影响，暂不修改**，待 Codex 独立审查后再定方案。
- 物理打印 / PDA 真机未验。

---

## 24. §23 两处缺陷的窄修复（2026-09-28，仅本地）

**范围**：只修 §23.2 的 ③′（无编辑误报未保存）与 ④（关闭重开不恢复）这**两个**缺陷。**不做**全局 `staleTime=0`、**不改**全局 Query 默认、**不自动**把新价 merge 进旧草稿。Codex 已独立验收 §23 并列为 A、授权实施。

> **事实澄清（勿混）**：商品编辑页本批修的是**两个**缺陷（③′、④）。**§23.2 ① 的「旧页提交 409、不回退价格、不写历史」是已验的**正向保护 / C 类**，不是缺陷** —— 409 正是版本 CAS 生效、**成功阻止**了旧页把已审批的等级价/成本价回退。**不得**把它表述成"本批修了三个缺陷（含 409 回退价）"。

### 24.1 方案（与约束逐条对应）

- **同一次初始化快照**：`ProductFormPage` 把「表单值 / 提交基线 `revision` / dirty 比较基线」固定在**同一次初始化**产出的同一个快照对象上（`baseline` state + `formRevisionRef` 同时写入），不再用「随 `product` 重算的初始值」做 dirty 比较。
- **后台 refetch 不动草稿与基线**：初始化以**商品 id** 为界只做一次；同 id 的后台刷新（失效重取）**既不重置表单、也不改基线** ⇒ 草稿保留、`isDirty` 不误报、提交仍用原始 `revision`。
- **真正新打开必须等本次刷新成功**：`useProduct` 新增可选参数 `{ refetchOnMount }`（**仅编辑页**传 `'always'`），配合 `isFetchedAfterMount` —— **本次挂载后的取数成功返回前不初始化、不渲染表单、不可保存**，从根上堵住「用 fresh 缓存旧值抢先初始化 ⇒ 拿旧 revision 提交」。
- **失败可重试、且不拿缓存冒充最新**：首次取数失败 ⇒ 整页「最新商品信息加载失败，请重试」+ 重试按钮，**不渲染**缓存旧值；`isFetchedAfterMount` 在失败后也会变 true，故**必须叠加 `isError`** 才拦住错误快照初始化。
- **已初始化后后台失败不覆盖草稿**：错误整页态只在 `baseline === null` 时使用；已初始化后刷新失败 ⇒ **保留当前表单与草稿**，仅给出提示条与重试入口。
- **仅切换 keep-alive 标签**不卸载组件、不重挂载 ⇒ 草稿自然保留（未改动该机制）。
- **新建不受影响**：`isEdit=false` 时不请求详情、基线为空表单。

### 24.2 自动化（先看失败再改；失败断言为真实行为）

- 新增 `frontend/src/pages/products/form.version-guard.test.tsx`：**渲染真实 `ProductFormPage` + 真实 `QueryClient`**（与生产同 `staleTime`），只 mock 边界（商品/设置接口、finder 弹窗、路由、toast）。**未自造镜像 Probe、未扫源码文本**。
- 覆盖 7 例：fresh 缓存 + **延迟响应**重挂载（断言**此时无保存按钮、零 API 调用**）→ 新价/新 revision 初始化 → 提交成功；首次刷新失败不可用缓存保存 + 可重试；**无编辑后台 refetch 不误报**；有草稿 refetch 保草稿且**仍发原 revision**（并断言 payload 的 `remark`/`name`）；409 保草稿；**已初始化后后台失败仍保草稿**；新建。
- **TDD 证据（两阶段，数字均为实测）**：
  1. **首次基线（6 用例版本）**：修复前 **3 失败 / 3 通过** —— 失败即 ①缓存抢先初始化 ②失败不降级 ③无编辑误报「未保存」。
  2. **最终版本（7 用例）反向运行**：把 `form.tsx` / `useProducts.ts` 取回**修复前提交**（`30d8c68^`）后在**独立副本**中运行 ⇒ **4 失败 / 3 通过**（多出的 1 个失败为新增用例「已初始化后后台刷新失败保草稿」；通过的是草稿保留、409 保草稿、新建 —— 这三项修复前本已正确）。恢复修复后同文件 **7 通过**。
  - 说明：反向运行**未修改主工作树**（副本位于 `/tmp`，因主仓库源码在本次修复已提交，`git checkout` 只能取回修复版，故改用副本 + `git show <rev>:<path>` 导出）。
- **CI 可达**：`.github/workflows/test.yml` 已跑 `npm --prefix frontend run test:unit`（vitest 自动纳入该文件，**无需改 CI**）。
- **全量单测（项目要求的 Node 22）**：**单条命令内** `source ~/.config/flowcube/dev-env.sh` + `node --version` + `npm --prefix frontend run test:unit` ⇒ **`node=v22.23.2`、139 个测试文件 / 638 个用例全部通过、rc=0**（完整日志 `/tmp/fc-node22-full.log`）。
- **旧日志的环境更正（重要，勿再引用）**：本节初版曾记录基线 **85 failed / 553 passed** 与"修复后 81 failed / 557 passed"，并据此写过"14 个基线已有失败文件 / 81 个既有失败用例"。该组数字是在**默认 shell 的 Node v26.8.1**（`/opt/homebrew/bin/node`）下跑出的——**每个 shell 调用相互独立**，先前的 `source dev-env` 不会延续到后续命令，故当时并未使用项目要求的 Node 22。该组失败与 `AGENTS.md` §3 记载的「本机 Node 26 下前端单测既有 `localStorage is not available` 假失败」一致，**不是真实基线缺陷、也不是本批引入**。**更正后的结论**：Node 22 下全量**全绿**，本批**无新增失败、亦无既有失败遗留**；上述 81/14 的说法**作废**。
- 反向验证（7 用例）已在 **Node 26 与 Node 22 下各跑一次，结果一致：4 失败 / 3 通过**（该文件不依赖 `localStorage`，故与运行时版本无关；Node 22 那次在独立副本内运行）。
- `tsc -p frontend/tsconfig.app.json --noEmit` rc=0；改动文件 eslint rc=0。

### 24.3 真实浏览器原反例复验（隔离库 + 本地栈）

用真实 `ProductFormPage`（工作区标签 keep-alive）＋ HTTP 驱动"另一会话"，**未自造 Probe**；夹具按 ID 自洁（商品 151/152、供应商 63 及相关历史**全 0**）。

| 原反例 | 复验结果 |
|---|---|
| ④ 关闭重开（5 min fresh 内）能否恢复 | **通过（已修）**：重开**发起了** `GET /api/products/:id`（原来零请求）；表单初始化为**最新价 + 新 revision**（原为旧值）；随后提交**成功**（`商品已更新`，`revision` 1→2→3） |
| ③′ 无编辑 + 后台 refetch 是否误报 | **通过（已修）**：真实失效重取（另一商品保存成功触发，网络记录确认发过该商品 `GET`）后，可见「未保存」徽标数 **0**（原为 1）、无冲突条；关闭该未编辑页**不再误弹**「离开确认」 |
| ③ 正向（有草稿 + refetch） | **本批仅组件专项通过**（未再跑浏览器）；**真实浏览器证据见 §23.2 ③**（上一阶段已验） |

### 24.4 未验证边界（如实）

- **未做发版前全量构建/回归**（按指令只补跑受影响组件测试与类型检查）；未验生产影响规模。
- **发布顺序与旧客户端兼容边界不变**：迁移 264 → 后端 → 前端；新后端仍会**拒绝**未带 `revision` 的旧客户端编辑（400 `PRODUCT_REVISION_REQUIRED`），**本批未验旧客户端实际行为**。
- **§22.5 的 B 其余部分（Finder 关闭重开、A 等级价跨客户端展示陈旧、实时客户价失败/无有效价的人工确认路径）本批未处理**。

---

## 26. 本批后续

启动脚本职责拆分（§23.5 的"下一批候选"）**已实施**，独立记录见 **`docs/mysql8-dev-script-role-split-2026-09-28.md`**（与商品批次分开提交）。

---

## 27. 商品 Finder 陈旧缓存（2026-09-28；取证 → 已窄修）

§22.5 B 的**商品 Finder**部分：取证确认「关闭重开 / 重开后重复搜索原关键词 / 同次 A→B→A」在全局 5 min `staleTime` 内**显示旧 A 参考价**，且页脚「确认选择」回传**过期行对象**（双击/Enter 回传当前行）。经 Codex 接受两个 A 项后实施**窄修复**：`useProductFinder` **局部 `staleTime: 0`**（唯一调用点，全局默认不动）+ `ProductFinderContent` **只存 `selectedId`**（选中对象一律从当前列表派生）。

- **回归**：`frontend/src/components/shared/ProductFinderModal.stale-cache.test.tsx`（6 例）——**原实现 3 红 / 3 绿**、修复后 **6/0**；反向验证（摘 `staleTime:0`）⇒ **仅**「重开重复关键词」「A→B→A」2 例变红。相关专项（Node 22 单条命令）合计 **36/0**（含既有 Finder 3、销售取价/校验 20、orderEntry 校验、改价失效）。
- **真实浏览器复验**：重开参考售价 **¥150.00**（原 ¥100.00）、重开发起 **2 次** finder 请求；选中 → 确认 ⇒ 明细单价 **150**。
- **B（未量化）**：`staleTime:0` 的请求量代价。**C（非缺陷）**：无有效价要求人工确认、取价成功覆盖参考价、**选中行被移除后禁止确认是正确守卫**。
- **口径纠正**：全局 `refetchOnWindowFocus:false` ⇒ `staleTime:0` **不会**开启"窗口重新聚焦取数"；客户取价**抛错**分支目前只有代码/组件证据（GUI 实到的是**无有效价**分支），两者分开。
- **边界**：**未保存任何真实销售单**（只验到 Finder 选中与草稿行单价）；夹具仅隔离测试库且已按 ID 自洁；未评估生产影响规模。取证全文见 **`docs/finder-stale-cache-investigation-2026-09-28.md`**。
- **客户/供应商 Finder 的同类问题**（`selected` 亦为整行对象、搜索变化不 reset、页脚仅 `disabled={!selected}`、加载中也可确认）**已完成很窄对照取证**（真实组件 4/4；**未批准修改其业务代码**，最小方案待批）：见 **`docs/finder-selection-parity-2026-09-28.md`**。

---

## 28. 客户/供应商 Finder 的选中一致性（2026-09-28；取证 → 已修）

`CustomerFinder` / `SupplierFinder`（+ 通用 `FinderModal`）与商品 Finder **同根因、守卫更弱**：页脚确认可回传**过期或列表之外**的对象；加载中 / 出错 / debounce 期间也可确认；搜索不清空选中。经 Codex 全仓核对（`FinderModal` 仅这两个调用方、`FinderTable` 仅其使用）后，**在通用组件统一守卫**修复：

- 两个 Finder **只存 `selectedId`**、从当前启用列表派生；**搜索立刻清选择**；`isLoading = isFetching || debouncing`；页脚/双击/空格共用 **`onConfirm(row)`**；出错显示**可重试**错误（`isError`/`error`/`onRetry`）；`onSelect` 同受守卫；**`Enter` 仍只是"选择"**。
- **独立审查后补的边界（各有反向验证）**：搜索值用**原始值**比较（`.trim()` 会让带首尾空格的输入**永久 pending**）；**关闭与卸载都清 debounce timer**（否则"输入后立刻关闭"重开后永久 pending）。
- **回归**：两个 Finder **各 9 例、共 18/18**；TDD（6 例版）原实现各 **5 红 / 1 绿**；最终版三项反向验证**各精准变红**。本批**只补跑受影响项**（未再跑全量；先前 656 是加强版之前的数字）。
- **使用方（当前源码，排除 `*.test`）**：`<CustomerFinder>` **9 个实例**、`<SupplierFinder>` **11 个实例**，共 **20 个实例 / 15 个文件**；**接口未变只表示"不必改调用代码"**，本批改的是**运行行为守卫**，**仍会影响**这些页面，**尚未逐页运行时 / GUI 验收**。
- **未做**：真实浏览器取证（纯组件层 + 真实 `QueryClient`）；**未逐页验收上述 20 个使用方**（付款/核销、采购/销售/退货、查询窗口、对账）——列为**发版前跨端累计验收项**；**未改**全局缓存 / 客户取价 / 后端。

**环境事实（交接用，只核对可执行文件 / cwd / 监听，未读取 argv 或环境）**：GUI 预览栈后端（:3000）实际运行在 **Node v26.8.1**（`/opt/homebrew/Cellar/node/26.8.1/bin/node`），cwd 属本工作树；**本批与既往前端自动化专项均在 Node v22.23.2 下运行**。两者运行时应予区分：**自动化结论以 Node 22 为准**；发版前业务套件仍在 Node 22 统一验证。

### 28.1 最终累计专项（2026-09-28，Codex 独立复跑）

**同一条命令内 `source ~/.config/flowcube/dev-env.sh`（`node v22.23.2`）跑 8 个文件 ⇒ 61/0、自然 exit 0**：

| 测试文件 | 用例 |
|---|---|
| `CustomerFinder.test` | 9 |
| `SupplierFinder.test` | 9 |
| `ProductFinderModal.stale-cache.test` | 6 |
| `ProductFinderModal.test`（既有） | 3 |
| `form.version-guard.test`（商品编辑页） | 7 |
| `useSaleOrderForm.test`（销售取价 / 校验） | 20 |
| orderEntry 校验 | 5 |
| 改价失效 | 2 |
| **合计** | **61 / 0** |

**口径（重要）**：这 **61** 是**当前最终实现**的专项证据；此前记录的 Node 22 全量 **142 文件 / 656 用例**只对应**加强版之前**的版本（其后又补了 debounce / 清 timer / 首尾空格三处守卫及其用例），**不得**用它代表最终实现。

### 28.2 下一步（优先级，**未启动**）

1. **旧客户端 `revision` 兼容与发版前跨端累计验收**（新后端会拒绝未带 `revision` 的商品编辑，400 `PRODUCT_REVISION_REQUIRED`）。
2. **客户/供应商 Finder 的 20 个使用方实例（15 个文件）运行时 / GUI 验收** —— 重点：**付款/核销、采购/销售/退货、查询窗口、对账**；本批只做了组件层回归，**未逐页验证**其运行行为。
3. 客户/供应商自身的 **fresh 缓存策略仍列 B**（**目前无实际业务影响证据**）——**避免机械复制**局部 `staleTime:0`。

### 28.3 两条既定口径（C 类，勿混）

- **ATP 与「当前可拣量」是两套既定口径**，各有其定义与用途；**不得**互相替代，也**不得**据此判定其中一方"错误"。
- **审批的「行锁 / 状态机保护」不等于「请求键幂等重放」**：前者防**并发越权推进状态**，后者防**同一请求重复执行**；**两者不能互相证明**，也**不得**用其一的存在去声明另一项已具备。
- **键盘语义按组件区分，不得抹平**：**客户 / 供应商 Finder**（通用 `FinderModal` + `FinderTable`）—— `Enter` **只是"选择"**、**`Space` 才是确认**；**商品 Finder**（`ProductFinderModal`）—— **`Enter` 可确认**（与双击同为"以当前行确认"）。两者是**既定的不同设计**，不要合并成一条统一规则。

### 28.4 任务资源关闭核验与实现基线（交接）

- **实现基线**：`8b4ba0b`（客户/供应商 Finder 统一守卫）。**文档 HEAD 以 `git log` 当前为准** —— 本节及全篇**不再追写自身提交 SHA**（避免文档追自己）。
- **资源关闭（Codex 独立核实 + 本任务复核）**：`:3000` / `:5173` **无监听**；`agent-browser session list` **为空**；**共享 3307 容器保留且健康**（`flowcube-dev-mysql8`，**未停**，后续任务可复用）。
- **未触碰发布边界**：未推送 / 打 tag / 部署 / 生产迁移。

---

## 29. 缺 `revision` 的 400 恢复文案（2026-09-28；已实施）

**问题（真实旧客户端实测）**：用 `git archive a2b7fb7^ frontend` 导出到**独立临时目录**的**真实旧前端**连当前后端 —— `PUT /api/products/:id` ⇒ **400**、**草稿保留**，但**刷新后仍 400**（旧客户端**永不**回传 `revision`）⇒ 原文案「缺少版本号，请刷新后重试」是**不可完成的指引**，员工会陷入"刷新 → 再失败"循环且无出路提示。

**修复（只改 message）**：商品 `PRODUCT_REVISION_REQUIRED` 与发票 `INVOICE_REVISION_REQUIRED` 的 400 文案**统一**改为：

> 缺少编辑版本信息，本次修改未保存。请先复制需要保留的内容；浏览器请刷新加载新版，桌面端请更新后重新编辑。

要点：**"复制"放在"刷新/更新"之前**（避免先刷新而丢草稿）；**不武断断言"版本过旧"**（也可能是调用方漏字段）；**HTTP 码 / 业务码 / 行锁 / CAS / 写入路径完全未动**，**不放行**缺 revision；**只改服务端文案**（新前端的错误码映射**不覆写**它，只有后端文案能触达旧客户端），**不加重复的前端 toast**。

**证据层级（如实）**：① **真实旧前端 GUI**（5174，旧提交导出）实测 —— 收到**新文案**、**仍 400**、**草稿仍在**；② **新版前端 GUI**（5173）正向保存**成功**（`PUT` 200、`revision` 1→2）；③ Codex 独立核对 diff **仅 message/comment**。**发票侧同文案，但旧发票 GUI 未验，不据此外推。**

**验收环境偏差（如实记录，非业务失败）**：首次新版前端出现「页面出错 / Invalid hook call / more than one copy of React」—— 根因是旧前端副本 **symlink 了同一 `node_modules`**，两套 Vite **共享 `.vite` 依赖缓存**互相污染。清理缓存并**分时运行**后恢复正常。**这是验收环境偏差，不是业务回归失败**；若将来需同时跑两套，旧副本必须使用**独立 `cacheDir` / 独立依赖目录**。

**已修（见 §30）**：发票编辑遇 409 原为 `invalidateQueries + onClose()` ⇒ 弹窗关闭、草稿丢失；**§30 已完成取证（真实页面组件 6 例 + 真实 GUI）并改为「保留弹窗与草稿 + 内联提示」**。此处原"仍待办"**已关闭**。

---

## 30. 发票 409 的恢复行为（2026-09-28；取证 → 已修）

**取证（真实 `InvoicesPage` + 真实 `QueryClient`，只 mock 底层 `@/api/accounting`）**：编辑弹窗内填好草稿后保存遇 409 `INVOICE_CONCURRENT_MODIFIED` ⇒ 提交载荷**确带草稿**（`remark`=草稿、`revision`=打开时值），但 `onError` 的 `onClose()` 使 **dialog 从 DOM 消失**、重开后备注**回到原值** ⇒ **真实丢稿**（比"`textContent` 不含草稿"的弱断言更严格：`input.value` 不属于 `textContent`）。

**修复**：409 ⇒ **保留弹窗与草稿** + 内联提示「先复制 → 关闭 → 等列表刷新完成后重开核对」；**不自动关闭 / 不自动重试 / 不 merge 新版本**；toast 仍由全局拦截器统一给出。列表 **`isFetching`/`isError` 期间阻止重新编辑**（按钮 disabled，标题分开），列表出错给**可重试错误区**（`QueryErrorState` + `refetch`）；冲突提示在**重建表单**（打开/换 id/转录入）的同一 effect 清除。

**证据**：`frontend/src/pages/accounting/invoices/index.409-recovery.test.tsx` —— **早期 5 例阶段**曾得"**2 红 / 3 绿**"（红=409 后弹窗已关草稿消失、刷新 pending 未阻止重编辑；当时另有 2 例因测试自身设计问题被修正，**不作业务反证**）；**最终 6 例**（补齐"重开/转录入不带旧提示""失败时可重试"等后）⇒ 修复后 **6/6**。覆盖 409 保留草稿、重开/转录入不带旧提示、后台刷新不换基线（**既有正向/C**）、刷新期间阻止重新编辑（**实际点击**禁用按钮 ⇒ 无 dialog、无额外请求）、失败时**点重试**真实恢复、正常成功与其它错误不误报。**未验**：早期"移除 `onClose`"反向变体执行被本机工具策略拦截（已如实标注）；**旧发票客户端 GUI 未验**。

**真实 GUI 复验（新版前端 :5173 + 隔离库，夹具按 ID 自洁）**：新建发票 21 ⇒ 编辑弹窗改备注「GUI草稿」⇒ 先用 HTTP 让他人改（`remark`=他人改过、`revision` 1→2）⇒ UI 保存 ⇒ **409**，实测**弹窗仍在、草稿仍在、内联冲突提示出现**；**手动取消关闭 → 重开** ⇒ 备注为**最新值「他人改过」**、**无残留冲突提示** ⇒ 保存 ⇒ **200**、toast「已保存」、弹窗关闭。**网络边界不在 GUI 重复**，GUI 只验这条主路径（组件 6 例覆盖其余边界）。

**边界**：发版前后端全量 / 物理打印 / PDA 真机仍未验；20 实例验收见后续记录。

---

## 31. Customer/Supplier Finder 20 实例验收（2026-09-28）

**范围**：`<CustomerFinder>` 9 + `<SupplierFinder>` 11 = **20 实例 / 15 文件**。方法：真实 GUI 打开各自入口 → 搜索 → 选中 → 确认 → 读**回填**；关键项另抓**业务请求**（与 Finder 自身 `keyword` 搜索请求**分层记录**）。

**已验（19/20，逐页真实 GUI；夹具为**隔离测试库**按 ID 登记，非生产）**：

| 载体 | Finder | 观察 |
|---|---|---|
| `PaymentQueryDialog`（应收页） | Customer | 回填正确；**业务载荷 `GET /payments?type=2&partyName=验收批5客户&status=unsettled…`** |
| `PaymentQueryDialog`（应付页） | Supplier | 回填正确；**业务载荷 `GET /payments?type=1&partyName=<供应商名>&status=unsettled…`** |
| `SettleReceiptDialog` | Customer | 回填正确 |
| `SettleReceiptDialog` | Supplier | 回填正确；**候选载荷 `GET /payments?type=1&partyId=<新建夹具 id>&…`** |
| `sale/form`（新建主入口） | Customer | 回填正确 |
| `purchase/form` | Supplier | 回填正确 |
| `returns/sale/form` | Customer | 回填正确 |
| `returns/purchase/form` | Supplier | 回填正确 |
| `returns/ReturnQueryDialog`（**`/returns/sale`**） | Customer | 回填正确（该范围**只渲染客户** Finder） |
| `returns/ReturnQueryDialog`（**`/returns/purchase`**） | Supplier | 回填正确（该范围**只渲染供应商** Finder） |
| `SaleQueryDialog` | Customer | 回填正确 |
| `PurchaseQueryDialog` | Supplier | 回填正确 |
| `ProductQueryDialog` | Supplier | 回填正确 |
| `InboundTaskQueryDialog` | Supplier | 回填正确 |
| `products/form` | Supplier | 回填正确 |
| `inbound-tasks/new`（`InboundTaskCreatePage`） | Supplier | 回填正确（**路由是 `/new`，非 `/create`**） |
| `portal/statements`（菜单「销售 → 对外查询 → 客户对账单查询」） | Customer | 回填正确（**从菜单进入完成回填**；本轮**直连 URL 尝试未成功，原因未定位** —— **不当作既定路由限制**） |
| `sale/form` **EditView**（既有 `status=1` 单进入） | Customer | 回填正确 —— 入口是 `[data-entry-field="party"]` 内的 **PickerField button**（**非 combobox**），点击即开 `CustomerFinder`；**取回填后取消编辑，未保存** |
| `purchase-requisitions/new` 明细行（`scope=item`） | Supplier | 先加入一条商品行 ⇒ 点「选填，可转单时定」开 `SupplierFinder` ⇒ 选中后**明细行回填「诊断供应商」**；**未保存请购单** |

**未达（1/20）**：

- **`sale/form` 的 `AdjustView`**：要求 `status 2/3/6`（+ 单仓 / 未发货 / 无挂起）。**隔离库实测只有 `status=1` 共 2 张**（`SELECT status,COUNT(*) … GROUP BY status`）⇒ **无合格单**，本轮未达（未手工改状态；**建最小单并占库属多步，未在本短轮做**）。

**两处"未达"更正与根因（均为检查方法错误，非产品缺陷）**：

- **EditView 客户入口**：先前记为"combobox / 未见 `CustomerFinder`" —— 实际是 `[data-entry-field="party"]` 内的 **PickerField button**，点击即开 `CustomerFinder`（已补验）。EditView 内该组件共 2 处，本批验**客户主入口**那处，**另一处未单独验**。
- **请购明细行供应商**：先前记为"商品 Finder 前端 0 行、原因待查" —— **根因是选择器用错**：`ProductFinderModal`（**商品**）用**原生 `<table>/<tbody>/<tr>`**，**没有 `role="row"`**，用 `[role="row"]` 数必然是 0；而通用 `FinderModal`+`FinderTable`（**客户/供应商**）相反 —— 是 **`div[role="row"]`**、**不是原生 table**。改用对应选择器后实测：请购 ProductFinder **原生 `tbody tr` = 1 条**（含「诊断商品」）、`GET /products/finder?keyword=诊断商品` **200** ⇒ **可正常选行加入明细**，随后 `SupplierFinder` 亦正常回填（见上表）。**"启用商品"只是静态过滤提示，不是空态证据**。该 JSX 的 **`scope=convert`（转单）**路径仍**未验**。

**口径（按独立审查更正）**：
- ① PaymentQuery 的**业务载荷必须与 Finder 类型对应**：客户侧 `GET /payments?**type=2**&partyName=<客户>`、供应商侧 `type=1&partyName=<供应商>`（**不能**拿 `type=1` 的请求归给客户）；Finder 自身的 `keyword` 请求**只证明搜索**，不等于业务查询载荷。
- ② SettleReceipt 的**候选载荷**：客户侧实测 `GET /payments?**type=2&partyId=510**&settlementTypes=1…`、供应商侧 `type=1&partyId=<夹具 id>` ⇒ **按 id 查**（非仅靠回填名字）。
- ③ `ReturnQueryDialog` 按 `type === sale / purchase` **条件渲染**，**不是同页同时存在**两个 Finder。
- ④ `portal/statements` **从菜单「销售 → 对外查询 → 客户对账单查询」进入即正常渲染**；先前"直连 URL 未渲染"只说明**该页面的进入方式**，**不足以**判定导航失败根因（未做进一步定位）。
- ⑤ 上表是**逐页 GUI 的基本回填 / 关键载荷**；**共享边界**（debounce / 挂起 / 错误 / 409）由**共享组件测试**覆盖（`CustomerFinder.test.tsx`、`SupplierFinder.test.tsx` 各 9 例 + `ProductFinderModal.stale-cache.test.tsx` 6 例），**不冒充逐页 GUI**。**20 实例的基本验收 ≠ 覆盖所有业务模式**（如请购的 `scope=convert` 转单细分、销售单 `AdjustView` 条件路径）。
- **未发现新缺陷** ⇒ 未做任何"为过测试"的补丁。夹具为**隔离测试库**内按 ID 登记并自洁；清理后**物理与 active 残留均为 0**（未把软删当无残留）。

未触碰发布边界（未推送 / 打 tag / 部署 / 生产迁移）。

---

## 32. 本轮可接续状态（2026-09-28 收尾）

**基线**：**实现基线 `c75d934`**（发票 409 修复）。**文档最新 commit 以 `git log` 当前为准**（本节不追写自身 SHA）。主 `main` **`29f223e` 未改**；本工作树 **clean**。

**本轮两项实际修复**：

1. **缺 `revision` 的 400 恢复文案**（商品 `PRODUCT_REVISION_REQUIRED` 与发票 `INVOICE_REVISION_REQUIRED` 统一）：**只改 message**，指引"先复制再刷新/更新"，**不放行**缺 revision（`9eca2ef`）。
2. **发票编辑遇 409**：由"失效列表 + **自动关闭弹窗**（丢草稿）"改为 **保留弹窗与草稿 + 内联提示**；并加 **列表 `isFetching` / `isError` 期间阻止重新编辑** 与**可重试错误区**（`c75d934`）。

**证据层级（各自范围，勿混用）**：

- **组件 6 例**：`frontend/src/pages/accounting/invoices/index.409-recovery.test.tsx`（真实 `InvoicesPage` + 真实 `QueryClient`，只 mock 底层 api）—— 覆盖 409 保留草稿、重开/转录入不带旧提示、后台刷新不换基线（**既有正向 / C**）、刷新期间阻止重编辑（**实际点击**禁用按钮 ⇒ 无 dialog、无额外请求）、失败时**点重试**真实恢复、正常成功与其它错误不误报。**早期 5 例阶段**曾得 2 红 3 绿 → 最终 6 例**修复后 6/6**。
- **实际 GUI**：新版发票页（:5173 + 隔离库）实测 409 ⇒ **弹窗/草稿在 + 冲突提示**；关闭重开拿到最新值、无残留提示 ⇒ **保存 200**（网络边界不在 GUI 重复）。
- **累计专项 67/67**：Codex 独立复跑（Node v22.23.2 单条命令）。
- **全前端单测 143 文件 / 668 例**：Node v22.23.2、**自然 exit 0**（`npm --prefix frontend run test:unit`）。
- **类型检查 / lint（如实，不升级）**：`./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit` **rc=0**；eslint **仅对改动文件** rc=0 —— **本轮未跑全量 frontend lint**。

**§16 既有证据（不重复当未验）**：`## 16. 浏览器导出真正落盘验收（2026-09-27，隔离库 + 本地栈）` **已完成**，属既有验收，本轮**未重做、未推翻**。

**A / B / C 与下一步**：

- **A（已确认已修）**：商品价格列版本保护；商品编辑页两处（关闭重开不恢复、无编辑误报）；本地实例脚本启动/迁移拆分；商品/客户/供应商 Finder 选中一致性；**发票 409 保留草稿**；**缺 revision 的 400 文案**。
- **B（待查）**：① **`sale/form` 的 `AdjustView`** —— 下一步应**用隔离库真实创建/占库 API** 准备 `status 2/6` 单（**不得手工改 `status` / 库存**），验完**取消并释放占用、按本轮 ID 清理**；② **请购 `scope=convert`（转单）**细分；③ **真实客户取价异常操作路径**；④ 客户/供应商自身 fresh 缓存策略（**无业务影响证据**）；⑤ `staleTime:0` 请求量代价；⑥ 商品**列表**陈旧；⑦ 客户取价**抛错**分支仅代码/组件证据；⑧ 旧客户端 GUI（商品侧除外）。
- **C（已排除的误判，勿再列为缺陷）**：旧页 409 不回退价格（保护生效）；无有效价要求人工确认 / 取价成功覆盖参考价；Finder 选中行移除后禁确认；**ATP 与「当前可拣量」是既定不同口径**；**审批行锁/状态机保护 ≠ 请求键幂等重放**；`editTarget` 点击快照使"后台刷新不换基线"属**既有正向**。
- **C（键盘语义按组件区分，**不得抹平**，见 §28.3）**：**客户 / 供应商 Finder** 的 `Enter` **只是"选择"**、**`Space` 才是确认**；**商品 Finder** 的 **`Enter` 可确认** —— 两者是**既定差异**，不是一个统一规则。
- **C（本轮两项"未达"实为**检查方法错误**，已更正，见 §31）**：① **`sale/form` EditView 的客户入口是 `PickerField` 按钮，不是 combobox**；② **商品 Finder 用原生 `<table>/<tbody>/<tr>`，不能用 `[role="row"]` 计数**（客户 / 供应商 Finder 才是 `div[role=row]`）。
- **跨模块下一步**：**先做宏观检查**再决定是否统一公共能力 —— **不能**直接给所有 Finder 套 `staleTime:0`。

**旧开发库误迁移（保持原状）**：`flowcube_dev8` 的 `263/264` 系 **2026-09-28 启动脚本附带迁移**所致，**保持原状、不回滚**（见 §23.5）；**本轮未跑任何迁移** —— **不得**写成"历史所有迁移只作用于测试库"。

**仍未验（不可省）**：物理打印、PDA 真机、生产影响规模、**发版前后端全量与三端构建**。

**资源收尾（Codex 独立核实 + 本任务复核）**：`:3000` / `:5173` / `:5174` **无监听**；`agent-browser session list` = **`[]`**；共享 `colima-flowcube` 的 `flowcube-dev-mysql8` **healthy、3307 保留**。**严格目标** `127.0.0.1:3307 / flowcube_acceptance20260927_test` **只读 COUNT**：`product_items` id **156/157/158 = 0**、`product_price_history` 对应 product **= 0**、`supply_suppliers` id **66–69 = 0**、`sale_customers` id **509–511 = 0**、`fin_invoices` id **21 = 0**（**物理为 0 即可推出 active 为 0**）。**说明**：以上仅覆盖**本轮按 ID 登记**的夹具，**不声称任意历史夹具全清**。

**未触碰发布边界**：未推送 / 打 tag / 部署 / 生产迁移 / 生产数据 / 真实发货消息。

---

## 33. 销售改单（AdjustView）跨模块闭环验收与「改单只改明细」修复（2026-09-29，仅本地）

**环境**：工作树 `claude/happy-mahavira-0a2b4b`（HEAD `78b9828` 起，clean）；后端 `:3000`（`node index.js`，`NODE_ENV=test`、回环 `3307`、库 **`flowcube_acceptance20260927_test`**，进程内硬断言目标；`LOGISTICS_WORKER_ENABLED=0` + 空 `DINGTALK_ALERT_WEBHOOK=` + 可写 `APP_UPDATE_DOWNLOADS_DIR`）；前端 `:5173`（`VITE_ELECTRON=1 vite`）；浏览器会话固定命名 `flow-business-closure-20260928`。账号 `smoke_admin`（测试库公开测试口令，未回显）。

**调用链**：`sale/form` 详情 → `canAdjust`（`status∈{2,3,6}` 且无任务取消/改单挂起、`!executionAdjustmentBlocked`、非多仓、`shippedTotalQty=0`）→ `AdjustView`（`useSaleOrderForm(tabPath, order)`）→ `PUT /api/sale/:id/adjust`（`SALE_ORDER_UPDATE`）→ `sale.service.requestAdjustment` → **无 `task_id` 走 `adjustReservedWithinTransaction`（占库期改单）**，有 `task_id` 走执行期分支。

**场景准备（真实业务 API，未手改 status/库存）**：`POST /api/auth/login` → `POST /api/sale`（客户 1 + 商品 9 + 数量 5）→ `POST /api/sale/:id/reserve` ⇒ **status 2（已占库）**；`reserve-preview` 显示仓库 1 可用 11。共两轮夹具：`sale_orders` **21 / SL20260928001**、**22 / SL20260929001**（均按 ID 登记）。

**A 类缺陷（已确认，本轮修复）**：改单视图复用**完整订单头表单**，但服务端改单**只写明细与 `total_amount`**（占库期/执行期两支均不 UPDATE `sale_orders` 的客户/仓库/备注/收货字段）。

- **证据（夹具 21）**：GUI 客户 Finder 搜索「切换客户」→ `Space` 确认 ⇒ 回填「切换客户-f47da00f」；真实载荷 `PUT /api/sale/21/adjust` 带 `customerId:2`、`customerName:"切换客户-f47da00f"`、`items[0].unitPrice:10`（`priceSource:"list"`、`resolvedPriceLevel:"A"`）⇒ 响应 **200**；DB 实测 **`customer_id` 仍为 1、`customer_name` 仍「Smoke客户」**，而 **`total_amount` 500→50**、明细 `unit_price` 100→10 ⇒ 按新客户价格重算了金额，订单却仍归属旧客户。
- **同组字段同测**：改单里把出库仓库选为「修复范围外仓」并改备注 ⇒ 提交 200，DB `warehouse_id` 仍 1、`remark` 未变 ⇒ **整组头部字段均被静默丢弃**。
- **对照（同一支功能正常）**：改数量 5→8 ⇒ `quantity=8`、`reserved_qty=5`（`min(旧占,新量)`）、`status 2→6`、`total=80`、`stock_reservations` 未新增；取消改单不发写请求；「取消占库」释放后 `status 6→1`、`reserved 0`。**缺陷独立于数量联动**。

**修复（前端，最小）**：`SaleOrderHeaderFields` 新增 `headerReadOnly`，改单视图 `AdjustView` 传该开关 ⇒ 客户/仓库/承运商/运费方式/收货人/电话/地址/备注全部只读、隐藏「从地址簿选择」；提示条改为「改单仅修改商品明细：订单客户、出库仓库与收货信息保持不变。…」（原「订单已发往仓库执行」对 status 2 不成立，一并更正）。**不放宽后端、不新增后端写路径**；`update()`（草稿编辑）仍照旧更新客户/仓库等（该路径本就支持，未改）。

**回归与复验**：`tsc -p frontend/tsconfig.app.json --noEmit` **rc=0**；eslint **仅改动 2 文件** rc=0；`vitest run src/pages/sale/form` **4 文件 / 25 例全绿**。真实 GUI 复验（夹具 22）：改单视图实测 `客户按钮.disabled=true`、备注/收货人 `disabled`、地址簿按钮不再渲染、明细数量仍可编辑；改数量 5→3 提交 ⇒ `quantity=3`、`reserved_qty=3`、`status=2`、`total=300`，而 **`customer_id`/`warehouse_id`/`remark` 全部保持不变**。

**交互回归（审查反馈后补，2026-09-29）**：新增 `frontend/src/pages/sale/form/adjust-header.test.tsx` —— 渲染**真实 `SaleFormPage`**（真实 `SaleOrderHeaderFields`/`CustomerFinder`，只 mock api 层），**实际点击**验证：① 占库改单点客户按钮 ⇒ 选择器**不打开**、`getCustomerPriceApi` **未被调用**；② 占库改单改数量 5→4 提交 ⇒ `adjustSaleApi` 载荷 `customerId=1`（归属原客户）、`quantity=4`；③ 草稿编辑（**正向对照**）点客户按钮 ⇒ 选择器**能打开**（该路径本就支持改客户）。**不只断言 `disabled`**。**变异验证**：临时移除 `AdjustView` 的 `headerReadOnly` ⇒ 用例 ① 失败，恢复后 3/3 通过（临时变体只改本任务自己的文件并在同一会话内恢复，`git diff` 复核无残留）。**证据边界**：这是组件级（真实页面组件 + 真实交互，api 层 mock）证据，**不代替** :5173 的真实后端 GUI 复验（后者见上）；其中「选择器是否打开」按 `FinderModal`（经 `AppDialog`）可能 portal 到 `document.body` 的事实，在 `document` 上断言。`sale/form` 目录 **5 文件 / 28 例**通过；`tsc -p tsconfig.app.json` rc=0、改动/新增文件 eslint rc=0、`test:frontend-date-source`、`test:frontend-conventions`（5/5）通过。CI 入口为既有 `npm --prefix frontend run test:unit`（`.github/workflows/test.yml:166`），新文件随目录自动纳入。

**夹具清理与残留复查（本轮 ID，仅按 ID 核对、未清历史）**：21、22 均走**合法路径**（取消占库 → 取消订单 → 删除订单）到达终态。**软删 ≠ 无残留**——按 ID 实测：

| 对象 | 现状（按本轮 ID） |
|---|---|
| `sale_orders` 21/22 | **物理行仍在**（`deleted_at` 已设、`status=5`）；live 单仅剩 2 条既有草稿 `FIX-SO-3/4` |
| `sale_order_items` | 21→1 行、22→1 行，**物理仍在**（软删不级联） |
| `stock_reservations` | 各 1 条 **`status=3`（已释放）**；全库 `status=1` 计数为 **0** ⇒ **无未释放预占** |
| `sale_order_events` | 21→7 条、22→5 条（`created`/`reserved`/`adjusted`/`released`/`cancelled`）⇒ **活动日志仍在**；本轮**未产生价差日志**（无 `pricing_override`/`below_cost`：`cost_price=0` 且无手工改价） |
| `sale_order_adjustments`、`warehouse_tasks` | 均 **0** |

⇒ 准确表述：**本轮无有效订单、无未释放预占；软删记录与活动日志仍在**（历史保留，未清理）。

**库存事实的既有偏差（不声称一致，本轮不修）**：起点（造单前首次查询）与复查均为 `inventory_stock` wh1 `quantity=5.00 / reserved=0.00`、ACTIVE 容器 wh1 **4 个 / 11.00**、wh6 1 个 / 1.00 ⇒ **本轮未改变这两个数**；但 `inventory_stock.quantity(5)` 与 ACTIVE 容器合计(11) **在本批之前就已不同**，属**既有缓存偏差**，非本轮产生。按 AGENTS 红线，`inventory_stock.quantity` 的唯一合法写入口是 `syncStockFromContainers()`，**本轮不 `resync`、不擅自修复**。

**验收方法学记录（环境性问题，非产品缺陷）**：浏览器预览下 `ConfirmDialog` 走 `AppDialog`（`window.flowcubeDesktop` 不存在 ⇒ `native=false`），**当有 Radix 浮层（如通知中心 `div#radix-*`）覆盖右上角时，`agent-browser click` 会被遮挡**（工具会明确报「covered by …」），此时点击表现为「成功但无反应」；处置：先 `press Escape` 清浮层再点。另：`agent-browser find role button click "…"` 匹配不可靠，**用 snapshot 的 `@ref` 点击才稳定**；按钮文本含「取消」时需要精确 ref（确认框「确认取消」 vs 「返回订单」）。

**边界（如实）**：执行期改单（`status=3`，有 `task_id`）本轮**未单独构造**（同一函数与同一视图，`headerReadOnly` 对该状态一并生效，但**未实测**）；「改客户/仓库在改单中应否被后端支持」属**新增功能**，本轮不动。发版前后端全量 / 三端构建 / PDA 真机 / 物理打印仍未验。

**未触碰发布边界**：未推送 / 打 tag / 部署 / 生产迁移 / 生产数据 / 真实发货消息。

---

## 34. 客户切换取价异常与恢复（2026-09-29，仅本地；真实 GUI + 受控注入）

**为什么改从「草稿编辑/新建」验**：§33 的修复把改单视图客户字段设为只读，**改单里切客户已不可达**；真实可达路径是**新建/编辑销售单**（`CreateView`/`EditView` 的客户 Finder 可点）。

**本节范围（如实）**：本节当时只验证了「**无有效价格 → 人工确认 → 保存**」这一条，**没有做真实的客户 A→B 切换**，也没有覆盖**抛错/HTTP 失败**分支。**真实 A→B 切换 + 失败注入 + 恢复**已在 **§36** 补齐（并同时暴露了 §37 的路由缺陷），本节不据此声称「客户切换失败已验」。

**组件证据（受控注入，既有）**：`frontend/src/pages/sale/form/useSaleOrderForm.test.tsx` **20 例**已覆盖本条主问——较旧响应不覆盖当前客户价（`customer(1)→selectProduct→customer(2)`，先回 22 后回 11，单价保持 22）、旧请求不清新请求 loading、迟到响应不覆盖手工价、明确切客户对已有手工价**仍按现行规则重新定价**、**查价失败/未配置价格 ⇒ `priceErrors`「请手动确认单价」且不静默继承原价**、无效响应值（0/-1/NaN/∞）留待手动确认、删行/卸载失效、StrictMode 不重复请求。

**真实 GUI + 受控注入（本轮新增，隔离库 :5173）**：新建销售单 → 选 `Smoke客户` → 选 `Smoke仓库` → **拦截 `GET /api/price-lists/customer-price*` 返回 `data:null`**（模拟「当前客户未设置有效价格」）→ 从商品 Finder 选 `SMOKE-P001` ⇒ 行显示**「默认价格」**并出现 **「当前客户未设置有效价格，请手动确认单价」** + **「确认当前单价」** 入口；点「确认当前单价」⇒ 提示消失；填数量 3 ⇒ **保存草稿成功**（新单 `SL20260929002`，`total_amount=30`）⇒ **恢复完成**。**正向对照（真实 GUI）**：同库草稿编辑下 `[data-entry-field="party"] button` **`disabled=false` 且点击后选择器真实打开**（`input[placeholder="搜索客户名称、编码…"]` 出现），与改单视图的 `disabled=true`、不打开形成对照。

**证据分级（如实）**：① 「失败→提示→确认→保存」为**受控注入 + 真实 GUI**（注入只改接口响应，不改前端逻辑）；② **慢返回/乱序竞态**在真实库**无法稳定复现**（真实接口毫秒级，`agent-browser network route` 无延迟参数）⇒ 该分支**仅组件级（受控注入）证据**，不冒充真实 GUI；③ 真实库中所有客户对商品 9 均命中**同一等级价**（`source=price_level`，各客户取价同为 ¥10）⇒ **「异客户价格串写」只可能靠受控注入证明**，真实库无客户间价差可复现。

**夹具与残留（本轮 ID）**：`sale_orders` **23 / SL20260929002** 走合法路径（取消订单 → 删除订单）到终态；`live(21,22,23)=0`、`stock_reservations.status=1` 计数 **0**（无有效预占）、`inventory_stock` wh1 未变（`quantity=5.00 / reserved=0.00`）。**软删行与活动日志仍在**（同 §33 口径，未清历史）。注入已于同一会话 `network unroute` 清除。

---

## 35. 请购 `scope=convert` 转采购闭环（2026-09-29，仅本地；真实 GUI + 业务 API）

**调用链**：请购详情（`status===3` 才渲染「转采购单」）→ `openConvert()` 取「剩余可转量 > 0」的行并带入 `suggestedSupplier` → 弹窗内每行 `PickerField`（`supplierTarget.scope='convert'`）→ `onPickSupplier` 的 **convert 分支**写回 `convertRows[i].{supplierId,supplierName}`（`form.tsx:190`）→ `submitConvert()` 校验「每行必填供应商 / 数量 ≤ 余量」→ `convertRequisitionApi(id, lines)` → `POST /api/purchase-requisitions/:id/convert`（`PURCHASE_REQUISITION_CONVERT`）→ `service.convert`：锁单 + `assertStatusAction('purchaseRequisition','convert')`（from[3]）→ 逐行锁明细校验 → **按 `supplierId` 分组，每组建一张 PO 草稿**（`purchase_orders.source_requisition_id`）→ 写 `purchase_requisition_conversions` + 累加 `converted_qty` → 全部转完 `compareAndSetStatus` **3→6 结案**。

**场景准备（业务 API）**：`POST /api/purchase-requisitions`（商品 9、数量 5、`estimatedPrice=10`，**不填 `suggestedSupplierId`**，留给转单时定）⇒ `status=1`；`POST /:id/submit` ⇒ `status=2`；`POST /:id/approve` ⇒ **403 `SELF_APPROVAL_DENIED`**（「不能审批自己提交的请购单」——内控生效，**不是缺陷**）⇒ 改用**另一账号** `smoke_finance_approver` 审批 ⇒ `status=3`。

**真实 GUI 验收（:5173 + 隔离库）**：请购单页 → 「转采购单」⇒ 弹窗列「可转余量 5 / 转采购 5 / 供应商 / 单价」；点该行 **「选择供应商」** ⇒ 打开 `SupplierFinder`（候选 `Smoke供应商/SMOKE-SUP`）⇒ 选中 + 「确认选择」⇒ **弹窗行供应商列回填「Smoke供应商」**（即 convert 上下文的真实回填，而非仅组件层）；填单价 10 ⇒ 提交。

**真实载荷与实际结果**：`POST /api/purchase-requisitions/1/convert` → `{"lines":[{"requisitionItemId":1,"quantity":5,"supplierId":1,"supplierName":"Smoke供应商","unitPrice":10}]}`、**200**，toast「已生成 1 张采购单，采购申请单已结案」。DB 实测：`purchase_orders` **id=7 / PC20260929001**、`supplier_id=1`/`supplier_name=Smoke供应商`、`warehouse_id=1`、`total_amount=50`、`status=1`（草稿）、**`source_requisition_id=1`**、备注「由请购单 PR20260929001 转入」；`purchase_order_items` 商品 9 / 数量 5 / 单价 10 / 金额 50；`purchase_requisition_conversions`（req 1、item 1、po 7、qty 5）；`purchase_requisition_items.converted_qty=5`；`purchase_requisitions.status` **3→6**。⇒ **买到的不是「组件回填」而是真实转单落库结果**。

**清理与残留（本轮 ID，如实）**：采购单 **7** 走**业务 API**「取消」（`POST /api/purchase/:id/cancel`，GUI 按钮触发）⇒ `status 1→4`。此后 `purchase_orders` / `purchase_requisitions` **都没有删除 API**（请购单 `cancel` 的 `from=[1,2,4]` 且 **`blocked[6]='已转采购的请购单不能取消'`，前后端一致** ⇒ 已结案请购单在业务上**本就不可逆**），故本轮按 ID 用**测试清理 SQL** 软删（`UPDATE … SET deleted_at=NOW()`，`purchase_orders 7` + `purchase_requisitions 1`）——**这是测试清理手段，不是产品删除能力**，不得据此认为系统具备单据删除功能。清理后 `live req=0`、采购单列表不再出现 `PC20260929001`（余 `PC20260927004/003` 为 9-27 既有单，**非本轮**）。**清理不等于全零**：主表软删行仍在，且明细/关联表（`purchase_order_items`、`purchase_requisition_items`、`purchase_requisition_conversions`）**无 `deleted_at`**、随主表保留 ⇒ **物理残留仍在**（与 §33「软删 ≠ 无残留」同口径）。

---

## 36. 客户 A→B 切换的真实 GUI 验证（含失败注入与恢复）（2026-09-29，仅本地）

**夹具（全部业务 API，未手改库/未提权）**：临时客户 A = `sale_customers 512`（`切换A-161624`，等级 A）、客户 B = `513`（`切换B-161624`，等级 B，经 `PUT /api/price-lists/bind-customer` 合法设置）；临时商品 `product_items 159`（`P000001`，`salePriceA=10` / `salePriceB=20`，`POST /api/products`）。取价实测：A → `salePrice 10 / priceLevel A`；B → `20 / B`。

### 36.1 A 成功取价 → 切 B 成功取价（真实 GUI，无注入）

新建销售单 → 选仓库 → 选客户 A → 加商品 159 ⇒ 请求 `GET /api/price-lists/customer-price?customerId=512&productId=159`、单价 **10**；点客户按钮 → Finder 搜「切换B-161624」→ 确认 ⇒ 请求 `…customerId=513…`、单价 **10 → 20**（提示「价格表定价」）。填数量 4 → 保存草稿 ⇒ 载荷 `customerId:513`、`customerName:"切换B-161624"`；落库 `sale_orders` **24 / SL20260929003**：`customer_id=513`、`unit_price=20`、`total_amount=80` ⇒ **归属 B**。

### 36.2 B 取价的受控失败注入与恢复

**注入**（`agent-browser network route "**/price-lists/customer-price*" --abort`，模拟网络/HTTP 失败）：在客户 A 已有价 10 的前提下切到客户 B ⇒ 客户字段回填 B，但**单价仍显示旧值 10**，同时出现 **「默认价格」**（`priceSource='default'`、`resolvedPrice=null`）与 **「价格查询失败，请手动确认单价」**；点保存 ⇒ 提示升级为「第 1 行（切换验证商品-161624）：价格查询失败，请手动确认单价」，且**没有发出任何 `POST /api/sale`（计数 0）** ⇒ **旧价没有以自动定价凭据保存、保存被阻止**。

**恢复**：`network unroute` 清除注入 → 重开客户 Finder 并**重选客户 B** ⇒ 请求 `customerId=513` 成功、单价回到 **20**（「价格表定价」）⇒ 保存 ⇒ 载荷 `customerId:513`、落库 `sale_orders` **25 / SL20260929004**：`customer_id=513`、`unit_price=20`、`total=80` ⇒ **归属 B**。

**证据分级**：① A→B 成功取价与两次落库为**真实 GUI + 真实业务 API**（无注入）；② 失败分支为**受控注入（abort）+ 真实 GUI**（只改接口响应，前端逻辑未改）；③ **慢返回/乱序竞态**仍无真实 GUI 证据（本机 `network route` 无延迟参数），**仅组件级证据**（`useSaleOrderForm.test.tsx` 20 例）。

---

## 37. `PUT /price-lists/bind-customer` 路由遮蔽（缺陷 · 已修 · 已入 CI）（2026-09-29，仅本地）

**缺陷（A 类，真实 HTTP 复现）**：`backend/src/modules/price-lists/price-lists.routes.js` 中 `router.put('/bind-customer', …)` 注册在 `router.put('/:id', …)` **之后** ⇒ Express 顺序匹配把 `bind-customer` 当成 `:id`，请求落到 `ctrl.update`：返回 **200「更新成功」**（而非「绑定成功」），客户 `price_level` **完全未变** —— 前端调用方看不出失败（**静默 no-op**）。

**证据**：修复前 `PUT /api/price-lists/bind-customer {customerId:513, priceLevel:'B'}` → `200 {"message":"更新成功"}`；DB `sale_customers 513.price_level` 仍 `A`；取价仍返回 A 级 10。对照 `PUT /api/price-lists/999999`（不存在的 id）同样「更新成功」—— 确认两者命中同一条 `/:id` 路由。

**修复（最小）**：把 `bind-customer` 注册**移到 `/:id` 之前**并加顺序注释；**未改** controller/service。修复后：`200 {"message":"绑定成功"}`、`513.price_level='B'`、取价 `20/B`；对照 `PUT /:id`（改名）仍「更新成功」且真实落库。

**回归（真实 HTTP，非源码字符串比对）**：新增 `tests/price-list-bind-customer.smoke.test.js`（独立测试库），锁死三件事：① bind-customer 文案「绑定成功」且客户等级**真的变化**；② 取价据此返回 B 级价；③ 通用 `PUT /:id` 正向仍可用并真实落库。**接入 CI**：`package.json` 新增 `smoke:price-list-bind-customer`，`.github/workflows/test.yml` 增加对应步骤。

**收尾策略（审查反馈后加固）**：本套件复用 `prepareSmokeContext` 的**共享** customer/product，因此**写前快照**将被改动的字段（客户 `price_level`/`price_list_id`/`price_list_name`、商品 `sale_price_a`/`sale_price_b`），`finally` 用**测试 SQL 精确还原**（**不依赖绑定路由**——它正是可能被临时改坏的对象），逐项独立兜底并**断言还原值**；本轮自建临时价格表按 ID **物理清理**（`DELETE` 而非软删）并复查为 0。资源上关闭 ctx 自建 pool/server **与 backend 全局 pool**，以 `process.exitCode` 让进程**自然退出**（不用 `process.exit()` 掩盖未关闭资源）。**未改**共享 helper。

**结果**：修复后 **10 passed / 0 failed**、**退出码 0、约 1 秒自然退出**；**变异验证**（用本批起点 `78b9828` 的旧顺序）⇒ **3 项失败**（文案「更新成功」、`price_level` 未变、取价仍 A 级）而**还原/清理断言仍通过**，退出码 1；恢复后重新 10/10。变异跑完后**独立查库核对**：`sale_customers 1`（`A`/NULL/NULL）、`product_items 9`（`sale_price_a=10`、`sale_price_b=NULL`）、`live price_lists=0` 与基线**逐项一致** ⇒ 即使路由被改坏，还原与物理清理仍生效、不污染共享测试库。

**横向排查（如实限定）**：脚本扫描 `backend/src/modules/**/*.routes.js`，规则仅为**「同 method、单段字面量路径排在单段动态段（`/:x`）之后」**；该脚本对修复前的 price-lists 能正确检出（已验证），对当前代码库**未发现同类**。**此结论只覆盖这一种冲突形态**，**不能**据此断言「所有路由都无冲突」——未覆盖多段动态段、正则路径、`router.use()` 中间件顺序、跨 router 挂载前缀等。

---

## 38. 转采购单的请求键稳定性（缺陷 · 已修 · 真实 GUI 完整复现）（2026-09-29，仅本地）

**缺陷（A 类）**：`frontend/src/api/purchase-requisitions.ts` 的 `convertRequisitionApi` **每次调用**都 `createRequestKey()`。转单失败后弹窗保留，用户再点「生成采购单」就带**新键**——若上一次其实已在服务端成功（只是响应没回来），后端把它当新请求，**同一次转单意图被执行两遍**（又建一张采购单、`converted_qty` 二次累加）。**本次扫描仅在 `convertRequisitionApi` 发现内联生成请求键**（其它 api 函数体内未见、但**未逐一证明各入口的键策略**，不能据此认为所有写入口都安全）。

**真实后端证据（HTTP 层，隔离库）**：对同一已批准请购单连续三次 convert —— ① `K1` 转 5 ⇒ 建 PO-A；② **`K1` 同键重放** ⇒ 返回**同一回执**（PO-A，不新增）；③ **`K2` 换键同一意图** ⇒ **新建 PO-B**、`converted_qty` 5→10。⇒ **换键 = 重复执行**；注意 10 仍在请购量内，**不是「超量」问题**，而是**同一意图重复执行**。

**真实 GUI 完整复现（受控代理，非 abort）**：`abort` 只能证明「请求没送达」，**不能**证明「后台成功后响应丢失」。为此用本地中间代理（`/tmp/flowcube-convert-drop-proxy.mjs`）实现真形态：Vite 以 `DEV_API_TARGET=http://127.0.0.1:3100` 指向代理 → 代理把 convert **真实转发**给 `:3000`、**等后端 200 回来**（= 事务已提交）后**销毁浏览器侧连接**（浏览器得到网络层失败，经 Vite http-proxy 表现为 **HTTP 500 / `code=null`**）。实测：

| 步骤 | 观察 |
|---|---|
| 首次提交（转 5） | 代理日志 `[DROP] convert 已被后端处理（status=200），现在丢弃浏览器侧响应`；DB 已有 **PO 1 张**、`converted_qty=5`；前端出现**「上次转单没有收到确定答复…」提示条** |
| **原样重试**（同内容） | 代理第二次正常转发 ⇒ 后端**重放** ⇒ **PO 仍 1 张**、`converted_qty` 仍 **5** |
| **主动第二次部分转单**（转剩余 5） | 独立新键 ⇒ **正常建第 2 张 PO**、`converted_qty=10`、请购单 **3→6 结案**（**未为幂等挡掉正常后续转单**） |

**修复（最小，复用既有公共能力）**：① `convertRequisitionApi(id, lines, requestKey)` 改为**由调用方传键**；② `form.tsx` 用既有的 `useIdempotentSubmit`（`convertGuard`）管理键——**成功/明确 4xx 才轮换，超时·断网·服务器 5xx 一律保留**；③ 保存**载荷指纹**：内容变化即「新意图」（上一笔已确定 ⇒ 换新键；上一笔**未确认** ⇒ **阻止提交**并引导先查回执，避免「改了内容却按旧内容执行」的误报成功）；④ `remember()` **在发请求之前**调用（否则未确认期间标签/action 为空或过期，组件复用后回执可能查错）；⑤ 转单弹窗复用 `UncertainSubmitNotice`，并新增可选 `message` 参数传入**转单业务文案**（转采购只建草稿、**不入会计**，不沿用付款的「记账」措辞；**不传即保持旧调用默认行为**）。

**修复过程中新发现的第二处缺陷（同批修）**：首次用真实代理复现时前端**没有**出现提示条——实测该失败是 **HTTP 500 / `code=null`**，而 `isUncertainError` 当时**只认** `REQUEST_TIMEOUT`/`NETWORK_ERROR` ⇒ 被判「确定失败」⇒ **换键** ⇒ 重试**重复建单**（同一夹具上实测出现 **两张 PO、converted 5→10**）。修复：`isUncertainError` **最小扩展**——**所有 5xx（500–599）一律按未确认处理**（实现只看状态码区间、**不区分有没有业务码**；网关/代理中断、上游异常都不能证明提交没做成）；**明确 4xx 业务拒绝仍换键**。**未削弱后端闸门**（`converted_qty ≤ 剩余量`、状态机 `convert.from=[3]` 等原样保留），**未新增框架**。共用逻辑影响面：`useIdempotentSubmit` / `isUncertainError` 的调用方为付款登记、核销、应付补录、退款（`RegisterPaymentDialog`、`SettleReceiptDialog`、`CreateManualPayableDialog`、`useRefund`、`RefundDetailDialog`）——该扩展使它们对 5xx 一律**更保守**（保留键 + 引导查回执），不会造成重复记账。

**回归（按层如实分开）**：① **组件层** `form.convert-key.test.tsx` **9 例**：部分转单（5/10）、不确定后原样重试同键、改载荷被阻止、**关窗重开**（默认被重置 ⇒ 阻止 / 填回同内容 ⇒ 同键）、回执 `success` ⇒ 换键、`not_found`/`pending` ⇒ 不换键、4xx ⇒ 换键；键断言要求**非空字符串**（不接受 `undefined` 相等）——**本文件不含 5xx 场景**；② **API 层** `purchase-requisitions.test.ts` **3 例**（请求头确为外部传入的键，非同键/换键各一）；③ **共享分类层** `useIdempotentSubmit.test.ts` 新增 **5xx ⇒ 未确认**、**4xx ⇒ 非未确认** 两例（**5xx 的判定证据在本层**）；④ **真实 GUI**：见上文代理复现（前端出现未确认提示条、同键重试只 1 张 PO）。**变异验证**：把 API 改回「内部生成键」⇒ API 层 **3 项失败**；把 `form.tsx` 改成「每次换键」⇒ 组件层 **3 项失败**（①④⑥）。**Codex 独立复跑（Node 22）**：转单组件/API 专项 **2 文件 12 例**、`payments` 目录 + 转单 **6 文件 39 例**，均**自然 exit 0**；并独立只读查库确认「请购 4 `quantity=10`/`converted_qty=5`、仅 PO 12、`convert.4` 成功回执 1 条」与本节同键重试结论一致。

**边界（如实）**：① **整页关闭/刷新后的请求键恢复尚未覆盖**——本轮只验证了**模态关窗重开**（组件仍在内存、`keyRef` 保留），**不得**把它推广为「页面重挂后仍保键」；② 前端全量单测与三端构建未跑（**待发版前验证**）；③ 「转单应否支持跨页持久化键」属新方向，**先复现再决定**，不凭「缺持久化」直接改框架。

---

## 39. 本批夹具与资源清理（2026-09-29，仅本地）

> **状态：✅ 已按用户 2026-09-29 的有限授权执行**（下表是**执行前的计划稿**；**实际执行明细、复查与保留项见 §44**）。授权范围为：仅本轮隔离测试库自建夹具、走**合法业务取消**后**软删（只改 `deleted_at`）**、**保留**全部明细 / 事件 / 请求回执 / 主表历史、**不做物理删除**、**无合法收尾入口者保留并说明**。（先前两次尝试因本机 auto 权限分类器判定「批量删除 / 不可逆本地破坏」被拒；本次改为**限定范围 + 先 dry-run** 后执行成功。）

> **⚠️ 本节下方那段旧计划已废弃（2026-09-29）**：历史上曾计划「**按 ID 物理清理**主数据/明细 + **按 action 删除请求回执**」，该计划**已作废、不得执行**——最终采用的是**软删（只改 `deleted_at`）+ 保留全部明细 / 事件 / 请求回执 / 主表历史**，且**未删除任何回执**。以下仅作**废弃历史说明**保留，避免与最终口径混淆：

<details>
<summary>原计划（已废弃，勿执行）</summary>

单据类走业务入口到终态后按测试清理 SQL 软删；主数据（客户/商品）与明细/关联表**按 ID 物理清理**；`operation_requests` 中**本轮登记的完整 action** 按 action **精确删除**并复查（禁止 `LIKE 'sale.%'` 之类通配，以免连带删除历史回执）。

| 轮次 | 对象 | ID（拟） | 原计划处理（已废弃） |
|---|---|---|---|
| §33 | 销售单 | 21、22 | 已走合法取消 → 软删 |
| §34/§36 | 销售单 | 23、24、25 | 走合法取消 → 软删 |
| §36 | 客户 / 商品 | 512、513 / 159 | 按 ID 物理清理 |
| §35 | 请购单 / 采购单 | 1 / 7 | 采购单业务取消后软删 |
| §38 | 请购单 / 采购单 | 2、3、4 / 8–13 | 采购单业务取消后软删；请购单软删 |
| §38 | 请求回执 | 本轮 action | **按 action 删除并复查**（**已废弃，未执行**） |

</details>

**最终方案（唯一有效口径）**：仅本轮隔离测试库自建夹具；走**合法业务取消**后**软删（只改 `deleted_at`）**；**保留**全部明细 / 事件 / 请求回执 / 主表历史；**无物理删除**、**未删除任何回执**；无合法收尾入口者**保留并说明**。**执行明细、对照复查、保留项与独立复查数据见 §44。**

---

## 40. 只读追查：未确认状态下「关页 / 刷新后重试」的恢复机制（2026-09-29，**静态阅读，未复现**）

**追查问题**：§38 的修复把请求键稳定在**同一次提交意图内**，但键与「未确认」状态都只在内存——那么用户**关闭整个工作区页 / 刷新浏览器**后再重试，会发生什么？既有恢复机制是什么？

**静态结论（只读代码，未运行）**：

- **ERP 侧（付款登记 / 核销 / 应付补录 / 退款 / 转采购）没有持久化**：`useIdempotentSubmit` 的 `keyRef`（`useRef`）与 `uncertain` 都只在内存，`form.tsx` 的载荷指纹同理。**刷新或关页 ⇒ 两者一并丢失** ⇒ 重试会带**新键**，后端视为新请求 ⇒ **存在重复执行的静态风险**（是否真的重复取决于用户是否原样重试、后端闸门是否拦住——**本轮未复现，不外推**）。
- **PDA 侧已有持久化恢复机制**：`frontend/src/lib/pendingRequestStorage.ts`（`localStorage` 键 `pda_pending_request_confirmations` / `pda_unclaimed_request_confirmations`，v2 记录按 `userId` 归属）＋ `frontend/src/hooks/usePendingRequests.ts`（`unverifiedOwner` 未认领隔离、**组件卸载不清内存**、存储不可用时仍保留阻断），由 `useCriticalPdaAction` / `useOfflineQueue` / `PdaCriticalActionNotice` 使用。**该机制是 PDA 专用，ERP 侧未接入。**
- **服务端不能替代**：`operation_requests` 虽留有记录，但查询按 `requestKey`（`/api/system/request-status/:key`）——**键丢了就查不到**，无法承担"刷新后恢复"。
- **既有正向（仅提示层）**：`UncertainSubmitNotice` 的文案明确要求"不要关掉重开重新提交、不要改动内容后再提交"，属**行为约束提示**，不是技术兜底。

**边界（如实，勿读成已确认缺陷）**：本节为**静态阅读**；「未确认 → 刷新页面 → 原样重试」的**真实后果当时未构造**。**§41 已就其中一条链路（转采购单）用代理复现**：**未证明**用户会误以为没执行（详情页会显示成功进度），该静态风险**未确认为缺陷**。其余 ERP 入口**需逐条核对**，不得由本节或 §41 外推（也**不**把「模态关窗重开保键」推广为「页面重挂保键」——后者静态上已判定**不成立**，但**不等于**该链路存在已确认缺陷）。

---

## 41. 受控复现：「后台 200 → 丢响应 → **刷新整页** → 重试」（2026-09-29，真实 GUI + 代理）

**环境**：后端 `:3000`（`NODE_ENV=test` / 回环 3307 / `flowcube_acceptance20260927_test`）、代理 `:3100`（§38 的丢弃响应代理）、前端 `:5173`（`DEV_API_TARGET=代理`）；固定会话 `flow-business-closure-20260928`。**本轮自建夹具**：请购单 **5**（`PR20260929005`，数量 10、已批准）。

**步骤与观察**：

| 步骤 | 观察（真实 GUI / DB） |
|---|---|
| 转 5 提交（首次经代理） | 代理记录 `[DROP] convert 已被后端处理（status=200），现在丢弃浏览器侧响应`；前端弹窗出现**「上次转单没有收到确定答复…」提示条**；DB：**PO 1 张**（`PC20260929008`）、`converted_qty=5` |
| 提交后、**未刷新** | 页面明细仍是缓存值「采购申请数量 10 / **已转采购 0**」（响应丢失、未 refetch） |
| **刷新整页（F5）** | 明细变为「采购申请数量 10 / **已转采购 5**」——**界面用服务端事实自证上次已成功** |
| 刷新后重开转单弹窗 | **可转余量自动变为 5**（默认"转采购"= 5），**提示条消失**（`uncertain` 状态随重载丢失） |

**分类结论（按独立核对后的口径，勿夸大）**：本次复现证明的是——**刷新会丢掉内存里的「未确认」提示，但真实详情已显示成功进度**（「已转采购 5」/ 弹窗余量 5）；**§40 的静态风险未被证实为缺陷**：**目前未证明用户会误以为没执行**。因此**无需据此新增持久化框架**。

**支撑事实（仅限本条链路，不作为"前端功能完整"的证明）**：① 后端 `转采购数量 ≤ (quantity − converted_qty)` **只防「超量」**（挡住超过剩余可转量的请求），**不防「同一意图在剩余额度内重复执行」**——§38 已实测同一意图 5+5=10 重复建单，故它**不是去重闸门**；② 界面「已转采购」列与弹窗「可转余量」取自服务端事实，页面重挂后如实呈现；③ 同一意图内原样重试 ⇒ 同键重放（§38 已验证）、改内容 ⇒ 载荷指纹守卫阻止。

**不外推**：以上只覆盖**转采购单**这一条链路；**不得**据此认为「所有 ERP 入口都安全」——其它入口（例如手工应付创建）是否有等价的唯一性 / 单号 / 来源约束，须**逐入口核对**（见 §42 起）。

**残余（如实，属信息层而非事实层）**：刷新后**「未确认」提示条与查询入口消失**，用户失去"建议先查回执"的显式提醒。按既定边界（**不另造持久化框架、不改公共 PDA 语义**），本轮**不做**改动；若将来要做，最小方向是**复用既有 `pendingRequestStorage` 的存储语义**（而非新增机制），并先明确 ERP 与 PDA 的存储键/归属语义可否共用。

**夹具（已处理）**：请购单 **5**（`PR20260929005`，**status 3 未改**）与采购单 **14**（`PC20260929008`）均已按有限授权**软删 `deleted_at`**（PO 14 另经业务取消 → status 4）；**未物理删除、未改状态**。明细 / 事件 / 回执 / 主表历史**保留**——见 **§44**。

---

## 42. 只读跨模块核对：手工应付创建的「未确认 → 关闭 / 刷新」恢复（2026-09-29，**只读，未复现**）

**链路**：`PaymentsView` 常驻渲染 `<CreateManualPayableDialog open={createOpen} …/>` → 弹窗内 `createPaymentApi(payload, requestKey)` → `POST /api/payments` → `payments.service.createManual` → `INSERT INTO payment_records (order_id=NULL, …)` → 成功后 `invalidatePaymentViews()` 刷新「现结/月结供应商账款」列表；另有 `getOperationRequestStatusApi(requestKey, CREATE_ACTION)` 回执查询。

**独立核对到的事实**：
1. **后端无业务唯一约束兜底**：`payment_records` 的唯一索引只有 `PRIMARY(id)` 与 `uq_payment_records_type_order(type, order_id)`；**`order_no` 仅普通索引**（`idx_payment_records_order_no`，非唯一）。手工应付 `order_id` **恒 NULL** ⇒ 该唯一键对多条 NULL **不生效**；`createManual` **也没有按 `order_no` 的应用层查重**。⇒ 防重复**完全依赖 `requestKey`**（`beginCreationOperationRequest` + 载荷指纹），代码注释亦自述这是"全财务域唯一无防护的改钱路径"。
2. **同一页面会话内是安全的**：弹窗**常驻渲染**（`open={createOpen}`，不是条件挂载）⇒ **关闭弹窗不卸载组件** ⇒ `requestKey` 与 `uncertainRef` 保留；`reset()` 在未确认时**早退**（键与表单一并保留），用户原样重试即同键 ⇒ 后端认作同一笔。
3. **跨页面重载会丢键**：刷新整页 / 关闭工作区页 ⇒ `PaymentsView` 卸载 ⇒ `requestKey`、`uncertainRef` 归零 ⇒ 重开弹窗时 `reset()` 正常执行 ⇒ **新键 + 新随机单号**（`defaultOrderNo()`）。此时若上一次其实已成功，**理论上会再落一条同金额应付**。

**分类：待查（未证实为缺陷）**
- 支持"可能重复"的静态事实：上列 1、3；
- **但尚未复现**，且存在可能构成兜底的**可见性**：成功后 `invalidatePaymentViews()` 会刷新账款列表，用户**重挂后应在列表看到已建的那笔**（单号/金额/往来方可辨）——**是否足以避免误判尚未验证**；
- 依 §41 的教训，**不据静态缺口直接判定缺陷**。

**复现方案（下一步，需起服务）**：把丢弃响应的目标从 convert 扩到 `POST /api/payments`（同一代理加一条规则），走「录入 → 丢响应 → **刷新整页** → 重开录入同金额 → 核对是否落两条」，并同时核对**刷新后列表是否已显示第一笔**。

**边界**：不因"缺持久化"改框架；若复现证实重复，最小方向仍是**复用既有 `pendingRequestStorage` 语义**，并先明确 ERP/PDA 的存储键与归属语义可否共用。

---

## 43. 受控复现：手工应付的「未确认 → 刷新整页 → 重录」（2026-09-29，**真实 GUI + API + DB**）

**静态约束（独立核对，作为线索而非定论）**
- `payment_records` 唯一索引只有 `PRIMARY(id)` 与 `uq_payment_records_type_order(type, order_id)`；**`order_no` 仅普通索引**（`idx_payment_records_order_no`，`NON_UNIQUE=1`）；手工应付 `order_id` 恒 NULL ⇒ 该唯一键对多行 NULL **不生效**；**应用层无按 `order_no` 查重**。
- 创建类幂等语义：`action = payment.record.create.<载荷指纹>`，**同 key 同载荷 ⇒ 重放**、**同 key 不同载荷 ⇒ 新 action ⇒ 新建**；命中 `PENDING` ⇒ **409 不重复执行**。
- **禁止**以"加全局唯一索引"解决：同单号/同金额的多行**可能有既定业务语义**（如两笔押金），业务层不应按内容去重。

**真实证据**（本轮**测试标记**应付；**未做任何真实付款 / 外部动作**，仅记录本轮 ID）

| 步骤 | 观察 |
|---|---|
| 录入（往来方「验收手工应付-20260929」· 11.11 · 现结 · 借方科目 1002）→ 首次提交经代理 | 代理 `[DROP:payments] POST /api/payments 已被后端处理（status=201）`；DB **已建 `id=40 / AP-20260929-YO8A`**；弹窗内显示 **「提交结果未确认：网络中断或超时，服务器可能已经创建了这笔应付。请先点「查询上次结果」，确认没有再重试。」** 且带查询入口 |
| 未刷新 | 列表**不含**该单号（`invalidatePaymentViews` 只在 onSuccess 触发，本次未触发） |
| **刷新整页** | 列表**已含** `AP-20260929-YO8A`（服务端事实呈现）；未确认提示消失 |
| 重开弹窗 | 单号变为 **`AP-20260929-ODNT`**（新随机单号）、表单清空、请求键为新建 ⇒ 刷新后重录即**全新一笔** |
| 录入**同内容**再提交 | 弹窗关闭（成功）；DB **新增 `id=41 / AP-20260929-ODNT`**（同往来方、同金额 11.11） |

**分类（谨慎，勿直接判缺陷）**
- **可复现的事实**：刷新后重录同内容 ⇒ **落两笔**（并非同内容被重放，而是新建）；
- **但不足以判为产品缺陷**：① 业务上**同金额同往来方多笔是合法的**，系统**不应**按内容去重；② 刷新后**列表已显示第一笔**，用户**本可看到**；③ "用户误以为没执行"**未证明**。
- **与 §41 的实质差异（如实，措辞已更正）**：转采购单的 `converted_qty ≤ quantity` **只是「余量/超量」闸门**——它**只能防止"超过剩余可转量"，不能防止"在剩余额度内重复执行同一意图"**；§38 已有**同一意图 5+5=10 重复建单**的真实证据，故**不得**说成"重复在系统层不可能"。它同样**不等于**键持久化或完全去重（刷新后看到事实 ≠ 键还在）。**手工应付没有等价闸门**（单号随机、无来源约束）⇒ 该链路残余风险**高于**转单链路，属 **B 类待查（已有复现证据、未判缺陷；用户是否误判仍未证明）**。
- **边界**：**不**新增全局唯一索引（业务语义不允许）、**不**另造持久化框架、**不**改公共 PDA 语义。

**夹具（本次结论：保留）**：`payment_records` **40 / AP-20260929-YO8A**、**41 / AP-20260929-ODNT**（测试标记、同往来方同金额 11.11、**未付** `paid_amount=0`、`balance=total`）。因全后端**无应付作废/删除入口**，按有限授权**保留原样、不物理删除、不改状态**；其 `payment_entries`/对账/凭证依赖均为 **0**。详见 **§44**。

---

## 44. 本轮夹具收尾：真实执行明细与复查（2026-09-29，**已按有限授权执行**）

**授权范围**：仅本轮隔离测试库自建夹具；走**合法业务取消**后**软删（只改 `deleted_at`）**；保留全部明细 / 事件 / 请求回执 / 主表历史；**不做物理删除**；**无合法收尾入口者保留并说明**。**不手工改 `status`/`balance` 凑终态。**

**执行前提**：后端由本人以 `NODE_ENV=test` / `DB_HOST=127.0.0.1` / `DB_PORT=3307` / `DB_NAME=flowcube_acceptance20260927_test` 启动（凭据仅环境注入、未回显；`APP_UPDATE_DOWNLOADS_DIR` 可写）；脚本 `--dry-run` 先行通过后才 `--execute`。旧脚本 `/tmp/flowcube-acc-cleanup.mjs` **已改名废弃**（`.deprecated-DO-NOT-RUN`）。

**预检查（严格核对，非"ID 存在即认领"）**：单号（`SL20260929002/3/4`、`PC20260929002–008`、`PR20260929002–005`）、**PO↔请购来源**（8→2、9→2、10→3、11→3、12→4、13→4、14→5）、客户名前缀（`切换A-/切换B-`）、商品编码（`P000001`）**全部一致**；保留应付 40/41 均**未付**（`paid_amount=0`、`balance=total`）。

**业务取消（独立业务事务）**：`sale 24/25` → HTTP 200「已取消」；`PO 8–14` → **全部 HTTP 200「已取消」**；`sale 23` → **404「销售单不存在」**（此前已软删，属预期，非失败）。

**事务软删（单事务 + 行锁 + 状态条件 + 影响行数断言 + rollback/finally）**：`sale_orders 2` / `purchase_orders 7` / `purchase_requisitions 4` 与期望**逐项一致**；客户与商品在**活跃依赖 = 0** 后软删（客户 2、商品 1）。**无物理删除**。

**复查（执行后）**：本轮 `live` —— **销售 0 / 采购 0 / 请购 0 / 客户 0 / 商品 0**；`operation_requests` **未动（45 条）**；本轮单据**明细仍保留（14 行）**；`payment_records 40/41` **保留 2 条**。

**请购单状态说明（勿误读）**：`purchase_requisitions 2–5` **只做了 `deleted_at` 软删，`status` 未改**；其中 **`req 2` / `req 5` 仍为 status 3（已批准，非终态）**，`req 3/4` 为 status 6（已转采购）。**不得**把它写成"已业务取消"或"全部到达终态"——本条**没有可用的取消入口**（`cancel.from=[1,2,4]`，3/6 均不在其中），故仅作**隔离夹具的 `deleted_at` 收尾**。

**保留（无合法入口，未处理，如实说明）**：`payment_records` **40 / AP-20260929-YO8A**、**41 / AP-20260929-ODNT**（测试标记、同往来方同金额 11.11、**未付**）。理由：全后端**无 `DELETE FROM payment_records`**、payments 路由**无应付作废 / 删除入口**（仅 `pay/:id`、`confirm`、对账单相关）⇒ 按授权**保留**，**不物理删除、不手工改状态**。

**共享夹具（未受影响，与基线一致）**：`sale_customers 1` = `price_level 'A'` / `price_list_id NULL` / `price_list_name NULL`；`product_items 9` = `sale_price_a 10.0000` / `sale_price_b NULL`；两者 `deleted_at` 均为 NULL。**共享 MySQL（3307）未动、未停**。

**资源（实测）**：`:3000` / `:3100` / `:5173` **均无监听**；`agent-browser session list` 返回**空**；共享 MySQL `127.0.0.1:3307` **healthy、未停**。**说明**：会话列表为空是**观察到的事实**；本任务**未使用**浏览器会话，**不据此推断**「daemon 必然回收了 `default`」（`default` 的去向未由本任务核实）。

**独立复查（Codex，只读）**：`sale 21–25` 均 `status 5` + 已软删；`PO 7–14` 均 `status 4` + 已软删；`purchase_requisitions 1–5` 均已软删（**`req 2/5` 仍 `status 3`**、`req 1/3/4` 为 6）；客户 `512/513`、商品 `159` 已软删；**明细 3+7+4=14**、`purchase_requisition_conversions` **7**、`convert.2/3/4/5` 回执 **7** 条**保留**；`payable 40/41` 金额/余额 **11.11**、`paid 0` **原样**；`payment_entries` / 对账 / 凭证依赖 **各 0**，事件 **2** + 流水 **2** 保留；共享 `customer 1` / `product 9` 价字段与基线一致，**`product 159` 无活跃容器**。

**其它状态**：本任务的**定时跟进（flow）已 PAUSED**，不再自动续跑。

**数字口径（勿混用）**：本节出现的 45 条回执、14 行明细、7 条 conversion 等均为**本次执行后的实测值**；**既往批次记录的测试数字（如专项 67/67、全前端 143 文件/668 例）不是本轮运行结果**，不得引用为本轮证据。

**尚未处理（如实）**：仅 `payment_records 40/41`（无入口）；其余本轮夹具均已 `live=0`。

**未触碰发布边界**：未推送 / 打 tag / 部署 / 生产迁移 / 生产数据 / 真实发货消息。

**未触碰发布边界**：未推送 / 打 tag / 部署 / 生产迁移 / 生产数据 / 真实发货消息。

**未触碰发布边界**：未推送 / 打 tag / 部署 / 生产迁移 / 生产数据 / 真实发货消息。
