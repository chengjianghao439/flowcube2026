# 前端与 PDA 约定

> **来源**：本文件由 `AGENTS.md` 的 §9 迁出（2026-09-19 文档体系重构，原文见 `docs/agents-md-archive-2026-09-19.md`），内容为无损搬运。
> **何时必须读**：改 ERP 页面/组件、列表与图表、弹窗与浮层、PDA 页面与扫码交互、或登录会话与路由时。
> **约定**：能机器验证的规则一律以 `tests/` 守卫为准；本文件写「为什么」与「边界」，与守卫冲突时先核实代码，再同步两者。

---


- 销售详情用独立「发货安排」标签；承诺日期以实际出库为准，改单重建行按商品+仓库迁移交期，改仓/新增不继承；异常按原经办人分配。见 docs/order-fulfillment-2026-09-06.md。

- 订单详情参照销售单分为订单信息、各自业务进度及操作记录；无装箱环节不显示装箱页签。`/api/document-activity/:type/:id` 使用类型白名单、原模块查看权限及原详情的数据范围校验，之后才能读取关联进度和记录。迁移 234 在成功响应后异步保存订单操作摘要，不随普通系统日志清理；写入失败会记录服务日志，不能视为与业务状态同事务的完整审计保证。既有业务事件继续作为业务事实源，历史未记录或已清理的操作不推算补造。普通纸张打印发起不等于物理打印成功；条码状态来自打印任务。实施与验收见 `docs/order-progress-2026-09-06.md`。

- PC 壳层：顶栏菜单行随内容换行增高（<1024px 独占一行），工作区标签单独一行；登录页 <900px 单列；全局搜索不限日期、每类 20 条游标取齐、防抖 300ms。见 docs/global-search-all-dates-2026-09-06.md。
- PC 关联弹窗：财务核销的登记/继续核销与核销详情保持宽明细工作区；继续核销打开时聚焦标题，避免日期控件自动展开遮挡明细；客户/供应商查找集中名称与编码并保留联系人、电话独立列；分类选择保留原行为，层级使用缩进。仓库访问范围展示当前勾选数量，空选仍为不限仓；个人信息和密码字段保持清晰标签。条码打印关联提示采用主题语义色，错误结果允许完整换行。此处仅约定展示，不更改核销、权限、退款或补打规则；实际验证边界见 PC 专项记录的“六组遗漏补齐”。
- PC 专项样式：库存/收货/改价/盘点/处置明细用集中商品身份；财务列表金额右对齐、汇总复用 SummaryStrip；账套创建与打印机绑定用标准 Dialog。见 docs/erp-pc-page-completion-2026-09-05.md。

- ERP 列表取消页面分页：GET 数据层按有界批次取齐（allRecords.ts 的 MAX_COLLECT_ROWS 默认 5000，超限返回前 N 行带 truncated:true）；任一批失败或总数变化整体报错，不返回残缺结果。见 docs/all-record-lists-2026-09-06.md。

- 塑料盒新建每次打开清空上次商品/仓库草稿，二者未选全禁止提交；流水读取失败明确提示并可重试，不显示“暂无流水”。共享 WarehouseSelect 在必选表单未选值时显示 placeholder，查询的“全部仓库”选项语义不变。批次拣货查询保留并提交仓库、创建起止日期，默认与重置均不限制日期；列表和详情失败提供独立重试，详情失败时隐藏执行动作。见 `docs/warehouse-assets-waves-regression-2026-09-13.md`。
- 仓库、库位、货架与分拣格表单的可见标签须关联实际控件。库位自动编码在新建或原分段完整的记录缺少任一分段时清空，禁止保存过期编码；打开时分段不完整的历史库位保留原手写编码，补齐后正常生成。货架行操作提供编辑入口；编辑清空库区、名称或备注时显式提交空串，避免被 API 的省略字段保留语义吞掉。专项检查见 `docs/warehouse-masterdata-regression-2026-09-13.md`。
- 客户编辑表单提供启用/停用状态，读取原状态并提交当前选择；新建仍由后端默认启用，不扩展新建字段。停用保留历史单据，引用中的客户继续拒绝删除。客户、供应商、部门和分类表单的可见标签须关联实际控件，不能只显示文本。专项与安全页面检查见 `docs/masterdata-regression-2026-09-12.md`。
- 销售分组桌面样式：客户管理列表编码/名称/联系人/电话/邮箱各自独立列、窄窗口横向滚动；其他列表复用 RecordIdentity；超额驳回用统一原因弹窗。见 docs/sales-group-ui-2026-09-05.md。

