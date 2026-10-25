# 提示词 6 增补：有数据页面表现归编

证据采集于 2026-10-25，交付整理于 2026-10-26。分支 `codex/desktop-ibm-style`，直接基于提示词 6 的提交 `3e1fdd80c9ecef280eec2a19bad39afa6ea021db` 追加；第五轮 `6cb4b476fe5922c03cb44abd5d70a07ed513fe12` 已在其父链中。本报告与本轮源码一起提交，最终新提交完整哈希在交付回复及 Git 分支头中确认。不 rebase、不合并 main、不打 tag、不发版。

六项均有处理；采购“首行常驻蓝色”按实测改判，不添加错误覆盖。价格等级四色情况仅登记。

## 证据与边界

使用当前源码的真实 React 路由、Radix 输出、agent-browser 鼠标/键盘事件和 `getComputedStyle`；桌面视口 1280×900。数据由任务自有 HTTP 服务在 5207/58365 提供合成销售单、采购单、商品、部门等响应，**未向共享数据库造数，也不构成真实后端业务验收**。读取完整 class/role/data/aria，而非只检索 className。

附件包：[浏览器原始记录](desktop-data-state-evidence-2026-10-25/browser-evidence.json)、[63 张截图及 SHA256](desktop-data-state-evidence-2026-10-25/screenshot-manifest.json)、[销售/采购并排对照](desktop-data-state-evidence-2026-10-25/comparison.html)、[93 个列定义前后清单](desktop-data-state-evidence-2026-10-25/column-audit.json)、[TSX 逐处行号](desktop-data-state-evidence-2026-10-25/tsx-change-map.json)。JSON 的 `samples` 键与下文截图文件名一致，含原始属性与计算值。

## 1. 销售与采购详情：采纳并抽取共享呈现

| 段落 | 改前 | 改后与依据 |
| --- | --- | --- |
| 摘要 | 销售五格带卡；采购为金额、行数和逐商品数量文字行 | 共用 `OrderOverviewStrip`。两页都是五格，实测 grid 均为 `307.5px 246px 184.5px 246px 246px`。采购四项为供应商、入库仓库、商品明细行数、采购金额，第五格显示已有采购状态。 |
| 页签 | 销售六个通栏图标按钮；采购三个紧凑标签 | 共用 `DetailViewTabsList/Trigger`，两页通栏、同图标密度，按钮均 `13px`、padding `6px 12px`、高度 `30.5625px`。销售保留原按钮的 aria-pressed 和回调，采购保留 Radix tablist/tab/tabpanel、roving focus、KeepAlive。 |
| 基础信息 | 销售行内标签值；采购 dl 标签列和值列 | 共用 `OrderFacts/OrderFact`，行内“标签：值”；两页六列计算值均为约 `177.66px`。字段、日期格式、原条件进度条、备注和关联收货链接不改。 |
| 明细与数量 | 采购逐商品数量在页头及卡内页脚重复 | 只删除采购页头那一次；明细表原列、卡内数量与金额页脚保留，销售表结构不变。 |

采购第五格采用原 `StatusBadge type="purchase" status={order.status}`。接口没有供本轮直接复用的独立收货状态枚举，故不在呈现改造中新增状态推导。销售原折后金额、商业组行数与回款推导均原样保留。

[销售改前](desktop-data-state-evidence-2026-10-25/screenshots/sale-detail-before.png) / [改后](desktop-data-state-evidence-2026-10-25/screenshots/sale-detail-after.png)，[采购改前](desktop-data-state-evidence-2026-10-25/screenshots/purchase-detail-before.png) / [改后](desktop-data-state-evidence-2026-10-25/screenshots/purchase-detail-after.png)。并排图可按摘要、页签、基础信息、明细四段对照；业务字段和表列并不强制相同。

### 行色改判：未复现常驻蓝色，不修改原斑马规则

同一三行合成采购单，先移开真实指针，记录 `:hover=false`、`:focus-within=false`、无 data-selected，再悬停首行并移开。改前与改后结果相同，且与销售列表相同：

