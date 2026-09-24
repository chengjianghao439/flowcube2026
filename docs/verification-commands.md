# 开发与验证命令（全量）

> **来源**：本文件由 `AGENTS.md` 的 §3 迁出（2026-09-19 文档体系重构，原文见 `docs/agents-md-archive-2026-09-19.md`），内容为无损搬运。
> **何时必须读**：要跑某个具体 smoke/test 回归、确认某项检查需要哪些环境变量、或判断某个改动该跑哪些套件时。
> **常驻速查**：`AGENTS.md` §3 只留验证执行时机、「按改动影响选命令」的表格与 DB 测试环境要求；细节一律看本文件。

执行时机按 `AGENTS.md` §3：连续开发期间记录各项改动的待验证范围，发版前在最终代码上集中运行受影响端的构建、专项和全量回归。调试故障或即时验收可提前做必要的最小验证；验证后若继续修改，只补跑受影响检查。未运行的项目标记为待发版前验证。

---


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

`test:permissions` 同时运行权限码一致性、岗位角色预置授权边界、用户自助接口的身份绑定回归（“我的信息”和“我的仓库权限”只能读取当前登录者），以及部门负责人启用校验与审批流引用删除护栏。

按改动影响选择验证：

| 影响 | 相关命令 |
|---|---|
| 库存、状态、并发主链路 | `npm run smoke:mainline`、`npm run smoke:concurrency-guards`、`npm run smoke:p0-regression`、`npm run smoke:p1-regression`、`npm run smoke:fulfillment-credit`、`npm run test:integration` |
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

`npm run smoke:sorting-bin-recovery` 在独立测试库用真实 HTTP 与 MySQL 验证主管补分配：权限/仓库范围、任务状态与挂起守卫、同键重放、无空格、强制释放及两个任务争同一空格的双向绑定；fixture 只按本次 ID 清理。见 `docs/warehouse-masterdata-regression-2026-09-13.md` 的 2026-09-24 补充记录。

`npm run smoke:masterdata` 验证客户、供应商、部门和分类的真实 HTTP 管理接口、权限、引用保护与层级边界，使用本节独立测试环境，已接入 Tests CI 专项矩阵。夹具按本次ID清理，不全表删除，不重置共享编码序列。部门更新沿父链验证有效父级，省略 `managerId` 保留负责人，显式 `null` 清空；不能把局部字段更新当作负责人清空。细节见 `docs/masterdata-regression-2026-09-12.md`。

运行涉及数据库的测试前确认连接目标与测试数据清理行为，**不得连接生产库跑测试**。公共 `tests/helpers/testEnvironment.js` 要求 `NODE_ENV=test`、显式回环 `DB_HOST`、合法 `DB_PORT`、`DB_USER`/`DB_PASSWORD`、`flowcube_test` 或 `flowcube_<用途>_test` 库名；测试不再加载真实 `backend/.env`。可用 `FLOWCUBE_TEST_ENV_FILE=/绝对路径/.env.test` 显式加载测试专用配置，命令行环境优先，配置错误及迁移失败立即终止。新数据库测试必须复用此校验。**本机实操（2026-09-17 验证）**：测试库凭据在 `~/.config/flowcube/operations20260912-test.env`，文件名不是 `.env.test` 因而走不了 `FLOWCUBE_TEST_ENV_FILE`，改为 `set -a; source ~/.config/flowcube/operations20260912-test.env; set +a` 注入；还必须 `export APP_UPDATE_DOWNLOADS_DIR=/tmp/<可写目录>`，否则 `backend/src/app.js` 启动时就因默认 `/var/www/flowcube-downloads` 无写权限抛 EACCES——**这个报错与业务代码无关，别当成回归失败**。本机 Node 为 v26，前端单测因此有 9 个文件 56 个用例失败（`localStorage is not available`），属既有环境问题；对照基线时不看绝对数，看是否新增失败。没有运行或环境不具备时明确说明；不能据此声称全部通过。纯文档修改核对内容、路径和 diff 即可，不必启动数据库或全量业务回归。

本轮修复回归入口：`npm run smoke:prelaunch-finance`、`smoke:prelaunch-scope-export`、`smoke:prelaunch-hr` 与 `test:prelaunch-runtime`；数据库仍必须使用第 3 节独立测试环境。

