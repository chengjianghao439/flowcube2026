# 全模块回归记录 — 2026-09-12

> 已完成本轮模块入口检查、离线与独立数据库回归，并修复发现的并发、打印环境及大列表问题。本文按证据范围报告；不代表所有业务状态组合、生产或设备验收通过。

## 1. 基线、范围与证据口径

- 首轮代码基线：`0eb96e7667c5678ad05a725eb3208291b8502866`，工作分支 `codex/operations-optimize-20260912`；三端版本 `0.9.14`。本轮修复与本文同批提交，修复后的定向验证单独列于下文。
- 运行环境：macOS arm64、Node `22.23.2`、MySQL `8.0.46`。数据库回归目标为回环 `127.0.0.1:3307 / flowcube_operations20260912_test`；集成/临时库按测试隔离要求执行。未连接生产库跑测试。
- 路由核对：`backend/src/app.js:87-148` 挂载 **62 个 API 模块**；`frontend/src/router/routeDefinitions.ts` 注册 **72 个 ERP 静态入口、13 个动态详情/表单规则**；`frontend/src/router/pdaRoutes.tsx` 有 **30 个 PDA 叶子入口**。
- ERP 72 个静态入口已由主任务使用 CUA 逐个打开；登记为入口加载/读取级别；异步列表和典型交互复核见第6节。共享组件、合并页面或重定向不意味着对应所有子功能均已操作。
- 源码引用、测试fixture、mock、CI配置存在都不作为本轮业务断言证明。下表依据本轮结果及实际断言摘要，明确限制到所测分支；无直接专项的模块只登记UI读取或尚未执行。
- 原始日志和 JSON 位于本机忽略目录 `output/module-regression-20260912/`：`db/results.json`、`db/results.md`、`db/findings.md`、`static/results.json`、`static/summary.json`、`static/results.md`、`module-mapping.json`、`erp-routes.json`。日志不随本文自动提交；本文保留可审阅摘要。

## 2. 已执行结果

### 离线、静态与构建

- 27 个项目、28 次命令执行；除一次桌面依赖问题外其余26项首过。有效结果为 **620 项测试 + 124 项独立检查通过，0 跳过**；套件可能重复覆盖业务，不代表744个独立业务场景。
- 前端单元测试346项通过；后端lint、指定 `tsconfig.app.json` 的前端类型检查通过。前端lint为0错误、5条 `react-refresh/only-export-components` 警告，未为过门禁屏蔽。
- ERP与PDA前端构建均通过，产物输出到任务output目录，未改写 `frontend/dist`。两次构建保留 queryClient 静态/动态导入重叠提示；没有构建Windows安装包或Android APK。
- `test:audit-client` 首次31项中9项因 `MODULE_NOT_FOUND: semver` 失败，属于本工作树桌面依赖缺失。仅补跑进程使用 `NODE_PATH=/Users/chengjianghao/flowcube/desktop/node_modules` 复用与lockfile一致的semver 7.7.4，随后31/31通过；未持久更改环境、依赖目录、package或lockfile。该处理是客户端审计依赖复用，不是修改构建代码，也不能证明新工作树独立安装已成功。

### 独立数据库回归

- **40 个独立套件、42 次命令执行，39 个套件首次业务执行通过**。快递直连套件首次发生真实并发重放死锁；单独复跑通过只能说明时序变化，不能宣称竞态已修复。
- 报表第一次隔离包装因 `npm --prefix` 改变cwd而找不到模块，尚未执行业务；修正output包装绝对路径后原脚本执行通过。11个报表服务入口返回成功；首轮仓库运营4项历史可选指标降级，后续已补非零数值、日期与仓库范围专项39/39（含现行状态口径），详见第4节。
- 数据库用例串行、有界执行；快递使用注入adapter，打印使用独立库虚拟设备，无真实快递、支付或物理打印。报表使用任务专属预加载验证显式测试配置并阻止dotenv读真实backend/.env。
- party-ledger 动态临时库创建前不存在，创建/清理守卫与最终不存在结果已记录；未清理任何原有repair测试库。

## 3. 62个挂载模块的本轮覆盖

表内无 `test:` 前缀的命令名默认表示 `npm run smoke:<名称>`；例外 `users-roles` 为 `node tests/users-roles.smoke.test.js`，`cors-policy` 为 `node --test tests/cors-policy.test.js`。单独写出的 `node tests/...` 按原命令执行。全部“通过”仅指该行列出的实际断言，不表示整个模块全部接口或全部状态组合通过。UI读取列以72入口检查为基础，典型交互见第6节，未操作的管理动作明确保留。