| 场景 | 第 1 行 | 第 2 行 | 第 3 行 |
| --- | --- | --- | --- |
| 销售列表基线，指针移开 | `rgb(255,255,255)` | `color(srgb 0.982353 0.982353 0.985882)` | `rgb(255,255,255)` |
| 采购详情改前，指针移开 | 同上白色 | 同上斑马色 | 同上白色 |
| 采购详情改后，指针移开 | 同上白色 | 同上斑马色 | 同上白色 |
| 采购首行实际 hover，改前/后 | `color(srgb 0.96 0.97051 0.992314)`，`:hover=true` | 不变 | 不变 |
| 再移开指针，改前/后 | 恢复白色 | 不变 | 不变 |

将浏览器计算颜色绘入 1×1 canvas 读回 8-bit RGBA，斑马为 `[251,251,251,255]`，即本基线实际为 **#FBFBFB**；提示词中的 #FBFBFC 与现令牌混色存在一通道差异。hover 为 `[245,247,253,255]`。因此不硬编码 #FBFBFC，也不压掉合法 hover。原始样本见 `sale-list-before-style`、`purchase-detail-before-style`、`purchase-detail-hover-before`、`purchase-detail-away-before` 及对应 after 键。

交互：真实点击销售六个视图、采购三个视图后返回订单信息，明细三行仍在；采购 ArrowRight 实际激活“收货进度”，保留 tabpanel 语义。[键盘状态图](desktop-data-state-evidence-2026-10-25/screenshots/purchase-tabs-keyboard-after.png)。没有点击提交、取消订单、审批、收货等业务写动作。

## 2. 页脚：采纳家族口径补正

将既有两条 form 专用 CSS 页脚规则的选择器推广为电脑端 `.fc-dialog-footer` 及其 `.fc-button`。原 app-dialog 规则不动。没有逐弹窗改 TSX，也不改页头、正文、左侧附加信息的 flex/对齐、既有负外边距或对话框尺寸。

| 查询资金账户的实际计算值 | 改前 | 改后 |
| --- | --- | --- |
| footer 背景 | `rgba(0,0,0,0)` | `rgb(245,245,247)` = surface-subtle |
| padding | `0px` | `12px 20px` |
| 上边框 | `0px solid rgb(210,210,215)` | `1px solid rgb(210,210,215)` |
| 清空/取消/查询按钮 | 全部 `40px / 14px` | 全部 `36px / 13px` |

[查询资金账户改前](desktop-data-state-evidence-2026-10-25/screenshots/finance-query-before.png) / [改后](desktop-data-state-evidence-2026-10-25/screenshots/finance-query-after.png)。也实际打开 [新建账户](desktop-data-state-evidence-2026-10-25/screenshots/finance-form-after.png)、[新建报销单](desktop-data-state-evidence-2026-10-25/screenshots/expense-form-after.png) 和审批流表单；前两者的 `*-after-style` 样本记录同样的灰带和 36px/13px。ConfirmDialog 沿原 app 家族，日志确认实测保留危险最终按钮。

## 3. 审批流：采纳，补齐实际存在的五类控件

除了点名的业务类型、审批人类型、角色，条件分支还有部门与指定用户。五类全部替换为已有共享 `Select/SelectTrigger/SelectContent/SelectItem`，同一时刻按原条件显示三项。标签 htmlFor/id、选项文案、编辑时禁用业务类型、处理中的 fieldset 锁定语义保留。

| 控件 | 实测状态 |
| --- | --- |
| 业务类型 | 新增时鼠标选择“费用报销”；编辑时 disabled |
| 审批人类型 | 指定角色 → 部门负责人 → 指定用户 |
| 角色 | 空提示 → 演示查看角色；原隐藏角色在回归中保留原 ID |
| 部门 | 空值显示“申请人所属部门” → 采购部；编辑的部门 ID=0 显示默认项且仍提交 0 |
| 用户 | 选择合成用户“演示预览”；不可用用户的原回退选项仍按原条件保留 |

