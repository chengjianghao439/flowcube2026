# 点名偏离页面归编（2026-10-25）

本轮从 `83241d10fde1f43543f9e17d4b305b679e17bed2` 继续在 `codex/desktop-ibm-style` 追加提交。没有 rebase、合并 main、打 tag 或发版。提交及远端完整 SHA 以交付回复为准，不在提交内自证自己的发布状态。

产品改动限于 8 个点名/获准新增的 TSX 文件和 1 个 CSS 文件；另更新 3 个发票测试文件及本报告、主题规范、计划、抽查证据。完整路径见 [changed-files.txt](desktop-page-conformance-2026-10-25/changed-files.txt)。用户提到的三份同目录复核/偏离 Markdown 在本次仓库和附件目录中未找到；本轮依据用户消息中的六项明确任务、当前源码与真实 DOM 执行，没有声称读过缺失材料。

## 六项任务的取舍

| 项目 | 处理与依据 |
| --- | --- |
| A 类三页 | **采纳**。发票、跨期补录、记账凭证去掉 DataTable 外的 `card-base p-2`；DataTable 自身保留唯一表格卡。ListSummary 紧随表格。凭证原本还在表前重复计数，收束为一处、沿原业务单位“张”。凭证的 `card-base p-3` 对账说明/警示卡原样保留。 |
| 发票五项 | **采纳并收窄行操作**。类型选择沿条码查询的 `fc-segmented-control` / `fc-print-category` 与 `aria-pressed`；计数只剩 ListSummary“张”；四颗星使用 `text-destructive-ink`；金额带使用 `surface-subtle` 和 `--radius-button`（实测 10px），等距与金额公式不变。认证/抵扣使用普通分体按钮，红冲使用危险分体按钮，编辑/删除归入菜单。 |
| “已抵扣主操作为编辑” | **未采纳**。原前端仅 `status === 1` 可编辑；后端 `accounting.invoice.service.js:348` 也以 `INVOICE_LOCKED` 拒绝其他状态。为满足原行为等价，已抵扣/已红冲行保留原单一删除入口，未新增编辑资格。该冲突已在工作中说明；无推进动作的呈现采用保留原入口的保守默认。 |
| C 类四张表头 | **核实后保持表头实现**。四处已是 ReportTable，实际生成 `thead.data-table-header[data-resizable]` 与 `th.fc-table-header-cell`。并非手写灰底规则在最终呈现中生效；按任务明确排除项，不再重复处理表头。补货、账簿明细的 sticky 保留。补货另有下述一处弹窗 grid 约束修复，未改表头。 |
| B 类两页 | **采纳**。运费账单/汇总单分别在各自表后补 ListSummary，单位“张”/“单”，总数读取原接口 pagination.total。批次效率补“个”，按 `waves.length` 计当前返回列表；不能用独立近 30 天 summary.totalWaves 冒充筛选列表总数。原报表查询最多返回 100 行，该上限未改；本轮不宣称获得全部历史记录数。 |
| 正式紧凑表 | **采纳并限定共享表范围**。CSS 末尾追加 9 行、2 条规则，显式命中桌面工作区或 ERP 弹窗内 `table.fc-report-table.fc-table-compact`。仅声明字号和 padding；不重写颜色、状态、合计、行高或列宽逻辑。塑料盒详情两表接入，清除密度冲突工具类，保留对齐、font-mono、tabular-nums、换行和状态色。 |
| 发票标准查询 | **采纳**。同一 status 源连接 OrderStatusFilter、查询 Select 和 chips。QueryDialog 内部复用 AppDialog；打开时回填已应用筛选，草稿不提前请求，重置只清草稿，取消不应用；查询后才显示相应 chips，支持逐条/全部清除。移除内联关键词框；类型切换清除类型相关状态、保留关键词。没有独立 FilterChips 共享组件，沿销售页现有行内 chips 标记复用其样式。 |