| API挂载模块 | 本轮实际测试入口 | 结果范围 | UI与剩余边界 |
|---|---|---|---|
| `/api/auth` 认证 | users-roles、warehouse-scope、pda-device-session；cors-policy | 通过所测登录、改密/禁用令牌失效、设备会话与来源断言 | ERP 现有登录不代表所有角色或全部续期竞态；不登出用户会话。 |
| `/api/users` 用户 | users-roles、warehouse-scope、audit-finance-security | 通过所测用户创建/改密/禁用与超管保护 | 用户页入口已打开；列表筛选及全部管理动作仍需逐项确认。 |
| `/api/departments` 部门 | masterdata | 65条HTTP断言通过：CRUD、父级/防环、负责人、省略/清空、成员引用与权限 | 部门表单、空名校验及父级排除自身已查；未在开发库保存。 |
| `/api/approvals` 审批 | approval-flow、purchase-approval | 通过多级审批引擎与采购审批所测分支 | /approvals/pending、/approvals/flows 入口已打开；审批流配置 CRUD 未单独证明。 |
| `/api/warehouses` 仓库 | warehouse-scope、prelaunch-scope-export、warehouse-masterdata | 补真实管理接口 64 断言通过，覆盖权限/限仓/筛选/启停/引用删除保护 | 四模块仓储专项见 2026-09-13 报告；已查仓库创建/编辑/筛选/取消，其他业务单据引用未逐一构造。 |
| `/api/suppliers` 供应商 | masterdata | 77条HTTP断言通过；修复新建SQL占位符错误，覆盖CRUD、查询、输入、结算与引用保护 | 新建/编辑字段与标签已查，未在开发库保存。 |
| `/api/products` 商品 | mainline 的商品导入；prelaunch-scope-export 的停用商品保护 | 通过导入入口及指定主数据引用保护 | /products 入口已打开；商品全字段编辑、价格等级等不由这些断言覆盖。 |
| `/api/inventory` 库存 | audit-inventory、atp、p0-regression、p1-regression、test:integration | 通过 ACTIVE 容器事实、预计绑定及主链路数量一致性断言 | /inventory、/inventory/trace 等入口已打开；未在开发库执行缓存重算或库存调整。 |
| `/api/customers` 客户 | masterdata；prelaunch-scope-export | 89条主数据HTTP断言通过，覆盖CRUD、查询、授信权限/审计、引用与停用 | 客户筛选、空名保护及新增编辑启停入口已查；前端3项回归通过，未保存开发库。 |
| `/api/customer-addresses` 客户地址 | 无直接专项 | 销售新建表单选择客户后地址簿弹层已打开 | 无独立注册页；地址详情、默认地址、创建删除未单独测试。 |
| `/api/carriers` 承运商与快递账户 | test:direct-express；smoke:direct-express | 离线50项通过；DB首轮发现并发死锁，修复后专项通过，见第4节 | /carriers、/carrier-accounts 已打开；未发真实快递请求，不能称正式月结下单已验。 |
| `/api/logistics` 物流 | test:direct-express；smoke:direct-express | 离线签名/防重复断言通过；共享幂等死锁已修复并完成定向回归证据 | /logistics、运费对账入口已打开；轨迹读取与真实下单、作废、运费支付分开。 |
| `/api/purchase` 采购 | mainline、purchase-approval、p0-regression、p1-regression、warehouse-scope | 通过采购收货结算、短装、采购归属及仓范围所测断言 | /purchase 入口已打开；历史采购修复 DB 专项已在后续临时独立实例补跑8/8，见第4节。 |
| `/api/purchase-requisitions` 采购申请 | approval-flow、procurement-planning | 通过请购审批与采购计划转换/覆盖承诺所测断言 | 采购申请新建表单已补查必填字段、明细空状态与关闭；未保存。 |
| `/api/procurement` 采购建议 | test:procurement-planning；smoke:procurement-planning | 通过纯规则与并发生成、请购覆盖、转换取消等DB断言 | /procurement、/reports/replenishment 入口已打开；未从开发库创建真实采购建议。 |
| `/api/sale` 销售 | sale-adjustment、atp、p0-regression、p1-regression、credit-outbound、warehouse-scope | 通过所测占库/分仓/改单/信用与出库分支 | /sale 入口已打开；未由浏览器执行真实订单写入全流程。 |
| `/api/stockcheck` 盘点 | test:integration、warehouse-scope、audit-inventory | 通过盘点/库存主链路及仓范围所测断言 | /stockcheck、/stockcheck/abc 入口已打开；ABC规则维护与扫码实机未完整验。 |
| `/api/disposals` 库存处置 | disposal | 专项所测建议/审批/处置与台账断言通过 | /disposals 入口已打开；未处置开发/生产库存。 |
| `/api/refunds` 退款 | refund-orders | 专项所测红冲已收、账户出账与退货守卫通过 | /refunds 入口已打开；未发生真实资金退款。 |
| `/api/credit-overrides` 信用放行 | credit-override、credit-outbound | 通过申请审批与占库放行/出库信用复查断言 | /credit-overrides 入口已打开；仅所测额度/审批场景。 |
| `/api/dashboard` 仪表盘 | frontend-unit 中组件用例；无 dashboard API 专项结论 | 仅 /dashboard 入口读取；静态组件用例通过不等于指标对账 | 不保存用户布局；低库存可能触发浏览器通知权限提示。 |
| `/api/settings` 系统设置 | 无系统设置管理直接专项 | 仅 /settings 入口读取 | 未保存配置、上传品牌图或改变开发/生产连接。 |
| `/api/roles` 角色权限 | test:permissions；users-roles/warehouse-scope 为用户角色边界 | 181个前后端权限码3项一致性通过；角色管理仅入口读取 | /permissions 已打开；角色权限配置 CRUD 及所有角色矩阵未证明。 |
| `/api/reports` 报表 | reports、reports-values、warehouse-ops、mainline、audit-finance-security；test:workbench | 所测报表结构/数值通过；首轮四指标降级已补真实非零与仓范围/日期专项 | 全部对应静态报表入口已打开；仓库运营与PDA读取专项39/39（含现行状态口径），见 `docs/warehouse-ops-regression-2026-09-12.md`。 |
| `/api/export` 导出 | mainline、prelaunch-scope-export、payments-default-scope、audit-finance-security | 通过所测字段、账套/仓范围、超500行与超限拒绝断言 | 覆盖的导出类型见日志；不推导每一种导出格式和所有筛选组合均通过。 |
| `/api/import` 导入 | mainline；test:upload | 商品/库存模板与商品导入入口通过；上传限制6项通过 | 未在开发库正式导入；供应商/客户/价格表等全部导入消费者未完整验。 |
| `/api/transfer` 调拨 | round2-transfer、test:integration、warehouse-scope | 通过重复商品数量分配、扫码回执与跨仓主链路断言 | /transfer 已打开；PDA 实机双仓扫描仍待验。 |
| `/api/returns` 退货 | audit-inventory、test:integration、refund-orders | 通过所测退货数量/容器/账款联动断言 | /returns/purchase、/returns/sale 已打开；不等于前端退货表单全流程。 |
| `/api/return-tasks` 退货执行 | audit-inventory；test:audit-client 内退货扫码用例 | 通过所测退货执行/部分质检与扫码解析断言 | 主要为 PDA 动态作业入口，浏览器/原生硬件操作未完整验。 |
| `/api/payments` 往来账款 | party-ledger、payments-default-scope、finance、refund-orders、prelaunch-finance | 通过所测往来归属、核销、余额与退款联动 | 应收/应付/对账入口已打开；历史应收修复相关DB专项已在后续临时独立实例补跑13/13，见第4节。 |
| `/api/finance` 资金费用 | finance、prelaunch-finance、refund-orders | 通过账户/流水/费用报销及资金回归所测断言 | 资金/费用静态入口已打开；没有真实支付操作或外部支付验收。 |
| `/api/accounting` 会计 | test:accounting；accounting、accounting-period、invoice-quota、audit-finance-security | 通过科目映射及凭证、期间、发票配额/冲销所测断言 | 科目/凭证/总账/报表/发票/期间/合并/税务入口已打开；不能将少数账套样本当完整会计验收。 |
| `/api/fixed-assets` 固定资产 | prelaunch-scope-export、prelaunch-finance | 通过已测账套导出、日期/提足状态与相关财务保护 | /accounting/fixed-assets 已打开；资产完整新增/折旧/处置生命周期未单独证明。 |
| `/api/hr` 人事工资 | test:hr-tax、prelaunch-hr、round2-payroll | 通过税额纯函数及工资事务/并发专项所测断言 | 没有 ERP/PDA 注册页；员工管理HTTP列表和全字段维护无 UI 验收，工资原生输入流程亦不存在注册入口。 |
| `/api/oplogs` 操作日志 | test:oplog | 脱敏11项检查通过；/oplogs 入口读取 | 查询筛选/导出/留存策略不由脱敏单测全部覆盖。 |
| `/api/fulfillment` 履约 | test:fulfillment、test:fulfillment-refresh；smoke:fulfillment | 通过规则、刷新队列与自动发现/认领/版本冲突/交期/仓范围断言 | 待办/订单详情消费者入口已打开；未在开发库点认领、更新问题或修改日期。 |
| `/api/document-activity` 单据活动 | test:document-activity | 7项归属/脱敏/数据范围断言通过 | 无独立静态页；已补查一笔收货详情的操作记录视图；创建、收货、上架、结算历史事件显示正常，未覆盖全部订单种类。 |
| `/api/notifications` 通知 | 无通知API直接专项 | 已打开全局通知面板，显示12类待处理提醒 | 无独立注册页，当前模块仅 GET 聚合提醒；面板显示不证明各类数量对账或跳转全部通过。 |
| `/api/search` 搜索 | node tests/search-scope.smoke.test.js；mainline | 通过数组契约及单仓/超管搜索隔离断言 | 全局搜索实际输入/跳转由UI补证，不能只用壳层读取代替。 |
| `/api/warehouse-tasks` 仓库任务 | concurrency-guards、sale-adjustment、p0-regression、p1-regression、warehouse-scope | 通过取消逆向归还、阶段保护、分仓出库与跨仓拒绝断言 | 无独立ERP注册页；波次/销售详情消费者与PDA实机阶段操作分开。 |
| `/api/price-lists` 价格表 | frontend-unit 中销售价格解析mock用例；无价格表DB专项结论 | 仅客户/销售入口读取；不能以mock通过宣称真实定价通过 | 无独立注册页；需补真实 customer-price、价格表明细与权限API用例。 |
| `/api/price-change` 改价 | audit-finance-security | 无匹配/停用/金额不匹配审批流拒绝且不改价断言通过 | /price-change 已打开；完整改价批准成功路径与UI交互未单独证明。 |
| `/api/categories` 分类 | masterdata | 71条HTTP断言通过：四级树/祖先路径、第五级拒绝、状态、引用删除与权限 | 原有树和新建空表单已查；未在开发库创建树。 |
| `/api/print-templates` 打印模板 | test:label；print-template-preview | 点阵/几何和10类真实预览数据、权限/DPI/回滚等断言通过 | 模板列表入口已打开；Linux容器字体、物理出纸与扫描不能由本机测试证明。 |
| `/api/printers` 打印机 | print-queue 测打印路由绑定结果；无打印机管理CRUD专项 | 普通打印机页入口读取，队列消费者所测路由断言通过 | online-clients/all-clients GET会写离线投影；管理设备保存和硬件打印未验。 |
| `/api/print-jobs` 打印队列 | test:print；mainline、print-queue、test:print-purge | 通过入队/领取/令牌/失败重试/过期/回滚与清理断言 | 条码打印查询入口已打开；没有物理消费者，未触发真实补打。 |
| `/api/locations` 库位 | prelaunch-scope-export、mainline、warehouse-masterdata | 补真实管理接口 57 断言及前端编码 3 项回归通过，修复越仓创建/目标更新/下拉/扫码与过期编码 | 页面生成/清空编码及筛选恢复已查；保留历史手写码，全局编码唯一策略未改，扫码硬件未验。 |
| `/api/racks` 货架 | warehouse-masterdata | 68 HTTP 断言及前端清空文本/编辑入口 2 项回归通过；修复限仓遗漏、跨仓同码更新误拦截、清空文本无效及编辑入口缺失 | 创建/扫码前置提示/滚动表单/筛选已查；未触发物理打印。 |
| `/api/scan-logs` 扫描日志 | concurrency-guards、sale-adjustment、pda-device-session、warehouse-ops | 原扫描/取消归还断言通过；补统计/异常/任务详情仓范围、日期和真实HTTP401/403/404 | 修复读取串仓及结束日遗漏；实际扫描设备和全部异常类型未验，GET anomaly运行时DDL边界保留。 |
| `/api/inbound-tasks` 收货执行 | mainline、p0-regression、p1-regression、warehouse-scope、print-template-preview | 通过收货/上架/短装/超收防重/成本归属/打印事务断言 | /inbound-tasks 已打开；pending-containers GET写逾期标记，未当纯只读补测。 |
| `/api/admin` 管理上架 | mainline | 管理员补录上架成功与权限拒绝断言通过 | 仅 POST /putaway，无独立 UI/GET；成功路径只在独立测试库执行。 |
| `/api/containers` 容器逾期 | 无该挂载模块直接专项 | 未执行 /containers/overdue，仅源码识别副作用 | 库存引擎测试不等于该API通过；GET刷新逾期标记，frontend无直接消费者。 |
| `/api/plastic-boxes` 塑料盒 | prelaunch-scope-export；concurrency-guards 的容器拆分分支 | 通过所测盒管理仓范围/删除并发守卫及相关拆分断言 | /plastic-boxes 入口已打开；实物盒扫码、所有管理字段尚未验。 |
| `/api/picking-waves` 拣货波次 | concurrency-guards / sale-adjustment 的仓库执行；reports 的波次指标 | 相关执行断言通过；波次管理仅入口读取 | /picking-waves 已打开；波次创建/合并/释放的独立完整流程未证明。 |
| `/api/packages` 包裹 | concurrency-guards；print-template-preview | 通过打包、取消拆箱归还与事务内箱标签数据断言 | 无独立静态入口；箱内商品所有编辑路径和实物标签未完整验。 |
| `/api/sorting-bins` 分拣格 | prelaunch-scope-export、concurrency-guards、warehouse-masterdata | 补真实管理接口 63 断言通过，覆盖批量/容量/占用删除保护及双向释放/限仓扫描 | 页面批量预览、单个新建、编辑/筛选已查；写入和释放只在独立库，实际分拣格扫码未验。 |
| `/api/pda` PDA接口 | pda-device-session；test:audit-client；PDA前端构建 | 设备未绑定拒绝/会话边界及原生更新静态用例通过 | 30个PDA叶子入口尚未全程操作；设备绑定、加密存储、扫码、APK安装升级需单列。 |
| `/api/printer-bindings` 打印绑定 | print-queue 的无绑定/专用绑定入队断言 | 消费者路由绑定结果通过；管理API未单独测试 | 无独立页，绑定列表/新增删除未由普通打印机页读取证明。 |
| `/api/app-update` 桌面更新 | test:audit-client（NODE_PATH复用后31/31） | 桌面版本清单/URL/hash/证书及损坏安装包相关断言通过 | 无独立ERP注册页；本地latest真实响应/Windows下载安装尚待补，缺清单可返回业务404。 |
| `/api/system` 系统回执 | p0-regression、round2-transfer；test:round2-runtime | 回执归属/action/缺参/登录与相关恢复观测断言通过 | 无独立页；真实浏览器断网重试恢复及错误上报界面联动待UI补证。 |
| `/api/pda-devices` PDA设备 | pda-device-session | 通过所测设备会话与未绑定拒绝断言 | /settings/pda-devices 已打开；新绑定、密钥轮转、真机禁用联动未由列表通过证明。 |
| `/api/portal` 内部查询门户 | prelaunch-scope-export | 供应商仓范围、客户ID/同名/改名/历史归属断言通过 | 两个内部门户入口已打开；已打开客户/供应商选择器并选择对象，不同角色登录仍未在UI逐个测试，不是外部客户/供应商独立账号门户。 |