改前是原生 SELECT；改后 DOM 为 `BUTTON role="combobox"`，浮层为带 `data-state` 的 listbox/option，记录了完整 Radix 属性。[改前](desktop-data-state-evidence-2026-10-25/screenshots/approval-before.png)、[角色](desktop-data-state-evidence-2026-10-25/screenshots/approval-after-role.png)、[部门默认](desktop-data-state-evidence-2026-10-25/screenshots/approval-after-department-default.png)、[部门选择](desktop-data-state-evidence-2026-10-25/screenshots/approval-after-department.png)、[用户](desktop-data-state-evidence-2026-10-25/screenshots/approval-after-user.png)、[编辑禁用](desktop-data-state-evidence-2026-10-25/screenshots/approval-after-edit.png)、[展开选项](desktop-data-state-evidence-2026-10-25/screenshots/approval-options-after.png)。浏览器不保存流程。

`__none__` 只适配 Radix 不接受空 SelectItem 的控件约束，选择后还原原 `''`，保留原 `Number(...)` 提交转换。部门 `'0'` 仅在显示层映射默认项，不改 draft 或提交函数。新增 6 项回归检查三分支精确载荷、隐藏角色、pending 锁定、原部门 0；原 `handleSave` 和 setStep 的 AST 指纹完全一致。先在原生实现跑到 4 个红例；新增部门 0 用例还捕获了显示适配遗漏，修正后 6 项全过。红例未作为产品通过证据。

## 4. 短列：采纳，按实际内容和列类型收窄

共享状态标记只新增 `white-space:nowrap`；人员列按完整 `data-column-key` 白名单匹配原 `.min-w-0/.whitespace-normal` 包裹层：operatorName、realName、applicantName、manager、managerName、ownerName、userName。未对所有 `*Name`、所有 td 或所有 span 下 blanket 规则。商品、客户、供应商、备注等长文本继续原换行与展开行为。

| 有数据实测 | 改前 | 改后 |
| --- | --- | --- |
| 商品启用/停用 | 列宽 70px；normal；标签高 40px；两行 | 列宽 96px；nowrap；标签高 22px；一行 |
| 销售“欧阳诸葛明” | 列宽 96.046875px；normal；内容高 37.125px；两行 | 列宽 126px；nowrap；内容高 18.5625px；一行 |
| 客户状态 | 默认宽 70px | 默认/最小宽 96px，状态标记 nowrap |
| 库存流水操作人 | 原默认宽 90px | 实测 112px、nowrap、一行 |
| 收付款核销经办人 | 原默认宽 90px | 实测 112px、nowrap、一行 |
| 采购退货经办人 | 原默认宽 90px | 实测 112px、nowrap、一行 |
| 销售退货经办人 | 同一共享页面，原默认宽 90px | 实测 114.59375px、nowrap、一行 |
| 调拨经办人 | 原默认宽 90px | 实测 123.875px、nowrap、一行 |
| 商品改价三字状态 | 共享 nowrap 应用后额外抽查：列宽 80px、内容区 48px，标签 50.5px 会裁切 | 默认/最小宽 96px、内容区 64px，标签仍为 50.5px/22px，完整一行 |

销售 width 是比例权重，不能把 7 当成 7px：状态/回款权重不变，补 minWidth=112；经办人权重 7→9 并补 minWidth=112。四个其他人员列是原 90px，统一默认/最小 112px。商品、客户及改价状态为 96px。列宽持久化和缩放行为由原 useTableColumns 处理。

[商品状态可见截图](desktop-data-state-evidence-2026-10-25/screenshots/products-nowrap-visible.png)、[销售姓名可见截图](desktop-data-state-evidence-2026-10-25/screenshots/sale-name-nowrap-visible.png)、[库存流水](desktop-data-state-evidence-2026-10-25/screenshots/inventory-log-name-after.png)、[付款核销](desktop-data-state-evidence-2026-10-25/screenshots/receipt-name-after.png)、[采购退货](desktop-data-state-evidence-2026-10-25/screenshots/purchase-return-name-after.png)、[销售退货](desktop-data-state-evidence-2026-10-25/screenshots/sale-return-name-after.png)、[调拨](desktop-data-state-evidence-2026-10-25/screenshots/transfer-name-after.png)、[商品改价补宽前](desktop-data-state-evidence-2026-10-25/screenshots/price-change-width-before.png) / [后](desktop-data-state-evidence-2026-10-25/screenshots/price-change-width-after.png)。

