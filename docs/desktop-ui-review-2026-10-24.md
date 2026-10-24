# 电脑端逐页检查与组件统一（2026-10-24）

本轮在本地分支 `codex/desktop-page-samples` 的现有视觉改动上继续；代码未提交、未推送、未部署。实际逐入口打开 **103 条工作区路由定义**（81 条固定地址含 3 条本人结果核对入口，22 条模式路由），并核对 90 个对应页面源文件的结构与共用组件引用。模式路由使用合成单据；往来明细额外检查了客户和供应商两类。另检查登录、403、无可用页面三个壳层入口。

## 实现与边界

- `TableColumnHeader` 继续作为统一表头；`ReportTable` 的普通单行表头复用现有列宽拖动、键盘微调、双击适应和宽度记忆，保留原排序按钮、输入、真实复选框、行和合计。跨行/跨列报表保留原分组结构与样式统一，不机械拆散会计表头。
- 采购、库存、销售分配弹窗、塑料盒、盘点规则、商业组件、操作记录、变更对照和结算核对等原生桌面表接入共享表格。日历与打印画布不套业务表皮肤。
- 采购申请、调拨、采购退货、销售退货及普通销售录入按组合“商品”列显示编码、名称、型号、颜色、供应商型号，保留数量、价格、单位、仓库和原单来源。主数据与分析列保留独立字段以便比较。
- 采购申请接口已返回颜色和供应商型号，但原前端类型与详情回填遗漏；补齐已有显示字段，不修改 API、提交载荷或取价。
- 已完成或不可转换的采购计划不再保留空白选择列；可转换草稿保留全选和逐行复选框。
- 来源报废草稿和三个结果核对页统一页头/按钮。非法来源仍按原规则拒绝，不挂表单、不触发创建。
- 仪表盘报错来自外部预览服务的错误回包：`/reports/warehouse-ops` 缺 `summary.shippedToday`，履约事项缺 `summary.mine`；已按当前接口补齐合成数据。财务、权限、部门、打印等其他演示回包也按各自真实 DTO 补齐。未用前端兜底零值遮盖接口问题。
- Logo、官网主标题、业务规则、权限配置及 PDA 源码未改。`/settings/pda-devices` 与 PDA 异常分析属于电脑端管理/报表入口，已查看；PDA 应用页面未纳入此次精修。

## 浏览器证据与限制

- 实际代码来自当前工作区，主预览 `http://127.0.0.1:5197/`；界面带演示标识，外部 API 仅使用合成数据，不连接真实业务库。登录页在独立回环访客预览检查，临时服务已关闭。
- 默认视口 1470px；检查整页是否横向溢出、可见表头、空态、标题和控件。并不代表所有弹窗、所有单据状态、角色组合、大数据或业务写入已全量验收。没有以空态声称对应明细字段已通过。
- 本轮工作区快照的可见表头计算样式：[('12px', '10px 16px', 'rgb(250, 250, 250)')]。只读采购计划 21 列无空白首列，草稿 22 列含真实选择列。
- 真实 GUI 选择一行后，把编码列从 160px 键盘调整到 170px，采购量仍为 80、选择状态仍在；随后取消该选择。新旧表格的来源、数量、金额与状态逻辑未改。
- 请求日志本轮非 GET 数量：0。未提交业务保存、转单、审批、库存、财务或权限写入。
- 逐页快照、计算样式、检查台账与临时接口契约保存在 `/tmp/flowcube-desktop-samples-preview/`：`all-page-results.json`、`all-desktop-routes.json`、`all-pages/`。临时文件用于本机复核，系统清理后可能失效。

## 自动检查

- 前端全量单测：405 文件 / 3720 用例通过。
- `ReportTable` 键盘改宽、原排序、输入与合计保留，表格说明与行标题语义保留、采购申请完整身份回填、只读采购计划空列均做了失败后修复回归。
- lint、`tsconfig.app.json` 类型检查、构建、前端约定与文档守卫：本批末核验结果见下方验收补记。
- 真实后端/数据库业务回归、生产发布、PDA 真机与实际打印：本轮未执行。

## 全部工作区入口台账

| 地址 / 模式样例 | 页面标题 | 检查结果 |
| --- | --- | --- |
| `/dashboard` | 仪表盘 | 已打开；含空态或数据门槛 |
| `/sale/new-kit` | 新建销售单 | 已打开；含空态或数据门槛 |
| `/purchase` | 采购订单 | 已打开；含空态或数据门槛 |
| `/purchase-requisitions` | 采购申请 | 已打开；含空态或数据门槛 |
| `/procurement` | 采购建议 | 已打开；含空态或数据门槛 |
| `/inbound-tasks` | 收货订单 | 已打开；列表含合成行 |
| `/returns/purchase` | 采购退货 | 已打开；含空态或数据门槛 |
| `/suppliers` | 供应商管理 | 已打开；列表含合成行 |
| `/sale` | 销售订单 | 已打开；列表含合成行 |
| `/returns/sale` | 销售退货 | 已打开；含空态或数据门槛 |
| `/credit-overrides` | 超额放行申请 | 已打开；含空态或数据门槛 |
| `/logistics` | 物流运单 | 已打开；含空态或数据门槛 |
| `/customers` | 客户管理 | 已打开；列表含合成行 |
| `/portal/statements` | 客户对账单查询 | 已打开；含空态或数据门槛 |
| `/carriers` | 承运商管理 | 已打开；含空态或数据门槛 |
| `/carrier-accounts` | 快递账号绑定 | 已打开；含空态或数据门槛 |
| `/inventory` | 库存管理 | 已打开；列表含合成行 |
| `/plastic-boxes` | 塑料盒管理 | 已打开；含空态或数据门槛 |
| `/inventory/trace` | 批次追溯 | 已打开；含空态或数据门槛 |
| `/stockcheck` | 库存盘点 | 已打开；含空态或数据门槛 |
| `/stockcheck/abc` | 分档与盘点规则 | 已打开；含空态或数据门槛 |
| `/disposals/new` | 来源报废草稿 | 无来源时按原规则拒绝；另补查 handlingSourceId=801 草稿 |
| `/disposals` | 滞销库存处理 | 已打开；含空态或数据门槛 |
| `/transfer` | 库存调拨 | 已打开；含空态或数据门槛 |
| `/products` | 商品管理 | 已打开；列表含合成行 |
| `/kits` | 成套配件 | 已打开；含空态或数据门槛 |
| `/categories` | 商品分类 | 已打开；含空态或数据门槛 |
| `/price-change` | 商品改价申请 | 已打开；含空态或数据门槛 |
| `/warehouse-shipping` | 仓库发货 | 已打开；含空态或数据门槛 |
| `/picking-waves` | 批次拣货 | 已打开；列表含合成行 |
| `/warehouses` | 仓库管理 | 已打开；列表含合成行 |
| `/locations` | 库位管理 | 已打开；含空态或数据门槛 |
| `/racks` | 货架管理 | 已打开；含空态或数据门槛 |
| `/sorting-bins` | 分拣格管理 | 已打开；含空态或数据门槛 |
| `/payments/payable` | 供应商往来 | 已打开；含空态或数据门槛 |
| `/payments/receivable` | 客户往来 | 已打开；含空态或数据门槛 |
| `/reports/reconciliation/payable` | 供应商往来 | 已打开；含空态或数据门槛 |
| `/reports/reconciliation/receivable` | 客户往来 | 已打开；含空态或数据门槛 |
| `/logistics/freight-reconciliation` | 运费对账 | 已打开；含空态或数据门槛 |
| `/finance/dashboard` | 资金工作区 | 已打开；含空态或数据门槛 |
| `/finance/accounts` | 资金工作区 | 已打开；含空态或数据门槛 |
| `/finance/transactions` | 资金工作区 | 已打开；含空态或数据门槛 |
| `/finance/expenses` | 费用报销 | 已打开；含空态或数据门槛 |
| `/finance/expense-categories` | 费用类别 | 已打开；含空态或数据门槛 |
| `/accounting/accounts` | 会计科目表 | 已打开；含空态或数据门槛 |
| `/accounting/vouchers` | 记账凭证 | 已打开；含空态或数据门槛 |
| `/accounting/ledger` | 总账与试算平衡 | 已打开；含空态或数据门槛 |
| `/accounting/reports` | 会计报表 | 已打开；含空态或数据门槛 |
| `/accounting/invoices` | 发票管理 | 已打开；含空态或数据门槛 |
| `/supplier-refunds` | 供应商退款 | 已打开；含空态或数据门槛 |
| `/supplier-refunds/new` | 供应商退款 | 无来源时按原规则拒绝；另补查 purchaseReturnId=701 草稿 |
| `/refunds` | 退货退款单 | 已打开；含空态或数据门槛 |
| `/accounting/periods` | 会计期间与结转 | 已打开；含空态或数据门槛 |
| `/accounting/fixed-assets` | 固定资产 | 已打开；含空态或数据门槛 |
| `/accounting/consolidation` | 合并报表与账套 | 已打开；含空态或数据门槛 |
| `/accounting/tax` | 报税数据 | 已打开；含空态或数据门槛 |
| `/accounting/backfills` | 跨期补录审批 | 已打开；含空态或数据门槛 |
| `/reports` | 报表中心 | 已打开；含空态或数据门槛 |
| `/reports/profit-analysis` | 报表中心 | 已打开；含空态或数据门槛 |
| `/reports/avg-cost-reconciliation` | 成本对账 | 已打开；含空态或数据门槛 |
| `/reports/kpi` | 报表中心 | 已打开；含空态或数据门槛 |
| `/reports/replenishment` | 采购建议 | 已打开；含空态或数据门槛 |
| `/reports/inventory-aging` | 存放时长与滞销 | 已打开；含空态或数据门槛 |
| `/reports/warehouse-ops` | 仓库运营 | 已打开；含空态或数据门槛 |
| `/reports/wave-performance` | 仓库运营 | 已打开；含空态或数据门槛 |
| `/reports/pda-anomaly` | 仓库运营 | 已打开；含空态或数据门槛 |
| `/reports/role-workbench` | 待办中心 | 已打开；含空态或数据门槛 |
| `/settings/print-templates` | 打印模板 | 已打开；含空态或数据门槛 |
| `/settings/printers` | 打印机管理 | 已打开；含空态或数据门槛 |
| `/settings/barcode-print-query` | 条码打印查询 | 已打开；含空态或数据门槛 |
| `/approvals/pending` | 待我审批 | 已打开；含空态或数据门槛 |
| `/approvals/flows` | 审批流配置 | 已打开；含空态或数据门槛 |
| `/departments` | 部门管理 | 已打开；含空态或数据门槛 |
| `/users` | 用户管理 | 已打开；含空态或数据门槛 |
| `/permissions` | 权限管理 | 已打开；含空态或数据门槛 |
| `/settings/pda-devices` | PDA 设备 | 已打开；含空态或数据门槛 |
| `/settings` | 系统设置 | 已打开；含空态或数据门槛 |
| `/oplogs` | 操作日志 | 已打开；含空态或数据门槛 |
| `/logistics/1` | 运单 YD202610230001 | 已打开；含空态或数据门槛 |
| `/products/new` | 新增商品 | 已打开；含空态或数据门槛 |
| `/products/11` | 编辑商品 | 已打开；含空态或数据门槛 |
| `/payments/ledger/customer/1` | 客户往来明细 · 示例往来单位 | 已打开；含空态或数据门槛 |
| `/sale/new` | 新建销售单 | 已打开；含空态或数据门槛 |
| `/sale/1` | XS202610230016 | 已打开；列表含合成行 |
| `/purchase/new` | 新建采购单 | 已打开；含空态或数据门槛 |
| `/purchase/101` | CG202610230008 | 已打开；列表含合成行 |
| `/procurement/1` | 采购计划 JH202610230001 | 已打开；列表含合成行 |
| `/purchase-requisitions/new` | 新建采购申请单 | 已打开；含空态或数据门槛 |
| `/purchase-requisitions/301` | 采购申请单 QG202610230001 | 已打开；列表含合成行 |
| `/transfer/new` | 新建调拨单 | 已打开；含空态或数据门槛 |
| `/transfer/501` | DB202610230001 | 已打开；列表含合成行 |
| `/returns/purchase/new` | 新建采购退货单 | 已打开；含空态或数据门槛 |
| `/returns/purchase/701` | CT202610230001 | 已打开；列表含合成行 |
| `/returns/sale/new` | 新建销售退货单 | 已打开；含空态或数据门槛 |
| `/returns/sale/702` | XT202610230001 | 已打开；列表含合成行 |
| `/inbound-tasks/new` | 新建收货订单 | 已打开；含空态或数据门槛 |
| `/inbound-tasks/401/edit` | 编辑 RK202610230401 | 已打开；列表含合成行 |
| `/inbound-tasks/402` | RK202610230402 | 已打开；列表含合成行 |
| `/settings/print-templates/new` | 新建打印模板 | 已打开；含空态或数据门槛 |
| `/settings/print-templates/901` | 编辑打印模板 #901 | 已打开；含空态或数据门槛 |
| `/supplier-refunds/recovery` | 退款结果核对 | 已打开；当前本人没有待核对请求 |
| `/disposals/recovery` | 报废结果核对 | 已打开；当前本人没有待核对请求 |
| `/sale/create-recovery` | 开单结果核对 | 已打开；当前本人没有待核对请求 |

## 额外入口与状态

| 地址 | 结果 |
| --- | --- |
| `/login` | 独立访客预览，账号/密码/显示密码/登录按钮及帮助区域可见；未提交登录 |
| `/403` | 无访问权限提示与返回入口可见 |
| `/no-access` | 无可用页面提示与退出入口可见；未修改角色权限 |
| `/payments/ledger/supplier/1` | 供应商往来明细可见，表头为增加/减少应付 |
| `/procurement/2` | 已完成合成计划无空白选择列，分列数据与 21 个列宽把手对齐 |
| `/disposals/new?handlingSourceId=801` | 带准确来源的草稿可见，未提交 |
| `/supplier-refunds/new?purchaseReturnId=701` | 带准确采购退货来源的退款草稿可见，未提交 |

## 本批最终验收补记

- 等待当前可见表格退出加载状态后，再次逐一复查全部 103 条工作区路由：未发现页面崩溃或文档整体横向溢出；每条结果保存在 `final-page-results.json`。无准确来源的两个新建地址仍显示原有拒绝提示，并已另查带来源参数的正常草稿。
- 仪表盘“展示全部卡片”实际滚动到底部：43 个卡片、8 个图表，未发现错误提示或加载占位；随后取消预览编辑，未保存布局。
- `npm run lint` 无错误或警告；指定 `tsconfig.app.json` 的类型检查退出 0；桌面前端构建退出 0；前端约定 5 项通过；AGENTS 文档/引用守卫通过；`git diff --check` 通过。
- 浏览器测试标签和访客临时服务已关闭，原有用户浏览器标签未关闭；保留一个全宽仪表盘展示标签与原有工作区入口。5197 预览服务继续供用户查看。

## 连续精修：控件、空态和日期交互

先重读两个原始HTML附件、已确认样板与推广记录，继续使用灰白材质、深蓝强调和紧凑排版；Logo、官网H1及业务配置保留。本轮围绕实际状态做三轮检查与修正，不重复把此前103条路由检查算成本轮逐页验收。

1. 查询控件：发现文本/日期框为36px，下拉和选择框却被 `min-h-10` 撑到40px。ERP中显式紧凑尺寸现在一致，文本、日期、下拉和选择字段共享焦点光晕；保留危险色校验与禁用语义。
2. 表格明细：普通行的统一padding原先覆盖了跨列空态，现只覆盖普通单元格，空态与跨列合计保留自身留白。可编辑表格单行字段统一32px，长供应商名称仍自动增高。临时合成采购申请加入长商品名称、连续型号和长供应商名称，1470及1024宽度均无整页溢出，选择字段无横向截断；检查后已还原外部合成夹具，未保存单据。
3. 日期交互：原有圆形日期CSS使用了已被自定义 `classNames` 替换的DayPicker默认类名，未实际生效。改为稳定样式节点，紧凑展示完整六周，保留矮窗口内部滚动和底部工具。进一步复现日期输入的可访问名称在日历展开后混入月份内容；为13类电脑端业务查询及共用资金/日期查询提供固定名称，值、范围、清除/今天和回焦逻辑不变。新增专项在旧实现下1失败/3通过，修复后4通过。

