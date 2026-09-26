# AGENTS.md — 极序 Flow / Codex 工作约定

本文件是 Codex 在本仓库工作的**入口与约束清单**，适用于整个仓库。业务事实以当前代码、迁移和实际配置为准；文档与代码冲突时先核实，再同步两者。

**本文件的定位（2026-09-19 重构）**：只放两类内容——① **每次都必须生效的行为约束**；② **「何时必须读哪份主题文档」的索引**。
项目知识、业务流程、命令细节、历史背景一律放 `docs/`（见 §4）。旧版单文件全文归档在 `docs/agents-md-archive-2026-09-19.md`，重构说明见 `docs/agents-md-refactor-2026-09-19.md`。

**体积是硬约束**：本文件必须 ≤ **32 KiB**（默认注入预算 64 KiB 的一半，留一倍余量）。超预算的后果不是"变慢"，而是**尾部被静默截断**——2026-09-18 实测：文件 211 KB 时新会话注入的是一份过时的 `CLAUDE.md`、本文件显示 `omitted`，全链路不报错；重构前 130.6 KB 时 §8 之后（财务/前端/打印/部署/运维）**全部进不了上下文**，等于规则写了没人看见。`npm run test:agents-md-guard` 断言本约束：**超限即 CI 失败，不允许"再加一条"**。

## 0. 元规则：载体分工

1. **规则的首选载体是 `tests/` 守卫，不是文档。** 能机械验证的一律写成契约测试并接进 `package.json` 与 `.github/workflows/test.yml`；本文件只留一行指针（§0.2）。理由：文档会被截断、被忽略、会腐烂，测试不会；而且**没被反向验证过的守卫等于没有守卫**——新增守卫必须证明「破坏它会让测试失败」。
2. **改动同步到「对应的主题文档」**（§4 索引），不再要求一律改本文件。只有「新增/修改行为约束」或「新增主题文档」时才动本文件；同步与代码同批提交，文档未同步则任务不算完成。
3. **数量、版本、路径、"不存在/未启用/已部署"等断言必须当场核对**，并区分「已实现 / 已提交 / 已推送 / 已部署 / 已验证」。无法验证的明确标注待核实。
4. **显式指令优先**：用户当前要求 > 本文件 > 主题文档 > 历史归档。历史文档里的「已修复/未提交/当前数量」不得当作今天的状态。
5. **不要反向推断**：本文件没写不等于允许；涉及库存、账款、权限、状态机的改动，先读对应主题文档与完整调用链，再动手。

## 0.1 红线：没有守卫、后果重、最容易忘的

> 这些**没有 CI 拦截**，全靠动手前对照；每条都指向实现位置，详细背景见对应主题文档（§4）。

