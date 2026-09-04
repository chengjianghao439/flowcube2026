# AGENTS.md — 极序 Flow / Codex 工作约定

本文件是 Codex 在本仓库工作的项目说明入口，适用于整个仓库。根据 `CLAUDE.md` 整理于 **2026-09-04**。用户当前明确指令优先；业务事实以当前代码、迁移和实际配置为准，文档与代码冲突时先核实并同步修正文档。

`CLAUDE.md` 保留迁移前的详细业务说明、事故背景和历史验证记录；后续工作的现行约定统一维护在本文件。查历史问题时按主题读取旧文档，不能把其中的“未提交”“已修复”“当前数量”直接当作今天的状态。本次是工作说明迁移，不代表全仓审计或生产数据库核验。

## 0. 第一时间同步文档（每次改动必做）

**任何功能新增、缺陷修复、业务规则、接口、状态机、数据库、权限、配置、目录、开发命令、部署流程或工作约定发生改动，都必须第一时间检查并同步更新 `AGENTS.md` 和受影响文档。与实现放在同一次任务中完成；需要提交时，文档与代码同批提交。不得等用户提醒，不得留到下次或发版前再补。文档未同步，任务不算完成。**

1. 开始修改前定位本文件对应章节，以及相关 `docs/`、技能说明、代码注释、配置示例与测试断言。
2. 改动落地后立即修改对应章节的现行规则，删除或订正失效表述；不能只在末尾追加“已改”，却让正文继续描述旧行为。
3. 每次改动都做文档影响检查。影响本文件所描述内容时直接更新正文；纯样式、局部实现或文字修正若不影响现行规则，可在相关文档记录，完成说明中明确“已检查，AGENTS.md 无需调整”并说明原因，避免堆积流水账。
4. 新增风险写清触发条件、影响和待办；解决风险同步更新原条目。需要保留较长背景或验证过程时写入 `docs/`，本文件保留摘要和路径。
5. 数量、版本、路径、“不存在/未启用/已部署”等断言必须当场核对。区分工作区已实现、已提交、已推送、已部署、已验证；不得把历史测试结果写成此次验证结果。无法验证的事实明确标注待核实。
6. 修改跨文件契约时同步全部消费者：权限常量与 seed 迁移、状态常量与生成文件、API 与前端类型、页面标题与烟雾断言、发版脚本与技能说明。
7. 任务完成前检查 diff，并在完成说明中交代：改了什么、如何验证、文档同步情况和剩余限制。
8. `AGENTS.md` 应随仓库版本管理，不再作为本地忽略文件；`CLAUDE.md` 的入口说明必须与它一致，避免形成两套相互冲突的现行规则。

## 1. 协作与操作边界

- 默认中文沟通，用户可见文案用中文，代码标识符用英文。先说明要做什么，过程中报告关键发现，最后给出结果与验证依据。
- 用户要求修改、修复或实现时，完成已授权范围内的工作；常规可逆的实现选择自行处理，确实缺少业务决策时再提问。
- 开始先看 `git status --short --branch` 和相关 diff，保留用户及其他任务的改动。禁止用 reset、checkout、clean 等操作清除不属于本任务的内容。
- **提交范围必须明确**：提交前先列出拟包含的文件与用途；只暂存本任务已核对的路径，不用全量 `git add .` / `git add --all` 把旧改动带入。业务代码及其必要说明文档同批提交；通用技能迁移、环境整理和版本发布分别组织提交。遇到不明来源的已有改动先保留，不能默认为本次提交内容。
- 分支默认使用 `codex/` 前缀。需要隔离时使用工作树；不要假定工作树已经安装依赖或具备本地环境配置。
- 发布工作树的收尾：完成发布并确认工作区干净后，切回本次专用 `codex/release-*` 分支，或停在已发布提交的 detached HEAD，释放临时占用的 `main`；用 `git worktree list` 核验。不要让发版目录长期阻止用户切换 main，也不要用强制切换或忽略工作树占用来绕过保护。原开发目录有未提交改动时先保存并处理与目标分支的重叠，不自动覆盖。
- 未经用户明确要求，不执行 `git push`、打 tag、发版、重启生产服务或会删数据的 SQL。已授权的同一操作不重复询问。
- 不因旧文档曾使用多智能体就自动并行启动代理；是否委派遵循当前会话指令。不要为普通子任务创建用户可见的新 Codex 任务。
- 技能按当前会话可用清单选择并读取，不假设 Claude 的命令、hooks 或插件在 Codex 中自动生效。
- 本机技能整理：通用 `brainstorming` 仅在新功能/复杂行为存在未决设计时介入，明确的小修复、配置和文档任务可直接执行。当前 checkout 的 `.agents/skills/frontend-design/SKILL.md` 已通过个人技能设置停用重复加载，保留内容相同的全局副本；仓库文件未删除，此设置不自动覆盖其他工作树路径。发版技能沿用用户已明确给出的授权，不逐步骤重复确认，也不把咨询当作发布授权。
- **所需工具可直接安装（用户长期授权）**：执行任务过程中，如缺少必要的 Skill、MCP 服务、插件、CLI、依赖或其他工具，可自行查找并从官方或可信来源下载、安装和完成必要配置，无需逐项询问用户。优先复用已有能力，安装后验证可用并继续任务，在完成说明中简要记录安装内容；涉及项目配置或工作流程变化时，按第 0 节同步文档。需要用户登录、提供凭据、付费，或平台强制要求用户授权时，明确说明所需操作及原因；本授权不替代系统权限、工具调用限制或第三方授权，也不扩大生产操作及对外数据传输的授权范围。
- **项目凭据代为输入（用户长期授权，2026-09-05）**：执行用户已授权的项目任务时，可以使用用户提供或已为本项目安全配置的账号、密码、密钥代为登录、输入密码和完成所需认证，无需每次重新请求输入密码的许可；优先复用已有有效会话。此授权适用于项目开发、测试和已授权的生产操作，不自动授权发版、删除数据或其他原本需要单独授权的操作。缺少必要凭据时再向用户索取；平台或工具明确要求本人完成的扫码、验证码、生物识别、权限确认等步骤，请用户协助，不绕过认证或访问控制。
- 不把密钥、口令、Token 写进代码、文档、日志输出或提交，也不在回复中回显。旧文档中的测试账号信息不要复制到新文档；代为输入密码不意味着在文档保存密码。

