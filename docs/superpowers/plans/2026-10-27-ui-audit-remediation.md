# 深度 UI 审计核查与修复计划

> **执行说明：** 本文件是核查后的修复清单，尚未执行修复。后续实施按 `executing-plans` 逐批推进；每批开始重核工作区与相关 diff。是否委派遵循当时的会话授权，不自动创建聊天或启动子代理。

**Goal：** 修复已核实的操作与信息呈现问题，保留现有业务口径、权限、库存和账款约束。

**Architecture：** 桌面端沿用 `QueryDialog`、`AppDialog`、`ReportTable`、`DataTable`、`PageHeader` 等现有组件；小满沿用当前任务图、权限检查、版本化预览和原键恢复。视觉整理与任务执行逻辑分批交付，不以“统一样式”为由改变查询范围、结算方式或确认规则。

**Tech Stack：** React / TypeScript / Vite / Radix UI；Node.js 小满运行时；Vitest、Node test、agent-browser。

## 1. 核查范围与证据

- 原件：`/Users/chengjianghao/Desktop/深度UI审计-2026-10-26.html`，本轮未修改。
- 正文：基于 `2b8a949`，128 项（高 2、中 48、低 78）；附录另有 5 项；第六章另有 U1–U14、V1–V9。R1–R15 是修复提案，不另算缺陷。**不能把正文、附录、U/V 重复问题直接相加作为独立缺陷总数。** 附录 A1 与 U8、A3 与 V8 重复。
- 当前主工作区：`/Users/chengjianghao/flowcube`，`codex/release-0.13.8 @ f2c3356c5bdf73aa91e85762047befc7429e74b7`，开始时干净，属于较旧代码。
- 核查基线：本机 `main` / `origin/main` 引用均为 `137e2e44d6d696d3929ea61c75992549a09a4fe3`。没有联网刷新远端，不将本机引用冒充远端即时状态。
- 实际读码和预览工作树：`/Users/chengjianghao/.codex/worktrees/release-20261026/flowcube`，HEAD `56938fe294ff79a4465296dc806c0ff0500289b6`。`git diff main HEAD --name-only` 仅含发布记录与证据文档，前端、后端及 `agent/` 业务代码一致。该工作树业务代码未修改。
- 本轮完成：正文 128 项逐条归类与入口定位；附录及 U/V 核对；关键调用链检查；分流/金额解析离线探针；1440×900 当前代码合成数据浏览器抽查。
- **浏览器抽查仅覆盖销售占库、盘点详情、资金账户查询、小满欢迎页；没有重跑全部 81 页。** 其余项的“待复现/候选优化”不表示已经在当前版本实测成立。没有调用生产 API、运行数据库测试、确认小满任务或提交业务单据。
- 预览运行在本任务临时端口 5207，API 为既有本地演示服务；销售预占及盘点详情补充了仅本浏览器会话可见的合成 GET 响应。初次占库打开遇到演示服务缺少 `items` 的占位响应，不能算产品回归；补足合法 DTO 并整页重载后才取布局证据。
- 本轮截图与探针材料目录：`/Users/chengjianghao/flowcube/output/ui-audit-check-20261027/`。原报告截图仍只是历史证据。

逐条核查见 [完整核查台账](2026-10-27-ui-audit-verification-ledger.md)。台账保留原报告顺序，正文编号 `UI-001`～`UI-128`；附录使用 `A1`～`A5`。

正文核查分流：**已确认 21 项、部分成立 22 项、待复现 21 项、候选优化 56 项、不采纳原改法 8 项**。这是证据状态统计，不能视作独立缺陷数；多项共用同一组件，按以下任务合并实施。附录、小满 U/V 与原建议 R 的映射单列在台账中。

## 2. 需要纠正的原报告结论