## 4. 失败、未运行与副作用边界

### 并发死锁修复

`smoke:direct-express` 首轮在 `tests/direct-express.smoke.test.js:54` 的两个并发账号创建回执重放中触发 `ER_LOCK_DEADLOCK`。首轮源码 `backend/src/utils/operationRequest.js:50` 重复INSERT留下共享锁，`:65` 再用FOR UPDATE申请排他锁，形成互等；实际 InnoDB 死锁图存于 `db/innodb-deadlock.log`。最小路径是同一requestKey/userId已创建成功后，同时执行两次binding.create。修复将只读既有状态的分支改为 `FOR SHARE` 当前读，避免S锁升级为X锁；不用快照读、不加入业务或外部请求自动重试。新增7项真实SQL回归：确定性红测4通过、3死锁；修改后7/7。RC隔离锁升级场景，RR另验旧快照及首次并发提交，不改变生产事务隔离级别。用户、动作、资源身份、409、回滚与迟到失败均有覆盖。专项已接入原 `concurrency-guards` CI入口。修复后并发护栏88、主链路49、财务108、调拨15、快递离线50和快递DB三组全部通过；后端lint通过，测试请求回执残留0。日志为 `db/operation-request-*.log`、`db/operation-fix-*.log`。

### 未运行/部分降级