发票状态名称取现有 `INVOICE_STATUS_LABELS`，与后端/接口 `statusName` 对照：进项为待认证、已认证、已抵扣，销项为已开具、已红冲；表格仍展示接口原 `r.statusName`。只传已有 `invoiceType / keyword / status / page / pageSize`，没有日期筛选或新 API 字段。组件原 `page=1 / PAGE_SIZE=20` 保持；既有 payloadClient 会归一到每批 200 条自动取齐，浏览器实际请求也是 `page=1&pageSize=200`，不能把组件参数误报为网络页量。两层分页代码均未修改，见 [request-audit.json](desktop-page-conformance-2026-10-25/request-audit.json)。

## TSX 逐文件与行范围

行号指本轮结果；精确逐 hunk 范围见 [diff-ranges.json](desktop-page-conformance-2026-10-25/diff-ranges.json)。新增 import 单列，避免把整个文件描述成修改范围。

| 文件 | 行范围 | 归编说明及逻辑依据 |
| --- | --- | --- |
| `frontend/src/pages/accounting/invoices/index.tsx` | 11、22–23、32–33；132–148；169–172、188–195；206–220；224、232–261 | import/必填星号/金额带/外层间距、去重复卡与计数属于表现归编；行操作改为既有共享菜单，权限仍为 canManage，三个推进条件、原单 id/action、编辑 status=1、刷新/错误禁编辑和删除确认回调保持。169–195、234、239–253、261 的筛选状态与新交互是任务六**明确授权的前端行为变化**，不能笼统称为所有逻辑零变化。 |
| `frontend/src/pages/accounting/invoices/InvoiceQueryDialog.tsx` | 新文件 1–48 | 任务六授权的草稿查询界面，只有关键词/状态；复用 QueryDialog→AppDialog、QueryFormLayout、Input、Select，不修改任何既有组件 props 接口。新增文件自己的 props 不改变公共组件合同。 |
| `frontend/src/pages/accounting/backfills/index.tsx` | 535–537 | 只拆冗余卡；原 error 分支、virtualized/preserveFocus/retainFocusedRow、全部属性和 ListSummary 的未截断判断不变。 |
| `frontend/src/pages/accounting/vouchers/index.tsx` | 459–461 | 只拆冗余卡、把两处计数收为表后一处“张”；原错误分支、查询、生成/冲销/删除、对账卡不变。 |
| `frontend/src/pages/logistics/freight-reconciliation.tsx` | 12、135、140 | import 与表后只读计数，原查询/汇总生成/写入/权限均不变。 |
| `frontend/src/pages/reports/wave-performance.tsx` | 20、213 | import 与表后只读计数，沿原 waves 数组；日期、排序、轮询和请求不变。 |
| `frontend/src/pages/plastic-boxes/index.tsx` | 310、313–323、342、345–361 | 仅两张 ReportTable 的密度 class 归编与冲突 utility 清理；数组映射、数量、来源提示、状态、读取分支、还原/打印/恢复逻辑不变。 |
| `frontend/src/pages/reports/replenishment.tsx` | 244 | 只为确认弹窗增加 `grid-cols-1`，消除隐式 grid 最小内容宽度造成的外层溢出；表格在原滚动容器内横向滚动。原选中、数量、生成回调、权限、表头和 sticky 均不变。 |
| `frontend/src/pages/accounting/invoices/index.date.test.tsx` | 45–49 | **仅验证文件**：编辑由散装按钮变为实际菜单项，改用 ArrowDown 打开和 Radix data-disabled 检查；日期与保存载荷断言保留。 |
| `frontend/src/pages/accounting/invoices/index.409-recovery.test.tsx` | 65–78、222–223、236、250–251、265–266 | **仅验证文件**：同样调整真实菜单入口，保留 409 草稿/版本/重开/失败重试断言，以及实际点禁用项不得打开/写入的断言；未删弱化业务断言。 |

新 `index.filters.test.ts` 是非 TSX 验证文件，5 例覆盖类型状态集、请求字段、草稿/后台重读/取消/重置、chips、三个既有 action 和只读岗位。真实页面/QueryClient/共享控件挂载，只有 API 边界及权限来源受控。