[列审计附件](desktop-data-state-evidence-2026-10-25/column-audit.json) 逐条列出 93 个候选定义的文件、行号、key、title、width、minWidth 与完整 render；涵盖启停、单据/回款/任务状态、审批、会计、财务、库存、打印、人员等。其余定义不统一扩宽，例如库位/分拣格为两字，80px 可容纳；库存流水 typeName 实际取页面“入库/出库/调整”两字映射，不按 API 中的四字 typeName 误判。93 个源码候选不等于 93 个列均做过有数据浏览器验收，实际覆盖限上表与截图。

## 5. 汇总与设备搜索：采纳，明确计数来源

| 页面 | 数据来源/单位 | 有数据与交互 | 空态/加载/失败 |
| --- | --- | --- | --- |
| 补货建议 | 原 pagination.total，项待补货 | 计数由表上移至 DataTable 卡外表后；1 项。实际勾选/取消首行，选中背景 `color(srgb 0.93 0.948392 0.986549)` 保留 | 共 0 项待补货；加载/失败不展示计数 |
| 打印模板 | 原 data 数组长度，个模板 | 9 个；不拿未返回的全库总数代替 | 共 0 个模板；加载/失败不展示计数 |
| 部门树 | 原 rows.length，个可见部门 | 展开 5，全部收起 2，搜索采购部为匹配节点及祖先共 2 | 共 0 个可见部门；加载/失败不展示计数 |
| 桌面 PDA 设备管理 | 原 pagination.total，台 | 3 台；输入设备1，HTTP keyword 请求后 1 台 | 共 0 台；加载/失败不展示计数 |

部门不称“全部部门”：折叠会减少可见节点，搜索会保留上下文祖先，单位写明口径。未新增树遍历或统计查询。设备原来仅 total>20 才显示计数，本轮改为成功返回时都显示，数据源、page=1/pageSize=20 保持原状。

PDA 设备原筛选属于卡内即时输入，和标准 FilterCard 的差异是容器及触发时机。**容器改造成本小**：移出卡内 toolbar，放入已有 FilterCard，DataTable 自带表卡，不再双层；原 input 的值、onChange 和 queryFn 不改。增加“查询”按钮会引入草稿/应用状态，超出表现层，因此保留即时筛选。

[补货改前](desktop-data-state-evidence-2026-10-25/screenshots/replenishment-before.png) / [改后](desktop-data-state-evidence-2026-10-25/screenshots/replenishment-after.png) / [选中](desktop-data-state-evidence-2026-10-25/screenshots/replenishment-selected-after.png)；[模板](desktop-data-state-evidence-2026-10-25/screenshots/templates-after.png)；[部门展开](desktop-data-state-evidence-2026-10-25/screenshots/departments-after.png) / [收起](desktop-data-state-evidence-2026-10-25/screenshots/departments-collapsed-after.png) / [搜索](desktop-data-state-evidence-2026-10-25/screenshots/departments-filtered-after.png)；[设备](desktop-data-state-evidence-2026-10-25/screenshots/pda-devices-after.png) / [即时筛选](desktop-data-state-evidence-2026-10-25/screenshots/pda-filter-after.png)。四页还各附 `*-empty-after.png`、`*-loading-after.png`、`*-error-after.png`，并有对应 summary 计算记录。

额外发现：设备页原来没有局部 QueryErrorState/重试分支，500 后回落空表；本轮仅保证失败时不展示“共 0 台”，没有扩大到错误处理流程。合成部门最初漏给 memberCount，造成截图的直属成员显示 undefined；随后补齐夹具并重拍当前部门有数据/收起/搜索图，没有修改产品渲染来掩盖夹具问题。

## 6. 日志危险入口：采纳，并登记其他实心危险按钮