- 首轮未运行的 `smoke:purchase-repair`、`smoke:legacy-receivable-repair` 已在后续补跑：新建任务专属 MySQL 8.0.46 临时容器，在随机回环端口使用固定库名 `flowcube_repair20260908_test`，完整迁移后串行8/8、13/13通过。原3307同名库及原有数据未动；临时容器、匿名数据卷及凭据文件已清理并核验。详见 `docs/module-followup-2026-09-12.md`。
- warehouseOps 首轮四项降级已完成补证：两日志表确为现行按需创建，真实记录服务初始化后查到非零数值；另发现并修复四指标串仓、出库参数顺序、空范围SQL、最新异常日期，以及PDA统计/异常/任务详情读取越权与结束日遗漏。读取范围专项先由6过9失败、扩展23过14失败到37/37；评审随后识别旧状态夹具不足，按现行状态机补测35过4失败，修复后最终39/39、零SQL降级。出库按SHIPPED与真实出库日优先（NULL回退更新时间），拣货仅PICKING，入库仅全部上架完成，流程为六个活动阶段，均排除软删除；实际HTTP权限和九表夹具残留0均已核实。细节见 `docs/warehouse-ops-regression-2026-09-12.md`，不代表生产/实机已验。
- `smoke:pages`、`smoke:reconciliation` 两个脚本未作为本轮数据库/静态命令执行；CUA页面验收单独记录，不冒用这两个脚本“通过”。
- 13条ERP动态规则及30个PDA叶子入口不自动包含在72静态入口的加载数内。原生扫码、设备绑定/加密存储、Android APK安装升级、Windows安装更新、Linux容器字体和物理打印/条码扫描均需独立验收。
- `backend` 的 `test:package-add-item`、`test:package-finish-print` 只是 `echo removed`，不算测试项目。