[source-audit.json](desktop-page-conformance-2026-10-25/source-audit.json) 用 TypeScript AST 定位函数，逐字比对最终 JSX return 之前的语句：InvoiceDialog、BackfillsPage、VouchersPage、FreightReconciliationPage、WavePerformancePage、ReplenishmentPage、塑料盒 DetailDialog 均一致；发票 doStatus 函数一致。四张候选表的 thead 子树逐字一致；补货文件除上述单一 class 外一致，其余三个文件全文件一致。另人工复核 JSX 内回调、条件与原 props。该证据支持原业务处理保持，不声称它自动证明所有 JSX 语义等价；发票筛选与动作归组的授权差异如上单列。后端、API 类型/客户端、权限定义、共享组件、根令牌、PDA、官网、TemplateRenderer 均无改动。

## 四张表头：实际计算样式

| 定向目标 | 背景：改前 → 改后 | 字重 | 内边距 | 字号 / 字色 | 处理 |
| --- | --- | --- | --- | --- | --- |
| 补货生成申请弹窗 `reports/replenishment.tsx:254–260` | `rgb(245,245,247)` → 同值 | 600 → 600 | 10px 16px → 同值 | 12px / `rgb(110,110,115)`，前后相同 | 保留 ReportTable；thead `sticky; top:0px` |
| 账簿明细弹窗 `accounting/ledger/index.tsx:32–42` | 同上 → 同上 | 600 → 600 | 10px 16px → 同值 | 同上，前后相同 | 保留 ReportTable；thead `sticky; top:0px`；主表/明细同屏对照 |
| 采购计划详情 `procurement/detail.tsx:103–126` | 同上 → 同上 | 600 → 600 | 10px 16px → 同值 | 同上，前后相同 | 保留 ReportTable 的列宽/选择及 whitespace 工具类 |
| ABC 规则 `stockcheck/abc.tsx:225–234` | 同上 → 同上 | 600 → 600 | 10px 16px → 同值 | 同上，前后相同 | 保留 ReportTable；不向结果 DataTable 重复补规则 |

以上是每张目标表**全部 th**的计算值，而非只 grep thead 的工具类。最初改前采集同时保存了页面/弹窗图；早期通用 JSON 只保留前 16 个表头，补货页表头太多，未含弹窗目标。为补齐该证据，定向采集又在同一真实 DOM 中临时加载 `git show 83241d1:.../desktop-page-samples.css` 的精确文本作基线测量，再在 finally 恢复当前 CSS 并重测四张表。当时四个 TSX 文件与基线逐字一致；这种重建基线测量没有改仓库、定位类或节点状态，未冒称最初漏采的数据已经采到。随后补修补货弹窗 grid，最终又实际重读该页并逐格确认表头仍为上述值、sticky 保持。详细类名/属性、每格样式与基线 CSS SHA256 见 [header-computed-styles.json](desktop-page-conformance-2026-10-25/header-computed-styles.json)，最终复测见 [replenishment-layout-final.json](desktop-page-conformance-2026-10-25/replenishment-layout-final.json)。

图证复核还发现补货确认弹窗的宽表将隐式 grid 列撑到 920px，弹窗 clientWidth 766px、scrollWidth 968px，导致说明/页脚横向裁切；基线同样可见。先在真实 DOM 临时试验 `grid-template-columns:minmax(0,1fr)` 并还原，验证外层不再溢出、表格内部仍可横向滚动，再只在该页 DialogContent 加现成 `grid-cols-1`。最终实测外层 clientWidth/scrollWidth 同为 766px，内部滚动区 716px/918px、页脚 right=999px 在弹窗 right=1024px 内。没有改共享 Dialog、说明文案或生成行为；[诊断尺寸](desktop-page-conformance-2026-10-25/replenishment-layout-diagnosis.json) 与图版最后的 `replenishment-dialog-contained` 为补修证据。