- **撤回收货拒绝在途调拨容器**：`transfer_order_id` 非空即 409（`inbound-tasks.void.js`）
- **盘点扫码账面查询必须带 `locked_by_task_id IS NULL`**，action 用 `stockcheck.scan.<盘点单ID>` + 幂等回执（`stockcheck.service.js`、PDA `stockcheck.tsx`）
- **行已有预占时禁止更换发货仓库**：400 `RESERVE_WAREHOUSE_CHANGE_NOT_ALLOWED`（`sale.service.js`）
- **销售收入凭证**按已发原值占比净额化折扣、税额夹到折后净额；退货冲回成本用 `COALESCE(soi.cost_snapshot,0)` 且去掉 `product_items` JOIN，兜底留给 `reports.query.js`（`voucher-engine.js`）
- **采购结算毛额子查询必须按 `(order_id, product_id)` 关联并先跑来源断言**，脏单抛 `INBOUND_PURCHASE_SOURCE_INVALID` / `PURCHASE_LEGACY_RECEIPT_UNRECONCILED`（`voucher-engine.js`）
- **移库/拆分必须 `assertInScope`**（移库还须目标库位同仓）；`resync-stock` 是写操作，走 `inventory.adjust`（`inventory.controller.js`、`inventory.service.js`）
- **仓库范围写路由必须行锁、禁止自我提权，限仓创建账号继承范围、代授权不得超出自身范围**：`USER_SCOPE_SELF_FORBIDDEN`（`PUT /users/:id/warehouse-scope`）
- **范围校验必须覆盖读写路径**：`scan-logs` 四条写路径、`POST /admin/putaway`、`findMyTasks`/`findMyTaskSkuSummary`/`getTaskStats`（空范围返回空）
- **范围校验还必须覆盖**：`GET /products/finder`、`GET /containers/overdue`、`GET /returns/{purchase,sale}/source-order`（逐行校验发货仓）、`GET /approvals/biz/:bizType/:bizId`（`BIZ_DOC_META` + `sys_role_permissions`，未知 400）、`print-jobs` 列表与条码补打
- **`print-jobs` 三张条码子查询分别用 `c.` / `wt.` / `j.warehouse_id`**；SQL 文本替换必须带足上下文并真跑三种范围
- **`complete-local` 同 `complete-client`/`fail-client` 做工作站校验**；写路由必须 `requirePermission`（`fulfillment.routes.js`）
- **数量精度是两位小数（0.01）**：所有数量列 `DECIMAL(_,2)`，用户原量及未取整换算结果超过两位先拒绝，合法值再用 `unitConversion.roundQty`；**金额/单价/授信仍旧四位**，别一起改。改动精度要 grep 全仓 `10000`（乘与除都要改）（`docs/business-semantics.md`）
- **库存唯一事实源是 ACTIVE 容器的 `inventory_containers.remaining_qty`**，`inventory_stock.quantity` 只是缓存；唯一合法缓存写入口是 `syncStockFromContainers()`，禁止业务代码直接 UPDATE quantity（详见 `docs/inventory-transaction-invariants.md`）
- **写操作幂等**：前端发稳定 `X-Request-Key`，后端走 `beginOperationRequest`/`completeOperationRequest`；重放返回原回执，不得重复加库存、推进状态或入账（详见 `docs/inventory-transaction-invariants.md`）
- **批量写入用 `VALUES ?`（mysql2 二维数组）且先判空**：空数组会 `ER_PARSE_ERROR`；禁止循环内逐行 INSERT/UPDATE（`procurement.service.js`、`hr.service.js`）
- **`updateInvoice` 的 `assertInvoiceQuota` 必须传同一事务 `conn`**
- **销售退货可退量按 `wt.warehouse_id = COALESCE(soi.warehouse_id, 销售单头仓)` 关联**（`returns-sale.service.js`）
- **先 `lockStockDimension` 再锁容器**：`splitContainer` 与 `confirmContainerReturn` 都按此序（`warehouse-tasks.adjust.js`）
- **月结对账导出透传全部筛选并取 `EXPORT_MAX_ROWS`、超限即拒**；年结排除自身凭证（`export.service.js`）
- **占库期与执行期改单共用 `assertNoDuplicateSaleItemLines`**（在 `hydrateSaleInput` 之后）；改单挂起期间拣货/复核扫码补 `adjustment_requested_at` 并 409（措辞同 `check.js`）
- **采购退货出库按 `pri.id = wti.purchase_return_item_id` 关联**，仅商品在本单内唯一才回退 `product_id`，否则 `PURCHASE_RETURN_ITEM_LINK_MISSING`（`warehouse-tasks.ship.js`、迁移 `247`）
- **对账单 `findAll`/`findById` 共用金额整形、状态推导与 `refreshSettlement`**
- **标签渲染失败不得回滚业务事务**：降级 `status=3` unprintable + `label render failed: <CODE>`
- **承运商 mock 需 `ALLOW_MOCK_CARRIER=1` 且非 production**，否则 `CARRIER_MOCK_NOT_ALLOWED`；管理页写月结/取号字段即 400 `CARRIER_ACCOUNT_FIELDS_MOVED`，闸门共用 `carriers.guards.js`
- **软删主数据活跃唯一性用生成列 `active_unique_guard`**；迁移 `252` 遇重复活跃编码 fail-loud，`codeGenerator.js` 取号进事务 + 撞号换号
- **已执行迁移的漂移只能新增条件式迁移订正**（且仅当值仍是已知错误值）（`249_*`）
- **新增迁移必须幂等、编号最大 + 1，不得改已执行迁移或删字段**；索引/外键用幂等 DDL 单独补（`250_*`、`251_*`）；只按 `print_type` 的全局唯一索引也用幂等 DDL 删除（`246_*`）
- **schema 对账必须查 `information_schema` 按名字 + 列序比对，并在生产库核对**（`CREATE TABLE IF NOT EXISTS` 后补索引/外键会静默失效）（`schema-reconcile.js`）
- **PDA 设备改绑仓库/停用必须单事务**：行锁判换仓、`revokeSessions(..., conn)`，非 active 无条件吊销（`middleware/pdaSession.js`）
- **源码文本契约测试先去注释**：只剔整行注释（按 `//` 全剔会把 `http://127.0.0.1` 这类字面量的后半行一起砍掉，2026-09-18 实测导致守卫自我误报）；锁顺序按「上一个 `FOR UPDATE` 之后」归属；`INSERT` 列数必须与 `?` 一致
- **`printers.service.update` 的 `status` 只允许 0/1（路由 + service 双重）**，写语句同事务行锁，缺失字段沿用现值
- **资源级幂等 action 必须绑定单据 ID**（`action.<resourceId>`）；创建类用载荷指纹；回执查询剥尾部 `.<ID>` 取 base；调拨必须是 `transfer.scanOut.<id>` / `transfer.scanIn.<id>`（`utils/operationRequest.js`）
- **`track_status` 含义只在 `logistics.service.js` 定义一处、导出列名「签收状态」**；运费账单匹配用 `tracking_no = ? OR JSON_CONTAINS(tracking_numbers, JSON_QUOTE(?))`
- **共享夹具必须自洁**：`prepareSmokeContext` 把 Smoke 客户 `credit_limit` 置 NULL；`round2-transfer.smoke.test.js` 的 `after()` 清理本轮角色/权限/用户/设备
- **前端容器必须删 `/docker-entrypoint.d/10-listen-on-ipv6-by-default.sh`**
- **回退/还原逐个写全路径、不得 `||` 兜底猜路径**，改完立即 `git status --short`
- **生产机上批量删除/清理前先确认云盘 IO，并分批执行**：该机云盘有已知读写受限。动手前看 `iostat -x 1 2`（`%util`/`await`/`aqu-sz`）与 `vmstat`（`wa`）；分批删除（每批 ≤200MB、间隔数秒）并用 `ionice -c3 nice -n19`；避开 MySQL 写入高峰与部署进行中。2026-09-19 一次删除 1.9G 后系统极端缓慢、只能靠控制台重启恢复（`docs/deploy-disk-precheck-2026-09-19.md`）
- **服务器 SSH 访问必须复用连接**（`-o ControlMaster=auto -o ControlPath=… -o ControlPersist=…`），并把多条只读查询合并进一次会话；反复新建短连接会被 sshd 限流（2026-09-19 实测：本机 IP 被限流数十分钟，同期 HTTPS 仍正常）
- **改共用函数或路由契约后，发版前统一跑全量套件**（调用点补 `X-Client-Id`）；调试故障所需的最小验证可提前跑
- **普通资金登记用共享锁、补录与结账用排他锁**：`lockAccountingCompanyShared`（`FOR SHARE`）vs `lockAccountingCompany`（`FOR UPDATE`）；**全排他就会让并发登记排队、全共享就会让结账挡不住写入**——两侧别"顺手统一"。加锁顺序固定「账套→账户→对账单→账款」。`acct_periods` 主键是 `(company_id, period)`、**没有 `id` 列**（`accounting.period-lock.js`；回归 `tests/finance-period-lock-order.smoke.test.js`，已接 CI）
- **资金期间闸门与跨期补录**：业务日期落在已结账期间的收付款登记/核销/退款出账默认 409 `FINANCE_PERIOD_CLOSED`；特权补录 `finance.period.backfill` 落痕 `finance_period_backfills`，补录凭证落**审批当天所属期间**（资金流水 `happened_at` 保持业务日期），生成是「业务提交后**立即** + 逐笔核对」，核对不过才留 `voucher_generate_error`（`finance-period.guard.js`、`finance-backfills.service.js`；详见 `docs/finance-permission-time.md`）
- **返货出库全程不动会计**：`sale_return_out` 跳过复核/打包、走独立待出库列表、重复取消**幂等不 409**；状态 1/2 的退货应收**从未冲减**，故**既不冲减也不加回**（加回＝多收客户、再冲减＝少收客户）（详见 `docs/business-semantics.md`）
- **非单据应付只认有借方科目的行**：`buildUnbilledPayable` 按 `payment_records.debit_account_code` 取科目，**NULL = 历史未分类，跳过不猜科目**（`voucher-engine.js`、迁移 `259`）