- 全局商品查找统一复用 ProductFinderModal：默认只展示身份/规格/单位/分类，仅传仓库时显示该仓可用库存；搜索覆盖名称/编码/条码/供应商型号/型号/颜色。见 docs/product-finder-redesign-2026-09-05.md。

- 采购建议两视图共用 ACTIVE 实物、未发销售、有效预占与未上架采购净额；包装倍数/MOQ 按权威单位换算；调拨候选先保护来源仓需求与安全库存。见 docs/procurement-planning-2026-09-06.md。
- 业务入口合并：采购计划+补货建议=「采购建议」，报表中心/经营 KPI/利润分析=「报表中心」，仓库运营看板/批次效率/PDA 异常分析=「仓库运营」；保留原路由、参数、接口与权限。见 docs/business-centers-2026-09-05.md。
- 现结与月结入口分工保持不变：页面、导航和工作区标题统一为「现结客户账款」「现结供应商账款」「月结客户对账」「月结供应商对账」，保留原路由及结算筛选。「按单登记」默认跨日期显示未结清账款（未收/未付、部分收/付款且余额大于零），不再限定今天起；状态筛选可查已结清或全部，清空查询不重新加日期限制。列表与导出统一支持 `status=unsettled` 及单号、单位、确认状态、日期、金额条件。全量财务指标仍使用应收/应付术语，不误标现结。客户和供应商列表的「往来明细」按 PAYMENT_VIEW 权限进入独立页面，按单位 ID 跨结算方式查看。
- 待办＝首页摘要＋完整中心：「我的待办」最多六类；「待办中心」保留 /reports/role-workbench；巡检取消，只保留收货/上架/补打/出库/价格提醒与订单履约待办。见 docs/todo-center-cleanup-2026-09-08.md。
- **待上架待办与超时提醒按容器真实状态查询**（2026-09-16 修复）：`inventory_containers.status` 的待上架是 **4**（`CONTAINER_STATUS.PENDING_PUTAWAY`），容器状态只有 1..6、**没有 0**。岗位工作台的「待上架」卡片（`reports.query.js`）与「打印后未上架超时」通知（`notifications.service.js`）此前都写成 `status = 0`，条件恒不成立：卡片永远 0 条、提醒从不出现，收完货不上架没人知道（当时生产已有 2 张单各压着 1 个待上架容器躺了 5 个多月）。改动这两处一律引用 `CONTAINER_STATUS` 常量、不写数字字面量；回归见 `tests/workbench.test.js`（断言不得出现 `status = 0`、参数必须含 4）。详见 `docs/inbound-putaway-reminder-2026-09-16.md`。
- ERP 仪表盘默认首屏为待处理销售/今日出库/未清应收/待我审批四项摘要，下接待办摘要、业务待办、销售趋势与应收到期分布；编辑态与阅读态按保存的卡片顺序渲染。见 docs/dashboard-card-order-2026-09-08.md。
- 销售订单列表用普通表格，单号/客户/仓库/折后金额/状态等列独立；默认最近七天（北京时间），range=all 不套日期；未生成应收显示「未生成应收」，不用客户结算回退值制造未付/逾期。见 docs/sale-classic-layout-2026-09-05.md。
- **前端业务日期只有一个来源**：`lib/dateTime.ts`（`todayYmd` / `beijingYmd` / `beijingPeriod` / `shiftYmd` / `formatDisplayDate`）与基于它的 `lib/dateRange.ts`（近 N 天 / 本月窗口）。**禁止用 `getFullYear`/`getMonth`/`getDate` 自己拼业务日期**——那是宿主时区语义，非 +08 环境（UTC 容器、系统重装、出差改时区）下会偏一天，会计期间更会取到相邻月份；守卫 `npm run test:frontend-date-source` 扫全前端，唯一豁免是趣味小工具（本地存储标记，不参与业务日期）。2026-09-18 据此收敛 9 处：会计模块 5 份 `currentPeriod`、`PaymentQueryDialog` 的「今天」按钮、报销明细默认日期、运费对账当前年月、`lib/dateRange.ts` 整体。单据列表默认时间窗口统一由 lib/dateTime.ts 的 defaultRangeYmds(7) 生成；操作日志与库存流水默认最近 7 天。默认值在构造查询参数处兜底（与查询弹窗初始值同源），range=all 表示看全部。全局搜索 autoComplete="off"。
- 官网展示页为 frontend/src/pages/landing/：版本摘要维护在 updates.ts，不以工作区 package 版本冒充已发布版本；清单缺失时禁用下载入口。**每版发版必须把本版补进该列表最前**（官网「版本更新」区只读它，不读 package 版本）——此前文件注释声明了这条流程、但技能与 `docs/RELEASE.md` 都没写，0.9.16–0.9.22 连漏 7 版；现由 `npm run test:landing-updates` 守住（缺当前版本 / 顺序错 / 字段不全即失败）。见 docs/landing-adoption-2026-09-12.md。

