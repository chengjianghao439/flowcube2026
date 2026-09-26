# 列表导出筛选透传修复 + 首轮全项目调查记录（2026-09-27）

> 执行：Claude，工作树 `claude/happy-mahavira-0a2b4b`（起点 `29f223e`，与 `main` 一致；本批两个本地提交见 §5）。方向与独立验收：Codex。
> 这是**持续记录**：覆盖矩阵、已确认缺陷、在途分支状态、验证边界、下一步。
> 规则已同步 `docs/finance-permission-time.md`（§2026-09-27）；命令说明已同步 `docs/verification-commands.md`。**未改 `AGENTS.md`**（遵嘱）。
> **状态：P1 已本地提交 `865d8f3`（未推送、未部署）——代码层与页面手工验收均已通过。页面验收只证明「筛选请求携带条件 + 返回 200 Excel MIME」，未确认文件落盘。**
> **P3（作废容器补打）已本地提交 `5f6ede9`（未推送、未部署），并已通过独立 GUI / 代码 / 数据库验收；见 §7。**

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
| **页面手工验收**（业务方/Codex 于浏览器实操，2026-09-27） | 在专用回环库 `flowcube_ui_export_test` 上，**对账单与收款单分别筛至一条后点击导出**：浏览器网络请求**确实携带了筛选条件**并返回 **200 + Excel MIME**。**边界**：**IAB 下载事件未捕获**，因此**不能声称文件已保存到磁盘**——只证明了「请求带筛选、响应正确」。 |

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
| 审批流 / 发票 / 薪资 / HR / 固定资产 | **盲区** |
| PDA 真机 / 物理打印 / 浏览器实操 | **盲区**（未启动服务、未开浏览器） |

## 3. 已确认缺陷清单（P3 已于本轮修复并独立验收；其余未动）

| # | 问题 | 状态 |
|---|---|---|
| **P1** | 对账单/收付款单导出丢筛选 | **本批已修 + 已接 CI + 已实跑** |
| P2 | 成本快照口径分叉：凭证 `COALESCE(cost_snapshot,0)` vs 报表 `COALESCE(cost_snapshot, cost_price, sale_price, 0)`（`voucher-engine.js:344` / `reports.query.js:705,730,853`）→ 报表毛利 ≠ 总账毛利 | **未动**（遵嘱） |
| P3 | 补打中心可补打已作废容器：`print-jobs.label-command.js:518` 只过滤 `deleted_at`，而 `inbound-tasks.void.js:149-151` 置 VOID 时不动 `deleted_at` → 打出 qty=0 的无效标签 | **本轮已修复**，并通过独立 GUI / 代码 / 数据库验收（见 §7） |
| P4 | 占库口径不排除锁定容器（`containerEngine.js:477-483`），而"当前可拣现货"排除（同文件 274-284）→ 取消/拣货窗口期可用量可能虚高 | 待并发复现，**未动** |
| P5 | 数据新鲜度：`queryClient.ts:15` `refetchOnWindowFocus:false` + 5min `staleTime` | 机会项，**未动** |
| P6 | 权限码"选得对不对"无机械守卫（`route-permission-contract.test.js:15` 自陈只判"有没有"） | 盲区，**未动** |
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
- **浏览器实操——已做**：P1 的导出页面由业务方实操（筛选请求携带条件 + 返回 200 Excel MIME，**未确认文件落盘**）；P3 的补打中心由业务方高风险独立验收（见 §7.4）。
- **`desktop` 依赖未安装**：本轮未跑桌面端任何检查（改动不涉及桌面端）。
- **未跑全量回归**：只跑了与本改动相关的套件（见 §1.3、§7.3）。发版前须按 `AGENTS.md` §3 对本批全部改动统一跑受影响端的 lint/类型检查/构建与专项回归。
- **前端**：P1 未改前端（`StatementPanel`/`ReceiptPanel` 本就发送全部参数）；P3 改了前端，已跑 `tsc -p tsconfig.app.json` 与**前端全量单测 627/627**。
- 本机环境：Node 22（`source dev-env.sh`）、测试库 `flowcube_operations20260912_test`（回环 **3307**，colima profile `flowcube`）。
  **未连接 3306 主库**。

