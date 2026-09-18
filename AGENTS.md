# AGENTS.md — 极序 Flow / Codex 工作约定

本文件是 Codex 在本仓库工作的项目说明入口，适用于整个仓库。根据旧 `CLAUDE.md` 整理于 **2026-09-04**（该文件已于 2026-09-18 归档为 `docs/claude-md-archive-2026-09-04.md`）。用户当前明确指令优先；业务事实以当前代码、迁移和实际配置为准，文档与代码冲突时先核实并同步修正文档。

旧 `CLAUDE.md` 已归档为 `docs/claude-md-archive-2026-09-04.md`，保留迁移前的详细业务说明、事故背景和历史验证记录；后续工作的现行约定统一维护在本文件。查历史问题时按主题读取旧文档，不能把其中的“未提交”“已修复”“当前数量”直接当作今天的状态。本次是工作说明迁移，不代表全仓审计或生产数据库核验。

## 0. 第一时间同步文档（每次改动必做）

**任何功能新增、缺陷修复、业务规则、接口、状态机、数据库、权限、配置、目录、开发命令、部署流程或工作约定发生改动，都必须第一时间检查并同步更新 `AGENTS.md` 和受影响文档。与实现放在同一次任务中完成；需要提交时，文档与代码同批提交。不得等用户提醒，不得留到下次或发版前再补。文档未同步，任务不算完成。**

1. 开始修改前定位本文件对应章节，以及相关 `docs/`、技能说明、代码注释、配置示例与测试断言。
2. 改动落地后立即修改对应章节的现行规则，删除或订正失效表述；不能只在末尾追加“已改”，却让正文继续描述旧行为。
3. 每次改动都做文档影响检查。影响本文件所描述内容时直接更新正文；纯样式、局部实现或文字修正若不影响现行规则，可在相关文档记录，完成说明中明确“已检查，AGENTS.md 无需调整”并说明原因，避免堆积流水账。
4. 新增风险写清触发条件、影响和待办；解决风险同步更新原条目。需要保留较长背景或验证过程时写入 `docs/`，本文件保留摘要和路径。
5. 数量、版本、路径、“不存在/未启用/已部署”等断言必须当场核对。区分工作区已实现、已提交、已推送、已部署、已验证；不得把历史测试结果写成此次验证结果。无法验证的事实明确标注待核实。
6. 修改跨文件契约时同步全部消费者：权限常量与 seed 迁移、状态常量与生成文件、API 与前端类型、页面标题与烟雾断言、发版脚本与技能说明。
7. 任务完成前检查 diff，并在完成说明中交代：改了什么、如何验证、文档同步情况和剩余限制。
8. `AGENTS.md` 应随仓库版本管理，不再作为本地忽略文件。**工作区目录链上不得再出现 `CLAUDE.md`**（根目录最严禁，一行指针也不行）：工作区指令注入按 `<项目根>/AGENTS.md` → `CLAUDE.md` 逐层收集候选，**总量受字节预算约束，超预算才从「更宽」的一端省略、最后只保留或截断最具体的那一个**。2026-09-18 实测：根目录同时存在 166 KB 的 `CLAUDE.md` 与 211 KB 的 `AGENTS.md`，总字节远超预算，新会话注入的是那份过时旧正文、`AGENTS.md` 显示 `omitted`——文件都在，但最权威的现行说明根本没进模型上下文，全链路不报错。旧文已归档为 `docs/claude-md-archive-2026-09-04.md`，现行约定只维护在本文件（抽出 §11–§18 日记后由 211 KB 降到约 107 KB）。**体积仍是硬约束**：默认预设预算 64 KiB，超出部分会被**截断尾部**（现文件在默认预算下会丢掉第 10 节与 §11.1 防呆清单），本机 `standard-fullctx` 副本把预算提到 128 KiB 才完整注入；所以本文件只留现行规则、过程记录放 `docs/`，不要靠加预算绕过。守卫 `npm run test:agents-md-guard`（无 `CLAUDE.md` 候选 / 体积 ≤128 KiB / 关键章节与红线仍在 / `docs/*.md` 与 `npm run` 脚本引用都有效）已进 Tests CI。确需保留历史全文时放 `docs/` 下并使用**非候选文件名**（不能叫 `CLAUDE.md`/`AGENTS.md`，否则一旦被本会话读写就会作为该目录的作用域指令注入）。

## 1. 协作与操作边界

- 默认中文沟通，用户可见文案用中文，代码标识符用英文。先说明要做什么，过程中报告关键发现，最后给出结果与验证依据。
- 用户要求修改、修复或实现时，完成已授权范围内的工作；常规可逆的实现选择自行处理，确实缺少业务决策时再提问。
- 开始先看 `git status --short --branch` 和相关 diff，保留用户及其他任务的改动。禁止用 reset、checkout、clean 等操作清除不属于本任务的内容。
- 清理旧分支或工作树时，分别核对提交是否合入、目录内的未提交/未跟踪/忽略文件和实际进程占用；主目录干净不代表其他工作树干净。用户授权舍弃的旧实现仍先归档并校验，私有配置仅保存在本机受限目录；与现行业务规则冲突的旧补丁不重新并入。历史依赖 PR 关闭不等于升级完成，需逐项记录理由。2026-09-07 的 22 个 PR、Claude 与上线审计旧工作树处理见 `docs/dependency-pr-worktree-cleanup-2026-09-07.md`。
- **提交范围必须明确**：提交前先列出拟包含的文件与用途；只暂存本任务已核对的路径，不用全量 `git add .` / `git add --all` 把旧改动带入。业务代码及其必要说明文档同批提交；通用技能迁移、环境整理和版本发布分别组织提交。遇到不明来源的已有改动先保留，不能默认为本次提交内容。
- 分支默认使用 `codex/` 前缀。需要隔离时使用工作树；不要假定工作树已经安装依赖或具备本地环境配置。
- 发布工作树的收尾：完成发布并确认工作区干净后，切回本次专用 `codex/release-*` 分支，或停在已发布提交的 detached HEAD，释放临时占用的 `main`；用 `git worktree list` 核验。不要让发版目录长期阻止用户切换 main，也不要用强制切换或忽略工作树占用来绕过保护。原开发目录有未提交改动时先保存并处理与目标分支的重叠，不自动覆盖。
- 未经用户明确要求，不执行 `git push`、打 tag、发版、重启生产服务或会删数据的 SQL。已授权的同一操作不重复询问。
- 不因旧文档曾使用多智能体就自动并行启动代理；是否委派遵循当前会话指令。不要为普通子任务创建用户可见的新 Codex 任务。
- 技能按当前会话可用清单选择并读取，不假设 Claude 的命令、hooks 或插件在 Codex 中自动生效。
- 本机技能整理：通用 `brainstorming` 仅在新功能/复杂行为存在未决设计时介入，明确的小修复、配置和文档任务可直接执行。当前 checkout 的 `.agents/skills/frontend-design/SKILL.md` 已通过个人技能设置停用重复加载，保留内容相同的全局副本；仓库文件未删除，此设置不自动覆盖其他工作树路径。发版技能沿用用户已明确给出的授权，不逐步骤重复确认，也不把咨询当作发布授权。
- **所需工具可直接安装（用户长期授权）**：执行任务过程中，如缺少必要的 Skill、MCP 服务、插件、CLI、依赖或其他工具，可自行查找并从官方或可信来源下载、安装和完成必要配置，无需逐项询问用户。优先复用已有能力，安装后验证可用并继续任务，在完成说明中简要记录安装内容；涉及项目配置或工作流程变化时，按第 0 节同步文档。需要用户登录、提供凭据、付费，或平台强制要求用户授权时，明确说明所需操作及原因；本授权不替代系统权限、工具调用限制或第三方授权，也不扩大生产操作及对外数据传输的授权范围。
- **项目凭据代为输入（用户长期授权，2026-09-05）**：执行用户已授权的项目任务时，可以使用用户提供或已为本项目安全配置的账号、密码、密钥代为登录、输入密码和完成所需认证，无需每次重新请求输入密码的许可；优先复用已有有效会话。此授权适用于项目开发、测试和已授权的生产操作，不自动授权发版、删除数据或其他原本需要单独授权的操作。缺少必要凭据时再向用户索取；平台或工具明确要求本人完成的扫码、验证码、生物识别、权限确认等步骤，请用户协助，不绕过认证或访问控制。
- **模型提供方与上下文边界（2026-09-17 起）**：本机 Codex 可在官方 ChatGPT 登录与 DeepSeek 官方 API（`model_provider = "deepseek"` + `model_catalog_json`，由 DeepSeek 官方 Codex 脚本写入，见 `~/.codex/backup-deepseek/manifest.txt`）之间切换，两者共用同一份 `~/.codex/config.toml`。**当前模型提供方会收到本会话的完整上下文**：仓库代码、命令输出、`~/.codex/memories` 摘要，开启 chronicle 时还包括屏幕内容，且流量经本机代理。允许进入上下文：仓库代码、测试库、本地开发数据、脱敏样例；**禁止进入上下文：`deploy/production*.json`、`backend/.env` 的真实口令、生产库导出、真实客户与账款明细**——需要生产事实时由用户执行只读查询，或先脱敏再把结论带回会话。API Key 只保存在 `~/.codex/config.toml`（权限 600），禁止在 `.zshrc` 导出（Codex 每个会话会生成 `~/.codex/shell_snapshots/*.sh`，会把环境变量明文写盘）、禁止写进仓库、文档或日志，也不在回复中回显；2026-09-17 用户选择暂不轮换既有 DeepSeek Key，复检条件见文档第 3.1 节。DeepSeek 目录与 provider 段由官方脚本重写，**Codex 应用升级后必须重跑脚本（菜单 1）刷新 `models.json`**；DeepSeek 忽略内置 `web_search` 等工具且不支持 `store`/`previous_response_id`，联网核查改用 `curl`/`gh`、长会话注意缓存命中。审批口径为**已授权的操作不重复询问**（用户 2026-09-17 确认）：维持 `approval_policy = "never"` + `sandbox_mode = "danger-full-access"`，工具层没有额外拦截，已授权范围内直接执行、需要新授权时按本节边界停手。现状、兼容性差异、已完成的密钥清理与待办见 `docs/codex-model-provider-2026-09-17.md`。
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

本机另安装官方 `chrome-devtools-mcp` 的独立 CLI，供用户授权切换工具时排查 CUA 浏览器读取故障；不依赖 Codex 重载 MCP。使用任务专属 `--sessionId`，结束时 `stop` 并用 `status` 核验；连接用户现有 Chrome 前按当前工具权限规则确认调试访问，完成后恢复本次开启的调试设置。安装路径、版本和实测范围见 `docs/local-tooling-2026-09-04.md`，不能把公开首页测试当作已登录控制台验收。

根目录 `.nvmrc` 声明 Node 22；`npm run dev:backend`、`dev:erp`、`dev:pda`、`dev:check`、`dev:setup` 会经 `scripts/with-dev-env.sh` 加载项目环境并验证 Node 主版本。`.nvmrc` 本身不会让未安装版本管理器的终端自动切换。`dev:pda` 默认使用 5174，与 ERP 5173 分开；仍以 Vite 实际输出为准。

本机 Codex 个人设置已将 Claude 专用变量移出通用 shell 注入，并通过私有凭据文件/`http_headers_helper` 提供 GitHub MCP 认证；不把这些文件纳入仓库。个人设置备份、实际验证与需要用户完成的界面操作见 `docs/codex-local-setup-2026-09-04.md`。模型提供方（DeepSeek 官方 API / 官方 ChatGPT 登录）的配置、上下文边界与兼容性差异见 `docs/codex-model-provider-2026-09-17.md`。文件已修改不等于当前任务连接已重载；完成任务后重启应用。中文版“常规 → 跟进处理方式 → 调整方向”和“环境”的界面步骤由用户操作，不用其他手段绕过电脑控制工具对 Codex 自身的限制。