- **页内 Tab 状态保留（v0.9.10）**：子页首次激活才挂载，切换子页或工作区后保留筛选、草稿、选择、展开和滚动，关闭整个大页面才卸载；不新增跨刷新草稿存储。统一用 `KeepAliveSection` 与可见性上下文，隐藏子页暂停自身查询/轮询和浮层显示，不以关闭回调清空草稿；打印预览隐藏时撤销自身打印样式/监听，并取消等待图片解码的旧打印动作；已提交请求继续处理自身回执。原单据身份、账套切换及鉴权隔离边界保留。ABC 未保存规则切走仍有关闭保护、刷新不覆盖草稿；税务草稿与保存回执按税种隔离。覆盖清单与验证见 `docs/inner-tabs-retention-2026-09-08.md`。
- 新 ERP 页面注册到 `routeRegistry.ts` / `routePatterns`，配置 permission、keepAlive、tabIdentity、nav 或 listPath；菜单自动生成。
- API 统一经 `src/api/*.ts` + `payloadClient`，组件不直接 axios；自行提示错误时用 `skipGlobalError` 避免双 toast。
- 导出沿用列表的筛选、账套与仓库权限，但使用有界分批读取，不限于第一页 500 条；超过 10,000 条明确拒绝并要求缩小范围，读取期间总数变化或重复记录返回重试提示。不能提高公共分页上限代替导出实现。
- **导出的日期列格式**（2026-09-16 修复）：`fillSheet`（`utils/excelExport.js`，普通导出与多 sheet 导出共用）遇到 Date 值时统一指定数字格式——纯日期 `yyyy-mm-dd`、带时分秒 `yyyy-mm-dd hh:mm`——不再依赖 exceljs 默认的 `mm-dd-yy`（英文习惯，且与同一份表里用 `DATE_FORMAT` 生成的字符串列格式不一致）。**保留日期单元格类型、不转成字符串**，Excel 里仍可按日期排序与筛选。走 `DATE_FORMAT` 的字符串列原样输出；对账单导出（`exportStatementXlsx`）有自己的写入逻辑（用 `ymd()` 输出文本），不受影响。
- 服务端业务规则不复制到前端，不让前端传目标状态决定流转。生成的状态常量通过 `npm run generate:status` 更新。（2026-09-16 同步过一次：`SALE_ACTION_RULES` 的 `adjust.from` 补上 6「部分占库」、`release.blocked` 补齐，此前生成物落后于后端常量；该常量目前在前端**没有消费方**，所以那次漂移未造成行为差异，改动销售动作表时仍必须重新生成。）
- 状态展示统一 `StatusBadge` / `SoftStatusLabel` 与 `statusTone.ts` 语义色，不硬编码彩色 Badge。
- 编辑态必须可分辨：编辑已有记录的页面/弹窗标题旁用 EditModeBadge；脏检查一律与进入编辑时的基线比较，明细行用 dirtyItems() 剔除 units 等多计量单位投影。见 docs/edit-vs-default-state-2026-09-18.md。
- **打开即编辑的配置页必须有只读默认态（2026-09-18，用户澄清后）**：`/settings` 系统设置、`/permissions` 权限管理、`/carrier-accounts` 快递账号绑定、`/stockcheck/abc` 分批盘点规则这四页**打开一律是只读默认态**，点「编辑 / 编辑规则」才进入编辑态（带 `EditModeBadge`，主按钮 `保存修改`、`取消编辑`）；**保存成功后必须自动回到只读默认态**——只弹 toast 不算反馈；`取消编辑` 丢弃改动回到已保存值；脏检查只在编辑态生效。权限页在编辑态切换角色前先确认放弃未保存勾选；系统设置的 Logo 上传只在编辑态出现。记录与实测见 `docs/edit-vs-default-state-2026-09-18.md`。
- DataTable 列宽独立调整：只改目标列，超出横向滚动；所有业务列都可拖动调整顺序，表头分隔线支持拖动/双击适应内容/方向键微调；表格上方不再有「恢复默认列宽」。见 docs/table-column-resize-2026-09-06.md。
- 开单提效：销售/采购新建与草稿编辑首次保存后集中列出填写问题；销售空占位行忽略、采购空商品行必须补全；销售异步定价手动改价优先。见 docs/order-entry-efficiency-2026-09-12.md。
- 大列表优化：商品/库存/销售/履约待办/条码打印/操作日志在 ≥200 行时用共享 VirtualTableBody 虚拟滚动；隐藏列表用 useVisibleQuery 解除订阅并取消在途请求。见 docs/operations-optimization-2026-09-12.md。
- 复用 DataTable、TableActionsMenu、QueryErrorState、finder、usePermission、useDirtyGuard、useInvalidate 等已有结构；keepAlive 表单在挂载/参数变化时重置，未保存内容有退出保护。
- 弹窗内浮层与日期日历：DialogContent 居中不得用 translate-x/y-[-50%]，统一 inset-0 m-auto h-fit；PopoverContent 不用 Portal，碰撞避让边界固定视口。见 docs/dialog-datepicker-popover-clip-2026-09-18.md。
- 账款/对账六类写入或宽明细弹窗拆为 components/shared/payments/ 下独立组件，外壳统一 AppDialog（**右下角拖拽改尺寸** + 按 `dialogId` 记忆尺寸到 `localStorage: flowcube-dialog-size-{dialogId}`；**位置每次打开重新居中、不可拖动移动、也不持久化**——2026-09-19 浏览器实测，详见 `docs/local-ui-acceptance-2026-09-19.md` 第三轮）；小功能仍用轻量 DialogContent，只换外壳。见 docs/payment-dialogs-appdialog-2026-09-18.md。
- 桌面端判定使用运行时 `window.flowcubeDesktop`，不能用构建 flag 把浏览器误判成 Electron。
- 官网候选参考源码保留于 `frontend/src/pages/landing-preview/`，不注册路由、不替换正式入口；正式页面使用用户已确认的 `frontend/src/pages/landing/` 第一版。候选历史验证见 `docs/landing-preview-2026-09-12.md`，当前采用记录见 `docs/landing-adoption-2026-09-12.md`。
- 系统品牌采用已确认的蓝底双曲线 F；官网、ERP/PDA 登录页、PDA 首页通过 `SystemBrand` 复用本地哈希资源。网页 favicon/触屏图标、桌面程序/安装器、Android 普通/圆形/自适应图标与启动屏由 `scripts/generate-brand-icons.cjs` 从 `docs/branding/flow-icon-approved.png` 导出。公司 Logo 仍只用于 ERP 顶栏/单据打印，保持公司图优先及文字回退，不混用。素材、生成方式与验收见 `docs/brand-icons-2026-09-07.md`。
- 用户术语沿用“批次、采购申请、滞销、存放时长、分批盘点、型号、供应商型号”，不为改文案变更权限码、路由或数据库列。
- PDA 不做离线自动重放；不确定写入结果先用幂等回执/已有 `resolveServerState` 恢复路径核实。
- PDA 收货页没有扫码框：点选「待收商品」卡片，点「打印并登记」即提交；一个商品收完后自动切到下一个未收完的。scannedBarcode 不再发送。见 docs/pda-receive-remove-scan-2026-09-14.md。
- 能否继续收货只看 task.status（<3 继续收货、=3 待上架），不得看 putawayStatus；后端只在全部明细收满时把任务 2→3（inbound-tasks.command.js），上架侧强制 putaway.from=[3]。见 docs/pda-receive-partial-lock-2026-09-16.md。
- 原生绑定相机扫码使用 `useCameraScanner.ts` 的既定本地解码路径，注意预览时 WebView 背景透明、权限引导和关闭清理。浏览器预览不能证明 APK 相机功能正常。
- **PDA 聚焦规则按「这个页面要不要输入」判断**（2026-09-19 用户明确该依据）：**登录页需要输入，自动聚焦账号框是对的**；**扫码作业页不需要输入，进页面与扫码结束都不得自动聚焦输入框**（软键盘会挡住扫码视野），只有用户点「手动输入」才渲染手输框并聚焦。统一用 components/pda/PdaScanner.tsx，该组件不再提供 autoFocus；判断新页面时套用同一条依据（需要键入的可聚焦，扫码/浏览类不得聚焦），不要按「统一体验」把两类页面拉平。`tests/pda-scan-focus-contract.test.js`（`npm run test:pda-scan-focus`）机械守住：除 `login.tsx`（需要输入，`autoFocus` 是正面实现）外的 PDA 页面不得出现 `autoFocus`，且 `PdaScanner` 里每处 `.focus()` 必须自身带 manual 语义——聚焦只能由点「手动输入」触发（反向验证：给作业页加 `autoFocus`、或在挂载 effect 里自动聚焦，都必须失败）。见 docs/pda-scan-default-mode-2026-09-17.md。
- 错误提示保真：AppError 未显式带 code 时后端不再兜底 CONFLICT/BAD_REQUEST 通用码；前端 resolveApiErrorMessage() 对通用码一律以后端原文优先；新增 4xx 必须带 code 或给中文原因。见 docs/acceptance-issues-fix-2026-09-17.md。
- **PDA 打包页必须显示箱贴打印状态**：`GET /api/packages?taskId=` 返回每箱 `printStatus`，打包页显示「箱贴：待派发/已打印/打印失败」并在完成打包按钮上方常驻告警（列出待处理箱与出路：重新入队打印、ERP「条码打印查询 → 出库条码」重打、启动绑定打印机的桌面端）。「箱贴未打印成功不得进入待出库」是**服务端强制规则，不放开**；放开的是「看不见原因」。调拨调出页同理显示「剩余可调量」，因为整容器调拨要求容器数量不超过剩余计划量。
- **PDA 列表必须即时刷新**：拣货「商品列表/订单列表」的刷新按钮同时刷新两个查询，拣货动作后作废两个列表缓存；收货、打包、复核、调拨、盘点、退货列表统一 `refetchOnMount: 'always'`。keep-alive 下组件常驻，不这样做就会出现「订单列表已空、商品列表仍显示待拣 0/2」或「ERP 刚派发的单据看不到」。`npm run test:pda-list-refresh` 机械守住：只扫 `useQuery({...})` **声明块内部**的列表类 `queryKey`（`invalidateQueries` 等同名调用不算——第一版没区分，把 21 处失效调用误报成违规；详情查询必然带 id 参数故不在范围内），且文档点名的七个 key 必须仍被扫到，防止删/改页面后守卫静默失效。
- **库位扫码按「编码或条码」解析**：PDA 上架/调拨调入**不得**用 `R<数字>`/`LOC-*` 前缀卡格式（历史库位编码是 `SH-A01`、`SMK-396842` 这类），统一交给 `GET /api/locations/code/:code`（后端匹配 code 或 barcode）；归属仓、状态、范围仍由服务端校验。迁移 245 回填历史库位 `barcode`（`R+6位ID`）。**盘点单不允许 0 明细**：创建时取不到在库商品直接报错；PDA 待盘点列表用 LEFT JOIN，历史空单也会显示并提示去 ERP 取消。
- **列表与图表的呈现约束**：`DataTable` 的最后一列操作列固定右侧（sticky，宽表横向滚动时仍然可见）；分布类图表（各仓库存价值分布、账户余额分布，含财务看板「账户余额分布」饼图）统一走 `frontend/src/lib/topSeries.ts` 的 `limitTopSeries`（`TOP_SERIES_LIMIT = 8`）+ 「其他 N 个」，不得按主数据条数全量成系列，也不得在页面/组件里另抄一份常量与切片逻辑，饼图「其他」切片用中性色而非轮回到 `PIE_COLORS[0]`；`npm run test:chart-series-limit` 机械守住（2026-09-19 财务看板饼图曾漏改：94 个启用账户 8 色轮转 12 轮，见 `docs/chart-series-limit-2026-09-19.md`）；图表小组件用 `ChartWidgetShell` 只在可见标签内挂载（避免在 `display:none` 容器里报 width(-1) 并渲染空图），文字/交互型小组件仍用 `WidgetShell` 以保留本地状态。操作日志列表的「操作内容」按业务接口映射成「模块 · 动作」，未映射的显示方法 + 路径，不允许整列都是「系统接口访问」。`AppToast` 对 5 秒内同类型同文案去重。
- **列表页不再常驻展示日期筛选提示条**（2026-09-16）：主列表页的日期筛选与销售、采购一致——只在查询弹窗中查看（弹窗初始值即当前生效范围），页面上只保留可逐项移除的筛选 chips；已删除退货单（销售退货）与物流运单两处历史遗留的「创建日期：X 至 Y」横条，后者取代 `docs/sales-group-ui-2026-09-05.md` 中"明确日期"的展示约定。列表计数统一用 `ListSummary`（表格下方）；物流运单沿用其"当前显示数量"口径（自动取齐上限 500，不代表业务总量）。
- **查询弹窗「重置」＝回到该页面的默认窗口**（2026-09-17）：各 `*QueryDialog` 新增可选 `resetValues`，重置把日期恢复成该页面的默认口径（单据类与操作日志/库存流水 = 最近 7 天、物流运单 = 当天、退款单/处置/放行/采购申请 = 不限），不再一律跳成"今天起"。页面要传与自身 `effectiveStartDate/EndDate` 兜底一致的值（如 `resetValues={{ startDate: defaultRange.start, endDate: defaultRange.end }}`），**新增列表页时两处必须同步**，否则「重置」和「打开弹窗看到的范围」会对不上。`PaymentQueryDialog` 早已用 `clearValue` 表达同一语义（账款页默认跨日期看未结清），沿用不改。

