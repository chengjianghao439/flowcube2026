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

**本轮累计验收范围（**仅限实际跑过的**）**：后端 `product-price-history-integrity` **17/0**、`price-change-history-oldprice` **9/0**、`invoice-quota` **55/0**、`finance-period-guard` **39/0**、`smoke:finance` **118/0**；前端 `tsc -p tsconfig.app.json --noEmit` 通过、`useProducts.priceChange.test.tsx` **2/2**；浏览器侧完成过**一次导出真实落盘**验收（§16）与**一次商品编辑页可见性实测**（§18.6）。**以上均为本轮专项，不等于发版前全量**——按 AGENTS §3，受影响端的 lint / 类型检查 / 构建与全量回归统一留到发版前执行。

**未验证边界**：物理打印、PDA 真机、生产影响规模、发版前全量检查均**未做**；发票存量规模与两列不一致规模**未在生产核对**；「手工改价 × 审批通过」的并发用例**未构造**；本文件多数结论为**隔离库 + 本地栈**证据，**不得当作生产结论**。

**下一步优先候选**：① 由业务方定「价格权威」口径（定了才动审批侧与 A 的同步）；② 发票存量 `'invoice_order'` 的生产只读评估（需授权）；③ `invoice-quota` 历史残留的清理决策（需先确认归属）。**不要重做 P1/P2/P3/P8。**