## 0.2 有守卫的规则（一行一条 → 守卫命令）

> 这些**有 CI 拦截**，违反会红。此处只作速查；「为什么」与反向验证方式写在守卫文件头部。

- 分布类图表系列数必须有界（`TOP_SERIES_LIMIT = 8` + 其他 N 个）→ `npm run test:chart-series-limit`
- 只读路径禁止 N+1；无扫码行的明细必须按 0 拒绝（fail-open 风险）→ `npm run test:query-loop`、`npm run test:warehouse-scan-closure`
- `fail-loud` 错误不得被调用处吞成静默跳过 → `node --test tests/accounting-voucher-mapping.test.js`
- `logger.info/warn` 参数顺序必须是 `(msg, meta, module_)`，meta 是对象 → `npm run test:logger-args-order`
- 前端业务日期一律走 `lib/dateTime.ts`/`lib/dateRange.ts`，禁止自拼 `getFullYear` 等 → `npm run test:frontend-date-source`
- SQL 标识符插值必须经 `assertSqlIdentifier`/`assertSqlColumnList` → `npm run test:sql-identifier`
- 每处 `eslint-disable` 必须带可读理由，整文件禁用仅限机器产物白名单 → `npm run test:eslint-disable-rationale`
- 状态文案只能取 `generated/status.ts` → `node --test tests/status-rules-integrity.test.js`
- 轮询页面不得小 `pageSize` + 高频轮询（`refetchInterval` ≥ 5s、分页批量 ≥ 100）→ `npm run test:frontend-polling-contract`
- 权限常量前后端手工同步一致 → `npm run test:permissions`
- 前端调用的接口后端必须存在（防改名漏改）→ `npm run test:api-route-contract`
- 写路由必须挂 `requirePermission`（例外须登记理由且可验证）→ `npm run test:route-permission-contract`
- 发版必须同步三端 + PDA 版本、本版说明与官网 `landing/updates.ts` → `npm run test:landing-updates`
- `backend/downloads/` 已废弃，只允许 `.gitignore`/`README.md`（须在 CI 静态 job 真跑）→ `npm run release:check-downloads`
- `smoke:*`/`test:*` 脚本必须 CI 可达；smoke 测试服务须 `app.listen(0, '127.0.0.1')`；部署预算须覆盖上传/合并/等锁/回退，PDA 等待不得提前超时；PDA 工作流「等部署」与「持组」不同 job；桌面发布清理服务器中转目录（`EXIT` trap）；部署磁盘预检失败必须打印余量；SSH `known_hosts` 必须使用独立核对的可信公钥，禁止在线盲信扫描；只读诊断 workflow 必须只读 → `node --test tests/deployment-resources.test.js`
- 恢复演练临时卷必须具名 + 启动前幂等清理；`dingtalk_send` 失败必须非 0 → `node --test tests/ops-monitor-restore.test.js`
- 备份导入前只把触发器残留分号移出可执行注释 → `node --test tests/restore-trigger-normalize.test.js`
- 迁移逐条执行、触发器函数体不得残留结尾分号 → `node --test tests/migration-trigger-bodies.test.js`
- 前端命名与呈现结构：菜单名 = 工作区标签 = 页面标题、标签 ≤7 汉字、带日期的查询弹窗必须能重置回本页默认口径、纯图标按钮必须有可读名称 → `npm run test:frontend-conventions`
- 只允许整数的商品（`allow_decimal_qty=0`）不得按小数下单/出入库/调拨/盘点；录入类模块须走 `foldEntryItems()` → `npm run test:qty-precision`、`npm run test:qty-precision-coverage`
- `AGENTS.md` 体积、关键章节与红线必须在默认预算内，`docs/*.md` 与 `npm run` 引用有效 → `npm run test:agents-md-guard`