只把操作日志页头“清理旧日志”改为 outline + destructive-ink 字色 + destructive/30 边框，保留权限、size、onClick、原 ConfirmDialog 和最终清理动作。改前按钮背景 `rgb(218,30,40)`、白字；改后背景为原 outline 的 `bg-muted/40`（计算值 `oklab(0.970708 0.000790298 -0.00252372 / 0.4)`），字色 `rgb(184,25,38)`，边框为 destructive/30。[改前](desktop-data-state-evidence-2026-10-25/screenshots/oplogs-before.png) / [改后](desktop-data-state-evidence-2026-10-25/screenshots/oplogs-after.png) / [原确认弹窗](desktop-data-state-evidence-2026-10-25/screenshots/oplogs-confirm-after.png)。实际打开并点取消，未执行清理。

源码扫描还发现 16 个固定实心危险 Button，完整元素及祖先见 [危险按钮清单](desktop-data-state-evidence-2026-10-25/solid-danger-buttons.json)。本轮均保留：

| 位置 | 动作 | 保留理由 |
| --- | --- | --- |
| UserMenu:188 | 退出登录 | 弹窗最终动作 |
| credit-overrides/index:304 | 确认驳回 | 已填写原因后的最终提交 |
| DisposalDetailDialog:165、200 | 执行报废入口；确认驳回 | 详情弹窗业务动作及最终提交，登记，不扩大改造 |
| fixed-assets/index:137 | 确认处置 | 最终提交 |
| kits/index:99 | 确认删除/原请求重试 | 最终动作与恢复流程 |
| picking-waves/index:310 | 取消批次入口 | 详情弹窗入口，后接确认；登记保留 |
| price-change/index:284 | 确认驳回 | 最终提交 |
| purchase/form/index:750、purchase/index:428 | 确认驳回 | 最终提交 |
| RefundDetailDialog:194 | 执行退款入口 | 详情弹窗入口，后接确认；登记保留 |
| SaleCancelDialog:24 | 确认取消 | 最终动作 |
| settings/printers/index:434 | 行删除入口 | 行级入口，后接确认；登记保留 |
| sorting-bins/index:259 | 行删除入口 | 行级入口，后接确认；登记保留 |
| CheckDetailDialog:326 | 取消盘点入口 | 详情弹窗入口，后接确认；登记保留 |
| transfer/index:301 | 确认异常了结 | 填写原因后的最终提交 |

这 16 处并非都属于“最终确认”：表中明确区分了仍需统一策略的详情/行入口。动态危险变体如共享 ConfirmDialog、补录的确认动作按钮也保留，未把 `hover:bg-destructive/...` 的既有红框按钮误计成实心红主按钮。该清单是源码审计，未逐个执行这些业务动作。

## 价格等级四色：只登记，未改

来源为 `pages/products/form.tsx:165–169` 的 priceFields 与 `428–434` 的标签渲染；新建 `/products/new` 与编辑 `/products/:id` 共用此表单。四个值本轮前后均从真实 DOM 读到一致颜色：[改前登记图](desktop-data-state-evidence-2026-10-25/screenshots/price-colors-registration.png)、[改后登记图](desktop-data-state-evidence-2026-10-25/screenshots/price-colors-registration-after.png)、[源码清单](desktop-data-state-evidence-2026-10-25/price-source-audit.json)。

| 价格 | 源码 utility | 实际来源 | 浏览器计算值 |
| --- | --- | --- | --- |
| A | text-blue-600 | tailwind-v3-colors.js 的 --blue-70 | `rgb(0,67,206)` / #0043CE |
| B | text-emerald-600 | desktop CSS 兼容映射 --success-ink | `rgb(14,96,39)` / #0E6027 |
| C | text-orange-600 | desktop CSS 兼容映射 --warning-ink | `rgb(104,78,0)` / #684E00 |
| D | text-rose-600 | desktop CSS 兼容映射 --destructive-ink | `rgb(184,25,38)` / #B81926 |

等级 A/B/C/D 是现有业务字段；未找到另立的四色等级编码规范，不能据此认定颜色已由用户拍板。商品新建/编辑有这组四色标签；成套配件编辑器的 A–D 选项是普通文字，没有相同四色类。本轮未改价格表单、价格枚举、四色兼容映射或任何价格业务规则，等待用户裁定。

## 改动文件与表现层依据