## 2. 项目与目录

极序 Flow 是单租户 ERP/WMS：Electron 办公桌面端、Android Capacitor PDA、浏览器共用 React 前端和 Node 后端。**仓库端只执行、不决策；库存与账款事实变化必须在后端事务中完成。**

- 后端：Node、Express、CommonJS、`mysql2/promise`、zod；无 ORM，全部手写 SQL。
- 前端：React + TypeScript + Vite + Tailwind + Radix UI，React Query 管服务端数据，Zustand 管会话/工作区，HashRouter 路由。
- 桌面端：Electron + electron-builder；生产 Windows 安装包由 GitHub Actions Windows runner 构建。
- PDA：同一前端的 `/pda/*` 路由树，Capacitor Android 工程；原生能力需 APK 真机验证。
- 数据库：MySQL；业务时间统一北京时间 `+08:00`。依赖和运行时具体版本读各端 package/lock、Dockerfile、CI，不照抄历史数字。

| 路径 | 职责 |
|---|---|
| `backend/src/app.js` | 中间件、API 路由装配、错误处理 |
| `backend/src/modules/` | 业务模块 routes → controller → service |
| `backend/src/engine/` | 库存、容器、预占、审批引擎 |
| `backend/src/constants/` | 状态机、权限、结算等规则 |
| `backend/src/database/` | SQL 迁移与迁移执行器 |
| `backend/src/scheduler.js` | 清理、物流、盘点排程、预警、库存漂移等定时任务；具体启用条件读代码 |
| `backend/src/utils/` | 幂等、仓库范围、时间、价格、单号等公共逻辑 |
| `frontend/src/` | API、页面、组件、hooks、路由、store、类型 |
| `frontend/src/generated/status.ts` | 从后端生成的状态常量，不手改 |
| `frontend/android/` | Android 原生工程，区分源码与生成物 |
| `desktop/` | Electron 主进程、preload、本地打印、更新 |
| `scripts/`、`tests/` | 发布部署、运维、门禁与测试 |
| `docs/` | 技术规范、审计、故障预案、发布说明 |
| `.agents/skills/` | Codex 可用的项目技能，实际能力以会话清单为准 |

不要随意修改构建产物 `frontend/dist/`、`desktop/release/`、Android 生成物、废弃目录 `backend/downloads/`、任何 `.env`、真实 `deploy/production*.json`。模块/迁移/路由/权限数量按需实测；本地 SQL 文件数不等于生产迁移执行数或表数。

## 3. 开发与验证命令

在仓库根目录运行，具体脚本以各端 `package.json` 为准：

本机已配置项目专用工具环境。若 `$HOME/.config/flowcube/dev-env.sh` 存在，执行本地开发、测试和 Android 命令前先 `source "$HOME/.config/flowcube/dev-env.sh"`，使用与 CI 一致的 Node 22，并加载 Java 21、Android SDK 路径；其他机器先核对实际安装位置，不复制本机路径。环境核查与 MCP 修复记录见 `docs/local-tooling-2026-09-04.md`。

根目录 `.nvmrc` 声明 Node 22；`npm run dev:backend`、`dev:erp`、`dev:pda`、`dev:check`、`dev:setup` 会经 `scripts/with-dev-env.sh` 加载项目环境并验证 Node 主版本。`.nvmrc` 本身不会让未安装版本管理器的终端自动切换。`dev:pda` 默认使用 5174，与 ERP 5173 分开；仍以 Vite 实际输出为准。

本机 Codex 个人设置已将 Claude 专用变量移出通用 shell 注入，并通过私有凭据文件/`http_headers_helper` 提供 GitHub MCP 认证；不把这些文件纳入仓库。个人设置备份、实际验证与需要用户完成的界面操作见 `docs/codex-local-setup-2026-09-04.md`。文件已修改不等于当前任务连接已重载；完成任务后重启应用。中文版“常规 → 跟进处理方式 → 调整方向”和“环境”的界面步骤由用户操作，不用其他手段绕过电脑控制工具对 Codex 自身的限制。