| 事项 | 本轮核查 | 修复计划采用的口径 |
|---|---|---|
| 两个高严重度弹窗“无滚动区、核心输入不可达” | 占库表可视宽 1136px、表宽 1616px，实测 `scrollLeft=480` 后仓库与数量输入完整可见；盘点表可视宽 1102px、表宽 1424px，`scrollLeft=322` 后实盘、差异和操作可达 | 首屏布局问题成立，“无法到达”不成立。仍优先改善关键字段，但不是已证实的阻断性 P0 |
| 查询日期都改为近 7 天 | 现行前端规范明确：物流默认当天，放行/采购申请/退款等默认不限，账款默认跨日期未结清 | 保留各页面默认值与重置合同，只统一外壳及必要说明 |
| 供应商往来必须与客户往来对称 | 现行实现明确要求月结欠款和现结账款分区、分别汇总 | 不合并金额、不删月结区，不为对称改业务 |
| 固定资产、合并报表、报税高亮“系统”是错的 | `frontend/src/router/routeDefinitions.ts` 明确归“系统 / 高级会计”，主题文档有对应设计记录 | 不作为 bug 搬菜单；若以后调整信息架构，另立产品需求 |
| 四位小数与成本逐行说明一律删除 | 凭证核对区展示历史原值/分位投影/舍入差；利润表 `costBasisNote` 是逐行来源，可能不同 | 保留诊断精度与异常行依据，只精简重复的正常态说明 |
| 所有弹窗统一为 680px，所有长表单取消内滚 | 共享 `QueryDialog` 默认就是 520px；短查询、重置密码、仓库范围和成套编辑承载不同任务 | 制定按内容的宽度档与固定头尾，不用单一宽度或无限放大替代布局设计 |
| 小满库存时间在北京时间服务器也一定差 8 小时 | 库存回复用 `toLocaleString('zh-CN')` 未指定时区，简报明确指定上海；差异依赖服务器时区 | 缺陷是输出依赖服务器时区；按业务北京时间统一，不声称所有部署必现 |
| 小满欢迎卡存在永久选中态 | 源码四张卡同模板，只有 `:hover` 改背景；本轮停留指针使另一张卡高亮 | 不按某一张卡永久高亮修复，移开指针复验即可 |
| 小满按钮颜色差异可列 P0 | 视觉不同成立，但没有因此阻止操作或改变结果 | 放 P2 视觉批次；任务改量与确认一致性优先 |

等级说明：P1 为可能误读业务事实或误确认旧意图；P2 为明显影响操作的布局/交互问题；P3 为低风险一致性与精修。本轮没有证明必须立即停用系统的 P0。

## 3. 批次与勾选清单

实施顺序：**第一批 T01–T04 → 第二批 T05–T08 → 第三批 T09–T10、T12–T14 → 第四批 T11；T15 为产品待决，T16 为证据补齐，不能混入已确认修复。** 同一批代码审阅后统一验证，不逐个小修改重复跑全量。

| 顺序 | 任务 | 交付重点 |
|---|---|---|
| 第一批 | T01–T04 · P1 | 库存方向正确；小满分流、改量/放弃预览、金额/单号识别 |
| 第二批 | T05–T08 · P2 | 弹窗关键输入可达；查询壳；保存/返回/空态 |
| 第三批 | T09–T10、T12–T14 · P2/P3 | 范围与说明清楚；工具栏；小满时间、历史、视觉 |
| 第四批 | T11 · P3 | 按实际截图选择列宽、文案和间距精修 |
| 独立队列 | T15、T16 | 产品待决；动态/数据问题先补证据 |

### 第一批：事实与操作意图正确性

#### T01 · P1 · 库存追溯的出入方向

关联：UI-031、UI-032。

文件：`frontend/src/pages/inventory/trace.tsx`；核对 `backend/src/modules/inventory/inventory.service.js:getContainerLogs`、`backend/src/engine/inventoryEngine.js:writeInventoryLog`、`frontend/src/pages/inventory/index.tsx`。

