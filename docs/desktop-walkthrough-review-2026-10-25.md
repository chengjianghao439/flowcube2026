# 电脑端走查归编与交互实测（第六轮，2026-10-25）

本轮接在第五轮已提交、已推送的 `6cb4b476fe5922c03cb44abd5d70a07ed513fe12` 上，分支仍为 `codex/desktop-ibm-style`。未 rebase、未合并 main、未打 tag、未发版。提交状态与最终完整 SHA 由交付回复确认。

**结论边界：任务 1、2、3、4、6 完成；任务 7 按授权跳过。任务 5 的常驻共享浮层、主导航及用户菜单完成；调用方直接卸载的表单退出动画仍未完成，不能报成全部浮层通过。** 详见任务 5。产品改动为 13 个 TSX、1 个 CSS；另有 3 个测试文件。完整清单见 [changed-files.txt](desktop-walkthrough-review-2026-10-25/changed-files.txt)，逐处差异行号见 [diff-ranges.json](desktop-walkthrough-review-2026-10-25/diff-ranges.json)。

## 证据条件

真实 React 路由来自当前工作树，Vite 在 `127.0.0.1:5205`，回环合成 HTTP API 在 `58363`，没有连接业务数据库。正常、空、延迟和 503 响应均为本任务的合成夹具；这不是后台业务闭环验收。浏览器使用真实鼠标移动、按下、释放、点击与键盘事件；`requestAnimationFrame` 只读采样样式，没有向 DOM 伪造 open / active / selected 状态。API 写入未用于验收；销售表单会调用原 `/kits/preview` 计算预览，由合成服务响应。

[完整动效帧与事件](desktop-walkthrough-review-2026-10-25/motion-evidence.json)、[按压计算值](desktop-walkthrough-review-2026-10-25/press-evidence.json)、[完整元素属性审计](desktop-walkthrough-review-2026-10-25/selector-audit.json)、[浏览器、焦点与日历检查](desktop-walkthrough-review-2026-10-25/runtime-checks.json) 可逐条复核。截图与计算值来自同一浏览器任务；系统减动效通过浏览器媒体偏好模拟。

## 任务 1：客户双计数

**采纳。** `pages/customers/index.tsx` 删除原 132 行的筛选区重复计数；结果 162 行 ListSummary 的单位改为“位”，与客户口径一致。没有改 total 来源、成功/加载/失败条件、搜索或权限。

改前同时显示“共 2 位客户”与“共 2 条”，改后只显示表下“共 2 位”。[改前](desktop-walkthrough-review-2026-10-25/states/customers-before.png)、[改后](desktop-walkthrough-review-2026-10-25/states/customers-after.png)。

## 任务 2：成套配件筛选卡

**采纳。** `pages/kits/index.tsx:7,64–68` 接入既有 FilterCard，仅增加白卡容器；原 form 的外边距移到卡上，保留 max-w-xl 并补 w-full。表单 key、字段、默认值、100 字限制、查询/清空按钮及 onSubmit 原样保留。

[改前裸搜索行](desktop-walkthrough-review-2026-10-25/states/kits-before.png)、[改后白卡](desktop-walkthrough-review-2026-10-25/states/kits-after.png)、[实际查询状态](desktop-walkthrough-review-2026-10-25/states/kits-filter-after.png)。实际输入关键词、点击查询，再清空：URL 恢复 `/kits`、输入恢复空字符串；未调用保存接口。空态也实际看过：既有超宽表的空态说明偏向横向内容中部，在当前视口偏右，本轮按“只补筛选容器”的边界保留，未宣称修复其空态定位。

## 任务 3：必填星号

**改造采纳。** `components/ui/label.tsx:11–37` 在共享 Label 内把末尾星号、以及后接括号说明的星号拆为 `span.text-destructive-ink`；处理动态字符串与 Fragment，已有红色 span 不重复包裹。未改变标签文字、htmlFor、ref、required / disabled 属性或校验。通配符 `*.csv`、乘法 `单价 * 数量` 保留普通文字。

还查到 3 个未使用共享 Label 的原生标签，分别在 `pages/inbound-tasks/create.tsx:196`、`pages/settings/printers/index.tsx:474,491`，只把其星号拆成同款红色 span，保留原标签与布局。

源码清单有 91 处含星号的 Label/FormField 节点，分布在 37 个源文件，其中 8 处原已使用红色标记；另有上述 3 个原生标签。这里是**源码调用节点数量**，不是运行时字段实例数。动态字段会按原条件渲染。原生标签粗候选还命中 SaleQueryDialog 的 JSX 注释，核实不是可见星号后排除，未改该文件。