`dev:setup` 用于新工作树，按三端 lockfile 执行 npm ci，不复制真实 `.env`；不要在用户正在使用的开发服务目录中为验证脚本而重装依赖。旧 `.codex/hooks.json` 的 EnterWorktree 匹配器已移除，需用户在 Codex 中文版“环境”中将 `npm run dev:setup` 配置为“设置脚本”；界面配置未完成前不能声称自动初始化已生效。2026-09-04 临时空目录验证中，前后端安装成功，桌面端 Electron 安装阶段超过 240 秒测试时限，完整三端初始化尚待验证；不能以已有 node_modules 目录判断安装成功。

`npm run dev:mysql8` 使用本机 `colima-flowcube` context 启动 `flowcube-dev-mysql8`，监听 127.0.0.1:3307，库名 flowcube_dev8；随机凭据位于用户目录 `~/.config/flowcube/mysql8.env`（600），此命令只执行增量结构迁移，不自动导入业务数据或修改 backend/.env。`dev:mysql8:stop` 停服务并保留数据卷。

**本机开发后端已于 2026-09-04 按用户授权切换至上述 MySQL 8.0.46**：旧 flowcube 库的 134 张表、215,843 行数据完整迁入，逐表内容摘要及结构一致，保留 233 条迁移记录（232 份 SQL 均已执行，另含历史记录）、56 个用户及原密码哈希/JWT。backend/.env 仅修改五个 DB 连接项，当前后端已重启并实测连接 3307；时区 +08:00。旧 MySQL 9.6 / 3306 和原库保留用于回退，不能继续向旧库写开发数据。电脑重启后先运行 `npm run dev:mysql8` 再启动后端。备份、校验与回退说明见 `docs/local-mysql8-cutover-2026-09-04.md`；切换后的新写入不可被直接回退丢弃。

```bash
npm --prefix backend run dev
npm --prefix frontend run dev           # Electron target，浏览器也可预览
npm --prefix frontend run dev:pda       # PDA target
npm --prefix desktop start

npm --prefix backend run migrate       # 本地 schema 改动后显式执行
npm --prefix backend run lint
npm --prefix frontend run lint
./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run build:pda
npm run generate:status
npm run test:permissions
```

**前端 `tsconfig.json` 是空壳，类型检查必须指定 `tsconfig.app.json`。** 不把无输出的错误命令当作通过。lint、类型检查、构建和业务回归分别证明不同事情；不要引用旧文档的零错误/固定 warning 数作为此次结果。新增 eslint-disable 必须说明原因，不能为过门禁屏蔽问题。

按改动影响选择验证：

| 影响 | 相关命令 |
|---|---|
| 库存、状态、并发主链路 | `npm run smoke:mainline`、`npm run smoke:concurrency-guards`、`npm run smoke:p0-regression`、`npm run smoke:p1-regression`、`npm run test:integration` |
| 销售改单、预计库存 | `npm run smoke:sale-adjustment`、`npm run smoke:atp` |
| 财务、会计 | `npm run smoke:finance`、`npm run smoke:accounting`、`npm run smoke:accounting-period`、`npm run test:accounting` |
| 退款、处置、授信 | `npm run smoke:refund-orders`、`npm run smoke:disposal`、`npm run smoke:credit-outbound` |
| 权限、设备 | `npm run test:permissions`、`npm run smoke:warehouse-scope`、`npm run smoke:pda-device-session` |
| 打印、标签 | `npm run test:label`、`npm run test:print`、`npm run test:print-purge` |
| 报表、开票 | `npm run smoke:reports`、`npm run smoke:reports-values`、`npm run smoke:invoice-quota` |

运行涉及数据库的测试前确认连接目标与测试数据清理行为，**不得连接生产库跑测试**。公共 `tests/helpers/testEnvironment.js` 要求 `NODE_ENV=test`、显式回环 `DB_HOST`、合法 `DB_PORT`、`DB_USER`/`DB_PASSWORD`、`flowcube_test` 或 `flowcube_<用途>_test` 库名；测试不再加载真实 `backend/.env`。可用 `FLOWCUBE_TEST_ENV_FILE=/绝对路径/.env.test` 显式加载测试专用配置，命令行环境优先，配置错误及迁移失败立即终止。新数据库测试必须复用此校验。没有运行或环境不具备时明确说明；不能据此声称全部通过。纯文档修改核对内容、路径和 diff 即可，不必启动数据库或全量业务回归。

审计回归入口：`npm run smoke:audit-inventory`、`npm run smoke:audit-finance-security`、`npm run test:audit-client`、`npm run test:audit-tooling`。标签镜像检查使用前端已安装的 TypeScript 在 Node 22 编译并运行，`test:label` 需要前端依赖，不再按 Node 版本跳过；CI 在安装两端依赖后的 static job 执行。

## 4. Codex 本地预览