拟新建回归：`frontend/src/pages/inventory/trace.test.tsx`，通过页面渲染检查不同 `type/qty` 组合的可见符号与方向，覆盖真实 DTO 的正量出库情况。

- [ ] 明确现有 DTO：数量与 `type` 分开，`type=2` 为出库；现有追溯页面只按 `qty` 正负加号，库存列表另按 `type=2` 加负号。
- [ ] 在展示层按既有库存方向合同处理入库、出库、调整；不改日志原值，不对所有调整直接取绝对值，不批量修数据库。
- [ ] 新建定向展示回归，至少覆盖出库 `quantity=80/type=2`、入库 80、带符号调整、0 和未知方向；与库存列表相同事实显示一致。
- [ ] 合并类型、单号的重复说明，但保留真正的业务备注、来源和时间。
- [ ] 浏览器逐项核对正负号、方向文案和返回列表；同步 `docs/frontend-pda-conventions.md`。

验收：出库不能再呈现“+80”式增加；调整含义不被误改；没有库存写入变更。

#### T02 · P1 · 小满口语分流、越界反馈与多意图告知

关联：U1、U5、U6；R1、R5、R6。文件：`agent/src/routing.js`、`agent/src/agent.js`、`agent/src/llm.js`；已有测试 `agent/test/message-routing.test.js`、`agent/test/intent-gate.test.js`、`agent/test/concept-replies.test.js`。

- [ ] 将本轮原句加入回归：“开个单”“下单”“还欠我们多少钱”“删掉这张草稿”；现状前几句被归为 `outside`，而“改价”已有规范 `blocked`，不能把全部拒绝都算失效。
- [ ] 先保留明确越权/越界拦截，再将明确业务但槽位不足的表达交给受限意图解析或澄清；未知表达不能直接执行，也不能为了命中把所有文本交模型。
- [ ] 多意图先识别并告知待办顺序。最小修复为明确“已查询库存，开单尚未执行”，提供下一步；本批不自动串联多个写任务。
- [ ] 统一不能代办与没识别清楚的文案，并链接有权限的原业务页；不新增删单、改价、付款、发货能力。
- [ ] 在禁用模型、模型失败、低权限、多个相似客户和完全无关话题下复验；同步 `agent/README.md`。

验收：正常说法不会被一概当成无关话题；第二意图不静默丢弃；所有业务数字仍来自工具，原权限及确认闸门不放宽。

#### T03 · P1 · 小满改量后旧预览与放弃预览

关联：U2、U4；R2、R4。文件：`agent/src/agent.js:continueTask/reviseSalePreview`、`agent/src/tasks.js`、`agent/src/runtime.js`、`backend/src/modules/assistant/assistant.routes.js`、`frontend/src/components/agent/TaskPreview.tsx`、`frontend/src/components/agent/useAssistantConversation.ts`、`frontend/src/components/agent/types.ts`；测试 `agent/test/conversation-recovery.test.js`、`agent/test/quality-boundaries.test.js`、`frontend/src/components/agent/AgentWorkspace.test.tsx`。

- [ ] 增加“改成 3 个吧”“多了，改 5 个”等省略句与多行歧义回归；当前正则不接“吧”，单行识别还要求前文包含“数量/这单/刚才”等。
- [ ] 当前待确认任务优先解析修订意图；不明确时保留原正文并提示“尚未修改”，暂停可能被误点的旧预览确认，待用户澄清或明确继续原版。
- [ ] 成功修改必须重新读取价格、数量策略及库存并生成新 revision；前端呈现旧→新变化，确认继续携带当前 revision，旧 revision 返回 409。
- [ ] 加入“放弃预览”显式入口和当前任务取消意图。只允许合法的未执行状态进入 `CANCELLED`，服务端复核属主/权限并和确认使用同一互斥机制。
- [ ] `CONFIRMED / EXECUTING / RESULT_UNKNOWN / VERIFYING / ESCALATED` 不得用“取消”抹去结果或换键；已完成业务不受影响。提示应是“已放弃这份未执行预览”，不能笼统保证“已取消订单”。
- [ ] 自然语言“确认”只指引用户核对确认卡，不能绕过原显式确认与两段核销。补取消与确认竞态、过期、撤权、重复请求、结果未知的回归。
- [ ] 同步 `agent/README.md` 与后端 API 主题文档；如新增写入口，接入原路由权限与回执规范。