GUI复核销售、采购、退款、批次查询和供应商往来查询；销售/采购/退款/批次中的单行查询字段均36px，未见整页溢出。系统设置切换编辑并检查输入焦点后取消，没有保存配置。采购申请空白草稿点保存仍提示「请选择期望入库仓」，未发起业务写入。嵌套销售查询中，第一次Escape关闭日历、保留日期及输入焦点，第二次关闭查询并返回原查询按钮。长文本、设置、必填提示、查询及日历截图以 `refine-*.png` 保存于原仓库外预览目录。

本轮集中检查：前端405文件/3721用例通过，lint无错误或警告，`tsconfig.app.json`类型检查通过，ERP构建通过（仓库外输出）。新增测试曾误用浏览器locator的 `exact` 参数，类型检查指出后已移除；随后重跑类型和日期专项。代码未触碰后端、PDA业务、Logo或官网H1；当前仅本地未提交改动，仍未连接真实业务库、提交、推送或发布。API失败重试、真实角色、大数据、生产和PDA真机不属于本轮新增验收证据。

第四轮仪表盘：最终全宽检查发现「待处理与关注」在少量事项时仍占380px，四项指标被挤到首屏下方。该摘要卡现在共用260px展示/编辑高度，原内部滚动、图表高度和其他组件高度保留，未改变保存的顺序、宽度或显隐。GUI实测1470×656下四项指标位于top472.8至bottom632.8，可完整阅读；进入编辑实测同为260px，随后取消，未保存布局。此后补跑仪表盘相关组件回归、相关lint、类型及构建；前端约定5项与文档引用守卫均通过。最终画面为 `refine-dashboard-final.png`，本轮临时浏览器标签已关闭，原有8个应用工作区入口及用户3个浏览器标签保留。

## 图标与信息层级：连续方案迭代

用户要求继续自主优化，重点改进图标与组件。本批沿原分支保留此前全部未提交工作，持续实施、查看页面并依据新发现调整方案；没有改Logo、官网H1、业务请求、数量金额规则、权限或PDA业务。

- **图标及控件**：沿现有Lucide使用1.75线宽，统一搜索/前往图标并修正收货地址的位置图标。普通仪表盘图标减轻彩色底座，警告/危险/accent语义保留；状态标签、辅助字段文字与共用空态统一密度。新增 `IconButton` 使用Radix Tooltip，通知入口与有界仪表盘工具接入；大数据行操作保留原惰性菜单。最初试装1.4.1时发现其依赖新FocusScope接口，与仓库既有单例栈不匹配，最终固定兼容的1.2.8；锁文件仅新增Tooltip及其局部Slot，共53行，没有更新既有依赖条目。
- **根据真实画面再调整**：初次编辑页截图显示操作按钮覆盖标题、状态与指标图标，改为单独36px工具栏。进一步检查43张卡片时发现Top客户/供应商、到货等仍有大块固定空白，遂将内容自适应推广到12类列表卡片，取代此前仅待办固定260px的方案；图表及非列表内容尺寸维持原值。短列表实测168—198px，较长列表达340px后内部滚动，编辑工具不覆盖业务内容。
- **表单及交互**：字符计数平时安静显示，在焦点或原80%长度阈值时出现；25/30失焦后仍显示警告色，清空回到原值。保留计数空间与自动增高，避免焦点引起地址重新换行。GUI又发现嵌套选择器初始焦点落到关闭按钮，新增资料/商品两例自然失败后，在Radix打开阶段显式聚焦搜索，关闭仍返回原字段；独立与嵌套、禁用读取及已有确认守卫回归保留。

GUI证据：

- 展开全部43张仪表盘卡片与8张图表，滚动抽查列表、财务图表及系统版本；DOM几何检查无页面错误提示或整页溢出，工具栏未与卡片内容重叠。此证据不覆盖每个个人工具的写入、计时或声音功能。预览编辑全部取消，未保存布局。
- 合成待办临时扩展到6条长内容，在1列宽卡片内body为768px、可见227px；滚动到541px后第6条可见。1024窗口下工具按钮完整、无重叠或整页溢出。临时夹具已还原，窗口覆盖已重置。
- 查看销售列表/表单、采购、库存4行、退款空态和设置页：采购、库存与退款表头均12px、背景rgb(250,250,250)，未见整页溢出。销售表单的临时25字收货人已清回原空值，未保存。通知Popover与Tooltip组合可打开，Escape返回原入口。
- 从销售查询打开客户与商品选择器后，真实焦点均在搜索输入；客户可直接输入DEMO，取消回到客户字段，再取消查询。合成接口未用于证明真实后端筛选或业务写入。
- 截图与日志仍在仓库外预览目录，前缀 `icons-`；旧的103路由台账保持为此前轮次证据，不把它计作本批重新逐一验收。

最终检查：前端406文件/3727用例通过，lint、`tsconfig.app.json`类型检查、ERP构建通过。新增嵌套测试夹具补齐父窗受控属性后，另复跑4例及该文件lint通过；产品源码未再改。IconButton基础键盘测试、通知角标组合与嵌套资料/商品焦点均有自然失败后修复记录。前端约定、文档引用守卫与diff检查的最终结果见 `icons-final-*` 日志。

临时待办夹具、收货人输入、仪表盘宽度预览与视口覆盖均还原。本轮仅复用同一Chrome会话和一个QA标签；QA已关闭，保留原展示标签、3个用户浏览器标签及原8个应用工作区入口。未创建agent-browser隐藏会话。5197合成预览继续运行，未提交、推送、部署或操作真实业务库；后端与PDA业务路径无diff。

## 图表与报表组件：连续精修

本批覆盖仪表盘8张图、资金看板3张图、经营指标1张图、业务统计3处图形，共15处；保留现有Recharts，参考shadcn/ui组合方式实现共用呈现组件，没有新增绘图库依赖。此前所有未提交改动均保留。

- `ChartPresentation` 统一提示框、图例和环图外部数值图例；`chartTheme` 集中分类色、网格和游标。柱形宽度有界，横向柱形圆角朝右；折线数据点与序列同色，面积填充减轻，时间轴两端留出完整月份的位置。原formatter、单位、零/负值、完整名称、错误/空态与前8项加其他的规则保留。
- 资金看板账户名称及余额放在SVG外，长名称换行不压缩圆环，相邻图卡按自身高度呈现。费用占比条收敛到较细的圆角轨道。采购/销售业务统计原手写AmountBar替换为共用MonthlyAmountChart，每月的完整金额与单数直接显示；统一money格式保留分与千分位，月份不截断，多月在图内滚动。查询、日期与数据口径未变。
- 实际切换页面发现隐藏图表仍测量零尺寸。新增ChartContainer，所有15处图形沿SectionVisibilityContext挂载/卸载，筛选与缓存留在原父组件；专门测试先自然失败，再加可见性守卫通过。键盘焦点与鼠标均离开后隐藏残留提示，保留鼠标悬停或键盘查看状态。

实际GUI证据来自5197合成预览，不代表真实账款或后端验收：

- 仪表盘展开43张卡片，8张图均已挂载并滚动查看；销售指标切换到订单数，键盘提示为“2026-07 / 订单数 / 7 单”，未误加货币符号。预览编辑已取消，未保存布局。
- 资金看板、经营指标和业务统计的采购/销售子页均实看；价格趋势选择演示商品，键盘提示为“2026-06 / 均价 / ¥5.35”。发现右端月份文字越出图框约3px，补足轴内边距后2026-10完整落在图框内。
- 临时12个合成账户合并为9项，其中“其他4个账户”为15,000元；约50字的账户名称在1024px下换行至57px高，图例与页面无横向溢出。负现金流及负毛利曲线、金额和订单数单位均已查看。这些临时账户、KPI和价格序列已还原；另据后端DTO修正原合成单账户share误写100的问题，恢复为比例1，不改应用代码或真实数据。
- 可见性修复后，采购子页2张图、销售子页1张图、资金页3张图；隐藏图形数均为0。该切换窗口没有新增零尺寸警告。1024px和1470px宽度均无整页溢出，视口覆盖已清除。环图外部余额明细可直接阅读；没有把本次键盘抽查扩写成全库无障碍验收。

验证：最终前端单测408文件/3734用例通过；可见性修复专项5文件/26用例通过；lint、tsconfig.app.json类型检查、ERP构建、前端呈现约定5项及图表系列守卫5项通过。临时Web构建入口被项目配置拒绝后，改用正确VITE_ELECTRON=1入口完成构建；构建输出留在仓库外。日志与截图在 `/tmp/flowcube-desktop-samples-preview/charts-*`。本次没有重新逐一验收旧台账的103条路由，也没有跑真实API、数据库、PDA或生产验收。

资源收尾：本轮QA标签已关闭，原展示标签里的未保存仪表盘编辑选择继续保留，没有丢弃；另保留一个资金看板结果标签及3个原用户标签。未创建隐藏agent-browser会话，未保存仪表盘布局，5197演示服务继续运行。没有提交、推送、部署或修改后端/PDA业务路径。

## 低频电脑端页面：29个入口复核与13类页面精修

本批继续沿现有工作区，保留此前全部未提交改动。精修范围为科目树、合并报表与账套、会计期间、报税数据、发票、固定资产、审批流配置、操作日志、打印机、打印模板、条码打印查询、桌面PDA设备管理、快递账号绑定，共13类页面及其共用组件；没有改后端、权限表、业务公式、保存/提交条件、官网Logo/H1或PDA作业端。

- 共用ContextNotice收敛已有业务说明；打印设备Emoji与文字加号替换为Lucide，打印分类和绑定用途提供选中语义，设备别名、搜索、资产录入字段有明确名称。快递账号空态复用EmptyState，新增表单动作沿取消在前、保存在后的层级。没有点击实际绑定、登记、出纸或保存。
- 合并报表分区复用ReportPanel标题/合计，报税分区改为白色材质与对齐金额，保留原会计与金额表达式。日志详情10项完整字段改为平铺dl，长请求体内部滚动后标题/关闭仍可见；实际关闭回到原行“详情”按钮。
- 科目树的原展开按钮tabIndex=-1，键盘无法到达；新回归先自然失败，随后补齐可聚焦按钮、科目名称和aria-expanded，叶节点去掉无效按钮。行内动作在焦点进入时可见，下级以细中性树线呈现。只读角色的回归能展开下级且修改调用为0；实际GUI以Enter展开1002，显示两条下级，焦点保留在展开按钮。
- 审批级次平铺呈现；审批、发票与固定资产弹窗固定头尾，正文滚动。初次使用fieldset直接滚动时发现末尾复选框越界，改由普通div承载滚动，原disabled fieldset与草稿守卫保持。1024×600下审批弹窗在y=16—584，正文滚动187px、footer为y=514—583，复选框位于正文内；发票正文438px、完整内容566px，footer同样完整可见。表单均取消，未修改配置。

实际页面复核的29个有效入口、标题、行数、抽查表头和错误/溢出结果存于仓库外 `rare-final-review.json`：会计9页、打印/桌面设备4页、日志、审批流、快递账号、权限/部门/用户/承运商、仓库/库位/货架/分拣格、滞销处理、改价、超额放行、费用类别与采购建议。该台账包含空态；它不证明每页的全部弹窗、全部角色或真实业务写入都已验收。1470px下29入口无可见错误告警或整页溢出；普通表头抽查为12px、rgb(250,250,250)，分组财务表头保留原结构。打印三类切换经鼠标及Enter验证，始终只有当前分类aria-pressed=true。

验收临时补充日志、打印机、桌面设备、审批流、合并报表两种DTO、科目树，共7类合成读取样例，已还原。另按本地后端原判平表达式订正演示零值合并报表及试算平衡的错误布尔标志；没有改前端判平逻辑或真实账款。全部数据来自5197合成预览，不是后台、真机、打印或生产证据。

验证：最终前端409文件/3735用例通过；相关专项13文件/93用例通过；lint、tsconfig.app.json类型检查、ERP构建、前端呈现约定5项、文档引用守卫及diff检查通过。减少动态效果的CSS收尾后重跑ERP构建。日志/截图均在 `/tmp/flowcube-desktop-samples-preview/rare-*`，构建产物在仓库外，没有提交、推送或部署。

资源与状态：复用一个QA标签逐页检查；达到项目既有30标签上限后按原顺序恢复9个原工作区入口，再保留条码查询结果入口。临时QA已关闭并释放29页的验收缓存，另开干净的结果展示标签；原仪表盘43卡片编辑状态与3个用户浏览器标签均保留，没有保存或丢弃原编辑。视口覆盖已清除，当前1470px。未创建agent-browser隐藏会话，5197预览服务继续运行。

## 列表顶部与空态：减少重复面板

本轮以条码打印查询为样板，扩展打印机、打印模板、会计期间与电脑端设备管理，共5类页面。条码分类由三张大卡片收敛为紧凑按钮组，查询与恢复入口放在同一工具栏，当前类别说明、原来源范围和筛选摘要位于表头上方；出纸核对说明完整常显。打印上下文统计平铺，消除嵌套卡片，原计数/动作/权限不变。1470px窗口下表头由约447px上移至333.5px，约节省110px；没有改变全系统页面标题、Logo、官网H1或个人配置。

同时复现两种误导性空态：首次读取失败仍显示“暂无数据/共0条”；恢复模式尚无条件也显示普通空列表及“最新打印记录尚待核对”。新增两项真实页面组件回归先自然失败，再区分读取失败、暂停、恢复待查询、无结果和真实零记录；重试仍使用原读取API，不发补打请求。恢复空态可打开原查询，应用条件后原入口消失，故另验证初始输入焦点及关闭回到工具栏查询按钮；旧实现焦点在关闭按钮的自然失败已记录。QueryDialog的未应用草稿、隐藏/激活、权限及未知补打结果的原回归保持。

实际GUI来自5197合成预览：

- 5类页面逐一查看，普通表头抽查均12px、rgb(250,250,250)，没有可见错误或整页横向溢出；说明完整保留。打印模板按既有权限给出空态提示，打印机不执行登记/关联/绑定，设备管理不登记或改密钥，会计期间不执行结账。
- 条码恢复查询输入DEMO-BOX-001并应用，筛选摘要和无结果解释正确；清空后返回打印历史。实际查询打开焦点在关键字输入，取消返回“查询”按钮。
- 临时256条合成读取记录含长商品名称、成功/失败/超时/未配置任务及作废条码，在1470和1024×600下检查；表内横滚范围982/1320px，键盘进入右侧操作后scrollLeft=338px，页面无横向溢出。全部256条已加载，初始挂载10条数据行，滚动末端挂载239—255索引共17条，最后DEMO-BOX-0256保留。普通列与操作列同表头样式，未点击补打或业务导航。
- 临时条码夹具已还原，视口覆盖清除；截图与日志使用仓库外`hierarchy-*`前缀。本轮没有重验此前103路由或全部角色、真实业务API、PDA、打印设备和生产。

检查：前端全量410文件/3737用例通过，条码及表格专项6文件/52用例通过。类型检查曾指出新增测试混用了浏览器locator的exact选项，已按Testing Library类型移除；后续结果和浏览器资源收尾见本节后续记录。

收尾检查：lint无错误或警告，指定tsconfig.app.json的类型检查通过，ERP构建完成且输出在仓库外；测试参数修正后补跑新增两例通过。最后将工具栏查询与设备搜索归到既有36px字段基线并补跑构建。前端呈现约定5项、文档引用守卫及git diff --check通过。条码类别经Enter切到物流再返回入库，始终单选。最终结果截图为`hierarchy-final-overview.png`，审阅样本为前述5页，没有扩大成全系统全部状态通过。

临时QA浏览器标签已关闭，4个本轮新增的应用入口已关闭，原10个工作区入口与顺序保留。原仪表盘43卡片仍处于未保存编辑状态，没有保存、取消或刷新；另保留原资金看板及条码结果展示页、3个用户浏览器标签。未创建agent-browser隐藏会话，合成预览服务继续运行；本轮无真实业务提交，未提交代码、推送或部署，后端/PDA作业/Android路径无diff。

## 运营小图表与长申请详情

本轮实看仓库运营、批次效率、电脑端PDA异常分析、分档与盘点规则、商品改价申请、超额放行申请，共6类页面。改动集中于呈现组件、控件名称和布局，没有修改数据API、金额/数量公式、权限、轮询、审批或保存协议，PDA作业端无改动。