## 界面术语口径（2026-09-19 全量文案审计后固化）

> 这些词原本散落在 `docs/proposals/13-条码与序列号融合.md`、`docs/release-notes/0.4.57.md`、`0.3.87/0.3.88` 等历史记录里，**因为没有写进本文件、也没有守卫，执行力度不均**——「序列号」清理干净了，「容器」「履约」却大量残留。现汇总至此，由 `npm run test:copy-conventions` 机械守住。

| 概念 | 界面统一用 | 不再使用 |
|---|---|---|
| 收货生成的库存单元（`I` 码） | **库存条码** | 容器、库存容器 |
| 散件常驻盒（`B` 码） | **塑料盒** | 容器、周转箱 |
| 打包后的包裹 | **箱 / 箱子** | 容器 |
| 拣货批量单 | **批次 / 批次号** | 波次、批次单号 |
| 商品效期批次 | **效期批次** | （与拣货批次同叫「批次」会混淆） |
| 库位的 `zone` 字段 | **库区** | 区域 |
| 库位的 `aisle` 字段 | **通道** | 巷道 |
| 客户或供应商（财务往来） | **往来单位** | 往来方 |
| 审批终态 | **已批准** | 已通过 |
| 账户与台账金额 | **余额** | 结余 |
| 错误码与接口原始返回 | **技术详情**（折叠，标注"反馈给管理员时提供"） | 把错误码 / 原始 JSON 直接摆给业务用户 |