### 不能当纯只读的GET与UI操作

| 端点/触发 | 已确认副作用 | 本轮处理边界 |
|---|---|---|
| GET `/api/containers/overdue` | `containers.service.js:9` 调用逾期刷新，UPDATE容器标记 | 不在开发库纯只读扫描中调用；未计该API通过 |
| GET `/api/inbound-tasks/pending-containers` | `inbound-tasks.query.js:529` 同样刷新逾期标记 | 普通收货列表与此接口分开 |
| GET `/api/printers/online-clients`、`/all-clients` | `printers.service.js:237/265` 将超时客户端status置0 | 在线投影写入不能标成纯只读 |
| Electron自动打印桥 | 登录后心跳、领取队列和实际打印 | 本次CUA普通浏览器无printZpl桥；不启动真实Electron自动消费者 |
| 履约“更新问题/认领/处理”、物流“重试/作废”、配置“保存” | 更新业务或投影状态，物流可能入队 | 入口加载不点击这些动作，不据此主张成功写入 |
| GET `/api/scan-logs/anomaly` | `getAnomalyReport` 执行两条 `CREATE TABLE IF NOT EXISTS` 初始化日志表 | 本轮仅在独立测试库执行；迁移化未纳入本次修复，不标为完全只读 |
| GET `/api/app-update/latest` | 允许GitHub直连且缺清单时可发外网请求 | 元数据、实际下载、安装更新分开；缺清单业务404不当作代码异常 |