- 两处手工柱形替换为现有Recharts组合CompactColumnChart：刻度来自原数据，提示/主题/隐藏挂载沿既有共用实现，保留完整时段、次数与零值。旧小时图有写死06/14/22刻度，旧每日错误柱及流程条给零值补了最小色块，现按真实零值呈现，不改变业务数字。屏幕阅读器可读取完整数据表。仓库运营6项指标在宽窗一行、中等窗口三列，错误与撤销按原accent条件分别使用危险/警告tone。
- 四类比例条改为原生ReportMeter：流程瓶颈、异常分布、批次效率与ABC按期盘点率。精确值及单位保留；95/60/20%三档实际颜色为绿/黄/红。ABC动态bg-${tone}依赖移除，原80/50阈值保留。分档视图沿按钮组呈现选中状态，避免与主操作蓝色按钮混用；字段补全名称，新增回归先自然失败，再通过。原草稿保留、保存回执与全局权限专项通过。
- 改价/超额详情固定标题，页签随正文顶部保持可见；事实清单减少嵌套边框，长原因独占完整行，保留全部文字。1024×600下改价详情header top31、tab top90，正文高479px/完整925px，滚动368px后标题与页签仍可见；End切到操作记录、关闭回到原“详情 / 记录”。超额详情10项字段、正文479px/完整1038px。两类创建窗固定头尾，矮窗口取消/创建完整可见，未填写或提交。

GUI图表：1470及1024×600下没有整页横向溢出；键盘显示“06:00 / 扫码次数 / 0次”“07:00 / 18次”“2026-10-19 / 错误次数 / 2次”。批次效率0.0/2.5/8.0件/分均保留；异常长操作员名称与原因分别换行到40/60px，未横向截断。组合页切换后仅活动页保留1张图，无隐藏图形残留。组合页标题按已有分组为“仓库运营”，不把子页源标题与组合标题差异当成路由缺陷。

本轮临时补充8类合成读取样例，业务样例已按原值还原。原预览缺失ABC、盘点覆盖与循环规则三个DTO，通用分页对象不符合实际接口类型；仅在外部预览补齐空数组及后端现有30/90/365天、200条/批的全局兜底DTO，不在前端或数据库造规则，不声称已读到真实配置。截图与日志使用仓库外`refine2-*`前缀，不是后台/真机/出纸/生产证据。

验证：前端410文件/3738用例通过；相关专项5文件/26用例通过；lint、指定tsconfig.app.json的类型检查、ERP构建通过，产物位于仓库外。新增规则字段名称回归有自然红绿记录；本轮没有重新逐一验收103路由、全部角色、后台API或真实业务写入。

最后按原accent条件细化指标颜色：未触发强调的零错误、零撤销图标保持中性，达到原条件时才用危险/警告tone；补跑报表状态6例、受影响lint、类型及ERP构建通过。前端呈现约定5项、图表系列守卫5项、文档引用守卫及diff检查通过。最终结果截图`refine2-final-overview.png`使用1470×900桌面视口，捕获后已清除覆盖；窄窗证据仍为1024×600。

资源收尾：本轮QA标签和4个新增验收入口均已关闭，原10入口保留，在已有结果浏览器标签增加作业概况入口（现在11个应用工作区入口），没有新留一个结果浏览器。原仪表盘43卡片仍在未保存编辑状态，未保存/取消/刷新；原资金看板和3个用户浏览器标签保留。没有创建隐藏agent-browser会话，5197演示服务继续运行。代码仅本地未提交，未推送、部署或实际提交/审批申请、保存配置、重算分档；后端/PDA作业/Android路径无diff。

## 基础资料与长表单：10类电脑端页面继续精修

本批实看仓库、库位、货架、分拣格、供应商、承运商、费用类别、塑料盒的8类新建表单，再检查部门层级/新建表单与用户搜索，共10类页面。BaseCrudPage改为固定头尾、普通form正文滚动，原disabled fieldset、草稿与保存反馈完整保留；新建按钮统一Lucide Plus，空态按原查询入口与创建权限提供说明。仓库新增名称独占首行，编辑仍保留只读编码、编辑身份与启用选项。查询栏按钮统一36px。部门与分拣格批量表单复用相同骨架，搜索字段补充可读名称。

塑料盒详情将来源贡献平铺，流水标题使用h3；真实滚动检查发现原420px流水窗口与外层正文形成嵌套纵向滚动，改为唯一正文滚动。1024×600下以3条来源、30条流水检查，正文scrollHeight2455px，滚动1200px后标题仍在y35；没有执行还原整件、补打、删除或业务保存。

GUI证据来自5197合成预览：

- 8类新建表单逐一打开/取消，1024×600下无整页横向溢出，footer完整可见。仓库旧fieldset末尾备注边缘裁切，改后正文421px、footer约y506—575；新增名称宽度已补齐。供应商正文438px/内容631px，实际滚动到底后结算、账期与提前期可读，标题和底部操作保持。
- 部门3行合成层级全部收起后子部门不可见，全部展开后恢复；新建表单字段和操作完整。分拣格批量表单保留A01—A10预览及原禁用条件，未创建。用户搜索在可访问树中名为“搜索账号或姓名”，未编辑账号、密码、角色或权限。
- 编辑仓库原DEMO-W01编码仍禁用、编辑身份及原启用状态正确。初始演示仓库DTO缺isActive/typeName导致预览错显停用/空类型，按既有后端DTO订正仓库外演示夹具；没有改真实配置或后端。部门与塑料盒临时5个读取夹具已按原存在性还原，仓库DTO订正保留。

验证：部门搜索可读名称回归在旧代码自然失败，修复后专项8文件/56用例通过；最终前端410文件/3739用例通过，lint、指定tsconfig.app.json类型检查及VITE_ELECTRON=1 ERP构建通过。原BaseCrudPage草稿、隐藏页反馈及塑料盒未知结果恢复回归包含在全量中。构建输出、几何台账、日志与截图在仓库外`/tmp/flowcube-desktop-samples-preview/master-*`。没有把本批10类页面抽查扩写成全部路由、全部角色或真实业务/设备/生产验收。

资源：仅复用一个QA标签，检查后关闭；本批新增10个应用标签已关闭，原11个工作区入口保留，再复用结果标签展示仓库表单。视口覆盖清除，原仪表盘43卡片未保存编辑及3个用户浏览器标签保留。未创建agent-browser隐藏会话，5197演示服务继续运行；没有提交、推送或部署，后端/PDA作业/Android路径无diff。

收尾补验：前端呈现约定初跑将动态createLabel误识别为纯图标按钮；新增按钮显式aria-label沿同一原中文标签，未改守卫。补跑8文件/56用例、该文件lint、类型检查、ERP构建与前端约定5项均通过。文档引用守卫、diff检查通过。本批演示请求日志自基线快照起非读取请求为0。最终结果为1470×656的仓库表单，原11个应用入口加仓库展示共12个；Chrome共6个原/结果标签，QA已退出，原仪表盘仍处于含取消入口的编辑状态。

## 小弹窗与嵌套浮层专项

本轮针对七类查询、未保存确认、销售取消、授信审批/驳回、改价驳回、分类、日历和嵌套供应商选择器进行精修与实际检查。AppDialog显式提供非可调整窗口的内容尺寸模式，短正文收紧、长正文滚动、头尾保持；原可调整窗口尺寸记忆不变。统一长标题换行、关闭按钮、确认说明关联及原文换行。改价和授信原因表单使用现有fc-form-dialog骨架、可读标签和计数，原默认值、必填条件及业务动作保留。

实际GUI证据均为5197合成预览：

- 1470px下货架查询由420px收紧至359px，未保存确认由250px至183px。仓库临时输入“演示小弹窗检查”后取消进入确认，继续编辑保留原值，随后仅丢弃本轮生成的输入，未保存仓库。六类关键字查询改为打开即聚焦输入；操作日志取消后焦点返回查询按钮。
- 1024×600逐一查看货架、库位、分拣格、操作日志、超额放行和出入库查询，几何台账small-query-review.json记录完整头尾且无整页溢出；另实看商品查询。800×440商品窗口396px高，正文277px/内容458px，实际滚动181px后售价末项完整，footer在y356—417；嵌套供应商选择器760×396，搜索自动聚焦，取消后返回原供应商字段。没有确认供应商或应用临时筛选。
- 日期浮层在1024px下完整落于视口（约x273—519、y71—393），Escape返回查询。授信自行审批空原因时原确认按钮禁用，输入演示原因后仅取消；两类驳回表单完整展示原申请/商品和原因，未批准或驳回。销售取消窗口约295px高，原扫码归还说明与选填原因均保留，仅返回订单。
- 分类菜单改为轻量树状列表，Enter展开父节点、选择叶节点后回到原分类触发按钮；原子分类ID仍由原onChange传递。40条临时子分类加独立根项的样例中，选项区257px/内容1594px，滚动1337px后第40项与最后根项完整可达，菜单底部592px距600px视口保留8px。40条均加载；本样例没有采用虚拟列表，也不代表无限分类性能。

回归：确认框说明缺少关联和查询打开焦点在关闭按钮两项均先复现失败后修复；分类测试初版需改用Radix触发键盘事件，随后专门移除aria-expanded做反向验证，断言确实失败后恢复。未把最初未打开菜单的测试失败当成产品回归证据。最终前端412文件/3743用例、lint、指定tsconfig.app.json类型检查、ERP构建、前端呈现约定5项通过。过程类型检查发现content模式top重复声明，已收敛为单一表达式并补验。构建产物在仓库外small-final-dist，日志和截图small-*。

分类、授信、改价三个临时读取夹具已按原存在性及值还原；从首张检查截图起，预览请求日志中的非读取请求为0。未修改真实业务、权限、配置、后端或PDA/Android路径，未提交、推送或部署，Electron原生确认与真实设备本轮未验证。本批新增8个应用标签已关闭，原12入口保留，再复用结果标签展示商品查询（共13个）；唯一QA浏览器标签已关闭、视口覆盖已清除，Chrome保留3个结果/未完成标签及3个用户原标签。原仪表盘未保存编辑继续保留，没有保存或丢弃。

## 同类组件的样式与交互一致性

本轮横向对比同一类查询，根因是独立维护的三种外壳：固定高度AppDialog、已精修的内容高度AppDialog、普通Dialog；另有首焦点、底部重置位置、日期列数与财务字段名称差异。新增QueryDialog共用外壳，22个业务查询实现加PaymentQueryDialog共23个实现接入。外壳只管理标题/正文/底部、尺寸与初始焦点，原字段、草稿初始化与关闭条件、resetValues/clearValue、应用回调保持。财务“清空”和业务“重置”保留不同原口径；条码页onAfterClose沿原回焦归属。

两个实际布局原因分别处理：520px窗口内部约478px，旧网格两列230+230+20需480px，导致查询条件意外全变单列；改为220px并让起始日期另起一行，避免奇数前置字段把起止日期拆行。另查到财务DatePicker的flex传给内部input，外层未伸展，日期区间只占半行；ERP财务查询改由外层平分剩余宽度，与金额范围对齐。财务标题区分现结、月结、对账、收付款，字段补齐可读名称；原日期与金额表达式不动。

实际GUI来自5197合成预览：

- 1024×600逐一打开/取消27个入口的查询：23个业务路由（采购/销售退货分别检查）及应收/应付、双方对账4个财务入口。consistent-review.json记录标题、高度、首焦点、正文/操作位置及整页溢出。所有窗口完整落于600px视口，重置/清空、取消、查询的横向顺序一致，未见整页横向溢出。退款由500px收紧至359px，起止日期同在y361.5、宽229px；条码/分拣格查询287px，复杂采购/销售查询受540px上限约束。此矩阵只证明查询状态，不扩写为整页全部动作验收。
- 对财务再查看8个子状态，台账consistent-finance-variants.json：现结双方核销、月结双方的汇总对账/核销/全部账款。查询标题分别为付款单、收款单、供应商/客户对账单与原月结范围，关联单号/收付款单号/对账单号各自聚焦。现结单日仍1个日期输入，对账2个，全部月结账款4个，未混改为同一种日期口径。
- 800×440月结查询396px高，正文277px/内容409px，滚动132px后到期日和金额范围完整；footer在y356—417。两组日期各304.25px，和金额范围对齐。销售查询内客户选择器正常打开，取消回“选择客户”，再取消回原“查询”按钮。没有确认客户、应用临时条件、保存配置或执行资金/审批等业务动作。

验证：退款焦点和财务字段名称先复现失败后修复；纯选择查询另有自然失败后修复的回归，避免聚焦日期自动展开日历。最终前端413文件/3747用例通过，lint、指定tsconfig.app.json类型检查、ERP构建、前端呈现约定5项通过。财务标题补齐后另跑2文件/7用例，以及受影响文件lint、类型检查和最终构建。源码AST对照本轮仓库外基线确认22个业务查询的原字段协议和重置/应用/关闭回调一致，财务字段协议一致；该核对不代替真实API验收。构建、日志、逐页截图、协议核对脚本均在仓库外consistent-*。

本轮没有替换演示读取夹具；不连接真实业务库，不修改后端/PDA/Android路径，未提交、推送或部署。检查时逐页关闭本轮新增应用入口，保留原13个入口，结果页再增加退款展示入口；唯一QA标签已关闭、视口覆盖清除，Chrome仍为3个原/结果标签加3个用户原标签。原仪表盘仍显示编辑取消入口，没有保存或丢弃编辑。

## 组件库复用核对

本批按当前实现区分“已复用成熟组件”和“交互仍在手写”，不把本地封装文件误认为全部自造。Radix是无皮肤交互基础，外观仍沿现有Apple方向的浅色、紧凑token；没有引入第二套整站UI框架。

| 类型 | 当前实现与结论 | 本批处理 |
| --- | --- | --- |
| 弹窗、下拉、选择器、提示、通知 | 已有Radix基础，AppDialog等本地封装负责业务适配 | 保留，避免丢失焦点返回、尺寸记忆、隐藏页与嵌套浮层协议 |
| 日期与日历 | 已有react-day-picker和Radix Popover | 保留业务日期、输入和回焦规则 |
| 柱状图与其他图表 | 已有Recharts及共用ChartContainer/ChartPresentation | 已是组件库实现，不重复换库 |
| 图标 | 已有Lucide及共用IconButton | 沿原图标语言，不混入第二套笔画体系 |
| 打印模板属性开关 | 5份button/span手写轨道与滑块 | 替换Radix Switch，共用尺寸、焦点与标签点击 |
| 文本对齐、名称附加字段 | 分散按钮自行拼单选/多选状态 | 替换Radix ToggleGroup，分别单选和多选 |
| 销售、采购、收货状态分类 | 共用组件内仍为手写button组 | 同步复用ToggleGroup，保留原空值、查询回调、日期和分页重置 |
| 原生复选框、单选框、details | 浏览器已有键盘/表单语义，不等于手写交互 | 暂保留；后续按是否需要半选、统一字段布局或多面板展开，再选择对应基础组件 |
| 业务表格、树形选择与工作区标签 | 涉及列宽记忆、虚拟化、完整分类路径、KeepAlive与草稿 | 保留专用适配，不能直接替换普通DataTable/Tabs样例 |

后续优先候选是GlobalSearch的搜索结果键盘选择、纯本地内容页签、重复表单字段布局。它们分别涉及异步结果/跳转、KeepAlive、禁用与校验协议，先适配这些协议再判断库组件是否更合适；不是看到button/input就批量替换。当前OrderDetailSections已经有方向键、Home/End、tabpanel关联和保活，不把它列为缺少基础交互的故障。

本批源码变化：新增Switch/ToggleGroup封装，替换模板5处开关和2组选择、3个订单入口的共用状态筛选，并同步选中样式。只新增两个固定版本的Radix依赖；与HEAD比较，没有改变既有锁定包的版本。模板原缺省值、撤销重做、存储字段和未知附加字段均保持。实际集成另发现画布窗口快捷键会同时接收属性控件的方向键/Delete；已隔离控件按键与画布微调，保留画布原快捷操作。

回归先观察8项新期望失败，再实现组件；快捷键冲突另有自然失败后修复。最终前端413文件/3754用例通过，lint、指定tsconfig.app.json类型检查、ERP构建通过。演示GUI使用临时的销售单模板GET夹具验证序号开关标签点击、对齐键盘选择、多选字段及撤销；3次撤销回原布局后关闭演示编辑标签，没有调用保存或打印。临时2个GET夹具逐键恢复。证据在仓库外`/tmp/flowcube-desktop-samples-preview/library-*`；此处组件测试的保存断言使用受控mock，不代表真实数据库或设备打印验收。

