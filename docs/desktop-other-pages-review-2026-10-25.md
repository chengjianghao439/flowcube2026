# 其他电脑端页面精修与逐页记录（2026-10-25）

本轮基线为已复核的 `93109deb5c922266d49634fa8fdcc817083830b4`，继续在 `codex/desktop-ibm-style` 追加提交并推送，等待复核，不合 main、不打 tag、不发版。产品改动只有 `frontend/src/styles/desktop-page-samples.css` 末尾新增 71 行、16 条规则；原文件前缀逐字保留，TSX、结构、类名、业务请求和根令牌均未修改。

## 参考文件的取舍

| 参考组 | 核实与处理 |
| --- | --- |
| 全局搜索 | 基线已有搜索样式，不能称为“完全未覆盖”。`PopoverContent` 同元素含 `fc-global-search-results`、`fc-popover`、`role="presentation"` 和 `data-search-results`；当前 Popover **没有 Portal**。cmdk 实际输出 `[cmdk-group-heading]`、`[cmdk-list][role="listbox"]`、`[cmdk-item][role="option"]`，选项同时有 `data-selected` / `aria-selected`、`data-disabled` / `aria-disabled`。按实际属性补选中态，排除两种禁用标记；结果项 8px，外层 14px。已有列表 padding、边框、底栏 padding / border 不重复写。 |
| 浮层圆角 | 新增 ERP 范围的 `--desktop-radius-popover:14px`，Popover、Select、DropdownMenu 与顶栏菜单共用。选项、输入、分段控件、20px 对话框保留各自形态。 |
| 面板圆角 | `fc-list-workbench`、`fc-tax-panel` 使用 `--desktop-radius`。同时修正内嵌表格最后一块仍为 13px 的底角：随父面板计算为令牌减 1px，避免父面板 16px、内部仍停旧值。 |
| 库存数字 | 不另加重复规则：外壳本就继承 `tabular-nums`，数量组件各数字 span 也有该 utility。浏览器四个 `desktop-stock-stat-value` 的计算样式均为 `tabular-nums`；分单位数量及无边框分隔形态保留。 |
| 库存表头 | 保留 `--surface-subtle`。参考稿认为主表是白底，但基线后段已将 DataTable / ReportTable 改为浅灰，实际计算值为 `rgb(245,245,247)`。库存原本就与主表一致；改白反而制造差异。ReportTable 已有 tfoot utility，本轮不重复。 |

## 自查发现并修正

- 搜索内层 listbox 被原通用浮层规则命中，形成第二层阴影；仅对搜索内部真实的 `[cmdk-list][role="listbox"]` 清除阴影及外圆角。
- 搜索浮层会被工作面遮挡。源码显示 Popover 内联挂载于顶栏，顶栏 `backdrop-filter` 建立层叠上下文。浏览器点位命中先落到库存统计卡；临时只调顶栏层级后命中搜索，坐标保持不变。最终用 `--desktop-layer-header:20` 调整 flex 子项层级，Dialog / Sheet 原 50 保留。
- 仓库运营 `FlowBar` 有三处内联旧色。严格保留 TSX，以 `ReportMeter` 实际 `aria-label="待拣货" / "待复核" / "待打包"` 分别映射中性、blue-60、blue-80。`!important` 仅覆盖这三个内联 color；不匹配颜色字符串、不按行序猜状态。服务端标签确实来自 `WT_STATUS_NAME`，六个流程和零值均已渲染。
- 审批未知类型的单据号虽有原生 `disabled`，仍显示主色及 hover 下划线。只对表格内 `button.text-primary:not(.fc-button):disabled` 改为中性文字并取消下划线。实际悬停禁用项后，两个可用入口仍为主色，禁用入口为 `rgb(110,110,115)`；fc-button 的普通、危险、幽灵变体不进入该规则。

CSS 全文件十六进制色字面量为 0。**源 TSX 仍保留上述三处旧色字面量**，因为本轮硬性要求 TSX 零改动；本轮修正的是最终呈现。未来修改流程可访问名称时，须同步这三条语义选择器。打印模板编辑器另有四处纸张画布颜色，属于单据内容，未纳入 ERP 皮肤修改；不宣称产品源码所有十六进制均清零。

## 逐页浏览器记录

