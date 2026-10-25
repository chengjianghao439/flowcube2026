# 电脑端收尾：页脚、汇总与清理（2026-10-25）

基线 `2f2037ea1e711bc2000946fbc8317b3d3e5b7978`，原分支 `codex/desktop-ibm-style` 追加提交；不 rebase、不合 main、不打 tag、不发版。本轮产品差异为 **19 个 TSX + 1 个 CSS**，均在点名范围。逐文件清单见 [changed-files.txt](desktop-closeout-review-2026-10-25/changed-files.txt)，精确行号见 [diff-ranges.json](desktop-closeout-review-2026-10-25/diff-ranges.json)。提交/推送状态与完整 SHA 由交付回复独立确认。

## 任务一：表单页脚

**采纳**。只调整原表单页脚规则与新增同范围按钮规则（CSS 455–458 行）：`.fc-form-dialog > .fc-dialog-footer` 和 `.fc-form-dialog > form > .fc-dialog-footer` 的 padding 改为 12px 20px、背景为 `hsl(var(--surface-subtle))`，原 flex-shrink 和上边框保留；两种结构内的 `.fc-button` 高度 36px、字号 13px。app-dialog 规则、ConfirmDialog、弹窗头部/正文及组件结构未修改。

动手前解析全部 TSX，找到 **14 处显式 fc-form-dialog DialogContent、14 个页脚**，目标页脚均只有操作按钮，没有左侧附加文字。清单含完整 footer 元素与条件，见 [footer-inventory.json](desktop-closeout-review-2026-10-25/footer-inventory.json)。已先列出两种范围外的特殊结构：KitEditor 的 app-dialog 左侧“复制草稿/重载”按钮（`pages/kits/KitEditor.tsx:157`）、普通发货弹窗的左侧已选计数（`pages/sale/commercial/CommercialShipDialog.tsx:84`）；新选择器都不匹配它们。KitEditor 页脚实测前后不变；发货弹窗本轮仅源码核对，未操作。

| 实际打开的结构 | 背景：改前 → 改后 | padding | 按钮高度 / 字号 | 其他核对 |
| --- | --- | --- | --- | --- |
| 发票录入：直接页脚 | 透明（叠在白色弹窗上）→ `rgb(245,245,247)` | 14px 24px → 12px 20px | 40px / 14px → 36px / 13px | 空填保存仍禁用；上边框一致 |
| 供应商：BaseCrudPage / fc-master-form | 同上 | 同上 | 同上 | 创建仍禁用；上边框一致 |
| 客户：form 内页脚 | 同上 | 同上 | 同上 | 原 submit 类型、条件及布局保持；上边框一致 |
| 发票查询 / 删除确认（对照组） | `rgb(245,245,247)` → 同值 | 12px 20px → 同值 | 36px / 13px → 同值 | 页脚及按钮计算样式逐项一致，危险红保留 |

表单头部计算样式一致，正文 padding/字号/背景/字色一致；页脚变矮后，正文在原 flex 容器内自然获得更多可用空间，没有另改正文规则。完整匹配规则与级联来源见 [footer-cascade.json](desktop-closeout-review-2026-10-25/footer-cascade.json)，计算值见 [footer-comparison.json](desktop-closeout-review-2026-10-25/footer-comparison.json)。[三种表单图](desktop-closeout-review-2026-10-25/states/form-footers.jpg)、[查询/确认对照图](desktop-closeout-review-2026-10-25/states/app-controls.jpg)。

## 任务二：thead 死背景类

**采纳，纠正数量**：标题写“11 处”，逐个文件实际点名 **12 处**，全部处理。只删除指定 thead 的一个 bg 类；sticky、top、文字/对齐/whitespace 等类及全部 th/td 原样保留。12 处均由 ReportTable 承载，标准规则在 th 上提供不透明背景，去掉 thead 的底色不改变 th 的计算样式。