`dev:setup` 用于新工作树，按三端 lockfile 执行 npm ci，不复制真实 `.env`；不要在用户正在使用的开发服务目录中为验证脚本而重装依赖。旧 `.codex/hooks.json` 的 EnterWorktree 匹配器已移除，应用保存的 `.codex/environments/environment.toml` 已配置 `npm run dev:setup` 设置脚本与后端、ERP、PDA、检查代码四个操作；新工作树自动触发仍需实际验证，不能仅凭配置文件认定成功。2026-09-04 临时空目录验证中，前后端安装成功，桌面端 Electron 安装阶段超过 240 秒测试时限，完整三端初始化尚待验证；不能以已有 node_modules 目录判断安装成功。

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
| 打印、标签 | `npm run test:label`、`npm run test:print`、`npm run test:print-purge`、`npm run smoke:print-queue`、`npm run smoke:print-template-preview` |
| 报表、开票 | `npm run smoke:reports`、`npm run smoke:reports-values`、`npm run smoke:warehouse-ops`、`npm run smoke:invoice-quota` |

`npm run test:fulfillment`、`test:procurement-planning` 为履约与采购净额纯规则回归；`smoke:fulfillment`、`smoke:procurement-planning` 必须使用本节独立测试库，已加入 Tests CI 专项矩阵。
`npm run test:fulfillment-refresh` 检查履约提交后合并通知、有界队列、失败退避与执行中再变更；`smoke:fulfillment` 同时验证业务单号筛选、仓库权限及提交后供应依赖刷新，仍仅允许独立测试库。

`npm run test:direct-express` 为官方签名、默认重量 1 及防重复下单离线回归；`npm run smoke:direct-express` 验证 MySQL 批次入队、销售产品快照与并发恢复，必须使用下述独立测试环境。`npm run check:direct-express -- sf sf_main`（德邦用 `deppon deppon_main`）只检查配置，不联网、不输出凭据。

`npm run test:document-activity` 为不连接数据库的订单记录归属、脱敏及数据范围回归，已接入 CI。

`npm run audit:business-consistency` 使用显式数据库环境变量执行只读跨模块一致性检查，输出全量异常计数及每项最多 100 条样本；退出码 0=未检出、2=存在待核对项、1=执行错误。报告中的推算金额依赖来源字段完整性，不能直接用作自动修复指令。2026-09-17 起新增 `container_product_orphan`、`container_warehouse_orphan`、`task_lock_leak` 三项检查（孤儿容器与已完结任务仍持有容器锁），共 41 项，见 `docs/acceptance-2026-09-17.md`。`test:legacy-receivable-repair` 为定向修复守卫单测；`smoke:legacy-receivable-repair` 必须使用已迁移的回环独立 `flowcube_repair20260908_test` 库，串行执行真实事务/回滚/幂等及扫描口径回归。定向修复脚本默认只读，生产 apply 要求预检摘要一致和私有备份路径，具体范围见 `docs/production-receivable-audit-2026-09-08.md`。

`npm run test:purchase-repair` 检查空采购来源、错行归属和定向修复守卫，已加入 Tests CI 配置；`npm run smoke:purchase-repair` 在同一专用 `flowcube_repair20260908_test` 库验证事务回滚、幂等、库存/应付不变和规范化后真实应付重算，必须与应收专项串行运行。生产只执行已授权的定向修复脚本，不执行这些测试。

固定库名的采购/应收修复专项含全表清理，原有同名测试库存在未确认数据时不得复用。可在任务专属 MySQL 临时实例的随机回环端口创建同名库，完整迁移后串行执行；随机凭据仅留受限临时文件，结束清理并验证本任务容器、数据卷和凭据文件。不得放宽测试库守卫或清理原实例来迁就脚本。补证见 `docs/module-followup-2026-09-12.md`。

`npm run smoke:warehouse-assets-waves` 验证塑料盒和批次拣货的真实 HTTP 权限、仓范围、管理接口与状态流转，使用本节独立测试库，加载模块前禁用打印清理定时器并核验既有打印任务未变化，已接入 Tests CI 专项矩阵。空盒创建只接受正整数主档 ID 与文本备注，不增加库存；波次按商品合计并保留最早成员明细的显示快照，先限仓再返回绑定信息，完成时锁定成员，所有活动成员先检查待归还/待改单阻断，再保留已进入分拣及后续阶段的状态。销售任务取消仍必须从销售订单发起。活动波次 GET 详情会刷新已拣数量投影，不能当纯只读。详见 `docs/warehouse-assets-waves-regression-2026-09-13.md`。

`npm run smoke:warehouse-masterdata` 验证仓库、库位、货架和分拣格的真实 HTTP 管理接口、权限、仓库范围和引用保护；沿用本节独立测试库并按自有 ID 清理，已接入 Tests CI 专项矩阵。仓库详情/更新/删除及库位、货架、分拣格的创建/下拉/扫码读取均传入当前用户仓库范围；库位更新校验原仓及目标仓，分拣格商品扫码先限任务仓再取结果。货架更新查重按本仓执行，允许跨仓同码。详见 `docs/warehouse-masterdata-regression-2026-09-13.md`。

`npm run smoke:masterdata` 验证客户、供应商、部门和分类的真实 HTTP 管理接口、权限、引用保护与层级边界，使用本节独立测试环境，已接入 Tests CI 专项矩阵。夹具按本次ID清理，不全表删除，不重置共享编码序列。部门更新沿父链验证有效父级，省略 `managerId` 保留负责人，显式 `null` 清空；不能把局部字段更新当作负责人清空。细节见 `docs/masterdata-regression-2026-09-12.md`。

运行涉及数据库的测试前确认连接目标与测试数据清理行为，**不得连接生产库跑测试**。公共 `tests/helpers/testEnvironment.js` 要求 `NODE_ENV=test`、显式回环 `DB_HOST`、合法 `DB_PORT`、`DB_USER`/`DB_PASSWORD`、`flowcube_test` 或 `flowcube_<用途>_test` 库名；测试不再加载真实 `backend/.env`。可用 `FLOWCUBE_TEST_ENV_FILE=/绝对路径/.env.test` 显式加载测试专用配置，命令行环境优先，配置错误及迁移失败立即终止。新数据库测试必须复用此校验。**本机实操（2026-09-17 验证）**：测试库凭据在 `~/.config/flowcube/operations20260912-test.env`，文件名不是 `.env.test` 因而走不了 `FLOWCUBE_TEST_ENV_FILE`，改为 `set -a; source ~/.config/flowcube/operations20260912-test.env; set +a` 注入；还必须 `export APP_UPDATE_DOWNLOADS_DIR=/tmp/<可写目录>`，否则 `backend/src/app.js` 启动时就因默认 `/var/www/flowcube-downloads` 无写权限抛 EACCES——**这个报错与业务代码无关，别当成回归失败**。本机 Node 为 v26，前端单测因此有 9 个文件 56 个用例失败（`localStorage is not available`），属既有环境问题；对照基线时不看绝对数，看是否新增失败。没有运行或环境不具备时明确说明；不能据此声称全部通过。纯文档修改核对内容、路径和 diff 即可，不必启动数据库或全量业务回归。

本轮修复回归入口：`npm run smoke:prelaunch-finance`、`smoke:prelaunch-scope-export`、`smoke:prelaunch-hr` 与 `test:prelaunch-runtime`；数据库仍必须使用第 3 节独立测试环境。

第二轮新增 `smoke:round2-transfer`、`smoke:round2-payroll`、`smoke:round2-runtime` 与 `test:round2-runtime`；前三者必须显式测试环境。历史审计 probe 断言缺陷存在，只是修复前证据，不能当作现行正确行为门禁。

正式 Tests CI 的独立数据库专项矩阵包含两轮审计 finance、scope-export、hr、round2-transfer、round2-payroll、round2-runtime，每项先迁移专用测试库；static job 同时执行第二轮运行时/恢复/错误追踪回归。

审计回归入口：`npm run smoke:audit-inventory`、`npm run smoke:audit-finance-security`、`npm run test:audit-client`、`npm run test:audit-tooling`。2026-09-17 验收修复守卫 `npm run test:acceptance-fixes`（请求体解析错误码、废弃设置键、取消单明细投影、审计脚本覆盖、迁移存在性）为纯离线断言，已接入 Tests CI static job。标签镜像检查使用前端已安装的 TypeScript 在 Node 22 编译并运行，`test:label` 需要前端依赖，不再按 Node 版本跳过；CI 在安装两端依赖后的 static job 执行。`npm run test:agents-md-guard`（AGENTS.md 注入守卫：禁 `CLAUDE.md` 候选、体积不超 128 KiB、关键章节与红线仍在、`docs/*.md` 与 `npm run` 脚本引用都有效）为纯离线断言，与其它机械契约测试同组执行（Tests CI 的 regression job「契约测试」段）。
运维/迁移回归（static job 「运维回归」步骤）：`node --test tests/ops-monitor-restore.test.js tests/deployment-resources.test.js tests/restore-trigger-normalize.test.js tests/migration-trigger-bodies.test.js`。前两项验备份恢复判定与资源边界，后两项验触发器分号规范化与迁移逐条切分，均不连数据库。

导出格式回归：`npm run test:export`（static job 与 `test:upload` 同一步执行）——校验 xlsx 导出的日期列写成日期单元格并带 `yyyy-mm-dd` / `yyyy-mm-dd hh:mm` 数字格式（2026-09-16 起），不连数据库。

## 4. Codex 本地预览

- **开发与生产分工（用户于 2026-09-04 明确）**：本地开发者模式用于日常修改、实际页面验证和前后端联调；线上服务器为生产模式。涉及页面或接口联动的修复，自动化测试后应补本地开发模式验证，并分别说明两类结果；不能用单测或构建通过代替页面验收。数据库批量/破坏性回归仍放独立测试库。线上访问及发布遵守已有授权边界。
- 用户要求“开发者模式/给我网址”时，先检查当前可用的服务启动工具与已有服务。若有预览工具可使用；没有则通过终端运行第 3 节的 npm dev 命令，保留进程并读取实际监听地址。不能照搬不可用的 `preview_start`、`tabs_create` 等 Claude 工具名。
- 现有 `.claude/launch.json` 可作为启动命令参考；它不意味着存在 `.Codex/launch.json` 或 Codex 已自动加载它。不要凭空创建替代路径。
- 启动前检查端口与已有服务，并核对监听进程的工作目录确实属于目标 checkout；端口可访问不代表正在提供本任务代码。并行任务可能从另一工作树占用 5173，不能只凭端口认定主项目已更新；冲突时另选空闲端口，不杀其他任务进程。交付实际可访问且已核实源码归属的地址。
- 2026-09-09 按用户授权新建本地界面验收账号 `codex_ui_test`，使用既有只读角色；仅在回环 3307 的 `flowcube_dev8` 创建，随机凭据保存为本机 agent-browser 加密凭据档 `flowcube-local-ui`。后续使用前核实账号仍启用，不依赖旧测试账号，也不在仓库保存密码。
- 登录按第 1 节“项目凭据代为输入”授权执行：优先复用已有会话，需要登录时可代为输入项目账号和密码并继续验证；仅在缺少凭据或认证步骤要求本人操作时请用户协助。不得为了预览临时关闭鉴权或越过权限，不在文档记录密码。
- 本地 dev 连接本机后端时，`authStore.ts` 的 `USE_PERSISTENT_DEV_SESSION` 使用 localStorage；生产和本地前端连接生产 API 时仍使用 sessionStorage。边界由 Vite 的 `__DEV_LOCAL_BACKEND__` 控制，不能放宽。
- 更换端口会更换 origin，不共享 localStorage。会话有效期与续期读 auth/env 代码，不照搬旧文档的“固定 7 天”。
- PDA 启动时原生与浏览器开发模式均初始化设备凭据缓存；原生仍用加密存储，浏览器仅内存且刷新需重新绑定。不能只在原生初始化，使浏览器绑定页无法发起换票。
- PDA 构建使用独立路由入口，不打包 ERP 壳层与页面；两种构建复用 PDA 路由及权限定义，保留 legacy WebView 兼容构建。
- ERP 与 PDA 验证分别开标签页，`CrossClientNavigationGuard` 禁止同标签页跨客户端跳转。
- 验证结束保留用户可能正在使用的开发服务。连接生产 API 的预览视为生产访问，不能当作本地测试库操作。
- 自动化浏览器每任务使用独立稳定命名会话并复用标签页；结束、出错或长暂停时关闭本任务会话，用 `agent-browser session list --json` 确认退出。保留默认闲置回收，不无限保活、不批量关闭其他任务或用户浏览器。