第二轮新增 `smoke:round2-transfer`、`smoke:round2-payroll`、`smoke:round2-runtime` 与 `test:round2-runtime`；前三者必须显式测试环境。历史审计 probe 断言缺陷存在，只是修复前证据，不能当作现行正确行为门禁。

正式 Tests CI 的独立数据库专项矩阵包含两轮审计 finance、scope-export、hr、round2-transfer、round2-payroll、round2-runtime，每项先迁移专用测试库；static job 同时执行第二轮运行时/恢复/错误追踪回归。

审计回归入口：`npm run smoke:audit-inventory`、`npm run smoke:audit-finance-security`、`npm run test:audit-client`、`npm run test:audit-tooling`。2026-09-17 验收修复守卫 `npm run test:acceptance-fixes`（请求体解析错误码、废弃设置键、取消单明细投影、审计脚本覆盖、迁移存在性）为纯离线断言，已接入 Tests CI static job。标签镜像检查使用前端已安装的 TypeScript 在 Node 22 编译并运行，`test:label` 需要前端依赖，不再按 Node 版本跳过；CI 在安装两端依赖后的 static job 执行。`npm run test:agents-md-guard`（AGENTS.md 注入守卫：禁 `CLAUDE.md` 候选、体积不超 32 KiB、关键章节与红线仍在、`docs/*.md` 与 `npm run` 脚本引用都有效）为纯离线断言，与其它机械契约测试同组执行（Tests CI 的 regression job「契约测试」段）。
`npm run test:sql-identifier`（SQL 标识符插值守卫：每个表名/列名/列清单/别名插值都要有白名单校验）同为纯离线断言，与上一条同批执行。
`npm run test:eslint-disable-rationale`（lint 禁用理由守卫：逐行 `eslint-disable-next-line`/`-line` 上方 15 行内必须有一条说明性注释；整文件 `/* eslint-disable */` 只允许出现在机器产物白名单里，生成器输出该字符串不算指令）同为纯离线断言，与上两条同批执行。
`npm run test:logger-args-order`（logger 参数顺序守卫：`logger.info/warn` 的第二个参数必须是对象，即 `(msg, meta, module_)`；只传 msg 合法，`logger.error` 因签名含 err 不参与）同为纯离线断言，与上三条同批执行。
`npm run test:pda-scan-focus`（PDA 聚焦守卫：按「这个页面要不要输入」判断——除 `login.tsx` 外的 PDA 页面不得出现 `autoFocus`，`PdaScanner` 每处 `.focus()` 必须自身带 manual 语义）同为纯离线断言，与上四条同批执行。
`npm run test:api-route-contract`（前后端路由契约：把 `app.use('/api/x')` 前缀与各 routes 文件的平铺路由拼成完整路径，比对前端 `client.<method>('<path>')` 的静态调用——参数名与查询串归一化；不一致即运行期 404，构建/lint/类型检查都不会红）同为纯离线断言，与上五条同批执行。**改路由名、改前端调用路径或新增嵌套 `router.use` 后都要跑它**（嵌套 router 需先补守卫的展开逻辑，见该文件头「已知边界」）。
`npm run test:chart-series-limit`（分布类图表系列上限守卫：`TOP_SERIES_LIMIT` 只能定义在 `frontend/src/lib/topSeries.ts`，每个 `<Pie>` 的 `data` 必须来自 `limitTopSeries(...)`，点名的两张分布卡片与「其他 N 个…」文案必须仍在，「其他」切片必须有中性色）为纯离线断言，与上面各契约测试同批执行。**改分布类图表或 `limitTopSeries` 后都要跑它**（三条反向验证：饼图退回 `data.accounts`、再抄一份常量、删掉「其他 N 个」文案，都必须失败）。
`.github/workflows/server-diagnostics.yml`（`workflow_dispatch` **只读**服务器诊断：内存/`MemAvailable`、进程 TOP RSS、容器状态与 cgroup 内存、OOM 记录、磁盘与目录占用、镜像/卷计数）是运维诊断入口——**本机出口 IP 被 sshd 限流时的唯一通道**，`tests/deployment-resources.test.js` 机械断言它不得含删除/重启/清理命令（反向验证 3 例成立）。
运维/迁移回归（static job 「运维回归」步骤）：`node --test tests/ops-monitor-restore.test.js tests/deployment-resources.test.js tests/restore-trigger-normalize.test.js tests/migration-trigger-bodies.test.js`。前两项验备份恢复判定与资源边界，后两项验触发器分号规范化与迁移逐条切分，均不连数据库。