- **开发与生产分工（用户于 2026-09-04 明确）**：本地开发者模式用于日常修改、实际页面验证和前后端联调；线上服务器为生产模式。涉及页面或接口联动的修复，自动化测试后应补本地开发模式验证，并分别说明两类结果；不能用单测或构建通过代替页面验收。数据库批量/破坏性回归仍放独立测试库。线上访问及发布遵守已有授权边界。
- 用户要求“开发者模式/给我网址”时，先检查当前可用的服务启动工具与已有服务。若有预览工具可使用；没有则通过终端运行第 3 节的 npm dev 命令，保留进程并读取实际监听地址。不能照搬不可用的 `preview_start`、`tabs_create` 等 Claude 工具名。
- 现有 `.claude/launch.json` 可作为启动命令参考；它不意味着存在 `.Codex/launch.json` 或 Codex 已自动加载它。不要凭空创建替代路径。
- 启动前检查端口与已有服务；端口冲突不杀其他任务进程。交付实际可访问的地址，不能假定一直是 5173。
- 登录按第 1 节“项目凭据代为输入”授权执行：优先复用已有会话，需要登录时可代为输入项目账号和密码并继续验证；仅在缺少凭据或认证步骤要求本人操作时请用户协助。不得为了预览临时关闭鉴权或越过权限，不在文档记录密码。
- 本地 dev 连接本机后端时，`authStore.ts` 的 `USE_PERSISTENT_DEV_SESSION` 使用 localStorage；生产和本地前端连接生产 API 时仍使用 sessionStorage。边界由 Vite 的 `__DEV_LOCAL_BACKEND__` 控制，不能放宽。
- 更换端口会更换 origin，不共享 localStorage。会话有效期与续期读 auth/env 代码，不照搬旧文档的“固定 7 天”。
- ERP 与 PDA 验证分别开标签页，`CrossClientNavigationGuard` 禁止同标签页跨客户端跳转。
- 验证结束保留用户可能正在使用的开发服务。连接生产 API 的预览视为生产访问，不能当作本地测试库操作。

## 5. 后端、API 与数据库规范

- 严格 `routes → controller → service → db`。routes 注册路径、鉴权、权限、zod/PDA 校验；controller 取参并返回响应，不写 SQL；service 放 SQL 和业务规则，不接 HTTP 对象。
- 大模块新增逻辑放对应窄职责文件，例如 `inbound-tasks.putaway.js`、`warehouse-tasks.ship.js`，不要堆回 service 门面。
- 错误使用 `AppError` 交给统一 errorHandler；成功使用 `successResponse`。信封为 `{ success, message, data }`，失败可含 `code`；列表分页位于 `data.pagination`。
- SQL 参数化；API 小写、连字符、复数名词。分页复用 `normalizePagination`，导出遵循既有上限与截断告警，不能用无限大 pageSize 绕过分页。
- 新迁移按当前最大编号新增，**不得修改已执行的迁移**，不得未经明确授权删除字段、兼容代码或迁移文件。编号冲突、幂等执行、回填与消费者兼容要一起考虑。
- 后端启动不自动迁移；本地显式 migrate。生产由部署脚本执行，不能把两者混为一谈。
- 数据库列注释可能过期，状态含义以常量和执行代码为准。不能凭历史迁移文本认定生产已经存在某列。

## 6. 库存、事务与幂等：必须保留的约束

1. **库存唯一事实源是 ACTIVE 容器的 `inventory_containers.remaining_qty`；`inventory_stock.quantity` 只是缓存。** 唯一合法缓存写入口是 `containerEngine.syncStockFromContainers()`，禁止业务代码直接 UPDATE quantity。
2. `reserved` 只能经 `reservationEngine` 或 `inventoryEngine` 的合法入口变更；`stock_reservations` 与库存预占账必须一致。
3. 实物可用量通过 `containerEngine.getAvailableStockForDecision()` 等现有投影入口判定，不自写 SUM。销售 ATP 可显式纳入预计量，见第 7 节，不能把预计量当实物出库。
4. 待上架/待质检容器不计 ACTIVE 实物；建容器只经 `createContainer`。只有既定 transfer/container_split 来源可直接 ACTIVE，其他来源先待上架再 promote。
5. 销售出库只扣本任务锁定容器 `deductFromTaskLockedContainers`，禁止退回全局 FIFO；不允许负实物库存。
6. 库存与账款多表动作必须在调用方开启的同一事务连接 `conn` 中完成，引擎不自行嵌套事务。
7. 上架先锁 `lockStockDimension(productId, warehouseId)` 再锁容器；多商品操作按 product_id、warehouse_id 的统一顺序加锁，防死锁和缓存丢失更新。
8. 状态变更先 `lockStatusRow()`，经 `assertStatusAction` / `assertWarehouseTaskAction` 校验并使用 `compareAndSetStatus()`；CAS 冲突返回 409。既有财务内联状态机保留等效的事务行锁校验，不退化成裸 UPDATE。
9. 数量为 DECIMAL，比较/累加防浮点误差；打包沿用 `toQtyUnits/fromQtyUnits`。
10. 不恢复已关闭的手动入库/手动库存调整入口；入库走收货，调整走盘点。初始化导入等专用流程遵守其既有校验，不扩展通用后门。
11. 写操作考虑连点与断网重试：前端稳定 `X-Request-Key`，后端 `beginOperationRequest/completeOperationRequest`，结合唯一键和 CAS。重放返回原回执，不能重复加库存、推进状态或入账。
12. 事务内禁止外部 HTTP 或物理打印。打印只在数据库入队，实际动作异步；补打不建容器、不加库存、不改账款。
13. 缓存漂移先只读检查；需要修复时走既有 resync/引擎入口，不能手改数据库。不要为了“验证”擅自跑会修复数据的命令。
14. 改引擎或状态机前读完整调用链与历史事故注释；副作用变化同步 `WT_ON_ENTER_ACTIONS` / `WT_ON_EXIT_ACTIONS` 及相关测试。