塑料盒两张显式紧凑表的 th/td 均为 **6px 12px、12.5px**；表头仍 600/标准灰底。相同画面背后的普通 DataTable 表头仍 10px 16px、12px，普通 td 仍 11px 16px、13px。金额带实测 `rgb(245,245,247)` / 10px，四颗星均为语义危险字色。见 [selector-audit.json](desktop-page-conformance-2026-10-25/selector-audit.json) 与 [invoice-form-styles.json](desktop-page-conformance-2026-10-25/invoice-form-styles.json)。

## 逐页浏览器记录

本工作树真实 React 路由，独立回环预览 5201 / 合成 HTTP 58359，不连接数据库。GET 延迟触发加载，空 GET 响应触发空态，发票 503 触发原错误分支；用户选择、菜单、弹窗、输入与取消均在浏览器执行，未注入选中/禁用属性。采集后查看图版并核对 DOM/样式。原始截图 1280×633，图版缩至 75%；**10 个路由、79 份图像及 DOM 记录、12 张图版**。原图 SHA256、图版位置与完整属性/计算值在 [browser-states.json](desktop-page-conformance-2026-10-25/browser-states.json)。

“无”指页面未提供该类控件，不计作通过；“未验”指存在但未触发。打开危险确认框均取消，非业务提交。

| 页面 | 实际查看的状态 | 未覆盖及图证 |
| --- | --- | --- |
| 发票 `/accounting/invoices` | 进项三状态、销项两状态；下划线状态页签切换；查询回填/草稿/状态下拉/应用/取消重开/重置；chips 单独清状态、全部清空；进项/销项录入及编辑、表单下半区、空填保存禁用；行菜单；危险红冲主按钮悬停、删除确认；空列表、骨架、读取失败 | 无行多选。后台刷新禁编辑由原组件回归验证，GUI 未触发（应用配置关闭窗口聚焦刷新，未改该配置）；未实际认证/抵扣/红冲/保存/删除、未验全部日期与错误组合。[列表](desktop-page-conformance-2026-10-25/states/invoice-list.jpg)、[查询](desktop-page-conformance-2026-10-25/states/invoice-query.jpg)、[表单/菜单](desktop-page-conformance-2026-10-25/states/invoice-forms.jpg) |
| 跨期补录 `/accounting/backfills` | 单表卡与表后计数；空列表、骨架；待审批/已驳回/已作废三种合成行；真实点刷新后按钮禁用 | 无行多选；未打开批准/驳回/撤回危险弹窗、未执行补录、未验原请求恢复或大量虚拟行。[图](desktop-page-conformance-2026-10-25/states/backfills.jpg) |
| 凭证 `/accounting/vouchers` | 已生成/已冲销两行；单卡、唯一“张”汇总；冲销危险确认只打开；空列表、骨架 | 无行多选；本轮未触发手工录入提交禁用、未生成/冲销/删除/过账；对账卡只源码比对保持。[图](desktop-page-conformance-2026-10-25/states/vouchers.jpg) |
| 补货 `/reports/replenishment` | 未选择时生成按钮禁用；真实勾选第 1 行，`data-selected=true`；生成申请弹窗及全部表头测量；空列表、骨架；补修后说明换行/页脚完整可见，表格独立横向滚动 | 只打开生成弹窗，未确认生成。主表和表格列宽不变，本轮未逐列拖动或多仓混选。[图](desktop-page-conformance-2026-10-25/states/replenishment.jpg) |
| 账簿 `/accounting/ledger` | 两科目、分组/合计；点科目打开明细，与主表同屏；空期间、加载；明细 sticky 与计算值 | 只读表，无行选择、危险写入或提交禁用。未验全部科目树/期间、明细超长滚动。[图](desktop-page-conformance-2026-10-25/states/ledger.jpg) |
| 采购计划详情 `/procurement/1` | 两明细、全部勾选及转单计数；未选行转采购禁用；作废危险确认只打开；加载、零明细；全部表头测量 | 这是点名文件 `procurement/detail.tsx` 的**采购计划详情**，不是 `/purchase/:id` 采购订单详情。原行选择不附带 DataTable 选中行底色，未伪造属性。未转单/改量/换供应商/作废。[图](desktop-page-conformance-2026-10-25/states/procurement.jpg) |
| 库存 ABC `/stockcheck/abc` | 未选仓引导与重算禁用；选仓后分档结果正常/空/骨架；规则默认只读、进入/取消编辑；A/B/C 三行；全部表头测量 | 无整行选择；只读/编辑状态查看不等于保存验证。未重算/保存规则/导出、未验全局权限变化和覆盖率子页。[图](desktop-page-conformance-2026-10-25/states/abc.jpg) |
| 运费对账 `/logistics/freight-reconciliation` | 两表各一条，“张”/“单”汇总；滚动后计数可见；缺承运商时生成应付禁用；两表空态与骨架 | 无行选择；无危险行按钮。未录入账单/生成应付/确认付款，未验请求失败后旧数据分支。[图](desktop-page-conformance-2026-10-25/states/freight.jpg) |
| 批次效率 `/reports/wave-performance` | 仓库运营组合页中的批次效率子页；已完成/拣货中两行；滚动后“共 2 个”可见；旋转加载、列表空时“共 0 个” | 无选择/危险写入/提交禁用。空列表夹具保留独立近 30 天统计，非全部统计清零；未验超过 100 行、长期轮询和所有排序组合。[图](desktop-page-conformance-2026-10-25/states/waves.jpg) |
| 塑料盒 `/plastic-boxes` 与详情 | 主列表正常/空/骨架；来源贡献与流水两表改前/改后；混合来源、入库/出库语义状态；两表同时加载/空；零余量还原按钮禁用 | 无行选择；本轮未执行还原/新建/删除/打印，未验长来源、原请求未知结果与恢复分支。[图](desktop-page-conformance-2026-10-25/states/boxes.jpg) |