**面向用户文案的禁用词**：容器、波次、主链、缓存、缓存漂移、落库、口径、科目地基、服务端、回执、拉取、渲染、会话、令牌、事实源、快照、`userId`/`createdAt`/`avg_cost` 等字段名、数据库枚举（如 `ACTIVE`）、变量名（如 `API_BASE_URL`）、`sha256`/`APK`。实现细节一律收进折叠的「技术详情」，或译成用户能懂的动作与后果。

**对外页面（`/portal/*` 与官网）另有一套更严的标准**：读者是不登录 ERP 的客户，内部财务/技术词一律不进文案。
- 命名不用「门户」（portal 直译），用「查询」——「客户对账门户」→「客户对账单查询」；菜单分组同理。
- 「核销」对客户说「已结算 / 未结算」；「只读」说「本页仅供查看」；不要出现「本司」（视角混乱）。
- 官网 `pages/landing/updates.ts` 是**历史发布记录**，如实保留当时措辞，不按今天的口径回改——这是 `test:copy-conventions` 里唯一的豁免。

**标签命名**：页内标签反映**这份单据是什么**，工作区标签反映**我在看哪一个子页**。
- 单据详情的信息页签按单据身份命名，不再一律叫「订单信息」——收货、调拨、批次、盘点、退货、申请、报销、运单各有其名（`OrderDetailSections.tsx` 的 `INFO_LABEL`）。
- 明细类页签用具体名词：「拣货明细」「退货明细」「调拨明细」「盘点明细」「库存条码」「标签打印」「装箱与打印」；不用「取货明细」「条码明细」这类含糊或同名不同物的叫法（「取货明细」曾同时指波次拣货与采购退货）。
- 合并页（采购建议 / 报表中心 / 仓库运营）的工作区标签用**子页名**（「经营概览」「批次效率」），而不是组合名——组合名会让组内切换后的标签纹丝不动，用户看不出当前在看哪个子页；标签宽度上限 7rem 也放不下「组名 · 子页名」。
- **详情页的标签用业务单号，不用数据库主键**：`routePatterns` 的兜底名（「销售单 #3260」「运单 #12」）里的数字是主键，用户在标签栏上认不出是哪张单，也与「从列表点进来」时不一致（列表入口传的是 `orderNo`）。详情页数据到位后调 `useWorkspaceTabTitle(order?.orderNo)` 换成单号；两个实现约束：用 `updateTabTitle`（不能 `addTab`，否则数据晚到会把用户从别的标签拽回来）、路径取 `TabPathContext`（不能用 `location`，keep-alive 下非激活标签同样挂载会把标题写错标签）。
- **标签名控制在 7 个汉字以内**：工作区标签宽度上限 `7rem` 且 `truncate`，超了就直接看不见（`总账 / 试算平衡`、`会计期间 / 期末结转`、`合并报表 / 账套`、`商品分档与分批盘点规则` 都因此改短了）。标题里也不再用「A / B」斜杠拼接。标签元素带 `title` 悬停提示，但别指望用户去悬停。
- **菜单名、工作区标签、页面标题三者必须同名**：菜单名与标签都取自 `routeDefinitions.title`，页面标题则该写成同一个词。反例：`/sale` 菜单与标签叫「销售管理」、页面标题却写「销售订单」，而采购侧两边都是「采购订单」——只有销售侧不对称，用户从菜单点进去会以为进错了页面。跳转按钮的文案（如「查看销售订单」）也须跟同一口径。