## 5. 后端、API 与数据库规范

- 严格 `routes → controller → service → db`。routes 注册路径、鉴权、权限、zod/PDA 校验；controller 取参并返回响应，不写 SQL；service 放 SQL 和业务规则，不接 HTTP 对象。
- 大模块新增逻辑放对应窄职责文件，例如 `inbound-tasks.putaway.js`、`warehouse-tasks.ship.js`，不要堆回 service 门面。
- 错误使用 `AppError` 交给统一 errorHandler；成功使用 `successResponse`。信封为 `{ success, message, data }`，失败可含 `code`；列表分页位于 `data.pagination`。
- **请求体解析错误必须映射为 4xx**：body-parser 的 `entity.parse.failed` → 400、`entity.too.large` → 413，不能在 errorHandler 里落到「未知错误」500（2026-09-17 验收修复，此前畸形 JSON 会返回 500 并把堆栈记成 `[Unhandled]`）。
- **系统设置项只允许「真正生效的键」对外**：`settings.service` 维护 `DEPRECATED_SETTING_KEYS`，其中的键不出现在 `GET /api/settings` 列表、也被批量保存静默跳过。当前包含 `sale_prefix`/`purchase_prefix`/`stockcheck_prefix`（迁移 230/231 后由 `code_prefix_*` 接管）、`code_digits`（codeGenerator 未读取，固定 6 位主数据/3 位流水）与 `code_prefix_customer`/`code_prefix_supplier`/`code_prefix_product`（`generateMasterCode` 刻意不接入前缀覆盖）。恢复这些能力必须先把 codeGenerator 真正接上配置并处理新老编号格式分叉，不能只把键放回页面。
- SQL 参数化；API 小写、连字符、复数名词。页面不分页，但传输与 SQL 保留有界批次；批次查询按主排序追加唯一 ID（库存按商品/仓库组合）保持稳定，防止相同时间或名称在不同批次重复/遗漏。后台批次复用 `normalizePagination`，导出遵循既有上限与截断告警，不能用无限大 pageSize 绕过分页。
- 新迁移按当前最大编号新增，**不得修改已执行的迁移**，不得未经明确授权删除字段、兼容代码或迁移文件。编号冲突、幂等执行、回填与消费者兼容要一起考虑。
- **迁移必须逐条执行**：`backend/src/database/migrate.js` 经 `sqlStatements.js` 切分后逐条 `query`。整文件当一条多语句发送时，非末条 `CREATE TRIGGER ... <单语句>;` 的函数体会把结尾分号一起写进 `ACTION_STATEMENT`，mysqldump 导出成 `... ); */;;`，导入必然 1064 且备份不可恢复（2026-09-14 事故，见 `docs/backup-restore-trigger-terminator-2026-09-14.md`）。新增触发器迁移后要确认函数体不残留结尾分号；`sqlStatements.js` 不支持 `DELIMITER`，需要时先扩展再写迁移。
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
9. 数量为 DECIMAL，销售等单据输入最多 4 位小数，单位折算后若小于 0.0001 必须拒绝，不能舍入成零；比较/累加防浮点误差，打包沿用 `toQtyUnits/fromQtyUnits`。
10. 不恢复已关闭的手动入库/手动库存调整入口；入库走收货，调整走盘点。初始化导入等专用流程遵守其既有校验，不扩展通用后门。
11. 写操作考虑连点与断网重试：前端稳定 `X-Request-Key`，后端 `beginOperationRequest/completeOperationRequest`，结合唯一键和 CAS。资源级写操作的 action 必须绑定单据 ID，避免同一请求键跨单据误重放；重放返回原回执，不能重复加库存、推进状态或入账。公共操作幂等在重复 INSERT 后以 `FOR SHARE` 当前读检查既有回执，避免两个重放事务将唯一键共享锁升级为排他锁而死锁；不能改成可能漏掉新提交回执的快照读。确定性并发专项已接入 `smoke:concurrency-guards`，验证与全模块覆盖见 `docs/all-module-regression-2026-09-12.md`。
12. 事务内禁止外部 HTTP 或物理打印。打印只在数据库入队，实际动作异步；补打不建容器、不加库存、不改账款。
13. 缓存漂移先只读检查；需要修复时走既有 resync/引擎入口，不能手改数据库。不要为了“验证”擅自跑会修复数据的命令。
14. 改引擎或状态机前读完整调用链与历史事故注释；副作用变化同步 `WT_ON_ENTER_ACTIONS` / `WT_ON_EXIT_ACTIONS` 及相关测试。

## 7. 核心业务语义

- **采购收货**：采购提交可能按审批阈值进入待审批，按当前 purchase 常量及 service 判断；收货订单 → PDA 收货建待上架容器 → 扫库位上架 → 全部完成时自动结算应付。没有旧版的人工收货审核环节。**上架只在任务进入「待上架(3)」后开放，由服务端强制**（`putaway.from=[3]`）：进入 3 有两条路——全部明细行收满自动推进，或供应商短装时走 ERP「短装结案」把剩余未收量作罢；未了结的收货中(2) 会被拒绝并提示这两条出路。短装结案走专用 close，撤回收货走 void-receipt 并反冲，容器已被后续动作使用时拒绝。
- **收货保护**：超收确认与疑似重复扫码确认分别沿用 `confirmOverReceive` / `confirmDuplicate`；阈值读 `inboundThresholds` 和配置。容器保留 `inbound_task_item_id`，按归属行回写上架量和采购价，不能串单结算。
- **采购来源完整性保护（v0.9.10）**：收货/上架/撤回复用 `inbound-purchase-source.js`，每行必须有合法采购及明细 ID，且明细所属订单、商品一致，空来源不再跳过取消校验。应付重算前拒绝缺关联的有效收货或未归入收货明细的旧直接入库，不能用空 JOIN 的零金额冲掉历史应付。线上启用状态须以同 SHA 部署及迁移结果核实；生产历史记录另走有备份和审计的定向修复，见 `docs/purchase-repair-2026-09-08.md`。
- **销售分仓/按量占库**：行级 warehouse_id 必须参与关联；同商品多仓不能 JOIN 放大。订单头仓库和每条明细的目标仓库都必须通过当前用户仓库范围校验。`reserved_qty` 是已占量，`dispatched_qty` 是已派发量；销售数量允许正小数，发起出库可按明细指定本批数量但不得超过已占未发差额，部分占、补占、释放、分批发货和改单保持数量账一致。改单、取消、删除等写操作必须携带稳定请求键以防重试重复执行。
- **销售 ATP**：总可占量 = ACTIVE 实物 + 采购未上架总量 − 全部有效预占；预计量不能先减绑定后再减 reserved。绑定只表示尚依赖采购的数量，上架按采购明细 FIFO 兑现，不减少销售预占；出库只能使用本单已有实物份额及未分配实物，不能截断其他订单合法的预计预占。采购撤回、驳回、取消、减量/删行和短装关闭均保护有效绑定；撤回上架不能移除支撑现有销售承诺的供应。多商品释放先按统一顺序锁全部库存维度，再锁预占/预计绑定；旧快照漏维度返回 409 重试。规则与回归见 `expectedStock.js`、`sale-atp.smoke.test.js` 和 `audit-inventory.smoke.test.js`。
- **销售执行**：拣货 → 分拣 → 复核 → 打包 → 出库，各阶段校验闭合；执行期减量、取消涉及已搬动物料时走 PDA 物理确认/逆向归还。销售关联仓库任务禁止从仓库任务入口单独取消，必须从销售订单统一取消同单任务和剩余预占。已有部分出库时取消剩余需保留已发事实，按实发原值比例保留整单折扣并重算应收，不能整单当未发取消。**执行期取消且没有任何已出库任务时必须把明细 `reserved_qty`/`dispatched_qty` 一并归零**（2026-09-17 验收修复：此前只释放预占账与任务，明细仍显示已占/已派发，开发库累积 56 张此类单据）；有实发时按实发精简明细的分支不变。执行期改单仅支持单个仓库任务且所有明细已完整占库、完整派发的订单；同仓多任务或部分派发返回 409，列表和详情同步禁用入口。重建执行期明细必须写回 reserved_qty/dispatched_qty，不能只写旧 dispatched 标记。待实物归还期间 reserved_qty 按实际有效预占账保留，可暂大于改单目标量；PDA 确认释放后同事务同步已占量，dispatched_qty 表示调整后的派发目标。占库期或执行期改单重算货款后必须再次校验原折扣不超过新合计。同商品分仓的扫描记录必须同时按任务仓库与商品归属，不能只按 product_id 混在多条明细上。
- **销售主数据快照**：建单和草稿编辑时，客户、默认仓库、明细仓库、商品与承运商名称及商品编码、单位、供应商型号、型号、颜色、成本均从当前启用的服务端主数据生成；不能信任客户端传入的显示名称。停用或删除的客户、仓库、商品、承运商必须拒绝保存。
- **退货**：采购退货走标准仓库出库并冲减应付；销售退货走收货、质检、上架并冲减应收。部分质检必须保留合格、拒收、未检三份数量并守恒，未检容器可继续质检；收货/分箱标签与数量变化同事务入队，回传容器条码、打印任务及无打印机提示。上架扫码经当前任务范围解析真实容器/库位 ID，提交再次校验归属、状态、设备仓与权限；不能将完整条码直接转 Number，也不能通过列表选 ID 代替扫码。return_tasks 有内联状态机，不能仅查 documentStatusRules。
- **调拨**：列表批量返回本页已授权单据的逐行计划、已出、已收数量，不做逐单N+1；在途且任一行尚未出完时，PDA列表保留源仓出库入口，全部出完才隐藏。源仓扫码出 → 在途 → 目标仓扫码入；在途不可普通取消，异常走有独立权限的 force-close。正常完成须每行计划量=已出量=已收量且无在途容器，部分发收不能提前结束。重复商品行合法，整箱按商品合计余量校验，再按行 ID 用万分之一整数单位分配；不拆实物容器。创建、读写沿用至少一端在用户仓库范围的跨仓规则。扫码 action 为 `transfer.scanOut.<id>` / `transfer.scanIn.<id>`，执行及重放先验单据、仓库范围和设备仓；旧固定 action 只兼容资源归属一致的回执。自有回执查询保留权限调整后的读取契约，不等同于再次执行权限。
- **盘点**：账面读取 ACTIVE 容器；提交前整单检查账面漂移，任一漂移拒绝整单，刷新账面会清空对应实盘值。差异调整走引擎。
- **商品快照**：已有业务快照读快照，无快照的过程表按既定 JOIN 读取主档。`article_number` / `articleNumber` 语义为供应商型号，不恢复随机生成；`spec` 为系统型号，不能因改展示名擅改历史列名。