| 文件（相对 frontend/src） | 结果行号 | 仅删除的类 |
| --- | --- | --- |
| `pages/accounting/ledger/index.tsx` | 33 | bg-muted/60 |
| `pages/accounting/vouchers/index.tsx` | 207 | bg-muted/40 |
| `pages/credit-overrides/index.tsx` | 81 | bg-muted/60 |
| `pages/finance/accounts/index.tsx` | 327 | bg-muted/50 |
| `pages/finance/expenses/index.tsx` | 455 | bg-muted/50 |
| `pages/kits/KitEditor.tsx` | 198 | bg-muted |
| `pages/procurement/detail.tsx` | 104 | bg-muted/40 |
| `pages/reports/replenishment.tsx` | 255 | bg-muted/60 |
| `pages/stockcheck/abc.tsx` | 226 | bg-muted/40 |
| `components/shared/payments/ReceiptDetailDialog.tsx` | 72 | bg-muted/50 |
| `components/shared/payments/SettlementConfirmDialog.tsx` | 76 | bg-muted/50 |
| `components/shared/payments/StatementDetailDialog.tsx` | 116 | bg-muted/50 |

三张代表表在修改前后均读取真实 DOM 的**全部 th**，合计 16 格。结果逐格相同：

| 代表表 | 背景：前 → 后 | 字重 | 字号 | 内边距 |
| --- | --- | --- | --- | --- |
| 账簿明细弹窗（6 格） | `rgb(245,245,247)` → 同值 | 600 → 600 | 12px → 12px | 10px 16px → 同值 |
| KitEditor 新建态组成表（6 格） | 同上 → 同上 | 600 → 600 | 12px → 12px | 10px 16px → 同值 |
| 付款核销明细（4 格） | 同上 → 同上 | 600 → 600 | 12px → 12px | 10px 16px → 同值 |

见 [header-comparison.json](desktop-closeout-review-2026-10-25/header-comparison.json)、[类别/原属性清单](desktop-closeout-review-2026-10-25/header-class-cleanup.json) 与 [完整 ReportTable/thead 元素](desktop-closeout-review-2026-10-25/header-source-nodes.json)。账簿 sticky 类保留。KitEditor 为新建空组成态，表头实际位于滚动正文下部，已采 DOM/计算值；图版显示其上半部及左侧页脚对照，不声称拍到了下部表头的可视截图。[代表弹窗图](desktop-closeout-review-2026-10-25/states/headers.jpg)。其余 9 处只做源码/标准规则核对，没有逐个打开对应弹窗。

## 任务三：剩余四页汇总

**采纳**。只新增 ListSummary import、表后组件及其显示条件。审批流/打印机额外读取原 query 的 isSuccess，仅决定新汇总是否显示；原 query 调用、数据、权限、表格 loading 属性与动作不变。

| 页面 / 文件（相对 frontend/src） | 结果行号 | 单位与计数来源 | 实际状态及证据 |
| --- | --- | --- | --- |
| 审批流 `pages/approvals/flows.tsx` | 6、58、200 | 个；`flows.length`，当前成功返回数组 | 启用/停用两流程、“共 2 个”、空列表“共 0 个”、请求延迟时无新计数。原表 `loading={false}`，因此延迟时仍是原空表，未新增骨架。[图](desktop-closeout-review-2026-10-25/states/flows.jpg) |
| 会计期间 `pages/accounting/periods/index.tsx` | 12、126 | 个；`data.length`，原期间数组 | 已结账/未结账两期间、“共 2 个”、骨架、空列表“共 0 个”。没有结账或生成凭证。[图](desktop-closeout-review-2026-10-25/states/periods.jpg) |
| 打印机 `pages/settings/printers/index.tsx` | 35、159、536 | 台；`printers.length`，原打印机数组 | 在线/离线两条、“共 2 台”、骨架、空列表“共 0 台”。浏览器环境不读取本机打印机，未触碰状态开关、登记、删除或设备绑定。[图](desktop-closeout-review-2026-10-25/states/printers.jpg) |
| 平均成本对账 `pages/reports/avg-cost-reconciliation.tsx` | 6、106 | 条；`data.list.length`，当前返回的商品/仓库维度行 | 一致/差异两行、骨架、空列表“共 0 条”。合成样本特意为 list.length=2、totalRows=2、matchedRows=9、truncated=true；页后“共 2 条”，保留原“显示 2 / 9 行”提示，没有把匹配数或差异项数当列表总数。未点校正。[图](desktop-closeout-review-2026-10-25/states/cost.jpg) |

## 任务四：命名与三色

**段控改名采纳；“全局零命中”按产品源码解释。** 发票 `pages/accounting/invoices/index.tsx:235`、条码查询 `pages/settings/barcode-print-query/index.tsx:390` 改用 `fc-segmented-option`；CSS 435–437、481、540 行同步五处选择器，包含 hover、选中、focus-visible、减少动态效果分支。声明值逐字未改，两页按钮的计算样式/aria-pressed 在前后对应状态完全一致；另实际切换销项与出库条码类别。`frontend/src` 全量检索旧打印专名为 0 命中；历史报告和本轮**改前 DOM**记录保留原类名，不篡改旧证据来制造整个仓库的字面零命中。见 [segment-comparison.json](desktop-closeout-review-2026-10-25/segment-comparison.json) 与 [状态图](desktop-closeout-review-2026-10-25/states/segments.jpg)。