验收：用户说改量后不能不加说明继续确认旧量；放弃未执行预览不会取消业务单、不会隐藏未知结果。

#### T04 · P1 · 收款金额与指定单号分别解析

关联：U3、R3。文件：`agent/src/receipt-amount.js`、`agent/src/agent.js:graphReceipt/buildReceiptPreview`、`agent/src/llm.js`；测试 `agent/test/receipt.test.js`、`agent/test/receipt-accounts.test.js`、`agent/test/quality-boundaries.test.js`。

- [ ] 加入原句“甲公司付了 25 元，把 SL20261026009 那笔核销掉”；本轮离线复现 `RECEIPT_AMOUNT_INVALID`，而“甲公司 到账 25 元 核销”得到 2500 分。
- [ ] 按明确货币单位/付款语境提取金额，将客户编码、完整单号、日期等单独解析；不能只删除长数字后把客户名和核销目标一起丢失。
- [ ] **指定单号必须仍被核对**：原客户、权限、未结余额与目标账款一一匹配。现有 `buildReceiptPreview` 入口只有客户与金额，若本批不能安全支持指定目标，就明确澄清并停止，不能偷偷按全客户账款分配。
- [ ] 两个候选金额、负数、超两位小数、指数、倍率、中文模糊金额继续拒绝或澄清，不交模型猜金额或自动舍入。
- [ ] 保留收款登记与核销分配两段确认、整数分核对、原请求键和新鲜度复核。读 `docs/cash-cents-policy.md`、`docs/finance-permission-time.md` 后实施。

验收：单号不再被当金额；修复不导致错误客户/错误单据被核销。独立测试库真实流程验收另列，离线解析通过不等于资金闭环通过。

### 第二批：弹窗、长表单和失败出口

#### T05 · P2 · 弹窗内关键字段与滚动结构

关联：UI-001、033、037、056、120、123、128；UI-010、068 可随样板复核。

文件：`frontend/src/pages/sale/components/ReserveAllocationDialog.tsx`、`frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx`、`frontend/src/pages/disposal/components/CreateDisposalDialog.tsx`、`frontend/src/pages/finance/accounts/index.tsx`、`frontend/src/pages/approvals/flows.tsx`、`frontend/src/pages/users/components/UserFormDialog.tsx`、`frontend/src/pages/oplogs/index.tsx`；共用 `frontend/src/components/shared/ReportTable.tsx`、`frontend/src/components/shared/AppDialog.tsx`、`frontend/src/components/ui/dialog.tsx` 先读调用面再决定是否改。

- [ ] 先做占库/盘点两个样板：缩减次要身份列的默认占用，保证商品识别、仓库/账面量、核心数量输入在同一视野；剩余明细允许明确且可发现的横滚。
- [ ] 保留可调列宽，不重置用户持久列宽，不将所有商品身份列全局合并。共用 `ReportTable` 内联 `minWidth` 来自列宽合计，只改页面 `min-w-*` 不一定有效。
- [ ] 长内容采用固定标题/页脚与一个主要正文纵向滚动区；审批 1/5/10 级节点、用户 1/12/30 个角色均能键盘访问最后一项。
- [ ] 盘点未填写仍为未盘，不能把空值变 0；占库已有预占不能换仓、数量策略和请求恢复全部保留。
- [ ] 在 1366×768、1440×900、1920×1080 与 125% 缩放检查正常、空、长文本、加载失败；记录实际可视宽、滚动宽及焦点是否可达。