## 5. ERP入口记录

以下72项已逐个打开，均能显示对应页面或合并子视图。列表只是入口覆盖表，具体数据读取、发现及交互见第6节；不能读成全部按钮或全部业务状态通过。

| 序号 | 路由 | 注册标题 |
|---:|---|---|
| 1 | `/dashboard` | 仪表盘 |
| 2 | `/purchase` | 采购订单 |
| 3 | `/purchase-requisitions` | 采购申请 |
| 4 | `/procurement` | 采购建议 |
| 5 | `/inbound-tasks` | 收货订单 |
| 6 | `/returns/purchase` | 采购退货 |
| 7 | `/suppliers` | 供应商管理 |
| 8 | `/sale` | 销售管理 |
| 9 | `/returns/sale` | 销售退货 |
| 10 | `/credit-overrides` | 超额放行申请 |
| 11 | `/logistics` | 物流运单 |
| 12 | `/customers` | 客户管理 |
| 13 | `/portal/statements` | 客户对账门户 |
| 14 | `/portal/purchase-status` | 供应商到货门户 |
| 15 | `/carriers` | 承运商管理 |
| 16 | `/carrier-accounts` | 快递账号绑定 |
| 17 | `/inventory` | 库存管理 |
| 18 | `/plastic-boxes` | 塑料盒管理 |
| 19 | `/inventory/trace` | 批次追溯 |
| 20 | `/stockcheck` | 库存盘点 |
| 21 | `/stockcheck/abc` | 商品分档与分批盘规则 |
| 22 | `/disposals` | 滞销库存处理 |
| 23 | `/transfer` | 库存调拨 |
| 24 | `/products` | 商品管理 |
| 25 | `/categories` | 商品分类 |
| 26 | `/price-change` | 商品改价申请 |
| 27 | `/picking-waves` | 批次拣货 |
| 28 | `/warehouses` | 仓库管理 |
| 29 | `/locations` | 库位管理 |
| 30 | `/racks` | 货架管理 |
| 31 | `/sorting-bins` | 分拣格管理 |
| 32 | `/payments/payable` | 现结供应商账款 |
| 33 | `/payments/receivable` | 现结客户账款 |
| 34 | `/reports/reconciliation/payable` | 月结供应商对账 |
| 35 | `/reports/reconciliation/receivable` | 月结客户对账 |
| 36 | `/logistics/freight-reconciliation` | 运费对账 |
| 37 | `/finance/dashboard` | 资金看板 |
| 38 | `/finance/accounts` | 账户管理 |
| 39 | `/finance/transactions` | 资金流水 |
| 40 | `/finance/expenses` | 费用报销 |
| 41 | `/finance/expense-categories` | 费用类别 |
| 42 | `/accounting/accounts` | 会计科目表 |
| 43 | `/accounting/vouchers` | 记账凭证 |
| 44 | `/accounting/ledger` | 总账 / 试算平衡 |
| 45 | `/accounting/reports` | 会计报表 |
| 46 | `/accounting/invoices` | 发票管理 |
| 47 | `/refunds` | 退货退款单 |
| 48 | `/accounting/periods` | 会计期间 / 期末结转 |
| 49 | `/accounting/fixed-assets` | 固定资产 |
| 50 | `/accounting/consolidation` | 合并报表 / 账套 |
| 51 | `/accounting/tax` | 报税数据 |
| 52 | `/reports` | 报表中心 |
| 53 | `/reports/profit-analysis` | 报表中心 |
| 54 | `/reports/avg-cost-reconciliation` | 成本对账 |
| 55 | `/reports/kpi` | 报表中心 |
| 56 | `/reports/replenishment` | 采购建议 |
| 57 | `/reports/inventory-aging` | 存放时长与滞销 |
| 58 | `/reports/warehouse-ops` | 仓库运营 |
| 59 | `/reports/wave-performance` | 仓库运营 |
| 60 | `/reports/pda-anomaly` | 仓库运营 |
| 61 | `/reports/role-workbench` | 待办中心 |
| 62 | `/settings/print-templates` | 打印模板 |
| 63 | `/settings/printers` | 打印机管理 |
| 64 | `/settings/barcode-print-query` | 条码打印查询 |
| 65 | `/approvals/pending` | 待我审批 |
| 66 | `/approvals/flows` | 审批流配置 |
| 67 | `/departments` | 部门管理 |
| 68 | `/users` | 用户管理 |
| 69 | `/permissions` | 权限管理 |
| 70 | `/settings/pda-devices` | PDA 设备 |
| 71 | `/settings` | 系统设置 |
| 72 | `/oplogs` | 操作日志 |