## 7. 核心业务语义

- **采购收货**：采购提交可能按审批阈值进入待审批，按当前 purchase 常量及 service 判断；收货订单 → PDA 收货建待上架容器 → 扫库位上架 → 全部完成时自动结算应付。没有旧版的人工收货审核环节。短装结案走专用 close，撤回收货走 void-receipt 并反冲，容器已被后续动作使用时拒绝。
- **收货保护**：超收确认与疑似重复扫码确认分别沿用 `confirmOverReceive` / `confirmDuplicate`；阈值读 `inboundThresholds` 和配置。容器保留 `inbound_task_item_id`，按归属行回写上架量和采购价，不能串单结算。
- **销售分仓/按量占库**：行级 warehouse_id 必须参与关联；同商品多仓不能 JOIN 放大。`reserved_qty` 是已占量，`dispatched_qty` 是已派发量，发货只发差额；部分占、补占、释放和改单保持数量账一致。
- **销售 ATP**：总可占量 = ACTIVE 实物 + 采购未上架总量 − 全部有效预占；预计量不能先减绑定后再减 reserved。绑定只表示尚依赖采购的数量，上架按采购明细 FIFO 兑现，不减少销售预占；出库只能使用本单已有实物份额及未分配实物，不能截断其他订单合法的预计预占。采购撤回、驳回、取消、减量/删行和短装关闭均保护有效绑定；撤回上架不能移除支撑现有销售承诺的供应。多商品释放先按统一顺序锁全部库存维度，再锁预占/预计绑定；旧快照漏维度返回 409 重试。规则与回归见 `expectedStock.js`、`sale-atp.smoke.test.js` 和 `audit-inventory.smoke.test.js`。
- **销售执行**：拣货 → 分拣 → 复核 → 打包 → 出库，各阶段校验闭合；执行期减量、取消涉及已搬动物料时走 PDA 物理确认/逆向归还。已有部分出库时取消剩余需保留已发事实，不能整单当未发取消。
- **退货**：采购退货走标准仓库出库并冲减应付；销售退货走收货、质检、上架并冲减应收。部分质检必须保留合格、拒收、未检三份数量并守恒，未检容器可继续质检；收货/分箱标签与数量变化同事务入队，回传容器条码、打印任务及无打印机提示。上架扫码经当前任务范围解析真实容器/库位 ID，提交再次校验归属、状态、设备仓与权限；不能将完整条码直接转 Number，也不能通过列表选 ID 代替扫码。return_tasks 有内联状态机，不能仅查 documentStatusRules。
- **调拨**：源仓扫码出 → 在途 → 目标仓扫码入；在途不可普通取消，异常走有独立权限的 force-close。
- **盘点**：账面读取 ACTIVE 容器；提交前整单检查账面漂移，任一漂移拒绝整单，刷新账面会清空对应实盘值。差异调整走引擎。
- **商品快照**：已有业务快照读快照，无快照的过程表按既定 JOIN 读取主档。`article_number` / `articleNumber` 语义为供应商型号，不恢复随机生成；`spec` 为系统型号，不能因改展示名擅改历史列名。

## 8. 财务、权限与时间