**选择器统一**：「从弹窗里挑一条记录」的字段一律用 `components/shared/PickerField`——外观是**输入框样式 + 已选时的清除 X**，点击弹出 Finder。它合并自两个组件：表单用 `FinderTrigger`（做成输入框样、无清除），查询弹窗用 `QueryPickerField`（做成按钮样、带清除），于是同一个「选客户」在销售单表头与销售查询弹窗里长得不一样，用户不知道这里能不能打字。高度由 `className` 决定：查询弹窗传 `h-9`（与同排的 Select / Input 对齐），表单用默认 `h-10`。**真需要输入关键字筛选的场景（如客户列表搜索、超额放行页搜索）仍用原生 `Input`**，不要拿 PickerField 冒充输入框。

**金额显示统一**：金额一律走 `lib/format` 的 `money()`（带 `¥`）或 `amount()`（会计凭证借贷方，不带符号），不得手写 `¥{x.toFixed(2)}`——后者没有千分位，`¥1234567.89` 在列表里读不出位数；空值还会显示成 `¥0.00`，让「没有数据」看起来像「金额为零」。统一后空值一律 `—`，负数一律 `¥-20.00`。仪表盘 `components/dashboard/chartTheme` 的 `money` 就是 `lib/format` 的再导出，不要再另存实现。三处刻意例外（逐条登记在 `tests/copy-conventions.test.js` 的 `MONEY_ALLOW`，失效即守卫失败）：打印渲染管线（按版面宽度排版的独立字符串管线）、以「万」为单位的库存价值卡片、以及单价 tooltip 里的 `toFixed(4)` 精确值。