## 6. 本地界面与修复复测

CUA 使用本工作树的 `localhost:5175`，普通浏览器复用现有管理员登录，临时检查页与用户原有浏览器页分开。72个静态入口逐个打开；涉及合并页面时核对真实子视图。Hash导航工具曾出现URL已变而React仍显示旧页，后续显式重载后核对标题与内容，没有把旧页当目标页通过。

- 采购申请、供应商/客户、仓库/库位/货架/分拣格、盘点、处置、改价、账户、费用类别、会计科目/账套、退款、用户/部门/设备、打印模板/打印机等列表均显示内容；采购/销售/收货/调拨/物流等默认最近日期筛选下为空，检查其筛选范围，未据此推断没有历史业务数据。
- 库存总览完成加载，统计卡及库存行可见；商品查询面板可打开，输入不存在的关键字后正确显示已应用筛选和0结果。未变更商品资料。
- 应收、利润、库存时长、补货建议、履约待办、条码查询、日志等异步页面已补查加载完成数据。采购建议的“采购计划/补货建议”链接能切换到正确子视图。
- 客户对账选择器可选择客户，显示该客户空对账状态；供应商到货选择器可选择供应商并显示历史采购数量与状态。没有把管理员入口读取当成外部用户身份隔离验收。
- 采购、销售新建表单显示必填信息、明细和金额区。销售选择客户后可打开地址簿空状态，未保存；关闭触发离开确认，确认后仅丢弃本次未保存输入。
- 日志详情能打开，认证刷新请求体中的refreshToken显示脱敏占位。没有执行日志清理、权限保存、财务支付、审批、打印、库存写入或快递操作。