使用本工作树真实 React 路由，回环合成 HTTP transport，不连接数据库。正常状态来自合成列表；加载由延迟 GET 触发，空态由空 GET 响应触发，搜索失败为 503。选择、打开菜单/弹窗、填数量、切换页签均通过浏览器交互完成，没有给 DOM 注入选中或禁用属性。草稿离开保护保留；后段复查采用带 review 查询的整页导航进入新页面，没有修改应用守卫。请求日志非 GET 数为 0，没有确认业务写入。

下表“无”指该页面源码未提供该类控件或行选择，不计作已测通过；“未验”指存在但本轮未触发。每个图版按原始捕获名标注，缩放为 50%；原始图 SHA256 和对应 DOM / 计算样式保存在 JSON 中。总计 **14 个路由、65 份画面及 DOM 记录、14 张逐页状态图版**，不等于各页全部分支通过。

| 页面 / 路由 | 正常、选择 | 危险操作 | 禁用 | 空态、加载 | 未覆盖 / 图证 |
| --- | --- | --- | --- | --- | --- |
| 采购列表 `/purchase` | 1 单；草稿 radiogroup 选中，下划线保留；行菜单 | 取消菜单及红色确认框，只打开 | 提交中的禁用未验；无行多选 | 空列表、骨架 | 未确认取消/提交、无岗位矩阵。[图](desktop-other-pages-review-2026-10-25/states/purchase.png) |
| 采购表单 `/purchase/new` | 空表单、供应商/商品真实选中、仓库下拉、1 行填入 | 行移除按钮悬停保持危险文字，未删除 | 查找器未选中时确认禁用 | 空商品明细、供应商“正在查询” | 保存中、保存失败、全部校验未验。[图](desktop-other-pages-review-2026-10-25/states/purchase-form.png) |
| 收货创建 `/inbound-tasks/new` | 选供应商、原采购行填 10 只，确认查找器后填入 1 行 | 行移除未验；未创建收货 | 未选供应商时“选择商品”禁用 | 空表单、采购明细加载 | 查找器无可用采购行、创建中、恢复与失败未验。[图](desktop-other-pages-review-2026-10-25/states/inbound-create.png) |
| 收货详情 `/inbound-tasks/401` | 草稿、2 明细、默认收货信息页签 | 取消任务入口及红色确认框，只打开 | 取消中/提交中未验 | 详情加载；详情不存在未验 | 未看执行中/已上架等其他单据与全部子页签；无行多选。[图](desktop-other-pages-review-2026-10-25/states/inbound-detail.png) |
| 库存总览 `/inventory` | 4 行、分单位统计；真实打开第 2 偶数行条码抽屉，`data-selected=true`，选中底色保留 | 出库表单只打开 | 未填出库提交禁用；流水页签下导入禁用 | 空库存、加载文字及统计“读取中” | 1024px 表内滚动已看；未出入库、未验大量虚拟行和全部抽屉动作。[图](desktop-other-pages-review-2026-10-25/states/inventory.png) |
| 调拨 `/transfer` | 草稿/在途/完成 3 行，原单/分体行按钮 | 在途异常了结菜单及弹窗，只打开 | 原因空白时确认禁用 | 空列表、骨架 | 未确认调拨/取消/异常了结；无行多选。[图](desktop-other-pages-review-2026-10-25/states/transfer.png) |
| 账簿 `/accounting/ledger` | 2 科目、分组跨行跨列、合计；点科目打开明细账 | 只读页无危险动作 | 无写入禁用控件 | 空期间、加载 | 1024px 已看；未验长科目树/所有期间；无行选择。[图](desktop-other-pages-review-2026-10-25/states/ledger.png) |
| 凭证 `/accounting/vouchers` | 已生成/已冲销 2 张、科目下拉、手工录入、查询日历 | 删除红色确认框，只打开 | 最少两条分录时移除禁用、未填完整时保存禁用 | 空凭证、骨架 | 未冲销/保存/删除；日历自动焦点与首个科目选择器组合只取得一次菜单画面，重复检查未完成，不计完整通过。[图](desktop-other-pages-review-2026-10-25/states/vouchers.png) |
| 审批 `/approvals/pending` | 采购/报销/未知类型 3 项 | 此列表仅去原单，无审批危险确认 | 未支持类型的单据号/去审批禁用；悬停后仍中性 | 空待办、骨架 | 未进入原单审批、未验授权变化；无行多选。[图](desktop-other-pages-review-2026-10-25/states/approval.png) |
| 资金看板 `/finance/dashboard` | 1 账户、6 月收支、账龄、下半页图表；环图/柱线图等待连续 20 帧稳定后重拍 | 只读看板无危险动作 | 此子页无待提交禁用表单 | 账户/收支/费用/流水空态、加载 | 空态仍保留独立账龄合成数据，不是账龄全零；未验多账户归并、图表全部提示与异常恢复。[图](desktop-other-pages-review-2026-10-25/states/finance.png) |
| 仓库运营 `/reports/warehouse-ops` | 6 流程含零值、1 人效率、5 小时趋势、1 条异常 | 报表无危险写入 | 无业务提交禁用控件 | 四个空面板、旋转加载 | 未验持续轮询、所有图表提示、大量人员；无行选择。[图](desktop-other-pages-review-2026-10-25/states/warehouse-ops.png) |
| 条码打印查询 `/settings/barcode-print-query` | 入库类别选中；2 条码；已打印与业务作废并列 | 无危险按钮变体，未发补打 | 作废条码补打禁用，可补打行保持普通变体 | 空类别、骨架及读取提示 | 1024px 已看；出库/物流类别、恢复、补打未知结果与打印机实机未验。[图](desktop-other-pages-review-2026-10-25/states/barcode.png) |
| 报税 `/accounting/tax` | 增值税子页两面板均 16px | 删除调整未验 | 未填调整时添加禁用 | 无调整行已看；加载未验 | 所得税、其他账套、提交未验。[图](desktop-other-pages-review-2026-10-25/states/tax.png) |
| 桌面设备管理 `/settings/pda-devices` | 共用工作面 16px，最后表格底角计算 15px | 未操作设备 | 绑定表单未验 | 空列表已看；加载未验 | 仅桌面空工作面，PDA 客户端未进入。[图](desktop-other-pages-review-2026-10-25/states/barcode.png) |
| 全局搜索浮层 | 2 组 3 项；真实分组属性、方向键向下切换、输入焦点保留；1024px；顶栏菜单 | 不提供危险操作 | 当前 GlobalSearch 未渲染禁用结果；不伪造此状态 | 搜索中、未找到、503 失败 | 未执行 Enter 跳转、多批游标和全部权限过滤。[图](desktop-other-pages-review-2026-10-25/states/search.png) |