- 履约及时性（2026-09-12）：关键业务提交成功后以 `commitFulfillment` 合并通知，在事务外按有界批次刷新本单及相关销售供应依赖；回滚不通知。删行或改仓前在事务内捕获旧商品/仓库维度，提交后同时通知旧供应依赖；每单最多保留 500 个维度（读取第 501 项检测截断），截断计入 `snapshotOverflow`，不能为获取快照提前到授信所需客户锁之前。单据和库存维度提示共享 1,000 项有界队列，相关单据分批推进游标；普通依赖刷新不得重置已有展开游标。原 30 秒周期游标扫描保留为重启/丢通知兜底。队列的积压和处理时间决定实际延迟，不承诺全量单据每秒完成。业务交期与事项人工处理期限分开，不因刷新擅自覆盖人工期限。查询和事件职责从 service 拆出并保留兼容导出。待办显示业务单号、往来方及仓库，支持单据类型和关键词筛选；状态/类型按用户保存在本机，关键词和业务数据不持久化，返回原工作区保留筛选和滚动位置。详见 `docs/fulfillment-refresh-2026-09-12.md`。

## 8. 财务、权限与时间

- **顺丰/德邦月结直连（顺丰沙箱已联调、正式月结已绑定，正式下单待验收）**：直连运单在整批 `packDone` 校验通过后，按当前仓库任务已完成箱子自动填件数；每批最多 30 箱，超出分批，各批独立订单号，保存全部母子单号。界面不采集重量；按用户最新约定，顺丰 `totalWeight`、德邦 `packageInfo.totalWeight` 默认传 1（kg），件数仍来自实际箱数，不随件数放大默认重量。该值仅用于下单，最终实重由快递员称重确认，不写入实际重量/运费账单。旧 `DEFERRED_WEIGHT_MODE` 不再使用；已提交请求快照保持原样、仅查询原单。产品默认来自承运商、本单可覆盖，PDA 不决策。未提交平台的运单可补充寄收件、产品与寄付/到付，件数和箱子归属仅后端维护；系统缩批自动移除的未提交批次可恢复，人工作废不自动恢复；已提交箱子变更需先核实原单，当前取消确认同步尚未接入。HTTP 在事务外，提交前固化原始业务报文和凭据引用、不保存密钥；结果不明、进程中断及失败回写后只查原单，不再 create（德邦同渠道号重下可能追加子件）。状态 6 为下单待核实，旧重试入口对此仅查询，已提交直连单禁止通过本地作废伪装平台取消。官方面单打印及实际轨迹查询开通属于独立能力，取到号不等于已完成打印。2026-09-06 已用顺丰官方测试月结号验证本地适配器实际联网下单/原单查询，以及独立沙箱取消、轨迹、两页 PDF 面单；全部测试订单已确认取消。顺丰下单、原单查询、取消、轨迹、PDF 五项官方接口均已上线，应用显示 5/5，正式月结绑定已获平台成功回执。该结果不代表正式下单、生产启用、队列全链路或本地取消/轨迹/PDF 功能已验收。开通与验收见 `docs/direct-express-2026-09-06.md`。
- **德邦接入配置（2026-09-09，纳入 v0.9.11）**：Docker 将根目录私有 `.env` 的德邦默认凭据组七项配置仅注入后端，默认 production；本地 Node 使用 backend/.env。正式接口必须为官方 HTTPS。sandbox 仅额外精确允许对接人提供的创建 10348 与原单查询 10347 专用 HTTP 地址，两种用途不能互换；生产运行禁止使用沙箱。真实权限、凭据及联调结果独立核对，不用配置完整或离线回归冒充正式开通。用户 2026-09-07 已提供并确认另配 IP 测试环境的下单/原单查询，正式权限按对接人答复上线后配置；不能再索取同一组测试资料或以官网旧沙箱进度否定独立测试环境权限。2026-09-09 独立 IP 测试环境改用用户原月结号后，XJTK/DJTK 两箱均仍只回一个号码，创建和查原单均成功响应；子母件处理需按流水核对，不据此重索已配置的接口权限，不改合同产品或放宽箱数校验。官网本地联调已成功，已用现有联系人资料、无面单照片方式成功提交人工上线审核，平台要求德邦对接人起草工作流；尚非正式审批通过或生产下单可用。实测及未撤销的测试记录见 `docs/deppon-onboarding-2026-09-09.md`，配置规则见 `docs/direct-express-2026-09-06.md`。

- **快递月结账号绑定页**：`/carrier-accounts` 复用承运商查看/编辑权限，仓库人员在同页搜索/选择已有承运商，或新增名称、平台、月结号，再选择中文常用服务；不录密钥、凭据引用、重量或官方短信验证码。GET/PUT `/api/carriers/:id/account-binding` 返回准备状态、严格校验输入，并以行锁与绑定字段摘要拒绝过期覆盖。快捷新增 POST `/api/carriers/account-bindings` 使用创建权限及稳定请求键，单事务建立默认暂停的承运商/月结资料，断网重试返回原记录；列表按有界批次完整加载。解绑提交 action=unbind 与 revision，须先暂停且无待处理运单，清空本地月结号与常用服务但保留承运商、凭据引用及历史，不解除官网授权。快递账号绑定页不再提供删除入口、删除提示或删除确认框；前端不调用删除接口。承运商管理中的主档删除仍要求自动下单已暂停、月结号已解绑，且无销售订单、运单、运费明细或结算单引用；后端在事务内检查后软删除空记录。保存资料默认暂停；单独暂停仅提交 action=pause 与 revision，不能因历史账号/服务格式不合规而失败；启用需正式接口配置、常用服务及管理员登记的已验收月结号全部就绪。更换月结号须先暂停且无状态 1/2/4/6 的待处理运单。顺丰服务默认内置特快/标快，可由服务端 `WAYBILL_<REF>_PRODUCTS` 覆盖为合同列表，已验收账号使用 `WAYBILL_<REF>_VERIFIED_MONTHLY_ACCOUNTS`；这仅是简易页的管理员验收记录，不冒充官方在线授权验证，也不追溯关闭既有高级配置入口或历史运单。开通步骤与验收边界见 `docs/direct-express-2026-09-06.md`。
- 快递账号资料衔接（2026-09-08，纳入 v0.9.11）：承运商管理在未启用取号时也展示平台选择并保存，绑定页只对缺少平台的旧档案要求补选，不按名称猜测平台；已配置时直接显示承运商带入的快递公司。两个页面共用 carriers 查询失效范围，刷新绑定状态但保留同平台月结资料的未保存草稿及其原 revision，避免覆盖同事的新资料。承运商列表可定位对应账号，已打开的绑定页按新的页面定位切换、有草稿时先确认。账号页仅保留业务填写项、必要状态和操作，移除重复开通步骤及技术长说明。顺丰内置官方常用产品 1（顺丰特快）、2（顺丰标快），可由 PRODUCTS 覆盖为合同选项；展示产品不代表月结授权。说明与验收见 `docs/carrier-account-ux-2026-09-08.md`。
- 快递生产配置传递（2026-09-08，纳入 v0.9.11）：`docker-compose.yml` 将根目录私有 `.env` 中两家默认凭据组传入后端容器，不传前端、不打入镜像；本地 Node 仍读取 `backend/.env`。Docker 默认正式模式，顺丰默认官方正式地址；德邦正式下单/原单查询地址及 sign 依平台实际分配填写，不能复用此前 HTTP 测试地址。`test:direct-express` 包含配置传递回归。2026-09-09 顺丰正式凭据已配置到服务器私有 `.env`，通过服务器专用 `docker-compose.override.yml` 仅注入后端；基础映射发布前该覆盖文件须保留，后续移除须先核对渲染配置等价。沿用已部署镜像，仅重建后端，内外 ready 及生产账号 GET 验证通过，现有适配器使用运行时凭据取得正式原单查询 6150 回执。官网应用 5/5、正式月结绑定已复核，但尚待常用服务选择和真实订单验收；验收清单为空，自动下单暂停，不能宣称已可真实发货。德邦仍未配置。备份、验证及收尾见 `docs/carrier-production-setup-2026-09-08.md`。


- **往来明细账（v0.9.10）**：`/payments/ledger/customer/:id` 与 `/payments/ledger/supplier/:id` 读取 `GET /api/payments/party-ledger`，使用公司级 PAYMENT_VIEW 权限。迁移 238 保存启用时净余额为历史结转，以后在原业务事务内记录账款总额变化、直接收付款/退款、汇款单登记；核销不重复影响往来净额。正余额为欠款，负余额为预收/预付或应退款项，不能当成资金账户余额。单位 ID 从原销售/采购单取得并固化；汇款由核销源单或显式选择的单位 ID 归属，旧客户端名称仅在现名/历史快照名唯一时兼容；迁移 239 回填 receipt.party_id，240 禁止触发器覆盖服务层明确的空归属。继续核销必须保持相同单位 ID，空归属不能核销到已知单位。无明确归属的手工/运费或历史记录保留待核查，不用模糊名称塞进单位明细。按记账时间算期间余额，业务日期仅供追溯；启用前不可伪造历史流水。执行迁移前须停止业务写入（含定时任务/worker），完成后再启动。说明和验证见 `docs/party-ledger-2026-09-08.md`。
- `payment_records` 按 `(type, order_id)` 幂等；应付变化需遵守财务确认闸门。账款重算、退货/退款、对账投影保持同事务一致。销售授信与应收均按 `total_amount - discount_amount` 的折后净额计算；首次占库与补占均先从已用额度排除本单再加回本单净额，预览采用相同口径；出库复查本单敞口还要扣除已收款，整单折扣按已发原值占订单原值的比例分摊，不能按商品数量比例分摊。已批准的超额授信申请只在客户、信用额度和本单净额快照一致且当前超额不超过获批额度时有效，订单或额度变化后不得沿用旧审批扩大敞口。
- **历史账款修复（2026-09-08）**：生产两笔应收已校正，合计 358.43。采购侧后续按用户“直接改到符合逻辑的状态”授权完成：收货 ID 1..4 补齐采购关联；收货 1 根据旧入库流水 108、在库容器 101 恢复已完成/已结算、上架数量 1，容器 101 归入该收货行；重复或随已取消采购遗留的未上架容器 102..105 作废，收货 2..4 已取消。保留原始快照及调整事件，采购状态、应付 33.13、ACTIVE 库存和预占均未改变；没有新增实际收付款/出入库/退货。38 项只读检查已无前述差异；新增代码守卫纳入 v0.9.10。状态 3 是待上架，`putaway_qty=0/audit_status=0` 本身正常。修复依据与验证见 `docs/production-receivable-audit-2026-09-08.md`、`docs/purchase-repair-2026-09-08.md`。
- 结算方式和 due_date 是首次生成账款时的快照，补收/退货/分批发货不能追溯改写。到期日复用 `buildDueDateSql()`；月结才使用账期。回款状态独立于销售订单状态，按账款快照显示。
- 成本 `avg_cost` 按既定入库移动加权，退货/撤回不反冲是既有设计；利润使用成本快照，不“顺手修正”。
- 利润/库存分析（2026-09-12，工作区修复）：销售仅统计已完成订单，日期按开单时间；净额为整单原值扣折扣，每单只计一次，商品按明细金额比例分摊净额，成本快照回退链保持不变。读取沿用销售整单仓库范围（头仓及全部明细仓均需授权）。库存/滞销汇总覆盖全部授权数据，不从前 20/30 条排行榜推算；滞销库存与最后出库采用同一授权仓库集合，按商品合并，含无出库记录。本页滞销卡片打开同口径明细；分仓库龄与移动加权成本估值仍属另一分析口径。报表加载未知值不显示零，刷新失败保留旧数据并警示；库龄与效期分别重试，未打开效期不主动刷新。详见 `docs/report-correctness-2026-09-12.md`。
- 经营 KPI（2026-09-12，工作区修复）：销售沿用 `sale_date` 业务日期和已出库状态，净额扣整单折扣，每单只计一次；当期/上期/趋势/分仓使用同一金额、成本快照及销售整单仓库范围。月份采用半开区间，趋势止于所选月末；回款按 `payment_date`，无限制仓库账号保留全部应收分录，受限账号仅纳入可归属至有权查看的非删除销售单回款（不要求来源单已出库），无来源手工款不推断仓库。分仓仍按订单头仓库，销售占比为本仓净额/全部分仓净额；负值上期环比以绝对值作分母。接口 `gmv` 键兼容保留，展示名改为销售净额；利润页按创建时间，两个页面不能直接比较日期汇总。详见 `docs/kpi-correctness-2026-09-12.md`。
- 仓库运营状态与当前状态机保持一致：今日出库只统计 `WT_STATUS.SHIPPED`，优先按 `shipped_at`，历史空值回退 `updated_at`；拣货中只统计 `PICKING`，今日入库只统计收货订单 `finish.to` 的已全部上架状态，完成日期暂沿用 `updated_at`。三项及流程积压排除软删除任务；积压只含 `WT_STATUS_ACTIVE` 六个阶段，标签来自后端状态名，前端颜色引用生成常量，不再手写旧五阶段映射。