验收：数量输入和核心关联信息无需猜测即可找到，正文滚动不带走提交/关闭；不要求所有列同时显示。既有定向回归：`frontend/src/pages/sale/components/ReserveAllocationDialog.read.test.tsx`、`frontend/src/pages/sale/components/ReserveAllocationDialog.authorization.test.tsx`、`frontend/src/pages/stockcheck/components/CheckDetailDialog.error.test.tsx`、`frontend/src/pages/stockcheck/components/CheckDetailDialog.terminal.test.tsx`。

#### T06 · P2 · 查询外壳与同类弹窗规格

关联：UI-005、007、009、020、024、026、027、054–059、063–064、067、075、080、122。

文件：财务三页 `frontend/src/pages/finance/{accounts,transactions,expenses}/index.tsx`；`frontend/src/components/shared/{QueryDialog,QueryFormLayout,AppDialog}.tsx`；`frontend/src/pages/returns/ReturnQueryDialog.tsx` 及台账中的查询/页脚调用点。

- [ ] 先将资金账户、资金流水、报销查询接入 `QueryDialog`，统一重置/取消/查询及头尾边界；保留原字段和应用时机。
- [ ] 对字段相同的销售/采购退货查询统一宽度与分组；少字段查询保留紧凑档。以“内容类型＋字段数”选档，不直接将共享默认 520 改成 680。
- [ ] 保留每页默认日期、`resetValues`、已应用条件、未应用草稿和关闭后回焦。重置不是清空全部日期。
- [ ] 对普通 `DialogFooter` 处理真正的边距嵌套差异；当前背景色已有共享规则，不能声称所有样式仍完全独立。先修调用点，避免批量改基础壳影响全部业务浮层。
- [ ] 回归同页打开/取消/重开、切标签、后台刷新、日期浮层、上下拉和键盘焦点。同步前端规范。

验收：同类查询操作位置、命名、可读性一致，原查询请求参数完全保持。用 `frontend/src/components/shared/QueryDialog.consistency.test.tsx` 与工作区返回测试核行为。

#### T07 · P2 · 保存可达、禁用原因与无效入口返回

关联：UI-003、028、040、061、065、104、108、124、126。

文件：`frontend/src/pages/sale/commercial/CommercialEditor.tsx`、`frontend/src/pages/returns/purchase/form/index.tsx`、`frontend/src/pages/returns/sale/form/index.tsx`、`frontend/src/pages/disposal/HandlingScrapPage.tsx`、`frontend/src/pages/supplier-refunds/CreateRefundPage.tsx`、`frontend/src/pages/products/form.tsx`、`frontend/src/pages/permissions/index.tsx`、`frontend/src/pages/settings/index.tsx`、`frontend/src/pages/categories/index.tsx`、`frontend/src/pages/accounting/accounts/index.tsx`。

- [ ] 销售添加按钮附近显示实际缺失前置条件；不能照抄报告的“客户＋仓库”，当前添加按钮首先检查仓库和商品查看权限，保存还有独立条件。
- [ ] 商品、权限、设置长页增加一个持续可达的操作区，复用原保存/取消 handler、禁用态与脏稿保护，不能产生第二套提交逻辑。
- [ ] 分类行操作增加焦点和触摸可发现性；科目页已有 `group-focus-within`，保留其键盘行为，只核剩余发现性问题，不机械改成所有按钮常驻。
- [ ] 退货新建和来源无效页提供有权限的返回入口；保留列表原筛选和未保存确认。报废参数无效分支补标准页头；退款无效来源已有 `role=alert`，重点补出口和明确呈现。
- [ ] 验证滚到最后字段仍可保存，键盘顺序正确，双击只发原单次请求；只读角色无写入口，未知结果不能通过新按钮换键重提。

#### T08 · P2 · 空状态、范围提示与宽表空态定位

关联：UI-004、041、045、052、060、062、099、101、106、121。