受影响的表单/页面族：销售新建及复用销售头部的编辑、采购新建/编辑及驳回、采购申请、两类退货、调拨、收货创建；客户、供应商、普通商品、成套配件、分类、仓库、货架、库存期初、盘点、处置、塑料盒；会计科目、补录、凭证、资金账户、费用类别、报销、固定资产、退款、供应商退款、角色权限；共享手工应付、对账单、收付款登记、核销、跨期补录申请；个人密码与打印机添加。发票、用户表单、超额原因的既有红色标记保持原结构。逐文件/行号及原标签内容见 [共享标签清单](desktop-walkthrough-review-2026-10-25/source-inventory-before.json)、[原生标签候选](desktop-walkthrough-review-2026-10-25/native-label-inventory.json)。

客户表单改前星号随标签为 `rgb(29,29,31)`，改后标记为 `rgb(184,25,38)`；因此“原星号全部为灰色”不作为全站事实。销售、采购、收货、客户、成套配件、发票与密码弹窗均实际检查红色独立标记，见 [计算值](desktop-walkthrough-review-2026-10-25/labels-and-placement.json)、[客户表单](desktop-walkthrough-review-2026-10-25/states/form-after.png)、[收货表单](desktop-walkthrough-review-2026-10-25/states/inbound-form-after.png)、[密码提示中的星号](desktop-walkthrough-review-2026-10-25/states/password-after.png)。打印机添加的两处仅源码核对，未模拟本机硬件桥接。

两处导入模板说明正文引用“客户名称* / 供应商名称*”，属于模板列名示例，不是字段标签；本轮保留原文，未把正文中的星号自动解析为表单标记。清单见 [星号文本审计](desktop-walkthrough-review-2026-10-25/star-texts.json)。

新增 Label 回归先在旧实现上得到 2 失败 / 1 通过，再实现后通过。断言覆盖名称/关联/原生校验、动态标签、括号提示、既有红标记及非必填星号。

## 任务 4：ListSummary 落位

**采纳卡外文字行。** 源码发现 45 个 ListSummary 调用（含通用组件、嵌入区域、风险弹窗及门户）。BaseCrudPage 与多数 ERP 列表均在 DataTable 自带卡片之后渲染。销售差异来自页面自己的 sample-table-panel 外卡及专属底带 CSS，不是 DataTable 内置了另一种汇总模式。

| 被改动的页面 | 表现归编 | 保留的行为 |
| --- | --- | --- |
| 销售订单 | 原 section 保留区域语义，去掉外卡类；DataTable 恢复完整卡片，计数处于其后 | 总数、截断/错误条件、虚拟列表、列宽 |
| 条码打印查询 | 整段 fc-list-footer 移至工作面外；去上边框，左右 padding 对齐普通汇总的 4px | 未核对/等待查询文案、自动刷新说明、canOperate 条件 |
| 运费对账 | 两张 SectionCard 后分别放原汇总，并用无卡片语义 section 维持分组 | 张/单、原分页 total、加载条件 |
| 待办中心 | FulfillmentTodos 的汇总与说明移到 SectionCard 之后 | 筛选、刷新、完整总数、单据/权限入口；summary 模式原先直接返回链接，未变 |
| 滞销库存处理 | HandlingSourcesPanel 的可见卡片止于表格/空态，计数及截断说明置于卡外 | 所有 readable / current / revision / 权限条件与操作回调 |

客户、采购、商品、用户、库存等既有卡外调用保持落位，不批量重构。风险弹窗计数不是表格，门户不在 ERP 壳层内，未借此改造。删除只服务于销售旧外卡的失效 CSS，没有新增另一套汇总组件。

实际核对上述 5 个改动页面，并对照采购、客户、商品、用户、库存；采样的计数 `insideTableCard` 均为 false。待办中心和处置来源还看了正常、空、加载、503 失败四态；计数的原有显示条件没有顺手改变。[计算与祖先记录](desktop-walkthrough-review-2026-10-25/labels-and-placement.json)、[销售前](desktop-walkthrough-review-2026-10-25/states/sale-before.png)/[后](desktop-walkthrough-review-2026-10-25/states/sale-after.png)、[运费前](desktop-walkthrough-review-2026-10-25/states/freight-before.png)/[后](desktop-walkthrough-review-2026-10-25/states/freight-after.png)、[条码前](desktop-walkthrough-review-2026-10-25/states/barcode-before.png)/[后](desktop-walkthrough-review-2026-10-25/states/barcode-after.png)。

## 任务 5：浮层动效与退出边界