- `payment_records` 按 `(type, order_id)` 幂等；应付变化需遵守财务确认闸门。账款重算、退货/退款、对账投影保持同事务一致。
- 结算方式和 due_date 是首次生成账款时的快照，补收/退货/分批发货不能追溯改写。到期日复用 `buildDueDateSql()`；月结才使用账期。回款状态独立于销售订单状态，按账款快照显示。
- 成本 `avg_cost` 按既定入库移动加权，退货/撤回不反冲是既有设计；利润使用成本快照，不“顺手修正”。
- 区分公司级业务口径与带 company_id 的会计/发票账套口径；不能只在报表一端加账套过滤、另一端凭证生成仍读全量，造成勾稽失衡。改变隔离必须核对数据表、写入、回填、查询和报表全链路。历史背景见 `CLAUDE.md` 第 20 节第 50 条。
- 采购来源凭证金额变化/归零使用自动红字修订链，保留原分录；迁移 `232_acct_voucher_source_revisions.sql` 的 `source_root_id` 指向唯一来源根凭证。恢复金额新增正向修订，重算幂等；人工红冲后不自动恢复，已结账期间不可改写。凭证写入与期间开关先锁账套行；序号最大值使用当前锁定读。总账/导出必须包含原凭证及其红字抵消，不能用 `status<>3` 过滤掉原凭证。普通删除不得删除红字、被冲销凭证或有冲销关联的凭证。
- 重置密码、禁用或删除超管时在服务层锁定操作人/目标，验证操作人确为超管；拥有普通用户管理权限不等于能接管超管。改价未匹配审批流应返回明确配置业务错误，不越过审批或抛空引用 500。
- 自行审批是用户级 `allow_self_approve`，授予仅超管；复用 `selfApprove.js`，不扩大成全局豁免。收回立即生效，相关测试 finally 还原不可删除。
- 每个业务接口鉴权与服务端权限校验；权限常量在 `backend/src/constants/permissions.js` 与 `frontend/src/lib/permission-codes.ts` 手工同步，必要时追加 seed 迁移并跑一致性测试。前端隐藏按钮不能替代权限控制。
- 仓库范围用 `user_warehouse_scope`、`scopeFilter` / `assertInScope`；按业务是否涉仓接入。财务公司级接口不能盲加仓库过滤。
- PDA-only 写操作同时遵守 `X-Client: pda`、设备会话和绑定仓约束，ERP 不能绕过。未绑定设备显示受限引导，不放行业务请求。
- JWT access/refresh 分工、token_version、refresh jti 一次性轮换要一起维护；改密码/禁用可撤销旧会话。登出清理 React Query 缓存。
- refresh 请求复用运行时 API 基址和超时配置（含原生自定义服务器地址），并发 401 共用一次续期，失败统一清会话；不能从 Electron/file 或 Capacitor origin 请求相对 `/api`。
- 公开登录/更新/健康检查与公司 Logo 等是现有明确例外，新增接口不得据此省略鉴权。Logo `<img>` 场景不能携带 Bearer；更改公开资源策略需核对桌面跨源加载。
- **业务日期唯一时区为北京时间**：前端复用 `lib/dateTime.ts`，后端复用 `utils/backendTime.js`，数据库/容器配置保持一致。禁止用 `toISOString().slice(0,10)` 充当北京业务日期。
- DATETIME 查询按既有半开区间处理，DATE 列按日期语义处理；不可机械统一为同一种边界。到期日等于北京今天时不算逾期。

## 9. 前端与 PDA

- 官网独立展示页位于 `frontend/src/pages/landing/`；2026-09-05 本地重构采用浅色首页、五场景业务示意、供货过程解释与核心能力、精选版本更新和三端下载区，说明见 `docs/landing-redesign-2026-09-05.md`，业务内容与代码依据见 `docs/landing-product-evidence-2026-09-05.md`。版本摘要维护在 `frontend/src/pages/landing/updates.ts`，随对应发布说明同步，不以工作区 package 版本冒充已发布版本；页面动效支持手动暂停与系统减少动态效果。演示数据必须明确标注；页内导航不修改 HashRouter 的 hash，系统入口保留既有鉴权。Windows 下载清单缺失时显示不可用状态，不能以登录链接冒充下载。此版仅本地实现，未发布。

- 新 ERP 页面注册到 `routeRegistry.ts` / `routePatterns`，配置 permission、keepAlive、tabIdentity、nav 或 listPath；菜单自动生成。
- API 统一经 `src/api/*.ts` + `payloadClient`，组件不直接 axios；自行提示错误时用 `skipGlobalError` 避免双 toast。
- 服务端业务规则不复制到前端，不让前端传目标状态决定流转。生成的状态常量通过 `npm run generate:status` 更新。
- 状态展示统一 `StatusBadge` / `SoftStatusLabel` 与 `statusTone.ts` 语义色，不硬编码彩色 Badge。
- 复用 DataTable、TableActionsMenu、QueryErrorState、finder、usePermission、useDirtyGuard、useInvalidate 等已有结构；keepAlive 表单在挂载/参数变化时重置，未保存内容有退出保护。
- 桌面端判定使用运行时 `window.flowcubeDesktop`，不能用构建 flag 把浏览器误判成 Electron。
- 系统品牌用于登录/PDA 门面，公司 Logo 用于 ERP 顶栏/单据打印；不混用。
- 用户术语沿用“批次、采购申请、滞销、存放时长、分批盘点、型号、供应商型号”，不为改文案变更权限码、路由或数据库列。
- PDA 不做离线自动重放；不确定写入结果先用幂等回执/已有 `resolveServerState` 恢复路径核实。
- 原生绑定相机扫码使用 `useCameraScanner.ts` 的既定本地解码路径，注意预览时 WebView 背景透明、权限引导和关闭清理。浏览器预览不能证明 APK 相机功能正常。

## 10. 打印、部署与运维