文件：`frontend/src/components/shared/DataTable.tsx`、`frontend/src/components/shared/payments/CreateStatementDialog.tsx`、台账中三类恢复页及 `frontend/src/pages/supplier-refunds/index.tsx`、`frontend/src/pages/reports/{wave-performance,pda-anomaly}.tsx`、`frontend/src/pages/locations/index.tsx`。

- [ ] 宽表空状态以可视区域居中，保留表头、列宽及有数据状态的正常滚动；只针对 `colSpan` 空行处理。
- [ ] 区分未选择对象、无匹配结果、无数据、读取失败与结果未知；后两者不能显示“暂无数据”或虚构零值。
- [ ] 结果核对页增加简洁空态；不清除原恢复记录，不自动重发。供应商退款只说明已有查询/权限范围，不凭空新增日期筛选参数。
- [ ] 容量缺值显示“—”，但 0 仍显示 0；空表/有行/截断列表/失败四态检查，图表空态保持对应含义。

### 第三批：一致性及小满呈现

#### T09 · P2 · 时间范围与业务说明

关联：UI-032、036、042、048–051、073、093、096；UI-069 只优化可读性。

文件：`frontend/src/components/shared/PaymentQueryDialog.tsx`、`frontend/src/pages/accounting/reports/index.tsx`、`frontend/src/pages/accounting/vouchers/index.tsx`、`frontend/src/pages/reports/{profit-analysis,inventory-aging}.tsx`、`frontend/src/pages/inventory/trace.tsx`、`frontend/src/pages/stockcheck/abc.tsx`、`frontend/src/pages/transfer/index.tsx`。

- [ ] 开放日期区间用“起始不限/截至不限”等明确用语，不改真实起止值。
- [ ] 调拨的自定义日期应能识别，保留默认日期 chip 隐藏约定；ABC 覆盖统计与指定仓库分类说明各自范围，不改变计算。
- [ ] “期末时点”改为说明而非禁用按钮；维持资产负债表取期末、其他报表取期间的语义。
- [ ] 正常成本来源说明可集中一处；混合来源/缺少快照/历史回退行仍保留就地说明。历史四位金额与分位投影不舍入隐藏。
- [ ] 库龄同类零数量统一展示，缺失值与零明确区分；同步财务/前端对应文档。

#### T10 · P3 · 工具栏与切换器

关联：UI-006、011、016、018、022、034、038、044、046、053、074、079、085、087–089、097–100、111。

文件：台账对应页面；共用 `OrderStatusFilter`、`FilterCard`、`PageHeader` 与现有分段控件先核实现有职责。

- [ ] 优先去除批次效率/PDA 异常同作用域的重复“立即刷新”；待办中心全页刷新与局部刷新先核范围，再改标签或合并，不能机械删一个。
- [ ] 主次操作排序、破坏性操作露出及常用搜索统一到现有样板，原权限和确认框保持。
- [ ] 区分“业务子视图”“状态筛选”“报表类别”三种层级；不把所有切换器改成同一外观，不新增页面分页。
- [ ] 不修改采购建议两个子视图的路由身份、各自筛选及业务工具；只在存在真实认知障碍处补名称/层级。

#### T12 · P2 · 小满时间、单价来源与正文重复

关联：A1、A2、U7、U8、U10；R7、R8、R10。

文件：`agent/src/agent.js`、`agent/src/reports.js`、`frontend/src/components/agent/TaskPreview.tsx`、`frontend/src/components/agent/MessageText.tsx`；测试 `agent/test/graphs2.test.js`、`agent/test/receipt.test.js`、前端 `frontend/src/components/agent/AgentWorkspace.test.tsx`。

- [ ] 库存、简报、台账统计时点显式采用 `Asia/Shanghai`，前端走已有时间工具；分别在 `TZ=UTC` 和 `TZ=Asia/Shanghai` 验证同一时刻输出一致。
- [ ] 单价等级 A/B 等显示为完整来源名称，保留自定义来源和未知来源回退。
- [ ] 有预览卡时正文只描述结果、变化和下一步，字段明细留在卡片；风险/冲突/历史金额提示不得为了字数上限删掉。
- [ ] 低库存阈值与补货安全库存保持不同定义，简短解释口径；不采纳“统一同一判定”这种改业务方案。