**采纳规格，部分完成。** 当前安装没有启用能让现有 animate-in/out 类生效的动画插件；使用现有样式层及 Radix Presence，不增加动画依赖或 JS 延迟状态。原 Radix 工具浮层已有 140ms/100ms 动效，不能概括为所有浮层原先均 animation:none；本轮把同系列工具浮层统一为 200ms/140ms，并补上查询、表单、确认与顶栏菜单。

弹窗进场 200ms、`cubic-bezier(.2,0,0,1)`，opacity 0→1、scale .98→1、Y 3px→0；结束后 transform 回到 none，没有 forwards 残留，避免改变日历 fixed 包含块。退场 140ms，只淡出，关闭阶段禁止指针命中。全局搜索、选择/日期/操作菜单沿原工具浮层规则，进入 opacity + Y -3px→0，退出只淡出。

主导航及用户菜单保留原 state、回调和导航规则，仅将条件卸载改为 hidden/aria-hidden/inert 的呈现开关；用 `@starting-style` 与 display 的离散 CSS 过渡保留退场帧。主导航原 140ms 的移出关闭等待仍在，**等待时间与 140ms 淡出时间分开**。用户菜单仍沿原遮罩/菜单动作关闭，本轮未扩大其外部点击范围。

浏览器 ConfirmDialog 去掉关闭时提前 return null 的呈现短路，让原 AppDialog/Radix 处理退场；Electron 原生 messageBox 分支未变。以上是必要的**呈现挂载方式调整**，不能称 TSX 文本毫无变化；未新增业务状态、定时器、请求、权限或回调行为。

| 实际打开的浮层 | 改前 | 改后实际计算值 / 时序 |
| --- | --- | --- |
| 客户表单 | animation-name none，0s，打开采样全为 opacity 1 | desktop-dialog-open / 0.2s；首个可见样本后 +48.0ms opacity 0.607644；关闭 desktop-tool-close / 0.14s，之后移除 |
| 销售查询 | none / 0s | desktop-dialog-open / 0.2s；+45.7ms opacity 0.406118；退出 0.14s 后移除 |
| 删除发票确认 | 共享 AppDialog 原无弹窗动画 | desktop-dialog-open / 0.2s；desktop-tool-close / 0.14s，存在真实 closed 帧 |
| 全局搜索结果 | 沿原工具浮层动效 | desktop-tool-open / 0.2s；+42.7ms opacity 0.407252；关闭 desktop-tool-close / 0.14s |
| 主导航采购菜单 | none / 0s，立即可见 | animation-name 仍为 none，**使用真实 transition**：opacity/translate 0.2s，关闭 0.14s；进入中间帧 opacity 0.0988597，退出中间帧 0.41555，最终 display none |
| 顶栏用户菜单 | none / 0s | 同款 transition；进入中间帧 opacity 0.405692，退出中间帧 0.415494；最终 hidden + inert + display none |

这些数值是帧采样结果，不要求每次调度落到相同毫秒。完整原始帧保留，可验证确有中间态，而非只添加类名。全局搜索实际存在 cmdk 的 group-heading 属性；审计保留完整 role/data/aria 属性。

减动效实测：查询为 none / 0s，菜单 transition none，按压 scale none；动画没有覆盖媒体回退。退场后弹窗与遮罩数量均为 0、body pointer-events 恢复 auto、焦点回到“查询”；关闭的菜单均 inert，键盘 Tab 从“采购”进入“销售”，没有进入隐藏菜单。日历实际打开，弹窗 transform none、月份标题与日期网格完整可见。[日历状态图](desktop-walkthrough-review-2026-10-25/states/query-calendar-after.png)。

**未完成：调用方立即卸载的业务表单。** 成套配件 KitEditor 关闭后没有 data-state=closed 帧，下一采样帧已不存在；单独保存 [kit-exit-boundary 的实测](desktop-walkthrough-review-2026-10-25/motion-evidence.json)。同页条件渲染的 DeleteKitDialog 在源码上存在相同边界。CSS 无法动画已经被 React 删除的节点；要补齐需要调用方保留业务子树/关闭上下文，超出本轮“不改组件逻辑、数据流”的约束。本轮未引入缓存 props、复制 DOM 或延迟业务回调来伪装通过。其他条件挂载业务弹窗未穷尽实测，均不纳入“已完成退出动画”。

## 任务 6：按压反馈