销售、采购、收货3个真实前端入口在1024×600演示窗口检查共用筛选：销售方向键只移动焦点、Enter后草稿status=1，原10月17—23日条件保留；采购End/Enter选择待审批status=5；收货重复点收货中仍保留status=2。各入口原日期和page=1重置协议保留，文档根宽度均为1024px，没有新增页面横向溢出；宽表继续在自身区域横滚。最后分别切回全部订单，关闭本批新增的采购/收货/模板应用标签。QA浏览器标签关闭且视口覆盖清除，保留原6个浏览器标签及仪表盘待续标记；没有操作原仪表盘的保存/取消/导航。前端呈现约定5项、AGENTS文档守卫与diff空白检查通过。本批未提交、推送或部署，PDA与后台无本批改动。

## 全局搜索、内容页签与重复表单精修

本批沿用户认可的组件复用方向落地三个目标，不替换业务表格、工作区路由标签或表单业务引擎。

| 目标 | 实现 | 保留的业务协议 |
| --- | --- | --- |
| 全局搜索 | cmdk分组命令菜单、Radix Popover、可见活动项/清空/计数/键盘提示 | 300ms防抖、请求取消与迟到隔离、自动取齐、服务端命中和排序、原路径 |
| 纯内容页签 | 共用ContentTabs，覆盖OrderDetailSections和分档/盘点规则 | KeepAlive草稿与滚动、可见性读取门、单据类型条件、首次页签及任务交接 |
| 重复表单 | FormField共用21处标签/说明/字段布局；客户弹窗固定头尾、正文独立滚动 | 输入校验、长度/精度、结算/授信默认、原禁用、草稿和提交回调 |

新增固定依赖cmdk@1.1.1、@radix-ui/react-tabs@1.2.1；与本批仓库外基线比较，没有更换原锁定包版本。完整npm audit前后结果一致：已有vitest/@vitest/mocker两项moderate，未引入新公告，不执行无关依赖升级。来源为cmdk官方README与Radix Tabs官方文档，皮肤仍使用本项目token。

测试先复现旧搜索固定回车首项、缺少列表语义和全局Escape抢焦点，再实现替换；新内容页签与字段组件先有行为测试。集成另验证同轮mousedown/focus/click只通知一次，避免重复切换回调。最终前端415文件/3759用例通过，lint、指定tsconfig.app.json类型检查与ERP构建通过。前端呈现约定5项通过，diff已审阅；AST对照本批基线核对客户12、供应商19、承运商6、结算4个输入/选择/按钮节点的原协议一致（仅排除ID转交、说明关联和className），不把源码对照当作真实提交验收。

GUI使用5197原演示服务、本批唯一QA浏览器标签，临时增加一个/search GET夹具，正常搜索3项分属商品/客户/销售单且跨类型同ID。初始活动项是商品，方向键选择客户后aria-activedescendant与该客户项ID一致，Enter实际进入客户管理并清空搜索；命中说明、型号、单位与联系人均保留。另检查加载与无结果状态，未把错误伪装为无结果；错误/取消/迟到和输入法确认由组件回归证明。

实际打开客户新增、供应商新增、承运商快捷新增；原默认月结30天、应收/应付文案和承运商顺丰选择保留，没有保存。客户1024×600窗口正文410px/内容662px，footer始于y500；800×440正文266px/内容662px，footer始于y328.5至397.5，正文不覆盖按钮。嵌套结算选择器Escape只关闭选择器、焦点返回结算字段，客户弹窗保留，随后取消空表单。

分档规则用方向键进入；A档周期由30临时改17，End切到按期盘点率，再回原页仍为17且显示未保存；取消编辑后恢复30，没有调用保存。采购101详情Home/End在信息与记录间切换，收货401保留收货信息、收货进度、库存条码和操作记录，条码空态后Home可回信息；可见面板只有当前一块，tab的aria-controls与面板aria-labelledby互相对应。该证据不代表审批、真实库存、生产数据或PDA/打印设备验收。

长搜索列表另用40项合成商品，在800×440窗口检查：选项区342px、内容4283px，End选择DOM末项并滚动至3936px；原接口按商品ID倒序，显示末项为01，不能按夹具原数组顺序推断活动项。浮层范围x32—592、y51—427.5，页面宽800，没有页面横向溢出。Escape清空搜索，再从内容页签按Meta+K可聚焦空搜索，空关键词保持收起。搜索无结果浮层在1024×600窗口范围x256—816、y51—197。临时/search读取夹具最后逐键恢复。服务汇总日志在编辑热更新阶段15:42—15:45有7次system/error-report，不能据此归属来源或断言根因；15:45之后的最终GUI检查阶段未见非GET，QA控制台最终error/warn为空。整个基线保存后的业务写请求数为0，没有保存配置或业务单据。截图、日志、字段协议核对脚本与长列表DOM证据保存于仓库外content-*；本批未提交、推送或部署。

收尾核实：本批新增的客户、供应商、分档规则、承运商、采购列表/详情和收货详情/自动返回列表标签全部关闭，恢复原14个应用工作区标签。主QA与用于确认自动返回列表的收尾浏览器标签均关闭，视口覆盖已清除；浏览器保留原6个标签及原仪表盘待续标记，没有操作原仪表盘的导航/保存/取消。本地演示服务留供继续预览。

## 页面版式收敛：系统设置、快递账号、采购申请

- 计划：`docs/superpowers/plans/2026-10-24-desktop-page-layout.md`。基准为原始应用 HTML 与当前销售列表；本批不增加依赖，不改业务、权限、配置、PDA 或发布状态。
- 系统设置从双列独立卡片调整为连续分组面板；分组标题、字段名、值/输入分别对齐，值改为就近左对齐，长说明可换行。Logo 和未知配置沿原链路。
- 快递账号页去掉根部重复内边距，页头与销售页同为 x=24（1470 宽）；左侧 256px 账号列表与右侧资料合为连续工作面。900px 以下上下排列，列表单独限高；新增表单说明适用于上下布局，未改校验或提交。
- 采购申请新建与详情都沿原 ActionBar/SectionCard/ResizableTable，收紧页头间距和字段字重，明细去掉外圈重复留白，空行实测 padding 为 28px 16px；原列宽与内部横向滚动保留。
- 源码审阅：仓库外 `layout-baseline` 保存本批前文件，`layout-incremental.diff` 记录本批增量；四个页面/表单完整渲染前业务实现相对快照一致，辅助 Section 仅增加 className 透传，渲染内 onChange/onClick/disabled/权限/列配置未变。`layout-logic-review.json` 留存比较结果。
- 组件验证：Node 22 下受影响 15 文件 / 102 例通过（设置、账号表单/导航、采购申请及创建意图恢复）；前端约定 5 例通过、AGENTS 文档守卫通过。纯展示调整不增加重复实现测试。前端 lint、tsconfig.app 类型检查、构建和全量套件按项目集中验证规则列为待发版前验证，本轮未执行，不复用上轮结果。
- GUI：复用 5197 合成预览，一个独立 CUA 检查标签。实际查看三页在 1470/1024/800 宽的布局；设置编辑输入后取消恢复原值；账号筛选只保留匹配项，编辑草稿切换弹确认，取消后原草稿仍在；新增账号只打开/取消。采购申请添加商品、数量录入 12、切换工作区返回后原事由/数量保留，随后移除本轮测试输入；301 详情的申请信息/审批进度/操作记录可切换。1024/800 下 document.scrollWidth 分别等于视口宽度，800 下采购明细 table 宽 1000 且留在内部滚动区域。
- 账号有内容状态用两条临时合成 GET 响应核对；检查结束仅恢复本批涉及的 3 个夹具键并断言与备份一致。未提交业务保存、上传、审批、转单或启用自动下单，不代表真实接口、MySQL 或线上验收。最终检查标签控制台 warn/error 为空。
- 资源收尾：关闭本批创建的详情/设置/账号工作区标签和浏览器检查标签，核对回到原 14 个应用标签、6 个浏览器标签；原仪表盘未完成编辑、退款查询和资金预览保留，未导航或重载它们。
- 证据目录：`/tmp/flowcube-desktop-samples-preview/`，`layout-settings.png`、`layout-settings-edit-1024.png`、`layout-settings-800.png`、`layout-carrier-empty.png`、`layout-carrier-selected.png`、`layout-carrier-new-1024.png`、`layout-requisition-empty.png`、`layout-requisition-1024.png`、`layout-requisition-800.png`、`layout-requisition-detail.png`、`layout-review.json` 及 `layout-*.log`。截图来自演示数据，非生产数据。

## 全系统页头与副标题分类

用户授权直接统一电脑端页头，保留重要业务说明、逻辑与配置，PDA 不动。沿本分支既有修改实施；本轮没有提交、推送或发布。

- 盘点：原 73 个 PageHeader、8 个 BaseCrudPage、17 个 ActionBar 调用；ReportPanel 的 13 处区块说明不属于页面副标题。仪表盘由自写页头接入 PageHeader 后，当前为 74/8/17，共 99 个生产调用。标题、合并组名和导航保持。
- 78 处旧 description 分为：25 处功能介绍/重复加载文案移除，39 处业务说明原值完整转为 notice，4 处删除介绍部分并保留业务条款，3 处状态/编辑信息转到标题旁，5 处动态元信息归入图例、操作区或明细上下文；另有会计期间 1 处归回现有完整业务说明、设备管理 1 处由原列表提示完整承载核心范围/停用规则。设置状态与保存生效提示分别呈现；权限当前角色名仍在编辑态可见。
- 呈现：普通页头常规高度 36px，状态同行，正文间距 20px；ActionBar 内嵌按钮同为 36px，原吸顶不变。业务说明独立成 note/ContextNotice，长文可换行。模板编辑器移除重复页面内边距，保留画布操作指导；仪表盘仅替换页头，原布局编辑逻辑不改。
- 源码审阅：仓库外 header-baseline 保存 100 文件。AST 对照 93 个页面文件，渲染以外实现及原 onClick/onChange/onValueChange/disabled/checked/value 属性均相同；原值迁移的 39 处 notice 全部匹配原说明值；生产页头无旧 description 调用，TSX 解析无错误。所有原页头 title 值保持；85 个既有源码/样式文件发生本批增量变化，新增 PageHeader 回归、实施计划和文档同步另计。未修改后端、配置、依赖或 PDA 作业源码。
- 回归：PageHeader 新测试先自然失败 2/3（缺少状态/独立业务说明），实现后 3/3 通过；相关 38 文件/306 例通过，涵盖共用 CRUD、设置、仪表盘、账号、现结/月结、销售/退货表单等。最终页头与打印编辑器专项 2 文件/26 例通过，其中 PageHeader 3 例为重复核对。lint、tsconfig.app 类型检查、构建和全量套件按仓库集中验证规则待发版前执行，本轮没有把历史结果作为通过依据。
- GUI：一个独立 CUA 标签复用 5197 合成预览，实际查看客户列表、设置、会计期间、退款单、供应商往来（含月结视图）、开单结果核对、仓库运营、仪表盘、采购申请新建及打印模板编辑器。检查 1470/1024/800 宽，设置状态/脏稿/取消、合并导航切换、仪表盘编辑/取消均实际操作；未提交业务写入。客户列表、设置与采购申请最终测得页头高 36px、正文间距 20px、标题 x=24（1470 宽），800 下编辑态、恢复长文、报表元信息与模板指导保持可见，无整页横向溢出。测量仅取可见节点，KeepAlive 隐藏节点的初次误采样在证据中明确排除。
- 重要提示实拍保留：结账完整规则与生成/反结账顺序，退款前提及出账含义，现结/月结分别呈现与对账核销边界；开单核对页仍明确无原表单不得重发、未找到结果继续核对。报告更新时间与刷新入口保留，没有改变轮询与统计。
- 本轮没有添加临时 API 夹具。检查结束关闭所有本批创建的工作区标签（含详情关闭后自动打开的打印模板列表）与浏览器标签，回到本轮开始实际观察到的仪表盘/销售订单两项；未操作本轮开始前的用户浏览器标签；收尾清单仅剩原有 1170625222（仪表盘），历史临时保留标签已不存在，未重建。用户工作区相较上一批已变化，未用历史 14 项清单重建。
- 证据：仓库外 `/tmp/flowcube-desktop-samples-preview/header-*`：classification.json、source-audit.json、inventory-before.json、changed-files.json、incremental.diff、red.log、green.log、unit.log、final-focused.log，以及客户/设置编辑/结账/退款/合并往来/恢复/仓库运营/仪表盘/采购申请/模板编辑器截图。最终检查标签控制台 warn/error 为空。GUI 与组件证据不代表真实数据库、生产、PDA、打印出纸或逐页全部 GUI 验收。

### 本批逐项迁移记录

以下是旧 description 的分类清单，实际页头 title、动作及业务逻辑保持原值。ActionBar 原状态和已无说明的页面不重复列入此表。

| 页面文件（frontend/src/pages/） | 处理 |
|---|---|
| `accounting/accounts/index.tsx` | 移入图例/操作区/明细上下文 |
| `accounting/backfills/index.tsx` | 原业务说明完整保留为独立 notice |
| `accounting/consolidation/index.tsx` | 原业务说明完整保留为独立 notice |
| `accounting/invoices/index.tsx` | 原业务说明完整保留为独立 notice |
| `accounting/ledger/index.tsx` | 原业务说明完整保留为独立 notice |
| `accounting/periods/index.tsx` | 归回原正文业务说明，完整保留 |
| `accounting/reports/index.tsx` | 原业务说明完整保留为独立 notice |
| `accounting/tax/index.tsx` | 原业务说明完整保留为独立 notice |
| `accounting/vouchers/index.tsx` | 原业务说明完整保留为独立 notice |
| `approvals/flows.tsx` | 原业务说明完整保留为独立 notice |
| `approvals/pending.tsx` | 移除功能介绍或重复加载说明 |
| `carrier-accounts/index.tsx` | 移除功能介绍或重复加载说明 |
| `carriers/index.tsx` | 移除功能介绍或重复加载说明 |
| `categories/index.tsx` | 移入图例/操作区/明细上下文 |
| `credit-overrides/index.tsx` | 移除功能介绍或重复加载说明 |
| `customers/index.tsx` | 移除功能介绍或重复加载说明 |
| `departments/index.tsx` | 保留业务条款，移除介绍 |
| `disposal/DisposalRecoveryPage.tsx` | 原业务说明完整保留为独立 notice |
| `disposal/HandlingScrapPage.tsx` | 原业务说明完整保留为独立 notice |
| `disposal/index.tsx` | 原业务说明完整保留为独立 notice |
| `finance/accounts/index.tsx` | 保留业务条款，移除介绍 |
| `finance/dashboard/index.tsx` | 移除功能介绍或重复加载说明 |
| `finance/expense-categories/index.tsx` | 原业务说明完整保留为独立 notice |
| `finance/expenses/index.tsx` | 原业务说明完整保留为独立 notice |
| `finance/transactions/index.tsx` | 原业务说明完整保留为独立 notice |
| `fixed-assets/index.tsx` | 原业务说明完整保留为独立 notice |
| `inventory/index.tsx` | 原业务说明完整保留为独立 notice |
| `inventory/trace.tsx` | 移除功能介绍或重复加载说明 |
| `kits/index.tsx` | 保留业务条款，移除介绍 |
| `locations/index.tsx` | 移除功能介绍或重复加载说明 |
| `logistics/detail.tsx` | 标题旁状态 |
| `logistics/freight-reconciliation.tsx` | 原业务说明完整保留为独立 notice |
| `logistics/index.tsx` | 移除功能介绍或重复加载说明 |
| `oplogs/index.tsx` | 移除功能介绍或重复加载说明 |
| `payments/PaymentsView.tsx` | 原业务说明完整保留为独立 notice |
| `payments/party-ledger.tsx` | 原业务说明完整保留为独立 notice |
| `permissions/index.tsx` | 标题旁状态 |
| `picking-waves/index.tsx` | 移除功能介绍或重复加载说明 |
| `plastic-boxes/index.tsx` | 原业务说明完整保留为独立 notice |
| `portal/statements.tsx` | 原业务说明完整保留为独立 notice |
| `price-change/index.tsx` | 原业务说明完整保留为独立 notice |
| `procurement/detail.tsx` | 移入图例/操作区/明细上下文 |
| `procurement/index.tsx` | 原业务说明完整保留为独立 notice |
| `products/index.tsx` | 移除功能介绍或重复加载说明 |
| `purchase-requisitions/index.tsx` | 移除功能介绍或重复加载说明 |
| `racks/index.tsx` | 原业务说明完整保留为独立 notice |
| `refunds/index.tsx` | 原业务说明完整保留为独立 notice |
| `reports/ReconciliationView.tsx` | 原业务说明完整保留为独立 notice |
| `reports/avg-cost-reconciliation.tsx` | 原业务说明完整保留为独立 notice |
| `reports/index.tsx` | 移除功能介绍或重复加载说明 |
| `reports/inventory-aging.tsx` | 原业务说明完整保留为独立 notice |
| `reports/kpi.tsx` | 移入图例/操作区/明细上下文 |
| `reports/pda-anomaly.tsx` | 移除功能介绍或重复加载说明 |
| `reports/profit-analysis.tsx` | 原业务说明完整保留为独立 notice |
| `reports/replenishment.tsx` | 原业务说明完整保留为独立 notice |
| `reports/role-workbench.tsx` | 移除功能介绍或重复加载说明 |
| `reports/warehouse-ops.tsx` | 移入图例/操作区/明细上下文 |
| `reports/wave-performance.tsx` | 移除功能介绍或重复加载说明 |
| `returns/index.tsx` | 原业务说明完整保留为独立 notice |
| `sale/RepeatSaleRecoveryPage.tsx` | 原业务说明完整保留为独立 notice |
| `settings/barcode-print-query/index.tsx` | 移除功能介绍或重复加载说明 |
| `settings/index.tsx` | 标题旁状态 |
| `settings/pda-devices/index.tsx` | 由原列表业务提示完整承载 |
| `settings/print-templates/editor.tsx` | 移除功能介绍或重复加载说明 |
| `settings/print-templates/editor.tsx` | 原业务说明完整保留为独立 notice |
| `settings/print-templates/index.tsx` | 移除功能介绍或重复加载说明 |
| `settings/printers/index.tsx` | 移除功能介绍或重复加载说明 |
| `sorting-bins/index.tsx` | 移除功能介绍或重复加载说明 |
| `stockcheck/abc.tsx` | 原业务说明完整保留为独立 notice |
| `stockcheck/index.tsx` | 原业务说明完整保留为独立 notice |
| `supplier-refunds/CreateRefundPage.tsx` | 原业务说明完整保留为独立 notice |
| `supplier-refunds/RefundRecoveryPage.tsx` | 原业务说明完整保留为独立 notice |
| `supplier-refunds/index.tsx` | 原业务说明完整保留为独立 notice |
| `suppliers/index.tsx` | 移除功能介绍或重复加载说明 |
| `transfer/index.tsx` | 移除功能介绍或重复加载说明 |
| `users/index.tsx` | 保留业务条款，移除介绍 |
| `warehouse-shipping/index.tsx` | 原业务说明完整保留为独立 notice |
| `warehouses/index.tsx` | 移除功能介绍或重复加载说明 |