- 仓库运营与 PDA 日志读取统一按当前用户仓库范围过滤；错误/撤销/扫码通过任务归属仓库，受限用户排除无归属日志，空仓库范围返回空结果。`/scan-logs/task/:taskId` 先校验任务存在与范围；统计/异常日期按北京时间整日，结束日使用次日排他上界，单侧日期独立生效。仓库运营最新异常限今日最近10条并追加ID稳定排序。GET异常分析仍有既有按需建表DDL，不能当作数据库完全只读。新增 `smoke:warehouse-ops` 使用第3节独立测试环境，已接入Tests CI；范围、日期、现行状态口径及本机证据见 `docs/warehouse-ops-regression-2026-09-12.md`。

- 区分公司级业务口径与带 company_id 的会计/发票账套口径；不能只在报表一端加账套过滤、另一端凭证生成仍读全量，造成勾稽失衡。改变隔离必须核对数据表、写入、回填、查询和报表全链路。历史背景见 `docs/claude-md-archive-2026-09-04.md` 第 20 节第 50 条。
- 采购来源凭证金额变化/归零使用自动红字修订链，保留原分录；迁移 `232_acct_voucher_source_revisions.sql` 的 `source_root_id` 指向唯一来源根凭证。恢复金额新增正向修订，重算幂等；人工红冲后不自动恢复，已结账期间不可改写。凭证写入与期间开关先锁账套行；序号最大值使用当前锁定读。总账/导出必须包含原凭证及其红字抵消，不能用 `status<>3` 过滤掉原凭证。普通删除不得删除红字、被冲销凭证或有冲销关联的凭证。
- 重置密码、禁用或删除超管时在服务层锁定操作人/目标，验证操作人确为超管；拥有普通用户管理权限不等于能接管超管。改价未匹配审批流应返回明确配置业务错误，不越过审批或抛空引用 500。
- 自行审批是用户级 `allow_self_approve`，授予仅超管；复用 `selfApprove.js`，不扩大成全局豁免。收回立即生效，相关测试 finally 还原不可删除。
- 每个业务接口鉴权与服务端权限校验；权限常量在 `backend/src/constants/permissions.js` 与 `frontend/src/lib/permission-codes.ts` 手工同步，必要时追加 seed 迁移并跑一致性测试。前端隐藏按钮不能替代权限控制。
- 仓库范围用 `user_warehouse_scope`、`scopeFilter` / `assertInScope`；按业务是否涉仓接入。财务公司级接口不能盲加仓库过滤。
- 塑料盒所有读写和资料导出均执行仓库范围；空盒创建校验启用商品、仓库和库位归属，删除锁容器并复查余量及任务锁。供应商采购门户继承采购仓库范围；客户对账门户通过账款来源销售单的客户 ID 关联，不能用名称模糊匹配，无法唯一关联的历史记录保留在财务总列表供核查。
- PDA-only 写操作同时遵守 `X-Client: pda`、设备会话和绑定仓约束，ERP 不能绕过。未绑定设备显示受限引导，不放行业务请求。**后端挂了 `pdaOnly` 的路由，前端对应调用必须显式带 `X-Client: pda`**——`X-Client` 是逐个接口手加的，2026-08-09 给收货路由加守卫时漏了 `receiveInboundApi`，导致 PDA 收货 403「此操作仅允许 PDA 扫码完成」并在生产里完全不可用（2026-09-14 发现）。新增/修改 PDA-only 路由或前端调用后必须跑 `node --test tests/pda-only-client-header.test.js`，该静态契约测试逐个比对 pdaOnly 路由与前端调用；细节见 `docs/pda-receive-pda-only-2026-09-14.md`。
- 会计查询键包含账套 ID；切换账套取消并清理会计缓存、重置会计页面编辑状态并明确提示，存在提交中的写请求时拒绝切换。请求固定发起时的账套，迟到的旧账套响应不得显示。导出和错误上报共用认证客户端，二进制业务错误必须恢复为可读提示。
- HR 工资明细通过已有模块 GET /payrolls/:id、PATCH /payrolls/:id/lines/:lineId 维护，应发须明确录入（0 合法），仅草稿可编辑，PATCH 要求不超过 80 字符的稳定请求键。HR 写入先锁账套再锁单据，与凭证锁顺序一致；累计台账保留负净额，计税时才截为非负税额。核算逐月验证本年度任职起月至上月的工资与累计链，缺月或陈旧台账拒绝；缺少入职日期以可知首期工资为起点，不允许后来补建改变已使用的起点。已有已核算/发放后月时，拒绝改变上游，结果完全相同的重复核算仍允许；发放再验前月已发及本期台账。扣款超过应发拒绝核算，发放核对明细与汇总金额，个人社保凭证取明细合计。旧版无录入标记或累计失效的单据禁止直接发放，不自动改历史凭证；详见第二轮工资修复说明。
- 资金余额聚合在账户锁后使用当前锁定读，删除账户同事务锁定并检查流水。资产计提账簿与凭证共用实际封顶金额；重复月份不重写累计值；提足资产仍允许处置，处置补提与处置凭证同事务。
- JWT access/refresh 分工、token_version、refresh jti 一次性轮换要一起维护；改密码/禁用可撤销旧会话。登出清理 React Query 缓存。
- 客户端登录/退出递增仅内存中的会话代次，正常 `setTokens` 续期不变；请求首次派发绑定代次，迟到响应、续期、重放和 PDA 换票前均检查归属。旧会话不能覆盖新账号或以新账号执行旧请求。PDA 旧心跳取消不清票据，其他失败也仅清同代次且仍匹配原 token 的票据。创建账套纳入 mutation，提交中禁止关闭、重复创建及账套切换，成功刷新列表。
- refresh 请求复用运行时 API 基址和超时配置（含原生自定义服务器地址），并发 401 共用一次续期，失败统一清会话；不能从 Electron/file 或 Capacitor origin 请求相对 `/api`。
- 公开登录/更新/健康检查与公司 Logo 等是现有明确例外，新增接口不得据此省略鉴权。Logo `<img>` 场景不能携带 Bearer；更改公开资源策略需核对桌面跨源加载。
- `/health`、`/api/health` 为存活/网络检查；公开 `/api/ready` 用应用连接池执行只读探测，整体最多2秒，短缓存合并并发，仅返回就绪状态。新版本部署与服务监控使用 ready，回退尚无该接口的旧镜像才允许原存活检查。连接池获取默认最多5秒（`DB_ACQUIRE_TIMEOUT_MS`），超期返回503且不派发排队 SQL，迟到连接归还；不把已开始的事务用响应超时伪装成取消。
- **业务日期唯一时区为北京时间**：前端复用 `lib/dateTime.ts`，后端复用 `utils/backendTime.js`，数据库/容器配置保持一致。禁止用 `toISOString().slice(0,10)` 充当北京业务日期。
- DATETIME 查询按既有半开区间处理，DATE 列按日期语义处理；不可机械统一为同一种边界。到期日等于北京今天时不算逾期。