其余 ERP 页面做了源码筛查：解析 343 个非 PDA / 非 landing 的 TSX 文件，核对新规则的完整 opening element、同元素属性与 utility；没有将源码命中当作所有页面已渲染。原字重、原生分段/下划线、表头列宽交互、错误/危险 utility、查找器列宽及换行继续保留。

## 可抽查证据

- [selector-audit.json](desktop-other-pages-review-2026-10-25/selector-audit.json)：16 条增补规则、16 个 class 锚点、完整元素属性片段、库版本/输出片段及结构依据。未解析到的 class 为 0。
- [selector-dom-hits.json](desktop-other-pages-review-2026-10-25/selector-dom-hits.json)：实际 DOM 命中与计算样式。16 条规则均有至少一个可见节点命中；这是有限样本命中，不是各状态全覆盖。
- [browser-states.json](desktop-other-pages-review-2026-10-25/browser-states.json)：65 份记录的 URL、画面原图 SHA256、文字、节点属性、选中/禁用/危险按钮和计算样式；图版与记录一一对应。
- [checks.json](desktop-other-pages-review-2026-10-25/checks.json)：本轮检查范围与结果；[changed-files.txt](desktop-other-pages-review-2026-10-25/changed-files.txt) 为本轮逐文件清单。

## 验证及未覆盖范围

Node `v22.23.2`。前端 lint exit 0；`tsc -p frontend/tsconfig.app.json --noEmit` exit 0；最终 Electron 目标 Vite 构建 exit 0（4.47s，产物在任务临时目录）。`test:chart-series-limit` 5/5、`test:frontend-conventions` 5/5、`test:agents-md-guard` 失败 0。原 CSS 前缀逐字一致，CSS 十六进制 0，TSX 差异 0；根 `index.css` 整文件未动，所以 `.dark` 块也未动。最终提交前另核 diff、JSON 与逐文件清单。

没有运行全量前端单测、数据库业务 smoke、全部权限岗位、长期轮询/网络恢复、批量虚拟列表压力、Windows 安装更新、PDA 真机或实际打印出纸；这些仍按原发版流程独立验收。本轮不推断库存、资金、审批、补打及会计事实正确，也不将合成失败响应当作后端故障。

命名浏览器会话 `flowcube-other-pages-20261025` 已关闭，最终 session list 确认不存在；临时 5199 / API 60230 服务停止。原 5197 预览保留，没有结束其他浏览器或其他服务。