## 最新要求：全部业务页头一行短说明

本节取代上一轮“不显示普通功能介绍”的分类方案。99 个生产调用（74 个 PageHeader、8 个 BaseCrudPage、17 个 ActionBar）均显式提供具体短说明，覆盖 93 个页面源码文件，包括新建、详情、结果恢复与加载分支。统一字号 12px、行高 20px、标题后间距 4px；编辑/未保存/单据状态仍同行显示。42 处原页头业务规则、统计口径或操作指导完整移到正文 ContextNotice，原条件与按业务类型选择的文案保持；完整原文见 [正文提示迁移清单](desktop-body-notices-2026-10-24.md)。42 是迁移位置数，不是全部风险警告数量。

源码对照：本批前快照 subtitle-baseline 与现状比较，93 文件的渲染外业务实现、交互属性和原页头标题均一致，99 处说明无缺漏，42 处提示内容及条件无丢失，TSX 语法诊断为 0。初次迁移的 8 处泛型 CRUD 属性位置错误已修正；后续补跑对应基础资料页面回归。本批未改业务请求、配置、依赖、后端或 PDA。

组件测试：页头新增 4 例先验证缺失功能时全部失败，接入后全部通过；一次相关 38 文件 / 329 例通过，泛型 CRUD 修正后补充 11 文件 / 75 例通过。不是全量套件数字；执行日志分别为 subtitle-unit.log 和 subtitle-crud-unit.log。

GUI：本轮独立预览标签在合成数据服务 127.0.0.1:5197 中检查销售列表、仓库基础资料、采购申请新建/详情、设置查看/编辑、会计期间、供应商现结/月结、仓库运营、仪表盘、模板新建及开单结果核对页。1470 / 1024 / 800 宽代表页面的可见说明均为 12px / 20px / 4px、单行高度 20px，已测窗口无文档横向溢出；重要说明在页头之外。设置编辑仅测试本地预览并取消，没有保存；其余不提交业务、不打印。源码覆盖不等于 99 页逐一 GUI 验收。

证据位于 /tmp/flowcube-desktop-samples-preview/：subtitle-review.json、subtitle-source-audit.json、subtitle-console.json、subtitle-sale.png、subtitle-requisition-new.png、subtitle-requisition-detail-800.png、subtitle-settings-edit-800.png、subtitle-periods-1024.png、subtitle-supplier-monthly-1024.png、subtitle-dashboard.png、subtitle-template-new.png、subtitle-recovery.png。临时目录可能被系统清理。

本轮开始时已有工作区为仪表盘、销售订单、库存管理、销售退货、采购申请、补货建议；仅关闭本轮临时新增工作区，保留以上 6 个。独立浏览器核验标签收尾关闭，用户原浏览器标签不导航、不刷新。

验证边界：前端约定及文档守卫结果见本节后续验收行。按仓库连续开发规则，lint、tsconfig.app.json 类型检查、构建和全量业务回归待发版前集中验证；未提交、推送或部署。

### 逐项页头短句

| 源码位置 / 分支标题 | 一行说明 |
| --- | --- |
| [accounting/accounts/index.tsx](../frontend/src/pages/accounting/accounts/index.tsx) · "会计科目表" | 查看会计科目层级与记账属性。 |
| [accounting/backfills/index.tsx](../frontend/src/pages/accounting/backfills/index.tsx) · "跨期补录审批" | 核对跨期业务的补录申请与审批。 |
| [accounting/consolidation/index.tsx](../frontend/src/pages/accounting/consolidation/index.tsx) · "合并报表与账套" | 切换账套，核对集团合并报表。 |
| [accounting/invoices/index.tsx](../frontend/src/pages/accounting/invoices/index.tsx) · "发票管理" | 维护进销项发票与认证抵扣记录。 |
| [accounting/ledger/index.tsx](../frontend/src/pages/accounting/ledger/index.tsx) · "总账与试算平衡" | 核对科目发生额、余额与借贷平衡。 |
| [accounting/periods/index.tsx](../frontend/src/pages/accounting/periods/index.tsx) · "会计期间与结转" | 核对期间状态、损益结转与结账。 |
| [accounting/reports/index.tsx](../frontend/src/pages/accounting/reports/index.tsx) · "会计报表" | 查看利润、资产负债与现金流报表。 |
| [accounting/tax/index.tsx](../frontend/src/pages/accounting/tax/index.tsx) · "报税数据" | 核对税额测算与申报参考数据。 |
| [accounting/vouchers/index.tsx](../frontend/src/pages/accounting/vouchers/index.tsx) · "记账凭证" | 核对业务凭证、借贷明细与生成结果。 |
| [approvals/flows.tsx](../frontend/src/pages/approvals/flows.tsx) · "审批流配置" | 维护业务审批条件与审批节点。 |
| [approvals/pending.tsx](../frontend/src/pages/approvals/pending.tsx) · "待我审批" | 核对待办申请并进入原单处理。 |
| [carrier-accounts/index.tsx](../frontend/src/pages/carrier-accounts/index.tsx) · "快递账号绑定" | 维护快递月结账号与发货服务。 |
| [carriers/index.tsx](../frontend/src/pages/carriers/index.tsx) · "承运商管理" | 维护承运商资料与联系方式。 |
| [categories/index.tsx](../frontend/src/pages/categories/index.tsx) · "商品分类" | 维护商品分类层级与归属。 |
| [credit-overrides/index.tsx](../frontend/src/pages/credit-overrides/index.tsx) · "超额放行申请" | 核对超额申请、额度与审批结果。 |
| [customers/index.tsx](../frontend/src/pages/customers/index.tsx) · "客户管理" | 维护客户资料、结算与授信。 |
| [dashboard/index.tsx](../frontend/src/pages/dashboard/index.tsx) · "仪表盘" | 查看待办、经营指标与个人工具。 |
| [departments/index.tsx](../frontend/src/pages/departments/index.tsx) · "部门管理" | 维护部门层级、负责人和直属成员。 |
| [disposal/DisposalRecoveryPage.tsx](../frontend/src/pages/disposal/DisposalRecoveryPage.tsx) · "报废结果核对" | 核对当前账号发出的报废请求结果。 |
| [disposal/HandlingScrapPage.tsx](../frontend/src/pages/disposal/HandlingScrapPage.tsx) · "来源报废草稿" | 核对来源商品与报废申请明细。 |
| [disposal/index.tsx](../frontend/src/pages/disposal/index.tsx) · "滞销库存处理" | 核对待处理库存与报废申请。 |
| [finance/accounts/index.tsx](../frontend/src/pages/finance/accounts/index.tsx) · "账户管理" | 核对资金账户、余额与启用状态。 |
| [finance/dashboard/index.tsx](../frontend/src/pages/finance/dashboard/index.tsx) · "资金看板" | 查看账户余额、现金流与账龄。 |
| [finance/expense-categories/index.tsx](../frontend/src/pages/finance/expense-categories/index.tsx) · "费用类别" | 维护报销时可选的费用类别。 |
| [finance/expenses/index.tsx](../frontend/src/pages/finance/expenses/index.tsx) · "费用报销" | 核对报销明细、审批与付款进度。 |
| [finance/transactions/index.tsx](../frontend/src/pages/finance/transactions/index.tsx) · "资金流水" | 核对各账户收支、日期与关联单据。 |
| [fixed-assets/index.tsx](../frontend/src/pages/fixed-assets/index.tsx) · "固定资产" | 核对资产卡片、折旧与处置记录。 |
| [inbound-tasks/create.tsx](../frontend/src/pages/inbound-tasks/create.tsx) · "新建收货订单" | 填写收货来源、仓库与商品明细。 |
| [inbound-tasks/detail.tsx](../frontend/src/pages/inbound-tasks/detail.tsx) · {task.taskNo} | 查看收货进度、商品与库存条码。 |
| [inbound-tasks/edit.tsx](../frontend/src/pages/inbound-tasks/edit.tsx) · {baseline ? `编辑 ${baseline.context.task.taskNo}` : '编辑收货订单'} | 核对收货草稿的来源与商品明细。 |
| [inbound-tasks/index.tsx](../frontend/src/pages/inbound-tasks/index.tsx) · "收货订单" | 核对到货、收货与上架进度。 |
| [inventory/index.tsx](../frontend/src/pages/inventory/index.tsx) · "库存管理" | 核对库存数量、仓库分布与流水。 |
| [inventory/trace.tsx](../frontend/src/pages/inventory/trace.tsx) · "批次追溯" | 按库存或塑料盒条码追踪流转记录。 |
| [kits/index.tsx](../frontend/src/pages/kits/index.tsx) · "成套配件" | 维护成套配件、组成与销售价格。 |
| [locations/index.tsx](../frontend/src/pages/locations/index.tsx) · "库位管理" | 维护仓库内的存储库位。 |
| [logistics/detail.tsx](../frontend/src/pages/logistics/detail.tsx) · {wb ? `运单 ${wb.waybillNo}` : '运单详情'} | 核对包裹、快递单号与物流轨迹。 |
| [logistics/freight-reconciliation.tsx](../frontend/src/pages/logistics/freight-reconciliation.tsx) · "运费对账" | 核对承运商账单与运费应付。 |
| [logistics/index.tsx](../frontend/src/pages/logistics/index.tsx) · "物流运单" | 核对包裹运单、取号与物流状态。 |
| [oplogs/index.tsx](../frontend/src/pages/oplogs/index.tsx) · "操作日志" | 按操作人、时间与单据追踪变更。 |
| [payments/PaymentsView.tsx](../frontend/src/pages/payments/PaymentsView.tsx) · {copy.title} | type === 1 ? '核对供应商欠款与付款记录。' : '核对客户欠款与收款记录。' |
| [payments/party-ledger.tsx](../frontend/src/pages/payments/party-ledger.tsx) · {`${type === 2 ? '客户' : '供应商'}往来明细${data ? ` · ${data.party.name}` : ''}`} | 按记账时间核对往来余额变化。 |
| [permissions/index.tsx](../frontend/src/pages/permissions/index.tsx) · "权限管理" | 核对角色权限与可访问的功能。 |
| [picking-waves/index.tsx](../frontend/src/pages/picking-waves/index.tsx) · "批次拣货" | 核对批次拣货、分拣与打印进度。 |
| [plastic-boxes/index.tsx](../frontend/src/pages/plastic-boxes/index.tsx) · "塑料盒管理" | 核对塑料盒条码、商品与占用状态。 |
| [portal/statements.tsx](../frontend/src/pages/portal/statements.tsx) · "客户对账单查询" | 按客户与账期核对对账单金额。 |
| [price-change/index.tsx](../frontend/src/pages/price-change/index.tsx) · "商品改价申请" | 核对改价明细、审批与生效结果。 |
| [procurement/detail.tsx](../frontend/src/pages/procurement/detail.tsx) · {`采购计划 ${plan.code}`} | 核对需求、供给覆盖与采购数量。 |
| [procurement/index.tsx](../frontend/src/pages/procurement/index.tsx) · "采购计划" | 核对采购需求、覆盖与转单进度。 |
| [products/form.tsx](../frontend/src/pages/products/form.tsx) · {isNew ? '新增商品' : '编辑商品'} | 维护商品规格、单位与价格。 |
| [products/index.tsx](../frontend/src/pages/products/index.tsx) · "商品管理" | 维护商品资料、分类与数量规则。 |
| [purchase/form/index.tsx](../frontend/src/pages/purchase/form/index.tsx) · {isEdit ? '编辑采购单' : '新建采购单'} | 填写供应商、仓库与采购明细。 |
| [purchase/form/index.tsx](../frontend/src/pages/purchase/form/index.tsx) · {order.orderNo} | 核对采购明细、金额与收货进度。 |
| [purchase/index.tsx](../frontend/src/pages/purchase/index.tsx) · "采购订单" | 核对采购明细、收货与付款进度。 |
| [purchase-requisitions/form.tsx](../frontend/src/pages/purchase-requisitions/form.tsx) · {isNew ? '新建采购申请单' : `采购申请单 ${detail?.requisitionNo ?? ''}`} | 核对申请仓库、到货日期与商品。 |
| [purchase-requisitions/index.tsx](../frontend/src/pages/purchase-requisitions/index.tsx) · "采购申请" | 核对采购需求、审批与转单进度。 |
| [racks/index.tsx](../frontend/src/pages/racks/index.tsx) · "货架管理" | 维护货架位置、条码与标签。 |
| [refunds/index.tsx](../frontend/src/pages/refunds/index.tsx) · "退货退款单" | 核对销售退货退款与资金出账。 |
| [reports/ReconciliationView.tsx](../frontend/src/pages/reports/ReconciliationView.tsx) · {copy.title} | type === 1 ? '按账期核对供应商应付账款。' : '按账期核对客户应收账款。' |
| [reports/avg-cost-reconciliation.tsx](../frontend/src/pages/reports/avg-cost-reconciliation.tsx) · "成本对账" | 核对库存账面量、实物量与差异。 |
| [reports/index.tsx](../frontend/src/pages/reports/index.tsx) · "报表中心" | 查看采购、销售与库存统计。 |
| [reports/inventory-aging.tsx](../frontend/src/pages/reports/inventory-aging.tsx) · "存放时长与滞销" | 核对库存存放时长与滞销分布。 |
| [reports/kpi.tsx](../frontend/src/pages/reports/kpi.tsx) · "经营 KPI" | 按月份核对经营指标与环比。 |
| [reports/pda-anomaly.tsx](../frontend/src/pages/reports/pda-anomaly.tsx) · "PDA 异常分析" | 核对扫码错误、撤销与异常趋势。 |
| [reports/profit-analysis.tsx](../frontend/src/pages/reports/profit-analysis.tsx) · "利润 / 库存分析" | 核对销售估算毛利与当前库存。 |
| [reports/replenishment.tsx](../frontend/src/pages/reports/replenishment.tsx) · "补货建议" | 核对商品缺口、供给覆盖与建议量。 |
| [reports/role-workbench.tsx](../frontend/src/pages/reports/role-workbench.tsx) · "待办中心" | 按岗位查看待办与需要关注的事项。 |
| [reports/warehouse-ops.tsx](../frontend/src/pages/reports/warehouse-ops.tsx) · "仓库运营看板" | 查看仓库任务、扫码量与作业趋势。 |
| [reports/wave-performance.tsx](../frontend/src/pages/reports/wave-performance.tsx) · "批次效率" | 核对批次时长、商品分布与效率。 |
| [returns/index.tsx](../frontend/src/pages/returns/index.tsx) · {type === 'purchase' ? '采购退货' : '销售退货'} | type === 'purchase' ? '核对供应商退货明细与出库进度。' : '核对客户退货、收货与质检进度。' |
| [returns/purchase/form/index.tsx](../frontend/src/pages/returns/purchase/form/index.tsx) · "新建采购退货单" | 核对退货来源、商品与出库仓库。 |
| [returns/purchase/form/index.tsx](../frontend/src/pages/returns/purchase/form/index.tsx) · {ret.returnNo} | 查看采购退货明细与执行进度。 |
| [returns/sale/form/index.tsx](../frontend/src/pages/returns/sale/form/index.tsx) · "新建销售退货单" | 核对退货来源、商品与收货明细。 |
| [returns/sale/form/index.tsx](../frontend/src/pages/returns/sale/form/index.tsx) · {ret.returnNo} | 查看销售退货明细与处理进度。 |
| [sale/RepeatSaleRecoveryPage.tsx](../frontend/src/pages/sale/RepeatSaleRecoveryPage.tsx) · "开单结果核对" | 核对当前账号发出的开单请求结果。 |
| [sale/commercial/CommercialEditor.tsx](../frontend/src/pages/sale/commercial/CommercialEditor.tsx) · {order ? `${order.orderNo} · ${adjust ? '修改订单' : '编辑'}` : '新建销售单'} | 核对客户、商品与发货安排。 |
| [sale/commercial/CommercialSalePage.tsx](../frontend/src/pages/sale/commercial/CommercialSalePage.tsx) · {order.orderNo} | 查看销售明细、回款与履约进度。 |
| [sale/form/index.tsx](../frontend/src/pages/sale/form/index.tsx) · "新建销售单" | 填写客户、商品与发货信息。 |
| [sale/form/index.tsx](../frontend/src/pages/sale/form/index.tsx) · {order.orderNo} | 查看销售明细、回款与履约进度。 |
| [sale/index.tsx](../frontend/src/pages/sale/index.tsx) · "销售订单" | 核对销售明细、订单状态与回款。 |
| [settings/barcode-print-query/index.tsx](../frontend/src/pages/settings/barcode-print-query/index.tsx) · "条码打印查询" | 核对条码打印状态与失败记录。 |
| [settings/index.tsx](../frontend/src/pages/settings/index.tsx) · "系统设置" | 维护企业资料与业务参数。 |
| [settings/pda-devices/index.tsx](../frontend/src/pages/settings/pda-devices/index.tsx) · "PDA 设备" | 核对设备绑定、启用状态与仓库范围。 |
| [settings/print-templates/editor.tsx](../frontend/src/pages/settings/print-templates/editor.tsx) · "编辑打印模板" | 核对模板字段、纸张与打印版式。 |
| [settings/print-templates/editor.tsx](../frontend/src/pages/settings/print-templates/editor.tsx) · {isNew ? '新建打印模板' : `编辑打印模板 #${id}`} | 核对模板字段、纸张与打印版式。 |
| [settings/print-templates/index.tsx](../frontend/src/pages/settings/print-templates/index.tsx) · "打印模板" | 维护单据模板与默认打印版式。 |
| [settings/printers/index.tsx](../frontend/src/pages/settings/printers/index.tsx) · "打印机管理" | 核对打印设备、用途与任务绑定。 |
| [sorting-bins/index.tsx](../frontend/src/pages/sorting-bins/index.tsx) · "分拣格管理" | 核对分拣格位置、占用与关联任务。 |
| [stockcheck/abc.tsx](../frontend/src/pages/stockcheck/abc.tsx) · "分档与盘点规则" | 查看商品分档，维护分批盘点规则。 |
| [stockcheck/index.tsx](../frontend/src/pages/stockcheck/index.tsx) · "库存盘点" | 核对盘点任务、账面量与实盘量。 |
| [supplier-refunds/CreateRefundPage.tsx](../frontend/src/pages/supplier-refunds/CreateRefundPage.tsx) · "供应商退款" | 核对采购退货退款草稿与来源。 |
| [supplier-refunds/RefundRecoveryPage.tsx](../frontend/src/pages/supplier-refunds/RefundRecoveryPage.tsx) · "退款结果核对" | 核对退款与跨期补录的原请求结果。 |
| [supplier-refunds/index.tsx](../frontend/src/pages/supplier-refunds/index.tsx) · "供应商退款" | 核对供应商退款与实际回款进度。 |
| [suppliers/index.tsx](../frontend/src/pages/suppliers/index.tsx) · "供应商管理" | 维护供应商资料与结算信息。 |
| [transfer/form/index.tsx](../frontend/src/pages/transfer/form/index.tsx) · {isEdit ? '编辑调拨单' : '新建调拨单'} | 核对调出仓、调入仓与商品明细。 |
| [transfer/form/index.tsx](../frontend/src/pages/transfer/form/index.tsx) · {order.orderNo} | 查看调拨明细与两端执行进度。 |
| [transfer/index.tsx](../frontend/src/pages/transfer/index.tsx) · "库存调拨" | 核对调拨明细、在途与收发进度。 |
| [users/index.tsx](../frontend/src/pages/users/index.tsx) · "用户管理" | 维护登录账号、角色与启用状态。 |
| [warehouse-shipping/index.tsx](../frontend/src/pages/warehouse-shipping/index.tsx) · "仓库发货" | 查看仓库扫码发货的操作说明。 |
| [warehouses/index.tsx](../frontend/src/pages/warehouses/index.tsx) · "仓库管理" | 维护仓库资料与启用状态。 |