## 9. 前端与 PDA

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
- 单据列表默认时间窗口统一由 lib/dateTime.ts 的 defaultRangeYmds(7) 生成；操作日志与库存流水默认最近 7 天。默认值在构造查询参数处兜底（与查询弹窗初始值同源），range=all 表示看全部。全局搜索 autoComplete="off"。
- 官网展示页为 frontend/src/pages/landing/：版本摘要维护在 updates.ts，不以工作区 package 版本冒充已发布版本；清单缺失时禁用下载入口。见 docs/landing-adoption-2026-09-12.md。

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
- 账款/对账六类写入或宽明细弹窗拆为 components/shared/payments/ 下独立组件，外壳统一 AppDialog（可拖拽、记忆尺寸）；小功能仍用轻量 DialogContent，只换外壳。见 docs/payment-dialogs-appdialog-2026-09-18.md。
- 桌面端判定使用运行时 `window.flowcubeDesktop`，不能用构建 flag 把浏览器误判成 Electron。
- 官网候选参考源码保留于 `frontend/src/pages/landing-preview/`，不注册路由、不替换正式入口；正式页面使用用户已确认的 `frontend/src/pages/landing/` 第一版。候选历史验证见 `docs/landing-preview-2026-09-12.md`，当前采用记录见 `docs/landing-adoption-2026-09-12.md`。
- 系统品牌采用已确认的蓝底双曲线 F；官网、ERP/PDA 登录页、PDA 首页通过 `SystemBrand` 复用本地哈希资源。网页 favicon/触屏图标、桌面程序/安装器、Android 普通/圆形/自适应图标与启动屏由 `scripts/generate-brand-icons.cjs` 从 `docs/branding/flow-icon-approved.png` 导出。公司 Logo 仍只用于 ERP 顶栏/单据打印，保持公司图优先及文字回退，不混用。素材、生成方式与验收见 `docs/brand-icons-2026-09-07.md`。
- 用户术语沿用“批次、采购申请、滞销、存放时长、分批盘点、型号、供应商型号”，不为改文案变更权限码、路由或数据库列。
- PDA 不做离线自动重放；不确定写入结果先用幂等回执/已有 `resolveServerState` 恢复路径核实。
- PDA 收货页没有扫码框：点选「待收商品」卡片，点「打印并登记」即提交；一个商品收完后自动切到下一个未收完的。scannedBarcode 不再发送。见 docs/pda-receive-remove-scan-2026-09-14.md。
- 能否继续收货只看 task.status（<3 继续收货、=3 待上架），不得看 putawayStatus；后端只在全部明细收满时把任务 2→3（inbound-tasks.command.js），上架侧强制 putaway.from=[3]。见 docs/pda-receive-partial-lock-2026-09-16.md。
- 原生绑定相机扫码使用 `useCameraScanner.ts` 的既定本地解码路径，注意预览时 WebView 背景透明、权限引导和关闭清理。浏览器预览不能证明 APK 相机功能正常。
- PDA 作业页默认「扫码模式」：进页面、扫码结束都不得自动聚焦输入框；统一用 components/pda/PdaScanner.tsx，点「手动输入」才渲染手输框；该组件不再提供 autoFocus。见 docs/pda-scan-default-mode-2026-09-17.md。
- 错误提示保真：AppError 未显式带 code 时后端不再兜底 CONFLICT/BAD_REQUEST 通用码；前端 resolveApiErrorMessage() 对通用码一律以后端原文优先；新增 4xx 必须带 code 或给中文原因。见 docs/acceptance-issues-fix-2026-09-17.md。
- **PDA 打包页必须显示箱贴打印状态**：`GET /api/packages?taskId=` 返回每箱 `printStatus`，打包页显示「箱贴：待派发/已打印/打印失败」并在完成打包按钮上方常驻告警（列出待处理箱与出路：重新入队打印、ERP「条码打印查询 → 出库条码」重打、启动绑定打印机的桌面端）。「箱贴未打印成功不得进入待出库」是**服务端强制规则，不放开**；放开的是「看不见原因」。调拨调出页同理显示「剩余可调量」，因为整容器调拨要求容器数量不超过剩余计划量。
- **PDA 列表必须即时刷新**：拣货「商品列表/订单列表」的刷新按钮同时刷新两个查询，拣货动作后作废两个列表缓存；收货、打包、复核、调拨、盘点、退货列表统一 `refetchOnMount: 'always'`。keep-alive 下组件常驻，不这样做就会出现「订单列表已空、商品列表仍显示待拣 0/2」或「ERP 刚派发的单据看不到」。
- **库位扫码按「编码或条码」解析**：PDA 上架/调拨调入**不得**用 `R<数字>`/`LOC-*` 前缀卡格式（历史库位编码是 `SH-A01`、`SMK-396842` 这类），统一交给 `GET /api/locations/code/:code`（后端匹配 code 或 barcode）；归属仓、状态、范围仍由服务端校验。迁移 245 回填历史库位 `barcode`（`R+6位ID`）。**盘点单不允许 0 明细**：创建时取不到在库商品直接报错；PDA 待盘点列表用 LEFT JOIN，历史空单也会显示并提示去 ERP 取消。
- **列表与图表的呈现约束**：`DataTable` 的最后一列操作列固定右侧（sticky，宽表横向滚动时仍然可见）；分布类图表（各仓库存价值分布、账户余额分布）统一 `TOP_SERIES_LIMIT = 8` + 「其他 N 个」，不得按主数据条数全量成系列；图表小组件用 `ChartWidgetShell` 只在可见标签内挂载（避免在 `display:none` 容器里报 width(-1) 并渲染空图），文字/交互型小组件仍用 `WidgetShell` 以保留本地状态。操作日志列表的「操作内容」按业务接口映射成「模块 · 动作」，未映射的显示方法 + 路径，不允许整列都是「系统接口访问」。`AppToast` 对 5 秒内同类型同文案去重。
- **列表页不再常驻展示日期筛选提示条**（2026-09-16）：主列表页的日期筛选与销售、采购一致——只在查询弹窗中查看（弹窗初始值即当前生效范围），页面上只保留可逐项移除的筛选 chips；已删除退货单（销售退货）与物流运单两处历史遗留的「创建日期：X 至 Y」横条，后者取代 `docs/sales-group-ui-2026-09-05.md` 中"明确日期"的展示约定。列表计数统一用 `ListSummary`（表格下方）；物流运单沿用其"当前显示数量"口径（自动取齐上限 500，不代表业务总量）。
- **查询弹窗「重置」＝回到该页面的默认窗口**（2026-09-17）：各 `*QueryDialog` 新增可选 `resetValues`，重置把日期恢复成该页面的默认口径（单据类与操作日志/库存流水 = 最近 7 天、物流运单 = 当天、退款单/处置/放行/采购申请 = 不限），不再一律跳成"今天起"。页面要传与自身 `effectiveStartDate/EndDate` 兜底一致的值（如 `resetValues={{ startDate: defaultRange.start, endDate: defaultRange.end }}`），**新增列表页时两处必须同步**，否则「重置」和「打开弹窗看到的范围」会对不上。`PaymentQueryDialog` 早已用 `clearValue` 表达同一语义（账款页默认跨日期看未结清），沿用不改。

## 10. 打印、部署与运维