## 1. 协作与操作边界

- 中文沟通（用户可见文案中文、标识符英文）；先说要做什么，过程报关键发现，最后给结果与验证依据。
- **动手前先看 `git status --short --branch` 与相关 diff**，保留用户与其他任务的改动；禁止用 `reset`/`checkout`/`clean` 清除不属于本任务的内容。
- **提交范围必须明确**：先列出拟提交文件与用途，只暂存已核对的路径，不用 `git add .`/`--all`。业务代码与其说明文档同批提交；技能迁移、环境整理、版本发布分别组织。
- **未经明确要求，不执行** `git push`、打 tag、发版、重启生产服务、会删数据的 SQL。**已授权的同一操作不重复询问**；需要新授权时先停手问清楚。
- 分支默认 `codex/` 前缀；需要隔离时用工作树，但不要假定新工作树已装依赖或具备本地环境配置。
- 发布工作树收尾：确认工作区干净后切回 `codex/release-*` 或停在已发布提交，释放 `main`；用 `git worktree list` 核验。
- **工具可直接安装**（用户长期授权）：缺 Skill/MCP/插件/CLI/依赖时自行安装并验证，完成后简要记录；涉及项目配置或流程变化时按 §0 同步文档。需要登录、付费或平台强制本人授权时，说明原因并请用户协助。
- **项目凭据代为输入**（用户长期授权）：已授权任务中可用为本项目配置的凭据登录、输密码、完成认证，优先复用有效会话；**不索取密码/API Key/Token/恢复码**，不绕过验证码、生物识别等本人验证。
- **不把密钥、口令、Token 写进代码、文档、日志或提交**，不在回复中回显；旧文档里的测试账号不要复制到新文档。
- **模型提供方与上下文边界**：当前提供方会收到本会话完整上下文（仓库代码、命令输出、记忆摘要、开启 chronicle 时的屏幕内容）。允许：仓库代码、测试库、本地开发数据、脱敏样例；**禁止**：`deploy/production*.json`、`backend/.env` 真实口令、生产库导出、真实客户与账款明细。需要生产事实时由用户执行只读查询或先脱敏。
- 不为普通子任务创建用户可见的新任务；是否委派按当前会话指令。技能按当前会话可用清单选择并读取，不假设 Claude 的命令、hooks 或插件在 Codex 中生效。