- 标签队列只接受 ZPL；单据走浏览器打印/导出。入队复用 `enqueue*LabelJob` / reprint 入口、job_unique_key 与活跃期唯一约束。
- 桌面客户端拉取打印任务，按打印机绑定、client_id 和心跳派发，与登录账号无关；保留 claim 行锁/CAS、ack_token、超时回收。
- HTML 单据模板 image 与 ZPL 标签分开；编辑器预览与打印渲染、旧 layout_json 默认值保持一致。
- `main` 是发布来源，push main 触发检查与部署；浏览器、桌面发布前必须等待**实际待发布 SHA** 的 Tests 与 Security Scan 成功，旧 SHA/失败/取消/超时不放行。桌面手动 checkout_ref 也用实际 git HEAD，版本输入必须匹配其 package。PDA 还需同 SHA 浏览器部署成功；仅推 main 不等于桌面发版。
- 发版必须读取 `release-flowcube` 技能。同步三端 package/lock、PDA versionName/versionCode 与 `backend/apk/version.json`；同版本重跑不应虚增版本号或发布时间。脚本用实际存在路径，不照搬旧 `.Codex/skills` 路径。
- 生产安装包由 Windows CI 构建；迁移由 `scripts/server-update.sh` 部署链执行。不能直接改服务器代码，不能默认跳过发布门禁。
- Docker 构建上下文由根 `.dockerignore` 排除真实环境/密钥、本机依赖、历史安装包、日志和工具目录；运行配置从部署环境注入。新增构建依赖需确认未误排除，不能为构建成功把真实 .env 或 node_modules 加回上下文。
- GitHub runner 构建带 SHA 标签与 OCI revision 的 Linux amd64 镜像，通过 SSH 传输归档；生产禁止重新编译。部署在同一锁内固定 SHA、保存运行镜像 ID，检查空间与归档 SHA-256、加载并核对镜像 revision、等待 MySQL 健康、一次性容器迁移，再切换应用。产物校验/加载/迁移/本地或公网健康/页面门禁失败统一恢复旧应用镜像并检查健康；首次部署无旧版本要明确说明。数据库 DDL 不自动回滚，新迁移必须兼容旧代码；回退失败必须报人工恢复。部署门禁低磁盘时禁止清除回退镜像，直接失败。人工脚本入口要求显式 EXPECTED_COMMIT 并查询 GitHub 同 SHA 检查，推荐通过 workflow_dispatch 执行。
- 发布辅助负载边界：Docker 请求由 `scripts/lib/runtime-guards.sh` 设时限；处于 CI 总时限内时共享信号范围，保证清理/回退可执行，宽限为 600 秒；页面验收顺序执行，每次 1 CPU / 1 GiB（不额外交换）/ 256 进程，容器内 14 分钟，超时/中断清理本次容器并回退应用。浏览器镜像须预装，部署前检查存在且 `--pull never`；磁盘不足直接失败，禁止门禁自动 prune。监控用独占锁拒绝重叠，Docker 5 秒、TLS 10 秒，失败必须记为异常。详见 `docs/DEPLOY.md` 和 `tests/deployment-resources.test.js`。这些改动已随 v0.9.3 于 2026-09-05 正式部署；候选 89 项部署/运维/CORS/客户端回归通过，同 SHA 的 Tests、Security 与实际生产页面/对账门禁均成功。实际容器资源限制、镜像提交号、线上清单与发布结果见 `docs/release-v0.9.3-result.md`。
- 桌面更新清单由 `scripts/release-desktop.js` 写入 `/var/www/flowcube-downloads/latest.json`；`backend/downloads/` 已废弃。
- 桌面更新使用可信 HTTPS 清单，由主进程重新取清单并绑定 version、URL、sha256；下载后及启动安装前均验摘要。无摘要不能自动安装，系统证书校验失败默认拒绝；取消按 IP/域名放行任意证书的旧行为。根组件消费更新事件，preload 保留订阅前待通知结果并支持清理监听。
- PDA 已发布状态由不入 Git 的 `backend/apk/published-version.json` 指向唯一 APK；CI 先落安装包再原子替换清单。`backend/apk/version.json` 是构建目标/旧部署兼容清单，不能让浏览器 git reset 把未发布 APK 的版本提前对外公布。PDA 发布只更新挂载产物，不重置 Git 或重建后端；部署回退时将 version.json 原子恢复为已发布清单，兼容不识别 published-version.json 的旧镜像。
- 依赖审计安装/网络/JSON 错误必须失败，不能视为零漏洞；直接高危以上阻断，传递漏洞仍记录。当前 HashRouter 使用 React Router 7；后端 qs 安全补丁由 overrides 固定最低修复版，移除覆盖前重新审计上游依赖范围。
- 运维容器解析复用 `scripts/lib/ops-common.sh` 的 `resolve_container()`，不硬编码 Docker 容器名。备份先写临时文件、验证后落正式文件；失败清残留并告警。
- 恢复演练的新鲜度按备份文件修改时间判断，自动演练默认拒绝超过 48 小时的文件（`BACKUP_MAX_AGE_HOURS`）；显式指定历史备份只检查恢复能力并提示过期。没有新销售单不能判定备份损坏。MySQL 连接数探针在容器内认证，查询失败或无效值必须记录异常，不得回退为零；隔离回归见 `tests/ops-monitor-restore.test.js`。
- 库存漂移巡检只报警，不自动修库存缓存掩盖根因。调度器与服务器 cron 是不同机制，改动时检查 scheduler、install-cron 和部署同步链路。
- 故障处理先读 `docs/runbooks/failure-recovery.md`，确认现场与备份后执行已授权操作；测试与生产严格区分。
- CORS 规则集中在 `backend/src/config/cors.js`：`CORS_ORIGIN` 支持逗号分隔的精确来源，Electron 的字符串 `null` 由 `CORS_ALLOW_NULL_ORIGIN` 单独控制；内置 Android PDA 当前源码默认来源为 `https://localhost`。不要为兼容客户端而打开任意来源反射。v0.9.3 新后端已部署，当前生产保留既有反射兼容配置，须完成实际客户端验证后再收窄来源；测试见 `tests/cors-policy.test.js`，部署说明见 `docs/DEPLOY.md`。
- 2026-09-04～05 生产环境核查与恢复见 `docs/production-environment-check-2026-09-04.md`：用户授权普通重启后，9 月 5 日 00:12 网站/SSH 恢复。已完成现有 50 GiB 云盘的系统分区扩展（使用率约 66%）、.env 0600、SSH 密钥登录、宿主 Node 22.23.2，以及停用仅支持单队列网卡上不适用的 ecs_mq 优化；配置/数据库/分区表已备份至服务器和 Mac。生产 MySQL 实测 8.0.45，135 表，232 份 SQL 无缺失，另有 1 条历史迁移记录。备份误报、连接数探针和 CORS 配置能力修复已随 v0.9.3 部署（CORS 实际来源配置未收窄）；自动异地备份目的地尚未配置。云盘读写受限已由云平台确认，具体占用进程根因仍不明，避免重跑无时限的整盘 Docker 统计。

