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
| 审批流 / 发票 / 薪资 / HR / 固定资产 | **仍为盲区**（本轮只做了 P6 的**权限码**扫描，未查审批流的审批人判定与业务规则；见 §9） |
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
| P8 | 审批流/发票/薪资/HR/固定资产未纳入一致性调查 | 盲区，**未动** |

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