本轮 24 个 TSX 路径（含 1 个测试）和 1 个 CSS；下面每行覆盖该文件全部产品改动。精确 hunk 见 `tsx-change-map.json`，行号为本轮提交内容。

| 文件（均在 frontend/src） | 行号 | 只是表现归编的依据 |
| --- | --- | --- |
| `components/shared/ContentTabs.tsx` | 6, 35, 37, 39–40 | Radix asChild 接共享页签外观，原 selectTab、回调去重和 KeepAlive 不动 |
| `components/shared/DetailViewTabs.tsx` | 1–13 | 新增无状态 List/Trigger 呈现基础件，透传 ref 与原生属性 |
| `components/shared/OrderFacts.tsx` | 1–9 | 新增标签值网格呈现基础件，无数据处理 |
| `components/shared/OrderOverviewStrip.tsx` | 1–19 | 原销售五格 markup 抽出，字段仍由原调用方提供 |
| `components/shared/ReceiptPanel.tsx` | 117 | 仅经办人列默认/最小宽改为 112 |
| `pages/approvals/flows.select.test.tsx` | 1–92 | 新增 6 项精确提交值、锁定、隐藏角色、部门默认值回归，不属产品逻辑 |
| `pages/approvals/flows.tsx` | 11, 57, 222–225, 259–266, 271–278, 284–290, 296–303 | 五类原生选择入口换共享 Select，空值仅适配显示，原保存/校验不动 |
| `pages/customers/index.tsx` | 105 | 仅状态列默认/最小宽 96 |
| `pages/departments/index.tsx` | 5, 351–352 | 表后接 ListSummary，使用原 rows.length，单位个可见部门 |
| `pages/inventory/index.tsx` | 290 | 仅流水操作人列默认/最小宽 112 |
| `pages/oplogs/index.tsx` | 192 | 仅页头清理按钮 variant/classes，原权限及回调不变 |
| `pages/price-change/index.tsx` | 192 | 仅状态列默认/最小宽 96，不改任何价格颜色或逻辑 |
| `pages/products/index.tsx` | 192 | 仅状态列默认/最小宽 96，价格表单未动 |
| `pages/purchase/form/PurchaseOrderOverview.tsx` | 1–16 | 新增采购摘要呈现，读取原字段及现有 StatusBadge |
| `pages/purchase/form/index.tsx` | 11–12, 630–633, 641, 649–650, 657, 661, 664–665, 688–689, 691 | 详情摘要/事实/页签改为共享呈现，去页头重复数量；条件进度与收货链接不变 |
| `pages/reports/replenishment.tsx` | 2, 214, 216, 240–241 | 原总数计数移至表后 ListSummary；选择与创建不变 |
| `pages/returns/index.tsx` | 255 | 仅共用退货列表经办人列默认/最小宽 112 |
| `pages/sale/form/components/SaleOrderDetailTabs.tsx` | 2, 16–20 | 六个原按钮接共享 List/Trigger，原类型/props/选择回调不变 |
| `pages/sale/form/components/SaleOrderInfoCard.tsx` | 2, 11–23, 25–26 | 原字段值与条件原样放入共享 OrderFacts/OrderFact |
| `pages/sale/form/components/SaleOrderOverview.tsx` | 6, 20, 23 | 原计算与 cells 不变，仅委托共享五格 markup |
| `pages/sale/index.tsx` | 244–246 | 状态/回款增加 minWidth，经办人权重和 minWidth；renderer 与业务回调不变 |
| `pages/settings/pda-devices/index.tsx` | 39, 62, 145, 153–154, 165 | 搜索容器换 FilterCard，计数沿原 total 并按成功状态呈现，原即时请求不变 |
| `pages/settings/print-templates/index.tsx` | 17, 104–105 | 表后接 ListSummary，使用原 data.length |
| `pages/transfer/index.tsx` | 198 | 仅经办人列默认/最小宽 112 |

CSS：`frontend/src/styles/desktop-page-samples.css:338`（状态不换行）、451–452（页脚家族）、758–767（共享通栏页签与人员列白名单）。样式值沿既有令牌；没有新增产品硬编码十六进制，没有触碰 `.dark` 块。其他文件为本报告、证据包、实现计划及 `docs/frontend-pda-conventions.md` 的对应口径同步。[全部提交路径清单](desktop-data-state-evidence-2026-10-25/changed-files.txt)。