#### T13 · P2 · 小满历史与恢复

关联：U11、U12；R11、R12。文件：`frontend/src/components/agent/AgentWorkspace.tsx`、`frontend/src/components/agent/useAssistantConversation.ts`、`frontend/src/components/agent/types.ts`、`agent/src/tasks.js`、`agent/src/agent.js`。

- [ ] 历史标题显示任务类型、对象与阶段；同一两段核销按关联关系呈现，底层两任务/两确认/原 ID 均保留，不能凭同名合并。
- [ ] 区分“查询完成但未找到”与执行失败；只有确定的只读未命中可改显示状态，不把所有 `FAILED_FINAL` 改成成功。
- [ ] 首次进入不自动展开普通待确认草稿，改为待办提示和手动恢复；执行中/结果未知需要显著提示并保留恢复入口，不能随之隐藏。
- [ ] 测试换账号/服务器、历史失败、并发刷新、30 条上限、两段任务、过期与原键恢复。

#### T14 · P2 · 小满复用产品视觉令牌

关联：V1–V9、A3；R14。文件：`frontend/src/components/agent/xiaoman.css`、`frontend/src/components/agent/AgentWorkspace.tsx`、`frontend/src/components/agent/TaskPreview.tsx`；参照 `frontend/src/styles/desktop-page-samples.css`、`frontend/src/components/ui/button.tsx`、`frontend/src/components/shared/StatusBadge.tsx`。

- [ ] 首先统一确认/发送按钮的主操作色、圆角和焦点，复用现有组件/令牌，不直接照抄报告中的十六进制色。
- [ ] 统一预览、状态片、边框和辅助文字；移除无业务意义的重复身份，仅在需要判断操作范围时保留仓库范围。
- [ ] 根据长采购分组和核销分配卡调整可用宽度，正文继续有合理阅读宽度；不强制所有文字铺满全屏。
- [ ] 欢迎页、短对话、长预览、消歧、多账户、过期、断线/结果未知逐态检查。仅作用于小满，不波及 PDA、官网及全局主题。

### 第四批：低风险精修与待证项目

#### T11 · P3 · 列宽、文案及低风险视觉细节

关联：台账标为 T11 的项，包括 UI-002、008、012–015、017、019、021、023、029–030、035、039、066、068、070–072、076–077、082–083、086、091–092、094–095、102–103、105、107、109–110、112、118–119、125、127。

- [ ] 只处理有内容/窗口证据的默认列宽、零值、文字换行和重复说明；正常页面横滚、不同业务卡片数量不是强制缺陷。
- [ ] 不将各类主数据维护全部改为同一种页面/弹窗；不移除成套草稿备份、不同条码页签的业务状态、权限只读态差异。
- [ ] 逐个低风险改动看 diff 和前后截图；不为纯样式新增镜像实现的测试，不借机重构业务模块。

#### T15 · 产品待决，不进入直接修复

关联：U9、U13、U14、R9、R13、R15。

| 需求 | 建议边界 | 实施前需确定 |
|---|---|---|
| 错别字近似候选 | 只提供当前权限可见的候选，最多 3 个，由用户明确选择，不能自动替换商品 | 匹配来源、准确率与误匹配验收样本 |
| 大额/大量草稿提醒 | 只作核对提示，不更改数量/价格/安全库存，不另建审批政策 | 不直接采用报告的“5 万元/库存 5 倍”；先确定业务口径及配置归属 |
| 商务卡点覆盖 | 当前仓库执行范围已明示；扩大到草稿/占库属于能力增补 | 范围、权限、数据来源和与待办中心的职责 |
| G-chat 去留 | 修复业务误分流不需要删除 G-chat；暂保留现状，明确业务优先 | 用户是否希望保留极序使用咨询；本轮不代决 |