- 标签队列只接受 ZPL；单据走浏览器打印/导出。入队复用 `enqueue*LabelJob` / reprint 入口、job_unique_key 与活跃期唯一约束。
- 打印记录页与补打口径（2026-09-14 用户规则）：**补打只有一个入口——打印记录页**，其它页面（含收货/销售订单详情）不得提供补打；订单类页面只用于看进度，**销售订单不显示条码打印**（出货侧不打条码），**收货订单只保留任务进度、不展示打印记录**。记录页只列**唯一码**：入库/出库分别要求容器/箱贴最近一条 `print_jobs` 存在，且入库额外排除 `source_ref_type='plastic_box_create'`（可复用空盒即使打过标签也不进，直接调接口返回 `PRINT_BARCODE_NOT_UNIQUE`，请在塑料盒页新增的「打印条码」`POST /api/plastic-boxes/:id/print-label` 重复打印——那是重复打印不是补打）；物流取自 `print_jobs`；货架/库位标签本就不在取数范围，各页有自己的打印入口。**注意两个 `B` 码不同**：拆分散货（`container_split` / `sale_order_adjustment_return`）每次新建、指向唯一一批货，照常记录；只有空盒是复用码。无可用打印机时也要留记录（用户选方案 A）：容器标签/箱贴/面单落一条 `printer_id=NULL`、状态失败、`no printer available` 的记录，迁移 `242_print_jobs_allow_no_printer.sql` 允许 printer_id 为空；对象因此可见可补打，物理打印不受影响（claim 按 printer_id 过滤，NULL 行不会被领取）；返回值带 `unprintable`，收货/拆分的 `noPrinterCount` 与提示文案据此区分「已排到打印机」与「只留了记录」，回执统一引导到「打印记录」页补打。另修：出库计数查询把最新任务子查询别名写成 `j` 而状态条件按 `pj` 拼，一带状态筛选就报 `Unknown column 'pj.status'`，已统一为 `pj`。回归见 `tests/print-queue.smoke.test.js`；细节与未做项见 `docs/barcode-reprint-scope-2026-09-14.md`。
- 打印成功/失败回执均须携带本次 `ackToken`，以 PRINTING + 令牌 CAS 更新；缺令牌返回 400、旧令牌返回 409。旧客户端不能再无令牌上报失败，应同步更新桌面消费者；状态不明保留超时人工确认，不自动重打。领取查询与 CAS 都排除过期任务。
- 面单只使用明确的 waybill 用途绑定，缺绑定不入队；普通标签最后兜底及环境指定设备仍限目标仓或全局设备。显式用途绑定沿用已有契约。
- 重复入队命中活跃任务时，接口返回原队列内容快照，不返回新模板重绘结果。入队 copies 必须为 1–100 的数字整数，缺省为 1；桌面将多份内容组装为一次 RAW 提交。单份保留原始模板，模板含 ^PQ 时拒绝再叠加任务多份，避免数量相乘；提交后核销失败只重试回执。
- ZPL 业务字段统一清洗 ^/~ 和控制字符，可信模板正文保留；变量仅单次回调替换，不递归展开。条码保留合法首尾空格。画布标签及内置兜底统一由后端随包中文字体生成黑白点阵，PNG 预览与 ZPL ^GFA 使用相同像素；模板 layout.dpi 支持 203/300，旧模板默认 203，^PW/^LL 按该 DPI 输出。条码使用整数点模块宽及静区，HRI 计入元素高度，非法/太小/越界须报错。手写 ZPL 与历史任务快照保留原处理规则。实现与验收范围见 `docs/label-raster-2026-09-11.md`；库存退货标签入队回归从实际 ^GFA 点阵独立解码条码，不能再检查 ZPL 明文包含条码；真实走纸仍需设备验收。
- `smoke:print-queue` 必须在第 3 节独立测试库运行，覆盖回执、过期、并发、路由、份数及事务回滚；模拟 RAW 不等于真机验收。2026-09-09 七项修复及修复前证据见 `docs/label-print-audit-2026-09-09.md`。
- 桌面客户端拉取打印任务，按打印机绑定、client_id 和心跳派发，与登录账号无关；保留 claim 行锁/CAS、ack_token、超时回收。
- HTML 单据模板 image 与 ZPL 标签分开；编辑器预览与打印渲染、旧 layout_json 默认值保持一致。
- 条码标签 type 5–10 支持按需拖入商品身份、仓库、库位、批次/日期及对应货架/箱子信息，原默认布局不变。真实预览与打印共享取值；缺字段留空，容器取数复用调用事务，保存不固化样例业务值。字段清单与取值口径见 `docs/label-optional-fields-2026-09-09.md`。
- 打印模板新建/编辑默认用对应类型最新可查看业务记录辅助排版与预览；取数同时要求模板查看与原业务查看权限，沿用仓库范围。无记录/无权限保留当前空白或既有占位，网络错误明确提示并可重试；真实记录缺字段不混入示例值。初始空画布有记录时提供可撤销的默认字段排版，不覆盖已有布局或后续编辑；保存仅包含字段与几何，不包含样例业务值。空数据回归使用本测试新建仓库范围，不假设共享测试库全局为空；全局打印类型绑定夹具须保存并完整恢复原记录，不重复插入已有唯一键。取数只读、不入队，类型/登录会话隔离，隐藏页不新取数。接口、类型映射与验证见 `docs/print-template-real-preview-2026-09-09.md`。
- `main` 是发布来源，push main 触发检查与部署；浏览器、桌面发布前必须等待**实际待发布 SHA** 的 Tests 与 Security Scan 成功，旧 SHA/失败/取消/超时不放行。桌面手动 checkout_ref 也用实际 git HEAD，版本输入必须匹配其 package。PDA 还需同 SHA 浏览器部署成功；仅推 main 不等于桌面发版。
- **部署类 workflow 并发会抢锁超时**（2026-09-16 v0.9.17 发布时遇到）：push main 触发的 `Deploy Browser App` / `Build PDA APK` 与打 tag 触发的 `Build Desktop Installer` 会**同时** SSH 到服务器竞争 `/tmp/flowcube-deploy.lock`——各 workflow 内 `flock -w 300` 只等 5 分钟，外层 timeout 在 10 分钟强杀，表现为 `##[error]Process completed with exit code 124`；先拿到锁的完成，后到的失败（本次桌面成功、浏览器与 PDA 失败，线上服务不受影响）。**根因与已解决（同日）**：三个 workflow 的 `concurrency` group 名各不相同——`deploy-browser` 用 `deploy-production`、`build-desktop` 干脆没有、`build-pda-apk` 用 `build-pda`，**不同 group 等于互不排队**，于是同时抢服务器锁。现统一为 `concurrency: { group: flowcube-server-deploy, cancel-in-progress: false }`，GitHub 侧先排队，从源头避免同时抢锁；`build-pda-apk` 的 `cancel-in-progress` 也由 `true` 改为 `false`（取消进行中的部署会留下半成品；排队多跑一次是幂等的，每次部署都是"reset 到指定 commit"，最终状态由最后完成的那次决定）。服务器端 `flock` 保留为兜底。**发版仍建议串行节奏**：等浏览器部署成功后再打 tag；万一失败，用 `gh run rerun <run-id> --failed` **逐个**重跑（不要同时重跑多个）。结果记录见 `docs/release-v0.9.17-result.md`。**同日补充修复两个副作用**：① `build-desktop` 在 push main 时只做**验证构建**（本文件所有 SSH/发布步骤都带 `if: github.ref_type == 'tag'`，根本不碰服务器），却与 deploy-browser / build-pda-apk 共用同一个部署 group——既把真正的部署挤进 pending 排队，又因 GitHub「同一 group 内后到的 pending 会取消先前的 pending」的语义，在三者同时触发时取消掉其中之一（v0.9.17 发布时 Build PDA APK 就是这样被取消的）。现按**事件**分 group：tag / 手动触发走 `flowcube-server-deploy`，push main 走独立的 `build-desktop-ci`，互不干扰。② `scripts/server-update.sh` 里 `docker load` 的时限由 600 秒放宽到 **1800 秒**：首次加载一个新镜像要解压全部层，在慢盘上会超过 10 分钟被 `bounded` 强杀（exit code 124，日志停在「加载并验证 CI 应用镜像」之后且无任何 docker 输出）——这正是 v0.9.17 首次部署失败的原因，重跑时镜像层已存在所以只要 9 秒。**改这两个文件后都验证过**：桌面构建与浏览器部署可同时运行、部署正常完成。
- 发版必须读取 `release-flowcube` 技能。同步三端 package/lock、PDA versionName/versionCode 与 `backend/apk/version.json`；同版本重跑不应虚增版本号或发布时间。脚本用实际存在路径，不照搬旧 `.Codex/skills` 路径。
- **发版收尾的三个实测坑与已落地的加固（2026-09-18 v0.9.20）**：① `Build PDA APK` 的 push 触发带路径过滤（`frontend/**`、`backend/apk/version.json` 等），**只动测试/文档的后续提交不会触发 PDA 构建**，且首次提交的 PDA 构建若因该 SHA 浏览器部署失败而失败，最终发布 SHA 上就没有 PDA 产物（v0.9.19 就是这样把生产 PDA 停在 0.9.18/126 的，全链路没有一处会报错）。加固：工作流新增 `checkout_ref` 输入并以**实际检出的提交**为后续「等浏览器部署 / 服务器 HEAD 校验」的基准；`wait-release-checks` 对「该提交根本没有运行」在约 5 分钟内快速失败并提示指定发布提交，不再空等 30 分钟。补跑：`gh workflow run build-pda-apk.yml --ref main -f checkout_ref=<已部署的发布提交 SHA>`。② `Build Desktop Installer` 的「Upload EXE to Release」在 Windows runner 上会长时间挂起：根因是 GitHub 附件存储间歇性返回 `HTTP 500 Error saving asset`（本地用新版脚本复现：连续两次 500、第三次成功），而 `gh release upload` 不超时、不重试、不校验，中断还会留下**没有附件的草稿 Release**。加固：该步骤改用 `scripts/publish-release-asset.cjs`（直连 REST API：确保 Release 存在 → 删同名 → 默认 5 次尝试、每次 10 分钟超时、失败 10 秒后重试 → 校验远端大小 → 最后才 `draft=false` + latest）。③ PDA 工作流新增 `preflight` 前置门：**构建前**先校验 `backend/apk/version.json` 与 `build.gradle` 一致（v0.9.19 的 PDA 失败就是清单滞后，白构建 4 分钟才报），再比对线上 `/api/pda/version`——**目标版本（版本号 + versionCode）已发布时整条构建跳过**。原因是 `publish-pda.sh` 拒绝「同一 versionCode 换成不同字节的安装包」（客户端也不会因此更新），发版后再动 `frontend/**` 或 PDA 工作流会触发构建并在发布步骤变红；跳过比"白跑 4 分钟再失败"更准确，需要新包必须提升版本号。**发版后必须跑 `npm run release:verify -- --origin https://<生产域名>`**：逐项核对 `/latest.json`、`/api/app-update/latest`、`/api/pda/version`（版本 + versionCode + 可下载）与 `/api/health`，PDA 落后即视为发版未完成。仍**禁止在本机重新构建或复制本机产物**，补传一律用服务器 `/versions/v<版本>/` 的 CI 构建包（先复算 sha256）。回归：`npm run test:release-tooling`（离线，已进 Tests CI）；真实 API 与线上核对记录见 `docs/release-v0.9.20-result.md`。
- 桌面图标在 `desktop/build/`；Windows 保持 `signAndEditExecutable: true` 写入图标和元信息，并用 `signExecutable: false` 保持当前不签名策略，不能以关闭资源编辑代替关闭签名。Windows CI 打包后执行 `scripts/verify-desktop-icon.cjs` 校验实际 PE 内嵌图标摘要。
- 生产安装包由 Windows CI 构建；迁移由 `scripts/server-update.sh` 部署链执行。不能直接改服务器代码，不能默认跳过发布门禁。
- Docker 构建上下文由根 `.dockerignore` 排除真实环境/密钥、本机依赖、历史安装包、日志和工具目录；运行配置从部署环境注入。新增构建依赖需确认未误排除，不能为构建成功把真实 .env 或 node_modules 加回上下文。
- GitHub runner 构建带 SHA 标签与 OCI revision 的 Linux amd64 镜像，通过 SSH 传输归档；生产禁止重新编译。部署在同一锁内固定 SHA、保存运行镜像 ID，检查空间与归档 SHA-256、加载并核对镜像 revision、等待 MySQL 健康、一次性容器迁移，再切换应用。迁移前失败或已兼容数据库的健康/门禁失败恢复旧应用镜像并检查健康；迁移开始但未完整成功时保持后端停写。首次应用 240 记账契约、实际旧镜像缺少 `io.flowcube.party-ledger-contract=1` 标签，或停写后兼容性尚未核实时，失败保持停写；重试也不能恢复不传单位 ID 的旧后端，须核实迁移并启动兼容新后端。数据库 DDL 不自动回滚，首次部署无旧版本、回退或权限恢复失败均明确报告。部署门禁低磁盘时禁止清除回退镜像，直接失败。人工脚本入口要求显式 EXPECTED_COMMIT 并查询 GitHub 同 SHA 检查，推荐通过 workflow_dispatch 执行。
- 发布辅助负载边界：Docker 请求由 `scripts/lib/runtime-guards.sh` 设时限；处于 CI 总时限内时共享信号范围，保证清理/回退可执行，宽限为 600 秒；页面验收顺序执行，每次 1 CPU / 1 GiB（不额外交换）/ 256 进程，容器内 14 分钟，超时/中断清理本次容器，按数据库兼容边界回退应用或保持停写。浏览器镜像须预装，部署前检查存在且 `--pull never`；磁盘不足直接失败，禁止门禁自动 prune。监控用独占锁拒绝重叠，Docker 5 秒、TLS 10 秒，失败必须记为异常。详见 `docs/DEPLOY.md` 和 `tests/deployment-resources.test.js`。这些改动已随 v0.9.3 于 2026-09-05 正式部署；候选 89 项部署/运维/CORS/客户端回归通过，同 SHA 的 Tests、Security 与实际生产页面/对账门禁均成功。实际容器资源限制、镜像提交号、线上清单与发布结果见 `docs/release-v0.9.3-result.md`。
- 生产权限验收账号（2026-09-09 用户明确长期保留）：`smoke_limited`（ID 8）恢复启用，仅保留 dashboard.view / inbound.order.view 两项权限，发布完成后不删除。口令已轮换为随机值，原会话撤销；发布脚本通过 `SMOKE_LIMITED_USERNAME` / `SMOKE_LIMITED_PASSWORD` 安全配置读取，不再内置固定口令，也不自动恢复其他已删除账号或跳过权限验证。GitHub Secrets 在部署时注入门禁容器，缺少任一配置立即失败。该长期授权替代 v0.9.10 的一次性恢复约定，见 `docs/release-v0.9.13-result.md`。
- 桌面更新清单由 `scripts/release-desktop.js` 写入 `/var/www/flowcube-downloads/latest.json`；`backend/downloads/` 已废弃。
- 桌面更新使用可信 HTTPS 清单，由主进程重新取清单并绑定 version、URL、sha256；下载后及启动安装前均验摘要。无摘要不能自动安装，系统证书校验失败默认拒绝；取消按 IP/域名放行任意证书的旧行为。根组件消费更新事件，preload 保留订阅前待通知结果并支持清理监听。
- PDA 已发布状态由不入 Git 的 `backend/apk/published-version.json` 指向唯一 APK；CI 先落安装包再原子替换清单。`backend/apk/version.json` 是构建目标/旧部署兼容清单，不能让浏览器 git reset 把未发布 APK 的版本提前对外公布。PDA 发布只更新挂载产物，不重置 Git 或重建后端；部署回退时将 version.json 原子恢复为已发布清单，兼容不识别 published-version.json 的旧镜像。
- 审计目录中的原始`.log`保留工具输出字节与摘要，`.gitattributes`仅对这两轮归档日志关闭源码空白检查；业务源码、配置和Markdown继续检查空白。
- Gitleaks 审计证据误报只允许豁免经核实的固定非认证值，不能排除整个证据目录；当前四个测试调拨幂等键及一份源码SHA256采用精确匹配，原因写在`.gitleaks.toml`。
- 依赖审计安装/网络/JSON 错误必须失败，不能视为零漏洞；扫描完整依赖树，直接和传递依赖的所有 high/critical 均阻断，不能用 omit=dev 排除 Electron 分发运行时。v0.9.14 起上传依赖 multer 最低为 2.3.0，前端工具链 js-yaml 4.x 锁定安全补丁 4.3.2；上传与 Logo 接口只接收单文件、拒绝未使用的 multipart 文本字段，数量超限返回 HTTP 400（`test:upload` 离线回归并纳入 Tests CI），升级后仍扫描完整依赖树。当前 HashRouter 使用 React Router 7；后端 qs 安全补丁由 overrides 固定最低修复版，移除覆盖前重新审计上游依赖范围。
- 运维容器解析复用 `scripts/lib/ops-common.sh` 的 `resolve_container()`，不硬编码 Docker 容器名。备份先写临时文件、验证后落正式文件；失败清残留并告警。
- 恢复演练默认总时限900秒、768m内存、1 CPU、256进程，禁网络与额外swap；正常、超时或TERM退出清理自有容器及匿名卷，外层exec GNU timeout保证信号传递。新鲜度按备份文件修改时间判断，自动演练默认拒绝超过 48 小时的文件（`BACKUP_MAX_AGE_HOURS`）；显式指定历史备份只检查恢复能力并提示过期。没有新销售单不能判定备份损坏。MySQL 连接数探针在容器内认证，查询失败或无效值必须记录异常，不得回退为零；隔离回归见 `tests/ops-monitor-restore.test.js`。
- 备份可恢复性口径（2026-09-14 事故后）：mysqldump 可能把触发器函数体残留的结尾分号导出成 `... ); */;;`，直接导入会 1064。`scripts/restore-check.sh` 导入前只把该分号移出可执行注释（不改写备份文件），并透出 MySQL 真实报错以区分「文件损坏」与「导入语法问题」；`docs/runbooks/failure-recovery.md` 的手工恢复用同一口径。备份是否可恢复以完整导入临时 MySQL 为准，不能只看文件存在或 `gzip -t`。隔离回归见 `tests/restore-trigger-normalize.test.js`。
- 库存漂移巡检只报警，不自动修库存缓存掩盖根因。调度器与服务器 cron 是不同机制，改动时检查 scheduler、install-cron 和部署同步链路。
- 故障处理先读 `docs/runbooks/failure-recovery.md`，确认现场与备份后执行已授权操作；测试与生产严格区分。
- CORS 规则集中在 `backend/src/config/cors.js`：`CORS_ORIGIN` 支持逗号分隔的精确来源，Electron 的字符串 `null` 由 `CORS_ALLOW_NULL_ORIGIN` 单独控制；内置 Android PDA 当前源码默认来源为 `https://localhost`。不要为兼容客户端而打开任意来源反射。v0.9.3 新后端已部署，当前生产保留既有反射兼容配置，须完成实际客户端验证后再收窄来源；测试见 `tests/cors-policy.test.js`，部署说明见 `docs/DEPLOY.md`。
- 2026-09-04～05 生产环境核查与恢复见 `docs/production-environment-check-2026-09-04.md`：用户授权普通重启后，9 月 5 日 00:12 网站/SSH 恢复。已完成现有 50 GiB 云盘的系统分区扩展（使用率约 66%）、.env 0600、SSH 密钥登录、宿主 Node 22.23.2，以及停用仅支持单队列网卡上不适用的 ecs_mq 优化；配置/数据库/分区表已备份至服务器和 Mac。生产 MySQL 实测 8.0.45，135 表，232 份 SQL 无缺失，另有 1 条历史迁移记录。备份误报、连接数探针和 CORS 配置能力修复已随 v0.9.3 部署（CORS 实际来源配置未收窄）；自动异地备份目的地尚未配置。云盘读写受限已由云平台确认，具体占用进程根因仍不明，避免重跑无时限的整盘 Docker 统计。