**改造采纳方案 (a)：scale .98，缩放过渡 120ms，其他原颜色过渡 150ms。** 仅作用于 ERP 内的原生按钮、role=button 与 fc-button（含 asChild 链接），排除 disabled、aria-disabled、data-disabled。表格行按钮、状态页签、段控也适用；列宽拖动手柄 cursor-col-resize 豁免，保留拖动命中几何。链接型菜单项及滑块不作为按钮强行缩放。减动效时无缩放、无过渡。

实测纠正：原主按钮已有 Tailwind 的独立 `scale: .98`，并非完全没有按压态；原共享规则却没有把 scale 放进 transition-property，其他小按钮也未统一。新规则使用同一独立 scale 属性，避免再叠加 transform 导致 .9604。

| 真实鼠标悬停 / 按下 | :hover scale | :active scale | 过渡 |
| --- | --- | --- | --- |
| 主按钮 | 1 | 0.98 | scale 0.12s |
| 表格行操作 | 1 | 0.98 | 同上 |
| 危险确认按钮 | 1 | 0.98 | 同上，危险色保留 |
| 发票状态页签 / 类型段控 | 1 | 0.98 | 同上 |
| 库存 asChild 链接按钮 | 1 | 0.98 | 同上 |
| 禁用保存 | 1 | 1 | 不触发按压 |
| 减动效主按钮 | none | none | none |

主按钮悬停与按压背景同为 `rgb(0,29,108)`，采用缩放反馈，不叠加新的颜色规则；行操作保持 `rgb(0,45,156)`。采样的 offsetWidth/offsetHeight 前后相同，没有布局尺寸变化。完整元素属性、禁用状态与计算值见 press-evidence.json。

## 任务 7：滑动下划线

**按授权跳过。** 当前由每个按钮自身 border-bottom 承担指示线；真实滑移需增加跨项测量和跟随字体、隐藏页恢复、尺寸变化的更新机制，超出本轮小幅表现归编。未改 OrderStatusFilter 结构或选择逻辑。

## TSX 改动逐处说明

下列路径均相对 `frontend/src`，行号为本轮结果；完整零上下文 hunk 见 diff-ranges.json。

| 文件与行号 | 仅表现归编的内容 |
| --- | --- |
| components/layout/TopNav.tsx:132–183 | 菜单容器增加稳定标记及 hidden/aria-hidden/inert；原 hover 定时、状态和链接回调不变 |
| components/shared/UserMenu.tsx:72–131 | 只保留菜单呈现节点；遮罩仍按原开关显示，所有按钮行为不变 |
| components/shared/ConfirmDialog.tsx:89 | 删除浏览器关闭态的提前卸载，交给现有 Radix；native 分支与回调不变 |
| components/shared/FulfillmentTodos.tsx:41–55 | 无卡片语义 section 分组，卡片止于表格，汇总和原说明外置 |
| components/ui/label.tsx:11–37 | 只转换标签 children 的必填标记，原属性/ref 与文本含义保留 |
| pages/customers/index.tsx:132（删除处）,162 | 去重复计数，单位条→位 |
| pages/disposal/HandlingSourcesPanel.tsx:63–69 | 卡片包装止于数据/空态区，计数和截断说明外置 |
| pages/inbound-tasks/create.tsx:196 | 原生供应商标签的星号拆为语义红 span |
| pages/kits/index.tsx:7,64–68 | 接入既有 FilterCard，只调整相关间距/宽度类 |
| pages/logistics/freight-reconciliation.tsx:133–145 | 两组汇总分别移至各自 SectionCard 之后 |
| pages/sale/index.tsx:292 | 去掉独有外卡类，保留区域和原 DataTable/ListSummary |
| pages/settings/barcode-print-query/index.tsx:587–592 | 整段汇总/刷新说明移到工作面外 |
| pages/settings/printers/index.tsx:474,491 | 两个原生标签仅拆分星号 |
| components/ui/label.test.tsx:1–40 | 新回归，验证标签契约与特殊星号 |
| test/workspaceReturn.finance.test.tsx:44,50 | 仅测试操作适配前轮已批准的查询弹窗及编辑菜单，原筛选/返回/草稿断言保留 |

另一个测试改动是 `lib/statusTone.contrast.test.ts:8–17`：解析原有颜色令牌别名，保留所有 4.5:1 断言；未知/循环别名直接失败。不是修改产品颜色。

[AST 辅助差异审计](desktop-walkthrough-review-2026-10-25/diff-audit.json) 对比业务 JSX 之外的程序、事件处理器及数据/禁用/权限绑定。产品文件的事件处理器均原样保留；非 JSX 程序差异仅共享 Label 的呈现解析与 ConfirmDialog 的呈现短路。TopNav 只移除菜单的呈现卸载条件；客户只移除重复计数对应的条件与调整单位。此审计辅助 diff 自查，不替代浏览器和业务验收。无 API、后端、权限表、日期/金额计算或 props 接口改动。