#### T16 · 必须先补证据的项目

关联：UI-025、090、113–117、A4、A5，以及台账标为“待复现”的几何/动态项目。

- [ ] 打印编辑器：已有 `ResizeObserver` 自动 fit；检查初次编辑加载时 DOM ref 与 effect 时序、手动缩放状态、长模板和隐藏再激活。未复现前不重写缩放算法。GUI 预览不代表实际出纸。
- [ ] toast：源码默认错误 4 秒、桌面 320px、z-index 9999；原报告含已排除的实验 Agent 按钮，不能直接推断正式版层级错误。真实触发后测遮挡、hover 暂停、重复延时及切页，不靠继续抬高 z-index 修。
- [ ] 打印机乱码：核对演示种子、API 原始编码与显示层，未知类型才给明确回退；不对所有名称盲目二次解码。
- [ ] 待我审批灰块：核对实际 widget 类型、数据接口、loading/error/empty 三态；不能把任意灰色区域判成无期限加载，也不能用 0 掩盖请求失败。
- [ ] 采购排名与商品量差异：核对各 API 的时间、状态、数量与金额口径，确认数据后再决定提示或数据修复。

## 4. 实施与验收闸门

### 开始实施前

- [ ] 从已确认的最新业务基线建立本任务隔离工作树；当前旧主工作区只新增本计划及台账，不在其上直接开始修复。
- [ ] 读实际 `AGENTS.md`、对应领域文档与完整调用链。金额/权限/状态机/新写入口不能当作普通文案改动。
- [ ] 每批列明文件、原问题编号与预期行为；先核 diff，纯优化避免顺手增加功能。

### 每批结束

- [ ] 对行为变更补有意义的回归与负例；纯样式以真实页面、截图、几何和键盘复核为主。
- [ ] 对 UI 样板检查正常/空/失败/长数据/关闭重开/切标签返回；对小满检查撤权、过期、revision 冲突、取消竞态、未知结果与两段确认。
- [ ] 文档和代码同批，代码审阅后统一执行本批受影响检查。未经授权不推送、不合并、不发版。

### 待实施后、发版前统一验证（本轮未执行）

在实施工作树中先加载 `~/.config/flowcube/dev-env.sh`（存在时），Node 22：

```bash
npm --prefix frontend run lint
(cd frontend && npx tsc --noEmit -p tsconfig.app.json)
npm --prefix frontend run build
npm --prefix frontend run test:unit
npm --prefix agent test
npm run test:frontend-conventions
npm run test:frontend-date-source
npm run test:frontend-polling-contract
npm run test:api-route-contract
npm run test:route-permission-contract
npm run test:permissions
```

共用组件或路由契约改变时，发布前按 `docs/verification-commands.md` 跑全量套件；不能把上面的选择列表替代全部规定检查。若 T04 改到真实收款/核销选择或写入路径，还需独立测试库的财务、期间、并发及幂等回归。不得迁移或清空共享开发库。

`npm run test:style-compat` 包含真实浏览器步骤，运行前核其环境参数和资源归属。浏览器每任务一个稳定命名会话，用完关闭并用 session list 确认；本轮会话 `flowcube-ui-plan-20261027` 已关闭，列表确认无会话，临时预览服务已停止，保留用户原有服务。

验收记录分开写：代码/单元测试、真实浏览器合成数据、独立后台业务流程、CI、生产、Windows、PDA、实际打印。**本计划没有将任何待执行检查标成通过。**

## 5. 本轮交付状态

- 已完成核查分流、关键问题复现和修复计划；已保存原始问题到逐条台账。
- 未修改业务代码；未提交、未推送、未发布；未改变任何权限、配置、库存或账款。
- 对未逐页复现的事项保留明确验证任务；计划可从 T01–T04 开始，产品待决项不阻塞已确认问题。