## 2. 项目、目录与本地环境

极序 Flow 是单租户 ERP/WMS：Electron 桌面端、Android Capacitor PDA、浏览器共用同一套 React 前端与 Node 后端。**仓库端只执行、不决策；库存与账款事实变化必须在后端事务中完成。**

- 后端：Node、Express、CommonJS、`mysql2/promise`、zod；**无 ORM，全部手写 SQL**。
- 前端：React + TypeScript + Vite + Tailwind + Radix UI；React Query 管服务端数据，Zustand 管会话/工作区，HashRouter。
- 桌面端：Electron + electron-builder，Windows 安装包由 GitHub Actions 构建；PDA：同一前端的 `/pda/*` 路由树 + Capacitor，原生能力需真机验证。
- 数据库：MySQL 8.0；业务时间统一北京时间 `+08:00`。具体版本读各端 package/lock、Dockerfile 与 CI，不照抄历史数字。

| 路径 | 职责 |
|---|---|
| `backend/src/app.js` | 中间件、路由装配、错误处理 |
| `backend/src/modules/` | 业务模块 routes → controller → service |
| `backend/src/engine/` | 库存、容器、预占、审批引擎 |
| `backend/src/constants/` | 状态机、权限、结算等规则 |
| `backend/src/database/` | SQL 迁移与迁移执行器 |
| `backend/src/scheduler.js` | 定时任务；启用条件读代码 |
| `backend/src/utils/` | 幂等、仓库范围、时间、价格、单号等 |
| `frontend/src/` | API、页面、组件、hooks、路由、store、类型 |
| `frontend/src/generated/status.ts` | 后端生成的状态常量，**不手改** |
| `desktop/`、`frontend/android/` | Electron 与 Android 原生工程（区分源码与生成物） |
| `scripts/`、`tests/` | 发布部署、运维、门禁与测试 |
| `docs/` | 主题文档、审计、故障预案、发布说明 |