### 页面缺陷修复

| 问题 | 修复与当前证据 |
|---|---|
| 条码打印查询5707行全部挂载 | 接入现有变高虚拟化；main节点190740→588，tbody5707→16，原总数5707保留；滚动末端21行/760节点，无行重叠，页签关闭恢复 |
| 操作日志13428行全部挂载 | main节点282057→449，tbody13428→19，原总数13428保留；滚动后22行，详情打开及关闭均正常 |
| 全量条码列表误把首条收货单显示为当前链路 | 只有显式合法inboundTaskId才建立链路，同单统计；普通入口错误提示已消失，6项回归验证非法参数、跨单计数与筛选 |
| 改价时间直接显示UTC原始字符串 | 统一北京时间格式；实际样例2026-08-22T12:26:12.000Z→2026-08-22 20:26已在页面确认 |
| 门户创建时间截断UTC字符串 | 供应商到货及客户对账统一北京时间；供应商实际样例2026-09-02T13:05→2026-09-02 21:05已在页面确认 |
| 浏览器误判为桌面打印环境 | 使用真实运行时与桥接能力；货架和打印机页已显示简短浏览器说明，浏览器不再携带本机打印来源头；不改变入队及单一打印消费者 |

上述前端变更经19项打印相关测试、6项条码页面回归及共享虚拟表格/数据表回归验证，独立质量审查另跑29项通过，主任务最终选定测试41项通过并补跑7项虚拟表格回归；最终前端类型、后端lint及ERP构建重新通过；定向前端lint通过。相同用例的重复运行不重复累加到首轮620项中。修复细节见 `docs/ui-display-fixes-2026-09-12.md`。

## 7. 文档与交付状态

`AGENTS.md` 同步幂等共享当前读、两处新增虚拟化页面和收货上下文规则；本报告及UI修复记录与代码同批提交。临时浏览器标签已关闭并核验，视口覆盖已恢复，用户原页面回到补货建议；本地开发服务保留。原始output日志保留本机，未将完整业务行复制到提交中。本文不记录也不授权发布、推送、生产重启或生产数据修改。

剩余范围是表中明确未覆盖的CRUD/全部状态组合，以及用户暂缓的生产/实机/物理打印与正式快递验收。两项历史修复专项和四项降级报表指标已在后续补证闭合。无独立专项的模块按UI读取记录，不升级为全业务通过。

## 8. 后续补证

同日继续完成两项历史修复DB专项21项、7个新建表单的安全读取、模板预览、通知面板以及一笔收货详情/操作记录。仓库运营与PDA读取修复另有真实范围、日期、状态回归。分别见 `docs/module-followup-2026-09-12.md` 和 `docs/warehouse-ops-regression-2026-09-12.md`；没有把这些结果升级为全业务状态或设备验收。

## 9. 主数据专项补证

同日继续补四模块直接HTTP回归302条断言（客户89、供应商77、部门65、分类71）。修复供应商创建500、部门无效父级与负责人误清空，客户编辑补启停入口并完成前端3项测试和CUA复核；分类日志恢复正常字段。详见 `docs/masterdata-regression-2026-09-12.md`，仍不代表每个业务组合或全部并发场景已验。

仓储配置专项补测与页面证据见 [2026-09-13 仓储配置管理回归](warehouse-masterdata-regression-2026-09-13.md)，不以管理接口通过替代硬件、全部状态或生产验收。
