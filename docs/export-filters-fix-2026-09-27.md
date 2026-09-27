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