不要随意修改构建产物 `frontend/dist/`、`desktop/release/`、Android 生成物、废弃目录 `backend/downloads/`、任何 `.env`、真实 `deploy/production*.json`。

**本地环境**：执行开发/测试/Android 命令前先 `source "$HOME/.config/flowcube/dev-env.sh"`（存在时），使用与 CI 一致的 Node 22（根 `.nvmrc` 声明 22，但不会自动切换），并加载 Java 21 / Android SDK。**前端 `tsconfig.json` 是空壳，类型检查必须指定 `tsconfig.app.json`**；lint、类型检查、构建与业务回归各证明不同事，不要把无输出的错误命令当通过。

## 3. 验证速查

**验证集中到发版前**：连续开发时，每项改动先核对相关 diff 和影响范围，记录待验证项；不要在每个改动完成后重复构建或跑专项、全量测试。准备发版时，对本批全部改动统一执行一次受影响端的 lint、类型检查、构建及专项/全量回归，全部通过后再走发布流程；验证后又改代码，只补跑受影响的检查。排查具体故障、验证难以判断的高风险改动或用户明确要求即时验收时，可以提前运行必要的最小检查。未执行的检查必须明确写成「待发版前验证」，不得称作通过；即使本轮不发版，也不能因此省略代码审阅与 diff 检查。

| 影响 | 相关命令 |
|---|---|
| 库存、状态、并发主链路 | `smoke:mainline`、`smoke:concurrency-guards`、`smoke:p0-regression`、`smoke:p1-regression`、`smoke:fulfillment-credit`、`test:integration` |
| 销售改单、预计库存 | `smoke:sale-adjustment`、`smoke:atp` |
| 财务、会计 | `smoke:finance`、`smoke:accounting`、`smoke:accounting-period`、`test:accounting` |
| 退款、处置、授信 | `smoke:refund-orders`、`smoke:disposal`、`smoke:credit-outbound` |
| 权限、设备 | `test:permissions`、`smoke:warehouse-scope`、`smoke:pda-device-session` |
| 打印、标签 | `test:label`、`test:print`、`test:print-purge`、`smoke:print-queue`、`smoke:print-template-preview` |
| 报表、开票 | `smoke:reports`、`smoke:reports-values`、`smoke:warehouse-ops`、`smoke:invoice-quota` |

（命令均以 `npm run <名称>` 调用。）