**数量输入联动商品精度**：商品可以设「只能整数」（迁移 254），因此数量输入框的 `step` 一律走 `lib/qtyStep.ts` 的 `qtyStep(allowDecimal)`，不再写死 `step="0.0001"`。某一行是否允许小数用 `hooks/useProductQtyPolicies.ts` 按需批量查（一次请求 + 5 分钟缓存，与明细行数据来自商品选择器还是后端接口无关），**查不到时按允许兜底**——宁可让用户先填、由服务端拦下，也不要因为一次查询失败就把整数框锁死。`step` 本身**不是校验**，它挡不住键入；真正的拦截在服务端 `utils/qtyPrecision.js`。采购单与 PDA 拆分的数量本来就只收整数，保持原样。

**日期输入统一**：业务日期字段一律用 `components/shared/DatePicker`——外观与 `Input` 一致，可直接键入 `yyyy-MM-dd`（失焦或回车提交，非法输入回退上一个合法值），也可点左侧日历图标弹出选择。**不得再用原生 `<input type="date">`**：它的取值格式、清除能力与空值表现随浏览器/Electron 版本变化，且与同排的 `Input` 视觉不齐。两个例外：PDA 收货页的效期/生产日期（原生控件对触摸更友好），以及桌面小组件里的玩具输入。