CSS 变动为旧销售底带清理、卡外 footer、工具浮层时间/关键帧及末尾动效/按压规则。产品 CSS 十六进制字面量为 0；index.css 未改，含 `.dark` 的原令牌文件字节与基线一致。[范围与资源证据](desktop-walkthrough-review-2026-10-25/scope-and-cleanup.json)。

## 验证结果与未覆盖范围

- Node 22.23.2；`pnpm --dir frontend exec tsc -b` 通过。
- `VITE_ELECTRON=1 pnpm --dir frontend exec vite build --outDir /tmp/flowcube-desktop-walkthrough-20261025/dist` 通过；产物不入库。
- 全前端 Vitest：418 文件 / 3783 用例通过；共享浮层/标签/返回状态补验 7 文件 / 65 用例通过。完整最终输出分别见 [全量](desktop-walkthrough-review-2026-10-25/frontend-all-tests-final.txt)、[补验](desktop-walkthrough-review-2026-10-25/final-affected-tests.txt)。
- 修改文件 ESLint、`test:frontend-conventions`（5 例）、`test:agents-md-guard`、`git diff --check` 均通过；未降低守卫。
- 首次窄回归因本工作树未安装 backend 的 zod 未启动一个文件；按既有 package-lock 执行 `npm ci --prefix backend --ignore-scripts`，未改依赖声明/锁文件、未启动后端或数据库。
- 首次全量的 6 个失败已在 `6cb4b47` 独立源码快照中逐项复现：5 个颜色别名解析、1 个发票旧交互。只修测试解析和交互步骤，未降低断言或倒改已复核的产品实现。[基线复现](desktop-walkthrough-review-2026-10-25/baseline-failures.txt)、[两文件修复后 27 例](desktop-walkthrough-review-2026-10-25/repaired-tests.txt)。

本轮浏览器覆盖记录（“未逐项”表示不记作通过）：

| 入口 | 实际查看 | 本轮未逐项查看 |
| --- | --- | --- |
| 客户 | 2 条正常列表、双计数对照、新增空表单、开关/焦点、用户菜单及密码空表单 | 客户列表空/加载/失败、保存与所有角色 |
| 成套配件 | 空列表、查询/清空、空新增表单、必填红标记、条件卸载退场边界 | 非空列表/危险删除/加载/失败；空态横向定位未修 |
| 销售 | 6 行正常列表、卡外汇总、查询进出、日期浮层、减动效、新建初始表单 | 业务保存、全部订单状态和权限、大列表 |
| 采购 | 正常列表、卡外汇总、新建初始表单及必填标记 | 空/加载/失败、业务提交 |
| 收货创建 | 初始表单、原生供应商必填标记 | 来源选择完整流程、业务创建与恢复 |
| 商品 / 用户 / 库存 | 正常列表与卡外汇总；库存链接按钮按压 | 各页空/加载/失败及业务弹窗全状态 |
| 条码打印查询 | 正常记录、汇总/刷新说明外置 | 查询等待/失败/恢复各分支、实际打印 |
| 运费对账 | 两张正常表、分别汇总及单位 | 各表空/加载/失败、生成应付/录入 |
| 待办中心履约区 | 正常 1 项、空、延迟加载、503 失败 | 领取/解决与全角色 |
| 处置来源区 | 正常 1 项、空、延迟加载、503 失败 | 意图创建、解除/转单与全角色 |
| 发票 | 待认证/已认证/已抵扣行、行操作/段控/页签按压、危险确认进出、空录入及禁用保存 | 本轮未重验销项全状态、业务认证/抵扣/红冲/删除 |
| 全局搜索 | 3 个合成结果、cmdk 分组属性、选中属性、进入及 Escape 退出 | 空结果/失败/全部类型 |

运行截图是合成响应下的真实页面/事件，不等于真实后台写入、全部权限角色、大数据虚拟列表、PDA、Windows 原生确认框、打印机添加/硬件能力、实际出纸验收。没有重新走查全部 88 条路由，也未宣称所有 Label 调用页面都逐一打开；共享源码清单与已实测入口分开记录。条件卸载弹窗的退出动画属于明确未完成范围，不能以构建或单测通过替代。

本任务命名浏览器 `flowcube-desktop-walkthrough-20261025` 已关闭，session list 确认无本任务会话；自建 5205/58363 服务已停止，原 5197 服务（PID 54161）保留。未把 auth 文件、凭据或真实客户数据放入报告。