废弃目录回归：`npm run release:check-downloads`（`backend/downloads/` 只允许 `.gitignore`/`README.md`）——`.gitignore` 挡得住普通提交、挡不住 `git add -f`，而守卫只看 git 视角，所以必须在 CI 静态 job 真跑，不连数据库。

导出格式回归：`npm run test:export`（static job 与 `test:upload` 同一步执行）——校验 xlsx 导出的日期列写成日期单元格并带 `yyyy-mm-dd` / `yyyy-mm-dd hh:mm` 数字格式（2026-09-16 起），不连数据库。


发布页面脚本回归：`npm ci --prefix scripts/browser-smoke --ignore-scripts` 安装锁定依赖，`node scripts/browser-smoke/node_modules/playwright-core/cli.js install chromium` 安装匹配浏览器，再运行 `npm run test:browser-smoke`。该测试使用真实 Chromium 和随机回环端口夹具，覆盖 ERP/PDA、受限权限、错页/渲染错误、对账重定向失败及进程退出，不连接数据库或生产。Tests CI 的独立 `browser-smoke-runtime` job 执行它；生产依赖从 CI 构建镜像复制，不运行安装命令。

发布工具离线回归：`npm run test:audit-tooling` 包含页面运行时、HTTPS 归档验证/回退和 main→PDA→桌面 tag 编排；`npm run test:release-tooling` 覆盖真实下载流的 SHA256、404、损坏包和缺摘要。工作流语法可用 `actionlint -shellcheck=''` 核对。`npm run release:verify -- --origin https://<生产域名>` 是线上只读核对，默认实际下载两种安装包，每包最多 120 秒，不启动安装程序。


数量精度回归（2026-09-22）：`npm run test:qty-precision` 包含原值/换算、逐箱、商品开关 schema 与最小权限、数量配置、拣货复核浮点边界、容器扣空/整箱归还行为测试；`test:qty-precision-coverage` 用 AST 验证实际业务入口调用，包含删除、改名和注释伪装的反向验证。`npm run smoke:qty-precision` 必须运行在已迁移的独立 MySQL 8 测试库，真实验证 `.005` 拆分不写库存、`.01` 拆分守恒、合法浮点噪声扣空，以及迁移 255 的 70 个目标列和原 SQL 重放幂等；安装包或生产数据均不参与。该 smoke 已接入 Tests 的数据库迁移后步骤。

文案守卫 `test:copy-conventions` 使用 TypeScript AST 分析字符串、模板、JSX 和 AppError，解析回归防止 `https://` 被误当注释及单双引号/续行漏扫。前端数量输入行为、详情标签和策略缓存回归进入现有 `npm --prefix frontend run test:unit`。

AST 文案和数量覆盖守卫依赖 frontend 的 TypeScript，必须在安装前端依赖之后执行；CI 放在 static job，不能移回仅安装后端依赖的 regression job。`deployment-resources.test.js` 验证依赖接线与删除安装步骤的反向失败。

### 2026-09-22 全仓审计新增回归

- `npm run smoke:audit-remediation`：独立测试库上的授信、角色、仓库授权、打印动作与 PDA 设备事务/待办/分页验证。
- `npm run smoke:accounting-sale-period`：销售实际出库期间、旧累计根、闭期冲突、人工红冲、自动修订及来源完整性。
- `npm run test:dirty-navigation`：真实 Chromium 的 file URL、延迟挂载工作区、确认/取消和重复历史遍历；需 `agent-browser@0.36.0` 与其 Chromium，命名会话由脚本 finally 关闭并验证退出。CI 安装依赖并运行。
- `npm run smoke:nginx-headers`：需要 Docker，可通过 `DOCKER_CONTEXT` 选择本机环境；使用独立命名容器，不连接业务数据库。
- `test:audit-client` 同时检查实际启动入口先初始化历史拦截器再渲染 Router，并包含移除/后移初始化的反向验证。

### 已确认审计问题回归（2026-09-23）

`npm run test:confirmed-audit` 覆盖 PDA 用户绑定、权限即时读取、条码范围、盘亏预占、扣减符号、跨仓手动出库幂等、四位金额、SSH 信任/凭据传输及采购分页快照。`npm run smoke:confirmed-audit` 在独立回环测试库验证真实事务及 HTTP 拒绝；新增两命令已接 Tests CI。相机插件 mock 测试不代表 Android 真机验收。