本批验收收尾：前端约定 5 例、文档守卫及 git diff --check 通过；代表 GUI 控制台 warning/error 记录为空。临时浏览器标签已关闭，浏览器仅保留原用户标签，原 6 个工作区仍在。


## 最新调整：页头小字只显示一处，提示优先

用户最新要求取代上一节“用途与正文提示同时显示”的实现。有提示时，原提示直接作为标题下唯一的小字；没有当前提示时，显示原简短用途说明。42 处原提示全部保留原文及条件，撤除本批前的正文重复位置。系统设置与仪表盘按编辑态切换，用户管理沿原管理员条件；3 个基础资料 notice 由 BaseCrudPage 优先显示，会计期间和电脑端设备管理的整页说明也合并到同一位置。表单帮助、错误和设备当前状态仍保留在业务上下文。

小字仍统一 12px 字号、20px 行高、标题后 4px；长提示自然换行、完整显示，不强制压成单行、不省略。标题、状态、按钮、合并导航及全部业务数据/请求/回调、权限和配置不变，PDA 作业路由与后端不变。

源码审阅：本批前快照 single-caption-baseline 对照 93 个页面、99 个页头调用，标题、渲染外业务实现和交互属性无变化；全部有说明输入，42 处原提示/条件保留，正文重复节点为 0，语法诊断为 0。BaseCrudPage 只在唯一 description 处优先使用 notice。完整 diff 已核对，git diff --check 及本批快照对照的空白检查通过。

测试：新增设置编辑/取消与基础资料提示/用途切换两例，修改前新增两例失败、原 7 例通过；实现后受影响 15 文件 / 109 例通过。前端约定 5 例及文档守卫通过。依仓库约定，lint、tsconfig.app.json 类型检查、构建及全量业务回归待发版前集中验证。

GUI：使用独立临时标签与既有合成预览，设置 1470/800 宽检查默认、编辑、取消三态；会计期间 800 宽完整两行提示；供应商现结/月结 1024 宽切换提示；货架管理 1024 宽确认基础资料 notice 优先。每个活动页面只有一个 desktop-page-description，重复正文节点 0，已测窗口均无文档横向溢出，字体/行高/标题间距保持 12px/20px/4px；长提示高度可为 40px。没有保存配置、提交业务、打印或生产访问。代表 GUI 不等于逐页 GUI 全量验收。

证据：/tmp/flowcube-desktop-samples-preview/single-caption-{source-audit,gui,console}.json；single-caption-{red,unit,conventions,doc-guard}.log；single-caption-settings-800.png、single-caption-periods-800.png、single-caption-monthly-1024.png、single-caption-racks-1024.png。GUI warning/error 记录为空。

收尾已关闭本轮新增的 4 个工作区标签（设置、会计期间、供应商往来、货架）及独立浏览器标签；原 6 个工作区和用户浏览器页保留。未提交、推送或部署。


## 唯一小字的其他页面续查

本轮以既有“有提示优先、无提示显示用途”的规则继续，不回退工作区既有修改。留存 caption-followup-baseline 后，修正 5 个页面的残留：

| 页面 | 调整 |
| --- | --- |
| 条码打印查询 | 将类别/恢复说明与原完整出纸边界合并到唯一页头说明；撤除正文重复提示及类别介绍，真实收货来源筛选仍显示。切换入库、出库、物流与恢复模式沿原状态和查询行为。 |
| 货架管理 | 依据原 localPrintEnv 显示浏览器提示、本机不可用提示或正常条码说明，撤除独立环境介绍块；原筛选、打印入口及回执处理不变。 |
| 打印机管理 | 本机能力不可用时在页头显示原提示，可用时显示用途；原本机重新注册、凭据撤销与任务核对指导仍留在具体操作区。 |
| 模板编辑器 | 将通用画布操作指导并到页头，保留拖入、移动、缩放、右侧属性、Delete、真实纸张和毫米/ZPL 信息；预览状态切换说明，不改画布、字段、保存或预览取数。 |
| 报表入口 | 去掉“经营总览”下重复的功能介绍，保留页头用途、区块标题与全部图表/条件。 |

另清理 44 处未使用的 ContextNotice 导入。导入清理只涉及前几轮已不渲染该组件的页面，不移除其他有效组件。原 42 处提示中除模板指导按上述合并外，其余 41 处当前内容与条件均保持本批前值。

源码：93 个页面 / 99 个生产页头调用均有说明，标题、渲染外业务实现、原 onClick/onChange/onValueChange/disabled/checked/value 属性无变化，无重复 desktop-page-business-notice，TSX 语法诊断 0。正常业务页未发现共用组件之外的自写 h1；其余 3 处分别为登录、无权限和无可用页面，保留独立职责。核对完整本批 diff，业务 API、权限、配置、PDA、后端、依赖和工作区路由实现未改。

回归：新增条码页唯一提示/恢复切换检查，在修改前确认为 1 例失败、原 2 例通过；实现后共 8 文件 / 58 例通过。为模板原空白布局用例追加唯一说明和 Delete/毫米信息断言后，条码与编辑器 2 文件 / 26 例补跑通过（是前述用例的子集，不额外累加）。前端约定、文档守卫、git diff --check 与本批快照空白检查收尾核对。

GUI：合成预览 127.0.0.1:5197（当前 checkout 源码，本轮未改夹具），实际检查 17 个页面、21 个视图/模式记录，涵盖条码入库/出库/物流/恢复、货架、打印机、报表入口、模板编辑/预览、资金账户、总账、发票、退款/报废结果核对、分类、部门、ABC、库龄、电脑端设备管理、发货说明及销售基准。1470/1024/800 代表宽度下，每个活动页均只有一个页头说明节点，字号 12px、行高 20px、标题后 4px；长文本自然换行，无说明裁切或文档横向溢出，无重复正文提示。GUI 只证明这些合成场景，不代表所有 99 个调用逐一实页验收、真实 API/生产或 Electron 本机打印故障分支验收；字段帮助、错误与真实筛选不属于重复页面介绍。

截图和数据：/tmp/flowcube-desktop-samples-preview/caption-followup-{barcode-before,barcode-800,racks-800,printers-800,reports-1024,template-1024,devices-1024}.png；caption-followup-{source-audit,gui,console,import-cleanup,changed-files}.json；caption-followup-{red,unit,final-unit,conventions,doc-guard}.log；caption-followup.patch。临时目录可能被系统清理。

没有提交业务、保存配置、注册打印机或打印；没有接触生产。已关闭本轮新增的 16 个应用标签及独立浏览器标签，保留原 6 个应用工作区和用户浏览器页；预览服务保留。未提交、推送或部署。lint、tsconfig.app.json 类型检查、构建和全量业务回归按仓库规则待发版前集中验证。


续查中发现并修复的渲染告警：报废结果核对页的 disposalEpoch 与 handlingEpoch 实际为同一代际函数，两个相邻恢复区块因使用相同 key 产生重复标识警告。只给两类 key 增加各自固定前缀，代际变化时仍按原条件重挂，原记录集合、查询、重试与权限判断不变。既有真实路由回归中增加“无重复 key 警告”断言，修改前该断言失败、原 2 例通过；修正后另跑报废恢复与处理链回归。浏览器原始告警保存在 caption-followup-console.json，不覆盖或伪称原记录为空；修正后的独立复核另存 caption-followup-recovery-console.json。

报废页修正验收：恢复页与处理链 2 文件 / 19 例通过，独立浏览器重开后 warning/error 为 0，页头仍唯一；新测试继续验证只有原 status GET、不新增执行请求。该 19 例与本批 58 例来自不同文件，共 77 例；26 例补跑为 58 例子集。最终文档守卫、前端约定和 diff 空白检查均通过，未运行项目仍按前述发版前集中验证。报废页复核临时标签也已关闭，用户原页保留。


## 单据新建、详情和编辑状态续查

沿最新唯一小字规则，本轮从 caption-orders-baseline 保留本批前现场，核对销售、采购、收货、退货、调拨、采购申请和采购计划的页头及紧邻说明。修正 4 个页面：

- 普通销售新建：有处理来源时，原商品/原仓/基本单位、客户选择及可关联数量直接作为页头小字；无此来源时保留用途短句。原来源载入、错误与结果面板不变。
- 采购退货新建：未载入时使用原手工/系统原单指引，载入后使用原单号与只读、零数量/移除及剩余可退量规则；处理来源说明与同一位置合并。正文的重复整页说明撤除，精确选行和原写入不变。
- 销售退货新建：未载入时显示原指引，载入后随成套、普通净额、旧来源模式显示原对应规则；原退货单价/额度、净冲减与资金说明保留，不修改数据或判定。
- 采购计划详情：预测窗口、覆盖周期、默认提前期、行数和取数时间及转换重核规则合并为一个页头说明，撤除两条独立介绍。转换按钮旁具体包装/供应商条件仍保留。

来源规则的原条件、原文与动态值在迁移中保持。原来已合格的采购、收货、调拨、请购、各单据详情与普通销售页头不做无依据的视觉调整。PDA、API、后端、配置、权限、业务函数和原交互属性不改。

回归：在 4 个原有真实表单/路由用例中补充页头位置与单次出现断言，改动前 4 例因原用途短句未替换而失败、原 40 例通过；实现后相关 28 文件 / 314 例通过。包括来源模式、金额与精度、原请求/权限/未知结果、采购意图与单据交互的受控组件回归，不作为真实 HTTP/SQL 或生产证据。完整日志 caption-orders-red.log、caption-orders-unit.log。

源码对照：93 个页面 / 99 个页头调用均有小字输入；标题、渲染外业务实现和原交互属性相较本批前未改，语法诊断 0，无旧重复正文节点。原 41 处提示（先前已合并的模板指导另计）保持本批前内容，4 个本轮源单/参数说明按本节迁移。已核对 4 个生产文件完整 diff 及相应测试变更；前端约定、文档守卫及 diff 空白检查在收尾确认。

GUI 使用既有合成预览、本轮未改夹具：实查 16 个单据路由页面、21 个状态/尺寸记录，包括采购/销售退货新建，采购计划详情，销售/采购/收货/调拨/请购新建，销售/采购/收货/两类退货/请购/调拨详情，收货草稿编辑，以及采购/调拨编辑进入和取消。1470、1024、800 代表宽度下，每个活动页头均为一个小字节点，字体 12px、行高 20px、标题后 4px；长提示完整换行，无说明裁切或文档横向溢出。控制台 warning/error 记录为空。绑定原单和处理来源的特殊分支由上述真实组件测试验证，本轮合成 GUI 不虚称完成这些来源载入闭环或所有 99 调用的逐一实页验收。