**确认弹窗的两种入口**：命令式 `confirmAction({...})`（`@/lib/confirm`，配合全局挂载的 `GlobalConfirmDialog`）与受控式 `<ConfirmDialog open=... />`（`@/components/shared/ConfirmDialog`）。**两者最终渲染同一个组件**，视觉与按钮文案一致，不存在「同一个操作两套弹窗」——差别只在调用方式：**默认用 `confirmAction`**（无需在页面里维护 open 状态，适合列表行内操作）；需要自己控制开关时机、或要把确认框嵌进既有受控流程时才用 `ConfirmDialog`。新增确认框不必为了「统一」回头改造既有调用点。

**句式**：
- 加载态——纯加载用「加载中…」，带对象用「正在加载XX…」；动词一律「加载」，不用「读取」。
- 成功提示——「对象 + 已 + 动词」（如「销售单已保存」，而不是「保存成功」「已保存」）。
- 兜底失败提示——「现象 + 下一步」（如「保存失败，请重试」），不写只有「失败」的裸文案。
- 空态——`EmptyState` 的 `no-data` 用标题「暂无数据」+ 一句下一步，不再写「暂无记录」等同义副文案。
- 确认框——破坏性操作默认按钮「确认执行」，普通确认「确定」；调用方按需传 `confirmText`。
- 人称——全站统一用「你」，不混用「您」。

**改文案的验证要求**：跑 `npm run test:copy-conventions`、`./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit` 与 `npx vitest run`；**文案若被测试断言（`frontend/src` 与 `tests` 里有 200+ 处 `toContain('中文')`），必须同批改测试**。`pages/landing` 与 `pages/landing-preview` 的 index/BusinessStory/ProductContent 是双份同源，改一处必须两处同改。