## 6. 下一步建议

1. ~~独立验收本批（代码层）~~ —— **已完成**：Codex 复核新测试 4/0、既有导出 3/0、`smoke:prelaunch-scope-export` 34/0、
   CI 接线守卫 26/0、后端 lint、文档守卫、`git diff --check` 全部通过。
2. **页面手工验收——已完成**（2026-09-27，业务方/Codex 在浏览器实操）：对账单与收款单各筛至一条后点击导出，
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
| 新增离线契约（修复后） | **5 passed / 0 failed** |
| 新增 smoke（独立库 `flowcube_printvoid_test`，自洁残留 0） | **9 passed / 0 failed**（补 latest 取样断言后 **10 passed / 0 failed**） |
| **新增 receipt 路径 smoke**（独立库，真实 `voidReceipt`） | **12 passed / 0 failed** |
| `smoke:print-queue`（相关回归） | 14 passed / 0 failed |
| `test:query-loop` / `test:stock-cache-write` / `test:engine-transaction` | 均 PASS |
| `test:print-entry`（补打唯一入口） | PASS |
| 后端 lint / 前端 `tsc -p tsconfig.app.json` / 前端 lint | 退出码 0（31 个既有 warning 全在其他文件） |
| CI 接线守卫 `deployment-resources` | 26 passed / 0 failed |

**反向破坏验证（6 项，均精准红）**：① 去掉「其余筛选排除 VOID」→ 离线 §4 + 真实库「success 混入已作废行」；② 去掉补打侧 VOID 拒绝 → smoke §2、§6；③ 去掉 voided 派生分支 → 离线 §1 + 真实库「voided 筛选含非作废行」；④ 去掉产品补打的 `FOR UPDATE` → §7b「补打在锁被持有期间就完成」；⑤ 终结函数改 no-op → §5、§7；⑥ 去掉 `readLabelVariables` latest 分支的 VOID 排除 → 取样断言红。

**两次「反向验证抓出测试自身缺陷」（勿重蹈）**：
- **§7b 第一版用耗时阈值判定**，而测试自己固定等 300ms，把等待也算进去 ⇒ 恒真。改为判定「补打是否在容器行**仍被别人锁着**时就已结束」后才有效。
- **latest 取样断言第一版是假通过**：夹具条码写成 `${code}I9001`（以随机前缀开头），而该分支自带 `d.barcode LIKE 'I%'`，**根本不命中**，断言自然为真。改为 `I${code}9001` 后，反向 ⑥ 才精准红。

**并发口径的两点修正（重要，勿改回）**：
- **§7 通过并不依赖补打持容器锁**：撤回的 `UPDATE` 会去锁「并发插入的 PENDING 任务行」，未提交的新任务同样被挡住，终结逻辑自兜。故**不能**用「零新增记录」当断言——合法的「补打先成功、撤回随后提交」本就该留下一条历史 job。
- 因此另立 **§7b** 直接验证「产品补打确实在容器行锁内执行」：判定方式是「补打是否在容器行仍被别人锁着时就已经结束」（**不能用耗时阈值**——测试自身固定等待会把它算进去，恒真；这一点是被反向验证 ④ 抓出来的）。

### 7.4 未验证边界

- **PDA 真机、物理打印未做**（本轮全程未触发任何物理打印）。
- **GUI 页面实操——已完成**（业务方高风险独立验收，2026-09-27）：补打中心筛 `voided` 只 1 条、筛 `success` 只 1 条；
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

**问题**（业务方在页面上发现）：VOID 行原本只显示「条码已作废，不能再补打（原因：入库撤回）」，而该行最近一次打印任务其实是 **DONE**——**「已打印」这个事实被作废状态整个覆盖掉**。根因是行级业务状态与任务结果**共用了 `latestJob.statusKey` 一个字段**。

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