**仓库色源回正采纳；选择保留原三条兼容覆盖。** `pages/reports/warehouse-ops.tsx:26、29–30` 只替换 FLOW_COLOR 的三处色字符串：待拣货→`hsl(var(--muted-foreground))`、待复核→`hsl(var(--blue-60))`、待打包→`hsl(var(--blue-80))`。ReportMeter 将 color 写到 meter 元素；现有 CSS 的原生 meter 填充使用 currentColor，因此它控制**条形填充**，不是左右标签/计数字色。左右 p 各自使用 text-helper / text-foreground，前后字色也已比较相同。没有改状态键、数量、max 或绘制分支。

| 流程 | 改前最终色 | 改后最终色 |
| --- | --- | --- |
| 待拣货 | `rgb(110,110,115)` | 相同 |
| 待复核 | `rgb(15,98,254)` | 相同 |
| 待打包 | `rgb(0,45,156)` | 相同 |

保留既有三条 aria-label 映射以缩小 CSS 清理范围，其声明逐字不变；只更新了过时注释（CSS 684–685 行）。这不是依赖覆盖掩盖色源：浏览器临时移除三条规则的 color 声明，三色与两侧字色仍逐项相同，finally 恢复规则。见 [warehouse-colours.json](desktop-closeout-review-2026-10-25/warehouse-colours.json)、[停用覆盖的独立测量](desktop-closeout-review-2026-10-25/warehouse-override-independent.json) 与 [前后图](desktop-closeout-review-2026-10-25/states/warehouse.jpg)。未验证 Firefox 的原生 meter 绘制。

## 验证、交付与边界

[source-audit.json](desktop-closeout-review-2026-10-25/source-audit.json) 对全部 20 个生产文件做反向逐字核对：仅撤销本轮列明的类名/字面量/汇总接入/两处 footer 规则后，文件与基线完全一致。CSS 的段控声明、app-dialog、头部/正文、三条 meter 规则及其他规则未顺带变化。业务函数、数据读取/转换、请求、props 接口、权限和写入处理未修改；新增的成功/加载显示条件只作用于新汇总。不把“新增汇总界面没有任何条件表达式”作为虚假零逻辑声明。

真实页面来自本工作树，回环 5203 / 合成 HTTP 58361，无数据库。实际打开 **12 个路由、40 份画面与 DOM、9 张图版**，修改前完成对应采集，再修改、重开页面采集。图版缩放 75%，原始画面 1280×633；[browser-states.json](desktop-closeout-review-2026-10-25/browser-states.json) 保存完整属性、角色、计算样式、原图 SHA256 与图版位置。[request-audit.json](desktop-closeout-review-2026-10-25/request-audit.json) 中本任务 HTTP 共 198 次 GET、写请求 0；这是合成 transport 的记录，不是生产抓包结论。

Node v22.23.2；前端 lint、`tsc -p frontend/tsconfig.app.json --noEmit`、`pnpm --dir frontend build --outDir /tmp/flowcube-desktop-closeout-20261025/dist` 均 exit 0，构建 5.92s。`test:chart-series-limit` 5/5、`test:frontend-conventions` 5/5。文档守卫、最终 diff/JSON/证据核对结果见 [checks.json](desktop-closeout-review-2026-10-25/checks.json)。没有为只读样式值编写镜像实现的测试，没有运行或挪用上一轮业务回归数字。

未覆盖：其余 9 个表头弹窗的逐页 GUI、其余表单页脚的特殊业务状态、保存中/失败/未知结果、全部权限角色、截断/大列表与长期轮询、真实业务写入、PDA 真机、Electron 原生对话框/打印机发现和实际出纸。官网、PDA、TemplateRenderer、后端及版本文件未改。本轮未测试实际打印、登记/核销、结账、审批配置保存、成本校正或配件保存。

命名浏览器会话 `flowcube-desktop-closeout-20261025` 已关闭，后续 session list 确认无本会话；本任务 5203/58361 服务已停。原 5197 预览和其他任务进程保留。推送后停止，等待复核。
