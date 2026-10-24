# 浅色品牌样式校正与六类页面检查

2026-10-25，在 `codex/desktop-ibm-style` 上以 `f2c3356c5bdf73aa91e85762047befc7429e74b7` 为基线完成本地修改。用户附件 CSS 先完整替换，再按当前源码修正；HTML 仅作视觉参考。全部 TSX 无差异，未修改路由、状态、权限、请求或后台业务。本次按用户要求提交到同名分支供复核；未合并 main、未打 tag、未发布。

预览：`http://127.0.0.1:5197/#/sale`，服务源码为本工作树。API 是本任务回环服务提供的合成资料，界面带演示标识，不是业务验收库。两份原始 JSON 已随分支归档，字节内容与原 `/tmp/flowcube-ibm-20261025/` 文件一致；其余本地截图和日志仍保存在该临时目录。

## 提交基线与复核文件

工作开始时，原工作区在 `codex/release-0.13.8` 的 `f2c3356c5bdf73aa91e85762047befc7429e74b7`，本分支从该提交创建，未重新变基或合并其他分支。它的唯一父提交是 `54cef45522212f37c9a7fb1152d66e7fce7513ec`，也是本次推送前通过 GitHub `refs/heads/main` 核对的 main。

`f2c3356` 的提交标题是 `docs(release): record v0.13.8 acceptance and image inventory`，相对 main 只增加以下六份发布验收记录，没有业务代码差异：

- `docs/release-evidence/0.13.8/image-inventory.json`
- `docs/release-evidence/0.13.8/live-downloads.png`
- `docs/release-evidence/0.13.8/live-homepage.png`
- `docs/release-evidence/0.13.8/live-updates.png`
- `docs/release-evidence/0.13.8/verification.json`
- `docs/release-v0.13.8-result.md`

因此本分支并非直接从 main 的指针创建，但起始业务代码与该 main 一致。本次样式提交保留这个父提交；复核 main 到本分支的差异时，会同时看到这六份继承文件。复核本次提交本身时，请与其父提交 `f2c3356` 比较。

复核附件：

- [selector-audit.json](desktop-ibm-style-review-2026-10-25/selector-audit.json)，SHA-256：`ada012ecb285749f19ff323d111a55691ce3e7088f6a998ea3bbe375adc9f48f`。
- [semantic-aliases.json](desktop-ibm-style-review-2026-10-25/semantic-aliases.json)，SHA-256：`b531d7001c5188a8951cff9fd595b61fc7a595dd935131a1b881081b42f50a40`。
- [本次提交逐文件清单](desktop-ibm-style-review-2026-10-25/changed-files.txt)，也单列了继承自基线的六份文件。

## 对附件的判断与修正

| 问题 | 本次处理 |
| --- | --- |
| 附件称 TopNav 下拉没有 `role="menu"`，与当前版本不符 | 当前源码是 `nav > div.relative > div[role="menu"] > ul`，按此核对并保留真实语义；合并重复菜单规则，不改 DOM。 |
| 附件把搜索框改成胶囊，并强制把业务详情/内容页签也改成下划线 | 搜索框恢复圆角矩形；SaleOrderDetailTabs / ContentTabs 保留源码的分段形态，库存页保留其原生下划线，仅调色与字号；工作区、状态筛选仍保留下划线。 |
| 状态组原规则写 `role="group"`，实际单选组是 `radiogroup` | 按 OrderStatusFilter 和 Radix 的实际输出校正，恢复下划线；WorkspaceTabs 的原 2px 指示条不再隐藏。 |
| v3 给所有分体按钮第一项涂蓝，会覆盖组件提供的危险变体 | 只命中 `bg-primary` / `bg-transparent` 普通主按钮，包含单按钮分支；保留危险红色和仅箭头触发器。 |
| 偶数行底色的后置规则会覆盖选中态 | 斑马纹排除 `data-selected="true"`；真实 DataTable 行属性样式探针确认两态不同，随后恢复原属性。此探针不是业务选择流程验收。 |
| 附件的近似 HSL、十六进制散值仍会漂移，登录还有独立旧蓝 | 根令牌按指定 RGB 精确换算 HSL；样板 CSS 十六进制颜色降为零，登录主按钮及悬停也走共用令牌。 |
| 原有调色板类包含 `dark:` 变体，不能把后缀当成真实裸类 | 保留全部 TSX 类名；50 个真实浅色语义 utility 接令牌，蓝色 family 统一接 IBM 蓝，暗色根令牌块未改。 |
| 输入框圆角被 utility 覆盖、带说明的弹窗标题位于内层 | 在样式层明确控件圆角；标题选择器覆盖实际 `header > div > h2` 与直接 `h2` 两种分支。汇总底带跟随原面板圆角。 |
| 仅引入远程字体不足以保证桌面中文，CSS 相对路径在打包时还会改变基准 | 本地随包加载 Inter / Noto Sans SC / JetBrains Mono，保留 Unicode 分片；用 Vite 根资源路径让构建改写成相对哈希 URL，OFL 许可证同时分发。 |

确认无引用后删除 `frontend/src/pages/landing/landing.css` 与 `frontend/src/pages/landing-preview/preview.css`，未改变当前官网结构、Logo 或主标题。

## 源码与页面对应