- **涉及数据库的测试必须用独立测试库**（`NODE_ENV=test` + 回环显式 `DB_*` + `flowcube_<用途>_test` 库名），**不得连生产库**。本机凭据在 `~/.config/flowcube/operations20260912-test.env`（`set -a; source …; set +a` 注入），且必须给可写的 `APP_UPDATE_DOWNLOADS_DIR`，否则 `app.js` 启动即 EACCES——**该报错与业务代码无关，别当成回归失败**。
- 本机 Node 26 下前端单测有 9 文件 / 56 用例的既有假失败（`localStorage is not available`）；对照基线只看**是否新增失败**，不看绝对数。
- **纯文档修改**核对内容、路径与 diff 即可，不必起数据库或跑全量回归。
- 各命令的完整说明、专项矩阵与隔离要求 → `docs/verification-commands.md`。

## 4. 主题文档索引（何时必须读）

| 主题文档 | 何时必须读 |
|---|---|
| `docs/verification-commands.md` | 要跑具体套件、确认环境变量、判断某改动该跑哪些回归时 |
| `docs/backend-api-sql-conventions.md` | 改后端 routes/controller/service、写 SQL、加迁移、动批量写入或 SQL 标识符时 |
| `docs/inventory-transaction-invariants.md` | 动库存/容器/预占/引擎/状态机/幂等回执，或任何影响库存与账款一致性的代码时 |
| `docs/business-semantics.md` | 改采购收货与上架、销售占库与 ATP、拣货到出库执行链、退货、调拨、盘点、履约刷新时 |
| `docs/finance-permission-time.md` | 改账款与核销、凭证与结账、发票、HR 工资、权限与仓库范围、业务日期与账套隔离时 |
| `docs/frontend-pda-conventions.md` | 改 ERP 页面/组件、列表与图表、弹窗与浮层、PDA 页面与扫码交互、登录会话与路由时 |
| `docs/print-deploy-ops.md` | 改标签与单据打印、发布与部署链路、CI 门禁、备份恢复与服务器运维动作时 |
| `docs/local-preview-acceptance.md` | 启动本地开发服务、做浏览器/页面验收、判断某个账号能验收哪些页面时 |

**专题记录（按需查）**：`docs/DEPLOY.md`、`docs/runbooks/failure-recovery.md`（故障处置先读它）、`docs/audit-2026-09-18.md`（深审计）、`docs/ci-wiring-gaps-2026-09-19.md`（CI 接线缺口）、`docs/deploy-disk-precheck-2026-09-19.md`（磁盘与服务器运维事故链）、`docs/chart-series-limit-2026-09-19.md`、`docs/toolchain-acceptance-2026-09-26.md`（开发工具链配置与验收、测试库 EPERM 结论）。

## 5. 历史、审计与发布结果索引

本文件只写**现状与现行约束**；过程记录、审计清单、发布结果、验证数字一律放 `docs/`。索引里的「已修复/已部署/待核实」只代表当时状态，用前按现行代码与配置核对。

| 主题 | 位置 |
|---|---|
| 迁移前历史（编号未变） | `docs/claude-md-archive-2026-09-04.md` |
| 2026-09-19 前单文件全文（本次重构来源） | `docs/agents-md-archive-2026-09-19.md` |
| 2026-09-19 文档体系重构说明 | `docs/agents-md-refactor-2026-09-19.md` |
| 抽出的日记全文（原 §11–§18） | `docs/agents-md-archive-2026-09-18.md` |
| 2026-09-18 深审计 | `docs/audit-2026-09-18.md`、`output/audit-2026-09-18/findings/*.json` |
| 2026-09-26 一致性审查（报告 / 任务卡 / 返货设计） | `docs/system-consistency-audit-2026-09-26.md`、`docs/system-consistency-tasks-2026-09-26.md`、`docs/sale-return-reverse-flow-2026-09-26.md` |
| 2026-09-26 开发库误迁移偏差（只读核对，保持原状） | `docs/dev8-migration-drift-2026-09-26.md` |
| 发布说明与结果 | `docs/release-notes/*.md`、`docs/release-v0.9.*-result.md` |
| 历史分支与工作树长期归档（2026-09-25） | `docs/worktree-retention-2026-09-25.md` |
| 本机环境与本地库切换 | `docs/local-tooling-2026-09-04.md`、`docs/local-mysql8-cutover-2026-09-04.md` |