## 11. 历史材料与本次迁移记录

- 历史业务细节/事故：`CLAUDE.md`，尤其第 20 节。它含不同时期相互覆盖的记录，必须结合当前代码确认，不能直接作为尚未修复清单。
- 架构设计：`docs/01-系统技术与架构总规范.md`；设计与实现不一致时先查实现并记录差异。
- 本地工具核查（2026-09-04）：补装 Node 22、Colima/Lima，设置项目专用 Java/Android 命令环境；修正电脑控制 MCP 启动路径。初次核查本机数据库为 MySQL 9.6，随后已将开发后端和原数据切换到独立 MySQL 8.0.46，见第 3 节及 `docs/local-mysql8-cutover-2026-09-04.md`。工具及依赖验证的范围见 `docs/local-tooling-2026-09-04.md`，后续环境变化需同步更新。
- Chrome 扩展已从 Google 官方服务下载并验证发布者签名，经用户明确同意权限后安装启用；配套桌面插件及应用自动注册的 native-host 均通过官方诊断，CUA 已通过扩展读取 Chrome 真实标签页。安装目录须保留，解压导入方式不保证自动更新，详见 `docs/local-tooling-2026-09-04.md`。浏览器通信可用不等于服务器恢复。
- 本次迁移（2026-09-04）：以本文件替换本地旧 AGENTS 快照；建立第一时间同步文档规则；按 Codex 当前工具能力重写预览约定；不再复制固定计数、过时会话有效期及历史测试口令；保留库存、财务、PDA、打印和发布约束；`CLAUDE.md` 顶部改为指向本文件；从 `.gitignore` 移除 AGENTS.md 忽略项。
- 上述说明书迁移任务仅验证文档内容、引用路径、npm 脚本和 Git diff；后续系统审计结果见第 12 节，不能混用两次验证范围。

## 12. 系统审计修复与验证边界（2026-09-04）

审计基线为 `76c8496` / v0.9.1；原报告 `docs/system-audit-2026-09-04.md` 及 JSON 保留修复前证据。F01–F17、三个验证缺口及交叉复核问题的实现、测试结果与依赖修复见 `docs/system-audit-fixes-2026-09-04.md`，分域记录见 `docs/audit-fix-{inventory,finance,client}-2026-09-04.md`。

修复任务结束时的未提交状态与验证证据保留在上述报告；用户随后授权将修复纳入 **v0.9.2 / PDA versionCode 110** 正式发布，更新内容见 `docs/release-notes/0.9.2.md`。发布结果以该 tag 对应 SHA 的 Actions 和线上版本清单为准，不能仅凭版本文件认定已部署。业务批量回归只使用新建隔离 MySQL 8；本地开发联调数据库另已执行增量迁移 232，不据此推断生产历史数据已自动修复。Windows/Android 原生设备与物理打印仍须在对应环境验收。运行时、工作流和依赖扫描的验证范围分别记录，不把模拟发布测试等同于一次真实生产发布。

v0.9.2 发布准备复测：前端 69、客户端/PDA 发布 31、部署工具 22 项通过；lint、app 类型检查、ERP/PDA Web 构建通过，三端生产依赖审计为 0。本地开发首页、跳转登录页和 Vite 代理后端健康接口已实跑，无页面脚本错误；当时登录后业务页尚未验收，不能把公开页面结果写成全部页面通过。正式部署另执行已有账号页面/报表/对账回跳门禁。