## 11. 历史记录与发布结果（不在本文件维护）

本文件只写**项目现状与现行规则**；过程记录、审计清单、发布结果、验证数字一律放 `docs/`。索引里的「已修复／已部署／待核实」只代表当时状态，用前按现行代码与配置核对。

| 主题 | 位置 |
|---|---|
| 迁移前历史（编号未变） | `docs/claude-md-archive-2026-09-04.md` |
| 抽出的日记全文（原 §11–§18） | `docs/agents-md-archive-2026-09-18.md` |
| 2026-09-18 深审计 | `docs/audit-2026-09-18.md`、`output/audit-2026-09-18/findings/*.json` |
| 2026-09-04 系统审计 | `docs/system-audit-2026-09-04.md`、`docs/system-audit-fixes-2026-09-04.md`、`docs/audit-fix-inventory-2026-09-04.md`、`docs/audit-fix-finance-2026-09-04.md`、`docs/audit-fix-client-2026-09-04.md` |
| 2026-09-05 上线前两轮审计 | `docs/prelaunch-deep-audit-2026-09-05.md`、`docs/prelaunch-fixes-2026-09-05.md`、`docs/prelaunch-second-audit-2026-09-05.md`、`docs/audit-round2-2026-09-05/` |
| 发布说明与结果 | `docs/release-notes/*.md`、`docs/release-v0.9.*-result.md` |
| 本机环境与本地库切换 | `docs/local-tooling-2026-09-04.md`、`docs/local-mysql8-cutover-2026-09-04.md` |

### 11.1 防呆清单：审计沉淀下来的硬约束

历次审计沉淀的**现行约束**，只写"现在必须怎么做"、不写发现过程。改动涉及这些文件时逐条对照。
- **撤回收货拒绝在途调拨容器**：`transfer_order_id` 非空即 409（`inbound-tasks.void.js`）
- **盘点扫码账面查询必须带 `locked_by_task_id IS NULL`**；action 用 `stockcheck.scan.<盘点单ID>` + 幂等回执（`stockcheck.service.js`、`frontend/src/pages/pda/stockcheck.tsx`、`stockcheck.tsx`）
- **行已有预占时禁止更换发货仓库**：400 `RESERVE_WAREHOUSE_CHANGE_NOT_ALLOWED`（`sale.service.js`）
- **销售收入凭证按已发原值占比净额化折扣、税额夹到折后净额**；退货冲回成本用 `COALESCE(soi.cost_snapshot,0)` 且去掉 `product_items` JOIN，成本/售价兜底留给 `reports.query.js`（`voucher-engine.js`、`reports.query.js`）
- **采购结算毛额子查询必须按 `(order_id, product_id)` 关联并先跑来源断言**，脏单抛 `INBOUND_PURCHASE_SOURCE_INVALID`/`PURCHASE_LEGACY_RECEIPT_UNRECONCILED`（`voucher-engine.js`）
- **移库/拆分必须 `assertInScope`**（移库还须目标库位同仓）；`resync-stock` 是写操作，用 `inventory.adjust`（`inventory.controller.js`、`inventory.service.js`）
- **仓库范围写路由必须行锁、禁止自我提权**：`USER_SCOPE_SELF_FORBIDDEN`（`PUT /users/:id/warehouse-scope`）
- **范围校验覆盖读写路径**：`scan-logs` 四条写路径、`POST /admin/putaway`、`findMyTasks`/`findMyTaskSkuSummary`/`getTaskStats`（空范围返回空）
- **范围校验还必须覆盖** `GET /products/finder`、`GET /containers/overdue`、`GET /returns/{purchase,sale}/source-order`（明细逐行校验发货仓）、`GET /approvals/biz/:bizType/:bizId`（`BIZ_DOC_META`+`sys_role_permissions`，未知 400）、`print-jobs` 列表与条码补打
- **`print-jobs` 三张条码子查询分别用 `c.`/`wt.`/`j.warehouse_id`**；SQL 文本替换必须带足上下文并真跑三种范围
- **`complete-local` 同 `complete-client`/`fail-client` 做工作站校验**；写路由必须 `requirePermission`（`fulfillment.routes.js`）
- **新增不变量必须落 CI 契约测试并接进 `package.json` 与 `.github/workflows/test.yml`**（`docs/audit-2026-09-18.md`）
- **`updateInvoice` 的 `assertInvoiceQuota` 必须传同一事务 `conn`**
- **销售退货可退量按 `wt.warehouse_id = COALESCE(soi.warehouse_id, 销售单头仓)` 关联**（`returns-sale.service.js`）
- **先 `lockStockDimension` 再锁容器**：`splitContainer` 与 `confirmContainerReturn` 都按此序（`warehouse-tasks.adjust.js`）
- **月结对账导出透传全部筛选并取 `EXPORT_MAX_ROWS`、超限即拒**；年结排除自身凭证（`export.service.js`）
- **占库期与执行期改单共用 `assertNoDuplicateSaleItemLines`**（在 `hydrateSaleInput` 之后）；改单挂起期间拣货/复核扫码补 `adjustment_requested_at` 并 409（措辞同 `check.js`）
- **采购退货出库按 `pri.id = wti.purchase_return_item_id` 关联**，仅商品在本单内唯一才回退 `product_id`，否则 `PURCHASE_RETURN_ITEM_LINK_MISSING`（`warehouse-tasks.ship.js`、`247_warehouse_task_item_purchase_return_link.sql`）
- **对账单 `findAll`/`findById` 共用金额整形、状态推导与 `refreshSettlement`**
- **标签渲染失败不得回滚业务事务**（降级 `status=3` unprintable + `label render failed: <CODE>`）
- **承运商 mock 需 `ALLOW_MOCK_CARRIER=1` 且非 production**，否则 `CARRIER_MOCK_NOT_ALLOWED`；管理页写月结/取号字段即 400 `CARRIER_ACCOUNT_FIELDS_MOVED`，闸门共用 `carriers.guards.js`（`carriers.service.js`）
- **共享夹具必须自洁**：`prepareSmokeContext` 把 Smoke 客户 `credit_limit` 置 NULL；`tests/round2-transfer.smoke.test.js` 的 `after()` 清理本轮角色/权限/用户/设备（`tests/helpers/smokeTestKit.js`）
- **处置单 `approve`/`reject` 必须走 `assertNotSelfApproval`**（`tests/disposal.smoke.test.js`）
- **`dingtalk_send` 未配置→WARN 2，curl 失败/非 2xx/`errcode!=0`→ERROR 1**；键名必须 `DINGTALK_WEBHOOK`（`restore-check.sh`、`server-update.sh`、`tests/ops-monitor-restore.test.js`）
- **软删主数据活跃唯一性用生成列 `active_unique_guard`**；`252_*` 遇重复活跃编码 fail-loud，`codeGenerator.js` 取号进事务+撞号换号（`248_generated_active_unique_guards.sql`、`252_product_supplier_active_code_uniques.sql`）
- **已执行迁移的漂移只能新增条件式迁移订正**（仅当值仍是已知错误值）（`249_fix_default_label_paper_size_drift.sql`）
- **新增迁移必须幂等、编号最大+1，不得改已执行迁移或删字段**（含 `245_backfill_location_barcode.sql`）；索引/外键用幂等 DDL 单独补（`250_payment_entries_record_id_index.sql`、`251_payment_entries_record_fk.sql`）；只按 `print_type` 的全局唯一索引用幂等 DDL 删除（`246_drop_stray_printer_bindings_print_type_unique.sql`）
- **迁移逐条执行、触发器函数体不得残留结尾分号**；`test:print-purge` 是**数据库测试**（`tests/print-jobs-purge.test.js` import `helpers/smokeTestKit`，要 `NODE_ENV=test` + 第 3 节独立测试库），同时必须给可写 `APP_UPDATE_DOWNLOADS_DIR`——**别把它当纯离线测试跑**（2026-09-18 实测：只设 downloads 目录会在 `testEnvironment` 处报「必须设置 NODE_ENV=test」）
- **schema 对账必须查 `information_schema` 按名字+列序比对且在生产库核对**（`CREATE TABLE IF NOT EXISTS` 后补索引/外键静默失效）（`schema-reconcile.js`）
- **PDA 设备改绑仓库/停用必须单事务**：行锁判换仓、`revokeSessions(..., conn)`，非 active 无条件吊销（`middleware/pdaSession.js`）
- **源码文本契约测试先去注释**；锁顺序按「上一个 `FOR UPDATE` 之后」归属，`INSERT` 列数必须与 `?` 一致（`tests/inventory-lock-order-contract.test.js`、`tests/sql-placeholder-contract.test.js`）
- **状态文案只能取 `generated/status.ts`**；`WT_ON_ENTER/EXIT_ACTIONS` 是纯文档清单（`frontend/src/pages/sale/index.tsx`、`SaleQueryDialog.tsx`、`tests/status-rules-integrity.test.js`）
- **`printers.service.update` 的 `status` 只允许 0/1（路由+service 双重）**，写语句同事务行锁，缺失字段沿用现值
- **资源级幂等 action 必须绑定单据 ID**（`action.<resourceId>`，旧固定 action 只在 SUCCESS 且资源一致时回放）；创建类用载荷指纹；回执查询剥尾部 `.<ID>` 取 base；调拨必须是 `transfer.scanOut.<id>`/`transfer.scanIn.<id>`（`utils/operationRequest.js`、`transfer.service.js`）
- **`track_status` 含义只在 `logistics.service.js` 定义一处、导出列名「签收状态」**；运费账单匹配用 `tracking_no = ? OR JSON_CONTAINS(tracking_numbers, JSON_QUOTE(?))`，写入方 `logistics.direct.js`（`logistics.worker.js`、`logistics.freight.js`）
- **轮询页面不得写死小 `pageSize` 又高频轮询**（`refetchInterval` ≥ 5 秒，分页批量 ≥ 100），并计入 `backend/src/app.js` 的全局 IP 限流（1000 次/60 秒）
- **前端登出必须走 `lib/authSession.performSessionLogout()`**，仅 `lib/authSession.ts`、`store/authStore.ts` 可封装（`pages/pda/index.tsx`）；错误码文案不得按后缀启发式映射（`docs/acceptance-issues-fix-2026-09-17.md`）
- **发版三端+PDA 版本同步、写本版说明并打 tag**；`latest.json` 与 current 指针只由 `release-desktop.js` 写（`docs/release-notes/0.9.22.md`）
- **前端容器必须删 `/docker-entrypoint.d/10-listen-on-ipv6-by-default.sh`**（`10-listen-on-ipv6-by-default.sh`）
- **回退/还原逐个写全路径、不得 `||` 兜底猜路径**，改完立即 `git status --short`
- **改共用函数或路由契约后跑全量套件**（调用点补 `X-Client-Id`）；本机单测 Node 26 假失败用 `NODE_OPTIONS='--localstorage-file=/tmp/fc-ls.json'` 复现（`src/components/shared/FulfillmentTodos.test.tsx`）