[不变量审计](desktop-data-state-evidence-2026-10-25/invariant-audit.json)：19 个已有 TSX 文件中提取的 27 个 useQuery/useMutation 调用、handleSave、setStep、selectTab 等 AST 指纹与基线完全一致。新 Select 绑定只作原 onChange 值转换的 UI 适配；这部分另外以精确载荷、禁用和默认值测试验证。后端、API、types、generated、store、PDA、TemplateRenderer、价格表单与 index.css 均无差异。此证据证明本轮所审阅的调用与变换未改，不能代替全部角色与真实写流程验证。

## 验证结果

- Node 22.23.2，加载项目 dev-env。
- `pnpm --dir frontend exec tsc -b`：退出 0，包含 app/node 项目，未使用空壳 tsconfig 的无效检查。
- `VITE_ELECTRON=1 pnpm --dir frontend exec vite build --outDir /tmp/flowcube-desktop-data-state-20261025/dist`：退出 0；产物留在任务临时目录，不提交 dist。
- 改动 TSX 的 ESLint：最初 23 路径退出 0，最后补充的商品改价文件单独退出 0。
- 前端全量 `CI=true pnpm --dir frontend exec vitest run`：**419 文件 / 3789 用例全部通过**。stderr 含既有 WorkspaceSafety 故意抛出的“合成单页渲染错误”等 ErrorBoundary 负例，最终无失败。
- 审批 Select、ContentTabs、部门专项：3 文件 / 18 用例通过；其后全量包含这些用例。
- 全量后仅补充商品改价的列宽常量：重新类型检查、桌面构建、该文件 ESLint，及只读动作相关回归 **1 文件 / 21 用例通过**；没有复用改前构建结论。
- 原始输出在 [checks 目录的构建记录](desktop-data-state-evidence-2026-10-25/checks/build.txt)、[全量测试记录](desktop-data-state-evidence-2026-10-25/checks/frontend-tests.txt)、[补充回归](desktop-data-state-evidence-2026-10-25/checks/width-followup-tests.txt)。类型检查与 lint 输出为空，退出状态另在交付核验中确认。
- 提交前另核对 frontend-conventions、agents-md guard、`git diff --check` 及附件路径完整性，结果见 checks/root-checks.txt。

浏览器收尾：只关闭 `flowcube-desktop-data-state-20261025`，延迟回读 [session list](desktop-data-state-evidence-2026-10-25/browser-cleanup.json) 为 sessions=[]。刚 close 返回时守护进程清单仍短暂含本会话，因此没有将第一次回读当作已完成。5207/58365 自有服务已退出，原 5197 服务 PID 54161 保留。

## 未覆盖与主动改判

- 未连接真实数据库或复核方造数环境；未验销售/采购提交、审批保存、收货、退款、删除、日志清理、权限岗位全集、并发、全量大数据虚拟列表、PDA 原生与实际出纸。合成演示响应不冒充真实后端或生产验收。
- 详情主要为草稿三行单据；六/三个视图及键盘已走查，不声称覆盖所有单据状态、所有关联收货异常与长期保活场景。共享 ContentTabs 的其他消费者只通过现有回归，没有全部逐页重拍。
- 93 列是源码候选审计，有数据实测范围按任务 4 表列出；超长人员名称、不同缩放、全部历史手动列宽组合未穷举。
- 页脚抽查含资金查询/账户/报销与审批；特殊业务页脚的所有组合未逐个打开，原 flex 与附加内容结构未改。
- 设备请求失败的原局部错误呈现缺口已登记；此前提示词 6 的调用方直接卸载弹窗退出动画边界沿原报告保留，本轮未扩展动效。
- 采购首行常驻蓝色改判为未复现；实际斑马为 #FBFBFB，未硬改为提示词写的 #FBFBFC。
- 采购第五格使用现有采购状态；PDA 设备保留即时搜索；部门用明确的可见节点计数；审批控件覆盖实际五类；其他危险按钮及价格四色均如实登记，不擅自统一业务含义。