## 验证结果与后续边界

Node `v22.23.2`。前端 lint、`tsc -p frontend/tsconfig.app.json --noEmit`、`pnpm --dir frontend build --outDir /tmp/flowcube-page-conformance-20261025/dist` 均 exit 0（最终构建 5.59s，仓库 dist 未改）。发票 3 文件 **17/17** 通过：新筛选 5 例 + 原日期/409 恢复 12 例。新功能先观察到 3 个缺失界面的测试失败，再实现至通过；另外两例原动作/权限测试在基线即通过。原恢复测试只迁移入口，不移除断言。随后仅补修补货单一 grid class，已补跑 lint、类型检查和构建；发票产品/测试文件未再修改。

`test:frontend-conventions` 5/5、`test:api-route-contract` 失败 0、`status-rules-integrity` 1/1；文档守卫、最终 lint 与 diff 检查结果见 [checks.json](desktop-page-conformance-2026-10-25/checks.json)。CSS 全文件十六进制字面量 0，原前缀逐字一致；不宣称所有历史 TSX 的颜色字面量已清空。原根 index.css（包括 dark）未改。

没有运行全量前端测试、数据库业务 smoke、全权限岗位矩阵、大数据虚拟列表、长期网络恢复、Electron 原生确认/安装更新、PDA 真机、打印模板渲染或实际出纸。没有验证真实财务/库存写入，不能据合成页面断言业务结果正确。其他 B 类页面按本轮排除项不改；其他紧凑候选仅源码发现：凭证详情 `accounting/vouchers/index.tsx:206`、账簿明细 `accounting/ledger/index.tsx:32`、盘点详情 `stockcheck/components/CheckDetailDialog.tsx:248`、库存预占来源 `inventory/ReservationSnapshotRead.tsx:113`、补货确认 `reports/replenishment.tsx:254`，均未顺带迁移。

浏览器会话 `flowcube-page-conformance-20261025` 已关闭并再次核实 session list 为空；本任务 5201 / 58359 临时服务已停。原 5197 预览及其他任务进程保留。请求审计仅有 GET，没有确认业务写入；收尾证据见 checks.json。