GUI 没有填写字段、提交保存、派发、执行退货或打印。采购和调拨只进入编辑查看后取消；关闭本轮初始表单/详情时按原未保存确认退出本轮预览状态，保留原业务记录及原 6 个工作区。共关闭本轮 16 个新路由标签、详情关闭后自动生成的 1 个采购列表及独立浏览器标签，保留用户原浏览器页与服务。

证据在 /tmp/flowcube-desktop-samples-preview/：caption-orders-{source-audit,gui,console,changed-files}.json；caption-orders-{purchase-return-800,sale-return-800,plan-800,sale-new-800,inbound-edit-1024}.png；caption-orders.patch 与前述日志。未提交、推送或部署；lint、tsconfig.app.json 类型检查、构建和全量业务回归按仓库要求待发版前集中验证。


## 剩余弹窗与低频页面的唯一说明续查

本轮从 caption-dialogs-baseline 保存的本批前现场继续，核对 91 个普通 DialogHeader、22 个 AppDialog 源码调用（含共用 QueryDialog 和 ConfirmDialog，不能当作互不重叠的运行时弹窗数量）。普通弹窗显式补齐 description；查询、选择器、数量汇总和资金表单使用 AppDialog 的标题下说明分支。已有整窗提示、编辑对象和规则优先，没有原提示时才给具体用途。移除原位置的同段介绍与新建态缺失，保留字段帮助、失败重试、状态/来源事实及原操作。分类选择器没有选中项时不再在底部重复说明；已选分类仍显示。成套资料只读时使用原只读提示替代用途说明。

真页检查补出权限管理的遗漏：原底部“提示：修改权限后，用户需要重新登录才能生效。管理员（admin）角色权限固定，不可修改；系统内置角色不可删除。”整体移入唯一页头，原权限与角色交互不变。历史处置详情在原 disposal && !allScrap 条件下，将原三种状态提示移入唯一说明并保留 alert 语义，其余状态显示用途；原审批、取消、签认与执行条件不改。移除 8 个已有说明的 ERP DialogContent 对 aria-describedby 的旧禁用；共用头默认输出不变。

共享 UI 的新说明是可选项，AppDialog 默认仍沿原正文描述分支；说明使用 Radix Description asChild 的 div 容器，兼容补录审批原有多段富文本，避免 p 嵌 p。新增皮肤严格限定电脑端外壳。PDA/Android/后端/API/权限表/配置文件均未因本轮修改。

源码证据：对照 140 个生产 TSX 快照，91 个普通头和 22 个 AppDialog 调用均有说明输入，语法诊断 0，标题未变；除上述权限页明确的页头提示替换，原页头不变。渲染之外的业务 tokens 与原 on*/disabled/checked/value 属性对照无差异；普通弹窗原 JSX 中文文本未丢失。源码检查不等于所有运行时状态逐一验收。证据 caption-dialogs-{source-audit,content-audit,changed-files}.json 和 caption-dialogs.patch；另有处置历史状态的原测试追加说明位置断言。

回归：新增查询唯一说明、原提示优先、原重置/关闭/未应用语义，以及普通头可选兼容和 ARIA 关联断言。实施前新查询断言失败、原 4 例通过。全前端单测 416 文件 / 3768 例通过；随后对无障碍关联、富文本容器和历史处置状态补跑受影响组件，最终结果见本节收尾记录。日志 caption-dialogs-{red,all-unit,final-targeted,disposal-caption,final-components}.log。没有执行真实资金、权限、库存写入；单测使用受控 adapter，不作为真实 HTTP/SQL 或生产证据。

GUI：使用既有合成预览，19 条状态/尺寸记录中 17 条有业务弹窗；包括客户/供应商新建与编辑、销售查询及嵌套客户选择器、凭证生成/手工录入、新增会计科目、复制/新增角色、部门、固定资产、审批流、库存导入及删除确认（只取消）。1470 与 800 代表宽度中，每个被检查的业务弹窗各一处说明，字体 12px、行高 20px，标题下说明间距 4px，长提示完整换行，底部动作可见；ConfirmDialog 沿原单一正文分支。嵌套选择器取消后回到客户入口。手工凭证自动展开的日历是既有控件浮层，不作为缺失说明的业务弹窗。客户批量导入是原内联上传区域，并非弹窗；打印机添加受原浏览器环境闸门限制，本轮未伪造桌面环境，原生添加/绑定分支仅源码与组件覆盖。权限页提示实页仅出现一次。控制台 warning/error 记录为空。

GUI 没有修改字段、上传文件、保存、生成凭证、创建角色、确认删除或调整配置。保留开始实查时的 8 个工作区（含当时已有的会计科目表和记账凭证），关闭本轮 7 个新工作区与独立浏览器标签，恢复视口；原用户浏览器页与本地预览服务保留。截图 caption-dialogs-{customer-new-800,query-800,voucher-rule-800,confirm-800}.png，状态 caption-dialogs-gui.json，日志 caption-dialogs-console.json。未逐一打开 91 个原生头及全部动态分支，不宣称生产或 PDA/真机验收。

收尾：最终受影响组件回归 69 文件 / 517 例通过，处置历史状态说明断言所在 18 例通过，前端约定 5 例和文档注入守卫通过，diff 空白检查通过。最终新建独立浏览器标签复核销售查询：唯一说明为 div、ARIA 正确关联、12px/20px/4px、无无效段落嵌套；已取消并关闭，保留当时用户另外新开的会计工作区及原浏览器标签。证据 caption-dialogs-final-gui.json、caption-dialogs-query-final.png。未提交、推送或部署；lint、指定 tsconfig.app.json 的类型检查、构建及全量业务回归仍待发版前集中验证。


## 低频页面与特殊状态续查

本轮在 caption-special-baseline 保存完整前端源文件及相关文档的本批前现场后，重点查特殊状态重复说明。共修改 14 个生产 TSX 文件：

- 通用客户/供应商选择器、商品选择器、分类选择器及采购明细选择器：原读取暂停、无查看权限、结果超限与读取进度优先进入唯一标题说明；原单击/双击/Enter 指导不再作为第二段页脚用途。多个原提示并存时仍在同一容器保留，截断计数、确认闸门、当前选中事实与原回调不改。分类和商品中的局部分类错误/重试仍保留。
- 供应商退款详情：找到上一轮遗漏的正文 DialogDescription，改为唯一标题说明；历史不足一分、原上下文错误和重核状态合并，原“退款与实物退货独立”规则保留。供应商退款新建的无收入账户权限/历史尾差也使用原条件放页头；无效来源早返回补齐同一页头，原拒绝条件不变。核销明细原金额口径规则、读取暂停和身份不匹配说明合并；单位归属、分配数值、原结果/凭证核对区不动。
- 仪表盘低库存/授信风险明细、桌面发现新版本：接入统一 DialogHeader description，保留原风险口径与原版本号；原订阅、更新与忽略行为不改。
- 滞销建议和新建报废弹窗：原库存/预占/估值口径替换通用用途，原上下文失效警告放同一位置。实页长内容检查发现底部关闭按钮需滚动才能看到，改用现有固定头尾、正文滚动样式，1470 与 800 宽度下操作栏可见。原选仓、圈选、数量和来源动作不改。旧单整单签认把原读取错误、已有签认、资格不符及原签认边界合并，原历史预览与按钮条件不改。
- 系统设置：只读提示原来在 Logo 区和底部重复，编辑后未保存警告也另起整页提示；统一入页头，多个条件同时成立时仍保留重要提醒。企业资料、Logo 与配置保存接口不变。
- 物流详情：原 nextStep 覆盖待取号、取号中、已取号/面单、作废、平台下单待核实等分支；整段原指引与原读取状态进入唯一页头，正文移除重复。打印入口与其特定定位说明保留。原 nextStep 计算和所有业务函数未修改。

回归：首次 4 文件的新说明断言 7 失败/48 通过，修改后同时补齐旧 AppDialog 测试外壳对 description 的呈现，未删除原截断/禁止确认/请求约束；真实 AppDialog/Radix 的选择器用例额外核对单一说明、ARIA、暂停与截断同时成立仍保留两提示及确认不触发。设置只读/未保存的新增位置断言先失败；物流 12 种状态的位置断言先失败、原 21 例通过，实现后该文件 33 例通过。最终本批相关前端回归 40 文件 / 418 例通过，涵盖选择器权限/换来源/截断/搜索、资金登记/核销/退款恢复、历史处置、桌面更新桥接、物流草稿连续性与设置原保存/取消合同。日志 caption-special-{red,settings-red,waybill-red,waybill-green,shipment,final-unit}.log。它们是受控组件/adapter 证据，不代替真实 SQL/生产、桌面更新下载或硬件验收。

源码审阅：对本轮基线的 400 个生产 TSX 做语法、标题、非渲染业务 tokens、on*/disabled/checked/value 属性对照。93 个普通 DialogHeader 和 22 个 AppDialog 源码调用均有说明输入，语法诊断 0、原标题与渲染之外业务及交互属性无差异；本轮只有供应商退款新建、系统设置、运单详情三处页面说明变化。键盘选择指导只重组标点进入标题说明，原业务可见文字保留。PDA/Android、后端、API、配置文件及依赖没有本轮改动。证据 caption-special-{source-audit,content-audit,changed-files}.json、caption-special.patch。

GUI：合成预览记录 17 条，其中 8 条弹窗记录、7 条活动页头记录及2条中间态未取得弹窗的记录；不能把全部记录算成通过的独立页面。实查低库存风险空状态、授信风险空状态、滞销建议长提示/底部操作（1470、800）、历史供应商退款不足一分/嵌套取消确认、运单详情与录号弹窗、无效退款来源、退款/报废结果核对空状态、报税空数据与税种切换、跨期补录空状态；另实际查看系统设置进入编辑并取消，不输入或保存配置。被检查的说明均一处，12px/20px、标题后4px、长文换行，页头无文档横向溢出。弹窗内部局部来源提示/字段帮助/原数据不当作第二个整页说明。未在 GUI 撤权限、构造未知写入或执行提交；选择器暂停/超限、只读设置、旧单签认及桌面更新的特殊分支由相应组件测试/源码覆盖，不宣称全分支实页完成。

预览边界：授信风险明细初次读取因既有合成响应缺分页形状触发页面错误。核对当前后端 controller 按 page 参数返回分页后，仅临时给 /tmp 预览响应补形状；清除本轮标签的旧缓存后实查成功。为历史尾差界面另临时增加两条合成退款 GET 响应。三条临时响应键已按备份逐项恢复；不改后端/生产数据，不以此证明真实接口闭环。保留完整错误日志 caption-special-console.json，不把最初环境错误写成零错误。

资源：本轮不填写或保存业务/配置字段，不上传，不确认资金/库存/权限操作，不确认退款取消，不执行桌面更新。仪表盘“展示全部卡片”只预览，未保存并已取消。保留开始实查时的原12个工作区及原浏览器页，关闭本轮9个临时工作区、恢复视口并关闭独立浏览器标签；本地服务保留。证据 caption-special-cleanup.json、caption-special-gui.json、caption-special-{risk,credit,disposal,disposal-800,refund-legacy-800,invalid-source-800}.png。

未提交、推送或部署。本轮 lint、tsconfig.app.json 类型检查、构建及全量业务回归仍按仓库要求待发版前集中验证，收尾执行前端约定、文档守卫及 diff 检查。


## 低频列表、交接异常与批次状态续查

沿 caption-rare-baseline 保存的本批前现场，修正 9 个生产 TSX 文件的说明位置：操作日志、用户、库存盘点、跨期补录的超限提示进入唯一页头，计数和原重要规则保留；补录原上下文变化/写入错误仍沿原条件显示。分拣格无效交接与缺少分配权限的原提示进入 PageHeader/BaseCrudPage 唯一说明，管理页仅增加呈现 notice 参数，原管理表单组件身份与草稿保留。补分配弹窗的读取、空候选、目标失效和未取齐提示进入原规则所在说明，原错误重试、刷新任务和资格/分配条件不变。

分档规则的原全局/本仓、只读/查看/编辑说明随原状态进入页头；盘点新建的原全盘/分批范围说明进入弹窗标题下；塑料盒还原原盒内余量和生成整件码边界进入同一位置。批次详情将原阶段指引和下一步动作合并为标题说明，加载中显示原加载提示，正文保留当前阶段数据、商品汇总与原重试/执行/取消按钮。字段帮助、局部业务数据和可操作的未知结果恢复面板不作为重复用途删除。PDA/Android、后端、API、权限及配置值没有本批修改。

回归：原连续列表用例追加说明位置断言，实施前 6 文件中的 11 个新断言失败、57 例通过；批次取消/完成/打印异常及读取中的 4 个新位置断言实施前失败，原 3 例通过。实施后相关 22 文件 / 188 例通过。随后补强补录上下文变化的页头位置断言，补跑受影响 2 文件 / 27 例通过。保留原 25 批读取、5000/5001 边界、虚拟化、权限拒绝零请求、交接 A/B 草稿、未知结果恢复和执行参数等断言；两个旧弹窗测试外壳补齐对 description 的渲染，没有移除原业务断言。日志 caption-rare-{red,wave-red,final-unit,final-affected}.log；组件/adapter 证据不代替真实 HTTP/SQL 或生产验收。

源码对照：400 个生产 TSX 的语法、标题和原交互属性核对，93 个普通 DialogHeader、22 个 AppDialog 调用均有说明输入；语法诊断、原标题与 on*/disabled/checked/value 属性差异均为 0。非渲染 tokens 对照仅分拣格管理页出现预期差异：新增纯呈现 handoffNotice 和向原管理子组件传 notice 参数；已逐项审阅，无原业务函数、权限判定、读取/写入或回调变化。该检查不等于全部运行时状态逐一实页验收。完整本批差异和路径在 caption-rare.patch、caption-rare-changed-files.json，源码审计在 caption-rare-source-audit.json。

GUI 使用既有合成预览：17 条状态/尺寸记录，其中 9 条有弹窗，16 条有活动页头，1 条为角色预览响应形状错误的失败记录。覆盖全盘/分批新建、分拣格无效交接、空候选/目标失效、分档规则查看/进入编辑并取消、塑料盒空状态/新建、操作日志、用户页/新建、跨期补录空状态，以及拣货中/待分拣批次详情。1470 与 800 代表宽度下，被检查的说明各一处、12px 字号/20px 行高/标题后 4px，长提示换行、无文档横向溢出，弹窗操作可见。塑料盒实际还原、超限大量结果、缺少分配权限、补录身份变化及批次取消/完成/打印异常/读取分支由上述组件测试覆盖，不宣称全部实页验收。

预览边界：用户新建初次遇到 roles.filter 形状错误。核对真实 users/assignable-roles API 和后端 service 返回数组后，仅临时在 /tmp 合成预览补该空数组 GET 响应；重载本轮页面后弹窗呈现正常，未添加角色或修改权限，临时键已按备份恢复并核对。错误日志保留在 caption-rare-console{,-final}.json，不宣称控制台零错误，也不为迁就预览修改生产业务。所有截图、GUI 状态和日志均在 /tmp/flowcube-desktop-samples-preview/；代表效果 caption-rare-wave-800.png、caption-rare-wave-wide.png、caption-rare-stockcheck-800.png、caption-rare-invalid-handoff-800.png、caption-rare-no-candidates-800.png、caption-rare-abc-editing-800.png。

本轮不填写或保存业务/配置字段，不审批、分配、执行库存或资金动作，不创建用户，不输入密码。关闭 10 个本轮临时工作区（含批次详情关闭时自动生成的列表），核对原 12 个工作区全部保留；恢复视口、关闭本轮独立浏览器页，原用户浏览器页和本地服务保留。证据 caption-rare-gui.json、caption-rare-cleanup.json。未提交、推送或部署；lint、指定 tsconfig.app.json 的类型检查、构建及全量业务回归仍待发版前集中验证，前端约定、文档守卫与 diff 检查在本节收尾记录。

收尾：前端约定 5 例通过，文档注入守卫通过，git diff --check 通过；最终范围为 9 个生产 TSX、11 个原有测试文件及 2 份对应主题文档。已逐项核对本批快照差异，不覆盖原工作区中其他轮次的改动。浏览器页清理后重新列举，仅保留用户原会计发票页面。


## 其余列表及超额放行、资产和报销弹窗续查