对样板 CSS 的 **426 条规则、274 个不同类名**做 AST 字符串完整 token 对照，未用注释或 `dark:` 后缀充作依据。270 个类名找到当前产品源码；`rdp`、`lucide`、`recharts-wrapper`、`recharts-surface` 是 DayPicker、Lucide、Recharts 生成的类，另外在真实日历和图表 DOM 中确认。完整逐条记录见随分支归档的 [selector-audit.json](desktop-ibm-style-review-2026-10-25/selector-audit.json)，浅色兼容映射见 [semantic-aliases.json](desktop-ibm-style-review-2026-10-25/semantic-aliases.json)。

源码存在只证明选择器有依据，不能代替每个条件状态的浏览器检查。本轮实际检查如下：

| 页面 | 已核对的真实选择器与入口 | 实际检查及证据 | 未覆盖范围 |
| --- | --- | --- | --- |
| 销售列表 `/sale` | AppLayout / WorkspaceTabs / OrderStatusFilter；`.desktop-tabs [role="tab"]`、`[role="presentation"] > span.absolute`、`.desktop-status-filter button[data-state="on"]`、`.desktop-table`、`.fc-table-actions`、`.sample-table-panel > [role="status"]` | 6 条合成订单、10 列；上下划线、普通分体行按钮、真实汇总、主按钮悬停和横向滚动；1440 与 1024 宽。`sale-final.png`、`sale-1024.png`、`visual-state-*.json` | 没有做数千条虚拟列表、全部权限岗位或真实库存动作验收。 |
| 销售表单 `/sale/new` | CommercialEditor / SaleOrderHeaderFields / SectionCard；`.sample-order-editor > fieldset`、`.desktop-section-card`、`.fc-picker-trigger`、`.fc-select-trigger`、`.fc-input`、`[data-sale-entry-items]` | 实际选择合成客户、仓库、普通商品，明细显示 1 行与金额；空表单、禁用入口及未保存离开确认。`sale-form.png`、`sale-form-filled.png`、`draft-leave-confirm.png` | 未保存真实单据，未验证套装混合单和全部失败恢复分支。 |
| 销售详情 `/sale/1` | ActionBar / PageHeader / SaleOrderDetailTabs / DataTable；`.desktop-page-heading`、`.desktop-detail-tabs > button[aria-pressed="true"]`、`.data-table-header-surface`、`.desktop-order-total` | 源码原有分段页签、原摘要、基础信息、2 行明细和原操作入口；红色取消动作保留。`sale-detail.png` | 其他详情子页、改单、退货、派发和实际打印流程未验。 |
| 仪表盘 `/dashboard` | WidgetShell / ChartWidgets / chartTheme；`.dashboard-widget`、`.dashboard-stat`、`.desktop-widget-editor`、`.fc-chart-legend`、Recharts wrapper / surface | 实际从组件库加入出入库趋势、库存价值条形图、账户余额图，核对渲染颜色；结束取消编辑。`dashboard-charts.png` | 未保存账号布局，未遍历全部个人工具、所有图表数据边界。 |
| 设置 `/settings` | SettingsPage；`.sample-settings-grid`、`.sample-settings-card > header`、`.sample-setting-row`、`[data-editing="true"]`、`.sample-logo-preview` | 查看和编辑态，原企业信息、单号配置、业务参数均保留。`settings.png`、`settings-edit.png` | 未保存真实配置或上传 Logo。 |
| 销售查询弹窗 | SaleQueryDialog → QueryDialog → AppDialog；`.fc-app-dialog[data-content-sized]`、`.fc-app-dialog-header h2`、`.fc-query-dialog-content > .grid`、`.fc-query-date-start`、`.fc-app-dialog-footer`；Select / Calendar 的真实 portal | 1440 / 1024 宽、状态列表、日期日历、查询字段重置及 Escape 关闭。日期重置回本页默认 2026-10-19 至 2026-10-25。`query-final.png`、`query-1024.png`、`query-status-menu.png`、`query-calendar.png` | 不是每个关联选择器的全部查询组合或真实查询性能验收。 |

另外实际查看了主导航下拉（`nav-menu.png`）和构建后的登录页（`built-login.png`）。登录页在临时回环静态服务运行，资源来源仅为该回环 origin，中文字体错误数为零；临时静态服务在检查后关闭。

## 验证结果

- Node `v22.23.2`；前端 lint、`tsc -p frontend/tsconfig.app.json --noEmit` 通过。
- 前端 Electron 目标构建通过，产物在 `/tmp/flowcube-ibm-20261025/dist`；构建字体来源不依赖 Google Fonts 网络服务。
- 字体产物检查先自然失败：114 个未解析路径；修正后 **110 个 WOFF2 文件 + 4 个内联子集、3 份 OFL 许可证、0 个缺失路径**。构建后的实际登录页加载 Inter 和 Noto Sans SC，12 个字体文件请求成功，字体错误数 0。
- 既有 `test:chart-series-limit` **5/5**、`test:frontend-conventions` **5/5** 与 `test:agents-md-guard`（失败 0）通过。
- `git diff --check` 通过；TSX 差异为零；样板 CSS 十六进制颜色为零；前端产品源码指定三种旧蓝为零；`.dark` 根令牌块与基线逐字一致。

业务全量、数据库回归、Windows 安装、PDA 真机和物理出纸未执行，仍按原发版流程独立验证。共享根令牌与字体本轮有意统一，不能把“未改 PDA 组件”说成已完成 PDA 视觉或设备验收。

浏览器收尾：使用唯一会话 `flowcube-ibm-20261025`，最终关闭并复核 session list；本地演示开发服务保留供用户查看。