本轮从 caption-next-baseline 保存的本批前现场继续，修改 10 个生产 TSX、7 个原有测试文件及对应主题文档。销售、采购、调拨、采购申请、采购计划、成套配件与待我审批的超限提示使用原已读取/总匹配数和原条件放入唯一页头；底部只保留完整结果总数，配件原成交快照/真实组件库存规则保留。超额放行的原申请时额度口径替换用途；选单后的原对象与金额、授信校验说明进入标题下，普通创建后仍需提交审批、重申仍保留旧申请与审批记录。

固定资产新建沿原文显示直线法公式、购置当月计提和示例，原折旧参数不改；采购计划生成沿原文显示现货/在途、未发销售优先消耗与计划/申请/采购草稿抵扣边界，具体预测窗口、覆盖周期和 WMA 字段帮助保留。报销详情有原驳回原因时替换通用用途，没有时显示用途，明细数值和原审批/付款/关闭行为不动。采购的未知结束结果核对、刷新失败重试、成套资料冲突恢复、审批交接的重试/关闭控件及表单字段帮助均保留，不为减少整页介绍删去可操作反馈。未改 PDA/Android、API、后端、权限、配置值、依赖或业务函数。

回归：先加强 7 个原有组件用例文件中的位置与单次呈现断言，实施前 9 个新断言失败、原 66 例通过；实现后 7 文件 / 75 例通过。随后本批相关 25 文件 / 306 例通过，覆盖真实页面/hooks/受控 transport 的完整/截断、失败重试、旧数据隐藏、草稿保留、权限、审批交接、重申和原请求合同。后续生成规则和普通选单审批边界调整后，受影响 3 文件 / 21 例复验通过。日志 caption-next-{red,green,unit,plan-final,final-affected}.log；不将这些受控组件/adapter 结果视作真实 HTTP/SQL 或生产证据。

源码对照 400 个生产 TSX：93 个普通 DialogHeader、22 个 AppDialog 均有说明输入，语法诊断、原标题、非渲染业务 tokens 和原 on*/disabled/checked/value 属性差异均为 0；只改变呈现位置和原说明选择。完整本批 patch 已逐项审阅。证据 caption-next-source-audit.json、caption-next-changed-files.json、caption-next.patch。

GUI 使用既有合成预览，18 条状态/尺寸记录，其中 9 条有业务弹窗。实查固定资产空列表及新建（1470、800）、超额放行空列表/未选单/选单（800 与最终 1470）、报销驳回与普通草稿详情、采购计划列表与生成规则，以及待我审批、配件、采购、调拨、请购和销售列表。各记录的活动页头及业务弹窗均各一处说明，12px 字号、20px 行高、标题后 4px；长提示自然换行、无文档横向溢出，弹窗操作可见。未取齐的大结果、重申历史失效及失败/重试分支由组件回归覆盖，不宣称全部状态实页验收。

为核对报销驳回与无驳回时的说明切换，仅在 /tmp 预览添加两条专用合成 GET 详情响应（9701/9702），按当前 API 的已驳回/草稿状态形状准备；原 key 逐项备份，验收后已恢复并核对。没有实际创建报销、执行审批/付款、计提折旧、生成采购计划或提交超额放行。只读查询演示销售并点击本地选择项，没有填写原因或其他业务/配置字段；随后取消退出。控制台 warning/error 记录为 0。初次用未注册 /fixed-assets 地址得到原“页面不存在”，核对路由后使用 /accounting/fixed-assets；未修改路由。

关闭本轮新增 7 个工作区并恢复视口、关闭独立浏览器页，原 12 个工作区路径、用户其他浏览器标签和本地服务保留。访问原采购计划路径时，既有工作区逻辑把其历史标签名“补货建议”更新为当前注册名“采购计划”；没有修改标题配置或手动覆盖用户状态。证据 caption-next-cleanup.json、caption-next-gui.json、caption-next-console.json，代表截图 caption-next-{asset-800,credit-selected-final-800,credit-selected-final-wide,expense-rejected-800,plan-800}.png，均位于 /tmp/flowcube-desktop-samples-preview/。

未提交、推送或部署。完整 lint、tsconfig.app.json 类型检查、构建及全量业务回归仍按仓库要求待发版前集中验证；前端约定、文档守卫及 diff 空白检查在本节收尾记录。

收尾：本轮前端约定 5 例通过、文档注入守卫通过、git diff --check 通过；原工作区其他轮次改动保持，最终本批共 19 个文件。源码与最终受影响用例复验结果如上，GUI 浏览器页已核对关闭。


## 报表口径、发票冲突与读取状态续查

本轮以 caption-tail-baseline 保存本批前现场，修改 9 个生产界面文件。经营 KPI 原日期、限仓回款、分仓、负基期环比和动态成本说明移入唯一页头；利润分析原日期、折扣、估算与当前库存边界移入同一位置。成本对账原差异提醒和原截断范围提醒同时成立时合并显示，无提示时回退用途；保留原数值、金额格式、重试及校正按钮条件。排行局部前 N 条口径、单元格估值来源、字段帮助、打印请求折叠记录等局部业务依据保留，不为删除整页重复用途而移除。

发票原并发冲突提示和原复制/关闭/重开说明进入标题下，编辑对象保留；原草稿、revision 基线、刷新与禁止重开条件未改。库存预占明细的无权限/无效商品仓库使用原提示替换用途，原读取条件与快照组件身份不变。仓库范围读取中、凭证详情和明细账读取中不再同时显示通用用途与另一个加载介绍；原数据、错误重试、计数和按钮保持。退款新建的原已收金额边界替换用途。PDA/Android、后端、API、权限判定、配置及依赖无本轮修改。

在 5 个原有组件回归中追加说明位置和单次出现断言，实施前 5 个新断言失败、原 34 例通过；实现后 39 例通过。库存预占的旧弹窗测试外壳补齐 description 呈现，原账号/权限/服务器、迟到响应、快照续读和零预占入口断言保留。相关 21 文件 / 140 例通过，覆盖报表失败/保留数据/隐藏读取、估值精度、发票 409 草稿/revision/重开、新建日期、退款读取/跨目标结果、只读操作和工作区返回等原合同。日志 caption-tail-{red,green,unit}.log；组件与受控 adapter 证据不代替真实 SQL、资金、权限或生产操作。

源码审计对照 400 个生产 TSX：93 个普通 DialogHeader、22 个 AppDialog 均有说明输入；语法诊断、原标题、非渲染业务 tokens 和原 on*/disabled/checked/value 属性差异为 0。只改原说明的呈现位置及选择，已审阅完整本批 patch。证据 caption-tail-source-audit.json、caption-tail-changed-files.json、caption-tail.patch。

GUI 为既有合成预览的 9 条状态/尺寸记录，其中 3 条有业务弹窗。实查 KPI（1470、800）、利润分析、成本差异与截断同时成立、成本无提示回退（800、1470）、退款新建、发票正常录入和仓库范围正常读取。已查页头/弹窗各一处说明，12px/20px/标题后 4px，长文换行、无文档横向溢出，弹窗操作可见。为成本双提示仅临时替换 /tmp 预览的一条合成 GET 响应，逐项备份后恢复并核对，再点原刷新验证无提示回退。未点击校正、创建、保存或权限勾选，不填写字段、不输入密码；未模拟真实发票并发写入，冲突/权限失效/加载中禁止保存分支由上述组件用例覆盖，凭证与明细账加载位置由源码对照覆盖，不虚称所有状态完成 GUI 验收。

控制台 warning/error 记录为 0。保留原 12 个工作区与用户其他浏览器页、本地服务；关闭本轮新增 4 个工作区（报表组合页、成本对账、退货退款、用户管理），恢复视口并关闭独立验收标签。记录 caption-tail-gui.json、caption-tail-console.json、caption-tail-cleanup.json；代表截图 caption-tail-{kpi-800,profit-800,cost-800,refund-800,invoice-800,scope-800}.png，均位于 /tmp/flowcube-desktop-samples-preview/。

未提交、推送或部署。完整 lint、tsconfig.app.json 类型检查、构建及全量业务回归仍按仓库要求待发版前集中执行；前端约定、文档守卫与 diff 检查见本节收尾。

收尾：前端约定 5 例通过、文档注入守卫通过、git diff --check 通过；本批最终为 9 个生产 TSX、5 个原有测试文件和 2 份主题文档，共 16 个文件。原工作区其他轮次改动保持。


### 资金与占库特殊提示续查（caption-edge）

以 caption-edge-baseline 保留本轮开始时的完整前端及主题文档现场，本轮修改 5 个生产弹窗文件与 3 个原有测试。跨期补录的后端原原因移入原审批/记账说明；单据摘要、至少四字的原因帮助、pending 与确认回调保留。登记收付款和继续核销沿原尾差条件把原警告放入唯一标题说明，无警告时恢复用途；原余额仍按未舍入原值展示，候选行自身的待核依据与核销/登记限制不改。

对账新建将原初始、加载、空结果指引移入标题，正常候选回退用途；原查询、勾选、候选失效剔除及生成参数保留。GUI 发现原四轨网格令 800px 窗口的起始日期受挤，调整为往来方与两端日期三列，最终两端日期输入各 171.5px、完整显示；原日期值、默认范围、字段事件及查询合同不改。销售占库沿原授信超额条件移动完整金额、原批准/重申边界与原申请链接，读取时显示原加载信息；原错误重试、未知结果恢复、明细与数量/仓库输入保留。

先增强 3 个已有组件文件中的位置与单次呈现断言，实施前 10 例失败、29 例通过；实现后 39 例通过。再补原候选刷新用例的加载/空结果、原仓库标签用例的授信链接与数值断言，相关 14 文件 / 150 例通过，覆盖历史不足一分值、分配守恒、原请求重试、跨目标结果、占库读失败与授权等。日志 caption-edge-{red,green,unit}.log；均为受控组件/adapter 证据，不替代真实数据库或资金执行。布局最终调整后受影响检查在本节收尾记录。

源码对照 400 个生产 TSX：93 个普通 DialogHeader、22 个 AppDialog 均有说明输入；语法诊断、原标题、非渲染业务 tokens、原 on*/disabled/checked/value 属性与页头差异为 0。只调整原说明呈现及字段布局，完整本批 patch 已审阅。证据 caption-edge-source-audit.json、caption-edge-changed-files.json、caption-edge.patch。

Chrome 独立标签 1170625416，服务为现有 127.0.0.1:5197 合成预览，未连接真实业务库。GUI 检查登记收款的尾差/正常、继续核销尾差、新建收款核销、对账初始/空结果/有候选/勾选，以及占库超额/正常；记录宽屏与 800×650，共 15 条含迭代过程记录。每次标题说明均为一处，ARIA 关联、12px/20px/4px 一致；换视口期间的中间几何不当成最终布局，最终窄屏以 register-legacy-final-800、statement-final-800 等截图为准。跨期补录未通过 GUI 触发，未发起资金写入以制造已结账错误；仅核对其呈现 diff 与相关 backfillFlow/请求恢复组件回归。没有登记/生成/审批/占库等写入。

本轮临时替换的 4 个合成 GET 夹具键已按备份精确恢复；关闭新增客户往来工作区，原 12 个工作区路径完整保留；恢复视口并关闭独立验收标签，用户其余浏览器标签和本地服务保留。控制台 warning/error 为 0。证据 caption-edge-{gui,console,cleanup}.json，最终代表图 caption-edge-{register-legacy-final-800,statement-final-800,reserve-credit-800}.png，均在 /tmp/flowcube-desktop-samples-preview/。

未提交、推送或部署；完整 lint、tsconfig.app.json 类型检查、构建及全量业务回归按仓库要求待发版前集中验证。本批 PDA、后台、接口与配置未修改。

收尾：最终布局调整后的受影响 2 文件 / 34 例复验通过；前端约定 5 例通过、文档注入守卫通过、git diff --check 通过。本轮最终为 5 个生产 TSX、3 个原有测试与 2 份主题文档，共 10 个文件，原工作区其余改动保留。


### 表头统一修复（header-unify）

基于用户授权实施前两轮表头审计发现，先保存 header-unify-baseline，保持 codex/desktop-page-samples 上既有改动。ReportTable 对成功映射的表头显式标记 data-resizable，五类销售弹窗自动退出原静态竖线规则，仅留同一条把手分隔线。支持完整 rowspan/colspan 占位及叶列映射，保持总账双层分组、科目/类别跨行和原金额、合计；每个实际数据列使用带完整分组名称的共用把手。未知/不完整结构及原显式 colgroup 保留原呈现路径。

盘点详情、处置详情、报废建议与已选明细共四组旧网格表头接入 ReportTable 和商品身份表格组件。只读盘点九列，不再预留无标题空操作列；编辑盘点十列，刷新账面仍沿原状态条件。报废选择列有效保留并标名，明细移除列标名操作；处置行备注保留为跨十列的独立行，原文、估值和全部动作保留。删除无调用的商品身份网格变体，避免再形成另一套表头。

共用适应列宽原先按 DOM 下标读取，分组第二行会把借方量成贷方；以两标题不同测量宽度的原分组用例复现 336px 对期望 121px 的错误，再按 data-column-key 对应标题、按 colspan 逻辑位置读取普通/合计行。未改变排序、列重排、鼠标拖动取消/最小宽度、请求、业务输入或配置策略。

先强化 3 个原有测试文件，实施前 7 例失败、27 例通过，实现后 34 例通过；分组适配另有 1 个红例后修复。首次扩大回归发现盘点错误恢复测试仍用旧网格组件替身，移除该替身使用真实商品身份/共用表格，保留原请求、草稿、失败与终态断言。最终相关 17 文件 / 146 例通过；选择器相关 9 文件 / 73 例通过，共 26 文件 / 219 例。日志 header-unify-{red,green,group-fit-red,unit,unit-final,finders}.log。均为受控组件/adapter 证据，不代替实库库存、账款执行或生产验收。

源码对照 400 个生产 TSX：语法诊断、原 on*/disabled/checked/value 事件和控件属性、原标题及页头差异为 0。非渲染 tokens 差异仅为 ReportTable 的新表头映射，以及 ProductIdentityCells 删除无调用的网格变体；三个业务弹窗和总账的非渲染业务逻辑相同。useTableColumns.ts 的差异单独审阅，仅改适配测量的单元格定位。PDA 目录无这些表格组件的直接调用，本轮没有 PDA/Android/后台/配置改动。证据 header-unify-source-audit.json、header-unify.patch 与 changed-files 清单。

Chrome 独立标签 1170625437，现有 127.0.0.1:5197 合成预览，未连接真实业务库。13 条 GUI 记录覆盖：总账宽屏、键盘单列调整、鼠标拖动与 800px 窗口；盘点只读九列、实际鼠标拖动（编码 160→200）、800px 编辑十列及数量 79 在列宽变化后保留；处置行备注、空建议、圈选和已选明细在两种宽度；销售占库表头叶列 border-right 为 0，不再与 1px 把手叠加。所有检查表头均为 #fafafa、12px/18px、10px/16px、500；双层及长标题的自然高度保留。总账拖动不改金额/合计，报废选择与估值不由列宽重算。原正常保存、审批、盘点提交、库存刷新/占库、报废创建及执行均未点击。

7 个临时 GET 夹具键按备份精确恢复，数量恢复原值、圈选主动移除并取消弹窗。本轮新增的四条列宽键属于原网格/无拖动分组新接入后的验收记忆；原始路径没有这些键的写入组件。通过 Chrome Application 面板逐条精确筛选、Delete Selected 删除并核对目标键不再出现在表中，未清空站点存储或用户其他布局。原十二工作区完整保留，新增库存盘点/滞销库存处理工作区已关闭；恢复视口、关闭开发者工具和本轮标签，用户原浏览器页与服务保留。控制台 warning/error 为 0。证据 header-unify-{gui,console,cleanup}.json；代表截图 header-unify-{stockcheck-readonly,stockcheck-draft-800,disposal-selected-wide,ledger-wide,sale-reserve-lines}.png，位于 /tmp/flowcube-desktop-samples-preview/。

本轮未提交、推送或发布。完整 lint、tsconfig.app.json 类型检查、构建及共用组件发版前全量回归仍按 AGENTS 待发版前集中执行；收尾约定、文档守卫及 diff 检查结果随后附记。

收尾：前端约定 5 例、文档注入守卫、git diff --check 均通过。本轮为 9 个生产源文件、4 个已有测试文件、2 份主题文档与 1 份实施清单，共 16 个文件；保留工作区此前其他改动。
