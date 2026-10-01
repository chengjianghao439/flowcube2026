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

`npm run dev:mysql8` 使用本机 `colima-flowcube` context 启动 `flowcube-dev-mysql8`，监听 127.0.0.1:3307；随机凭据位于用户目录 `~/.config/flowcube/mysql8.env`（600，**已存在则原样保留、绝不覆盖**）。**该命令只启动实例，不改动任何库结构**（容器复用 + 数据卷保留）；`dev:mysql8:stop` 停容器并保留数据卷。**把结构迁移到开发库 `flowcube_dev8` 必须显式运行 `npm run dev:mysql8:migrate`**——迁移目标**硬编码为本机回环 `127.0.0.1:3307` / `flowcube_dev8`**，不受外部 `DB_*` 影响、也不接受额外库名参数；容器或环境失败即非 0 且不继续（不隐式串联）。行为由 `npm run test:mysql8-dev-script` 以 stub（colima/docker/npm）契约锁定，**不连库、不起容器**。不自动导入业务数据，也不修改 `backend/.env`。

**本机开发后端已于 2026-09-04 按用户授权切换至上述 MySQL 8.0.46**：旧 flowcube 库的 134 张表、215,843 行数据完整迁入，逐表内容摘要及结构一致，保留 233 条迁移记录（232 份 SQL 均已执行，另含历史记录）、56 个用户及原密码哈希/JWT。backend/.env 仅修改五个 DB 连接项，当前后端已重启并实测连接 3307；时区 +08:00。旧 MySQL 9.6 / 3306 和原库保留用于回退，不能继续向旧库写开发数据。电脑重启后先运行 `npm run dev:mysql8` 启动实例（若开发库结构落后，再显式运行 `npm run dev:mysql8:migrate`）再启动后端。备份、校验与回退说明见 `docs/local-mysql8-cutover-2026-09-04.md`；切换后的新写入不可被直接回退丢弃。

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
| 权限、设备与认证审计 | `npm run test:permissions`、`npm run smoke:warehouse-scope`、`npm run smoke:pda-device-session`、`npm run smoke:auth-session-remediation` |
| 打印、标签 | `npm run test:label`、`npm run test:print`、`npm run test:print-purge`、`npm run test:print-barcode-void`、`npm run smoke:print-queue`、`npm run smoke:print-template-preview`、`npm run smoke:print-barcode-void`、`npm run smoke:print-barcode-void-receipt` |
| 报表、开票 | `npm run smoke:reports`、`npm run smoke:reports-values`、`npm run smoke:warehouse-ops`、`npm run smoke:invoice-quota` |

`npm run smoke:inbound-progressive-putaway`（`tests/inbound-progressive-putaway.smoke.test.js`）：真实独立测试库、专属新商品/仓库与 OS 随机回环 API 端口。覆盖开放收货100→20/30/50早上架、现货真实销售预占/派发/拣货及撤回拒绝，预计绑定兑现/20实物+80预计守恒，短装已全上架即完成及原回执、关闭前无采购结算凭证规格/关闭后金额与首次应付日期一致，仍有待上架与普通收满兼容，混采购来源/不同价，同采购跨批保留已付和首次账期并扣已执行退货金额，同任务收货/上架/结案真实并发，scope/device及同键范围/数量闸门，阶段与异常独立。已付与已执行退货用于结算重算的既有事实夹具，不把该case称为真实出款/退货实操。测试不全表清理，不借既有库存；server/pool在finally结束，设备会话按本轮ID清理，业务夹具保留供失败取证。

前端 C4 专项：`src/pages/pda/inbound.test.tsx` / `putaway.test.tsx`、`src/hooks/useCloseReceivingInbound.test.tsx`、`src/pages/inbound-tasks/CloseReceivingDialog.test.tsx`。真实组件通过网络边界验证双入口、开放扫码/完成语义、原键/原端点、不自洽回执、撤权后可查询、换账号旧回调与真实弹窗恢复；还验证未知后重试 4xx 保留原键、切换端点的原成功不刷新新服务器、显式错误归属的 failed 回执保持未知。GUI、真机、物理出纸、CI与生产部署各有独立证据边界，自动化专项不能代替它们。

`smoke:sale-adjustment` 会为连续创建的销售任务建立本轮专用分拣格，并在结束时按 ID 清理；分拣完成必须先有已分配的分拣格。

`npm run test:fulfillment`、`test:procurement-planning` 为履约与采购净额纯规则回归；`smoke:fulfillment`、`smoke:procurement-planning` 必须使用本节独立测试库，已加入 Tests CI 专项矩阵。
`npm run test:fulfillment-refresh` 检查履约提交后合并通知、有界队列、失败退避与执行中再变更；`smoke:fulfillment` 同时验证业务单号筛选、仓库权限及提交后供应依赖刷新，仍仅允许独立测试库。

`npm run test:direct-express` 为官方签名、默认重量 1 及防重复下单离线回归；`npm run smoke:direct-express` 验证 MySQL 批次入队、销售产品快照与并发恢复，必须使用下述独立测试环境。`npm run check:direct-express -- sf sf_main`（德邦用 `deppon deppon_main`）只检查配置，不联网、不输出凭据。

`npm run test:document-activity` 为不连接数据库的订单记录归属、脱敏及数据范围回归，已接入 CI。

`npm run audit:business-consistency` 使用显式数据库环境变量执行只读跨模块一致性检查，输出全量异常计数及每项最多 100 条样本；退出码 0=未检出、2=存在待核对项、1=执行错误。报告中的推算金额依赖来源字段完整性，不能直接用作自动修复指令。2026-09-17 起新增 `container_product_orphan`、`container_warehouse_orphan`、`task_lock_leak` 三项检查（孤儿容器与已完结任务仍持有容器锁），共 41 项，见 `docs/acceptance-2026-09-17.md`。`test:legacy-receivable-repair` 为定向修复守卫单测；`smoke:legacy-receivable-repair` 必须使用已迁移的回环独立 `flowcube_repair20260908_test` 库，串行执行真实事务/回滚/幂等及扫描口径回归。定向修复脚本默认只读，生产 apply 要求预检摘要一致和私有备份路径，具体范围见 `docs/production-receivable-audit-2026-09-08.md`。

`npm run test:purchase-repair` 检查空采购来源、错行归属和定向修复守卫，已加入 Tests CI 配置；`npm run smoke:purchase-repair` 在同一专用 `flowcube_repair20260908_test` 库验证事务回滚、幂等、库存/应付不变和规范化后真实应付重算，必须与应收专项串行运行。生产只执行已授权的定向修复脚本，不执行这些测试。

固定库名的采购/应收修复专项含全表清理，原有同名测试库存在未确认数据时不得复用。可在任务专属 MySQL 临时实例的随机回环端口创建同名库，完整迁移后串行执行；随机口令**只传给本批临时容器与迁移/smoke 进程，不写入归属文件、仓库文件或日志；容器退出时删除**；0600 归属文件只含容器/卷/端口/实例身份与 runner 进程身份，**不含任何口令**；结束清理并验证本任务容器、数据卷和归属文件。不得放宽测试库守卫或清理原实例来迁就脚本。补证见 `docs/module-followup-2026-09-12.md`。**2026-09-29 越界事故后该约定已由机械门禁落实**：一键 runner `npm run repair:smoke-ephemeral` 显式新建本批数据卷与容器（同名资源已存在即拒绝复用）、建库（不 `IF NOT EXISTS`）、落 0600 归属文件、迁移后**串行**跑两条 smoke；清理只按精确容器 ID/卷名操作本批资源并复核确已退出，**清理标记只在容器与卷的 label 归属确认之后才置位**（`docker volume create` 对已存在卷幂等，未确认归属时保留现场、不删除）。两条 smoke 与复合命令内的 `audit-business-consistency.smoke.test.js` 在**任何写入之前**调用归属门（`tests/helpers/repairInstanceOwnership.js`），只认机械证据：0600 归属文件 + 非共享/长期实例端口 + 容器/卷的 `docker inspect`/`volume inspect`（存活、ID、本批 label、端口映射、卷挂载）+ 同一次运行时间窗 + **runner 进程实时存活且启动身份一致** + 实例实时 `@@server_uuid`；**不认**库名后缀、`CREATE DATABASE IF NOT EXISTS`、单个可自填 env 或「表为空」。未过门即在写入前失败，`try/finally` 的 `cleanup` 不会执行（只关连接）。契约与反向验证 `npm run test:repair-smoke-instance-guard`（纯逻辑、不连库，含 runner 行为 stub，已接 Tests CI 的 static job）。细节见 `docs/incident-repair-db-2026-09-29.md` §8。

`npm run smoke:warehouse-assets-waves` 验证塑料盒和批次拣货的真实 HTTP 权限、仓范围、管理接口与状态流转，使用本节独立测试库，加载模块前禁用打印清理定时器并核验既有打印任务未变化，已接入 Tests CI 专项矩阵。空盒创建只接受正整数主档 ID 与文本备注，不增加库存；波次按商品合计并保留最早成员明细的显示快照，先限仓再返回绑定信息，完成时锁定成员，所有活动成员先检查待归还/待改单阻断，再保留已进入分拣及后续阶段的状态。销售任务取消仍必须从销售订单发起。活动波次 GET 详情会刷新已拣数量投影，不能当纯只读。详见 `docs/warehouse-assets-waves-regression-2026-09-13.md`。

`npm run smoke:warehouse-masterdata` 验证仓库、库位、货架和分拣格的真实 HTTP 管理接口、权限、仓库范围和引用保护；沿用本节独立测试库并按自有 ID 清理，已接入 Tests CI 专项矩阵。仓库详情/更新/删除及库位、货架、分拣格的创建/下拉/扫码读取均传入当前用户仓库范围；库位更新校验原仓及目标仓，分拣格商品扫码先限任务仓再取结果。货架更新查重按本仓执行，允许跨仓同码。详见 `docs/warehouse-masterdata-regression-2026-09-13.md`。

`npm run smoke:sorting-bin-recovery` 在独立测试库用真实 HTTP 与 MySQL 验证主管补分配：权限/仓库范围、任务状态与挂起守卫、同键重放、无空格、强制释放及两个任务争同一空格的双向绑定；fixture 只按本次 ID 清理。见 `docs/warehouse-masterdata-regression-2026-09-13.md` 的 2026-09-24 补充记录。

`npm run smoke:masterdata` 验证客户、供应商、部门和分类的真实 HTTP 管理接口、权限、引用保护与层级边界，使用本节独立测试环境，已接入 Tests CI 专项矩阵。夹具按本次ID清理，不全表删除，不重置共享编码序列。部门更新沿父链验证有效父级，省略 `managerId` 保留负责人，显式 `null` 清空；不能把局部字段更新当作负责人清空。细节见 `docs/masterdata-regression-2026-09-12.md`。

运行涉及数据库的测试前确认连接目标与测试数据清理行为，**不得连接生产库跑测试**。公共 `tests/helpers/testEnvironment.js` 要求 `NODE_ENV=test`、显式回环 `DB_HOST`、合法 `DB_PORT`、`DB_USER`/`DB_PASSWORD`、`flowcube_test` 或 `flowcube_<用途>_test` 库名；测试不再加载真实 `backend/.env`。可用 `FLOWCUBE_TEST_ENV_FILE=/绝对路径/.env.test` 显式加载测试专用配置，命令行环境优先，配置错误及迁移失败立即终止。新数据库测试必须复用此校验。**本机实操（2026-09-17 验证）**：测试库凭据在 `~/.config/flowcube/operations20260912-test.env`，文件名不是 `.env.test` 因而走不了 `FLOWCUBE_TEST_ENV_FILE`，改为 `set -a; source ~/.config/flowcube/operations20260912-test.env; set +a` 注入；还必须 `export APP_UPDATE_DOWNLOADS_DIR=/tmp/<可写目录>`，否则 `backend/src/app.js` 启动时就因默认 `/var/www/flowcube-downloads` 无写权限抛 EACCES——**这个报错与业务代码无关，别当成回归失败**。本机 Node 为 v26，前端单测因此有 9 个文件 56 个用例失败（`localStorage is not available`），属既有环境问题；对照基线时不看绝对数，看是否新增失败。没有运行或环境不具备时明确说明；不能据此声称全部通过。纯文档修改核对内容、路径和 diff 即可，不必启动数据库或全量业务回归。

本轮修复回归入口：`npm run smoke:prelaunch-finance`、`smoke:prelaunch-scope-export`、`smoke:prelaunch-hr` 与 `test:prelaunch-runtime`；数据库仍必须使用第 3 节独立测试环境。

第二轮新增 `smoke:round2-transfer`、`smoke:round2-payroll`、`smoke:round2-runtime` 与 `test:round2-runtime`；前三者必须显式测试环境。历史审计 probe 断言缺陷存在，只是修复前证据，不能当作现行正确行为门禁。

正式 Tests CI 的独立数据库专项矩阵包含两轮审计 finance、scope-export、hr、round2-transfer、round2-payroll、round2-runtime，每项先迁移专用测试库；static job 同时执行第二轮运行时/恢复/错误追踪回归。

2026-09-26 一致性审计修复统一由 `npm run smoke:audit-20260926` 回归：独占 `flowcube_payable_test` 测试库，先跑会全量重算凭证的应付入账测试，再串行验证返货出库、跨期补录与锁序、采购应付撤回、借方科目接口、打印机绑定权限和请求幂等。Tests CI 的 `consistency-audit-20260926` job 使用独立 MySQL 8 service 与 Node 22，完整迁移后执行该命令；本机只允许回环 3307，CI service 使用回环 3306。该套件不连接生产库。
月结到期日的北京业务日与现结单据创建日回归由 `npm run test:accounting` 包含 `tests/settlement-due-date.test.js`；审计专项仍通过真实 HTTP/MySQL 检查月结应付到期日。

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

列表导出筛选透传回归：`npm run test:export-filters`（static job，2026-09-27 新增）——从每个列表接口 `findAll` 的函数签名解析出它支持的筛选键，断言对应的导出函数把其中**每一个**都原样透传，纯离线（stub `findAll`，不连数据库）。判定依据是「列表接口支持什么」而非「导出实现里写了什么」。同时 `smoke:prelaunch-scope-export` 的导出循环补了同一断言（真实服务 + 真实库）。背景：对账单与收付款单导出曾只透传 `type/status/keyword`，页面筛了往来方/单号/日期/金额却拿到全量；旧循环恰好只断言了 `keyword`（当时唯一被正确透传的参数），故缺陷长期不可见。


发布页面脚本回归：`npm ci --prefix scripts/browser-smoke --ignore-scripts` 安装锁定依赖，`node scripts/browser-smoke/node_modules/playwright-core/cli.js install chromium` 安装匹配浏览器，再运行 `npm run test:browser-smoke`。该测试使用真实 Chromium 和随机回环端口夹具，覆盖 ERP/PDA、受限权限、错页/渲染错误、对账重定向失败及进程退出，不连接数据库或生产。Tests CI 的独立 `browser-smoke-runtime` job 执行它；生产依赖从 CI 构建镜像复制，不运行安装命令。

发布工具离线回归：`npm run test:audit-tooling` 包含页面运行时、HTTPS 归档验证/回退和 main→PDA→桌面 tag 编排；`npm run test:release-tooling` 覆盖真实下载流的 SHA256、404、损坏包和缺摘要。工作流语法可用 `actionlint -shellcheck=''` 核对。`npm run release:verify -- --origin https://<生产域名>` 是线上只读核对，默认实际下载两种安装包，每包最多 120 秒，不启动安装程序。


数量精度回归（2026-09-22）：`npm run test:qty-precision` 包含原值/换算、逐箱、商品开关 schema 与最小权限、数量配置、拣货复核浮点边界、容器扣空/整箱归还行为测试；`test:qty-precision-coverage` 用 AST 验证实际业务入口调用，包含删除、改名和注释伪装的反向验证。`npm run smoke:qty-precision` 必须运行在已迁移的独立 MySQL 8 测试库，真实验证 `.005` 拆分不写库存、`.01` 拆分守恒、合法浮点噪声扣空，以及迁移 255 的 70 个目标列和原 SQL 重放幂等；安装包或生产数据均不参与。该 smoke 已接入 Tests 的数据库迁移后步骤。

文案守卫 `test:copy-conventions` 使用 TypeScript AST 分析字符串、模板、JSX 和 AppError，解析回归防止 `https://` 被误当注释及单双引号/续行漏扫。前端数量输入行为、详情标签和策略缓存回归进入现有 `npm --prefix frontend run test:unit`。

AST 文案和数量覆盖守卫依赖 frontend 的 TypeScript，必须在安装前端依赖之后执行；CI 放在 static job，不能移回仅安装后端依赖的 regression job。`deployment-resources.test.js` 验证依赖接线与删除安装步骤的反向失败。

### 2026-09-22 全仓审计新增回归

- `npm run smoke:audit-remediation`：独立测试库上的授信、角色、仓库授权、打印动作与 PDA 设备事务/待办/分页验证。
- `npm run smoke:user-account-management`：独立测试库上的真实 HTTP/MySQL 账号改名权限、重名拒绝及新旧账号登录回归；已接入 Tests CI。
- `npm run smoke:accounting-sale-period`：销售实际出库期间、旧累计根、闭期冲突、人工红冲、自动修订及来源完整性。
- `npm run test:dirty-navigation`：真实 Chromium 的 file URL、延迟挂载工作区、确认/取消和重复历史遍历；需 `agent-browser@0.36.0` 与其 Chromium，命名会话由脚本 finally 关闭并验证退出。CI 安装依赖并运行。
- `npm run smoke:nginx-headers`：需要 Docker，可通过 `DOCKER_CONTEXT` 选择本机环境；使用独立命名容器，不连接业务数据库。
- `test:audit-client` 同时检查实际启动入口先初始化历史拦截器再渲染 Router，并包含移除/后移初始化的反向验证。

### 已确认审计问题回归（2026-09-23）

`npm run test:confirmed-audit` 覆盖 PDA 用户绑定、权限即时读取、条码范围、盘亏预占、扣减符号、跨仓手动出库幂等、四位金额、SSH 信任/凭据传输及采购分页快照。`npm run smoke:confirmed-audit` 在独立回环测试库验证真实事务及 HTTP 拒绝；新增两命令已接 Tests CI。相机插件 mock 测试不代表 Android 真机验收。

### 2026-09-24 整改专项

独立测试库运行 `node --test tests/auth-token-remediation.smoke.test.js tests/finance-account-precision.smoke.test.js tests/schema-reconcile.smoke.test.js`；纯代码回归运行 `node --test tests/document-activity.test.js tests/sale-order-contract.test.js` 与 `npm run test:query-loop`。前端操作记录 API 用例在 `frontend/src/api/oplogs.test.ts`。schema 严格对账只统计物理表，视图不当作多余表。

### 2026-09-27 作废容器不得补打专项

`npm run test:print-barcode-void`（纯离线，static job）：从各入口断言作废容器（撤回收货等）的**状态派生、状态归一化、逐分支筛选**——显示按容器状态派生 `voided`，则 `inboundStatusClause` 除新增 `voided` 分支外**其余每个分支都必须排除 VOID**，否则「筛已打印」会把显示为「已作废」的行收进来；同时锁住「只收紧 VOID」的业务边界（`EMPTY`/待上架/待质检/拒收不得被判为作废）。

两个冒烟套件必须跑在独立回环测试库，覆盖两条互相独立的路径，缺一不可：

- `npm run smoke:print-barcode-void`：直接造容器与打印记录夹具——补打接口拒绝 VOID 且**不新增任务**、撤回终结「未领取」（PENDING）任务而 **PRINTING 不动**、两种并发顺序、**补打接口确实在容器行锁内执行**、列表 `voided`/`success`/`total` 三者一致、`readLabelVariables` 的 latest 取样分支同样排除 VOID（该分支供打印模板预览挑样例数据）。
- `npm run smoke:print-barcode-void-receipt`：从采购单→收货→上架造出**真实收货单**排一条 PENDING 打印任务，再走真正的 `voidReceipt` service——断言容器 VOID、单据回退「待收货(1)」、该任务变 FAILED 且**不能再被 `claimClientJobs` 领取**；再用「容器已被后续动作改动」触发 409，断言**不得误终结**（任务仍 PENDING 且仍可被领取）。

两者都做过反向破坏验证：去掉任一处排除/拒绝/终结，对应断言精准红。业务规则见 `docs/print-deploy-ops.md`「作废容器不得补打」条。

### 2026-09-27 报表成本口径专项

`npm run smoke:report-cost-basis`（独立回环测试库，Tests CI 的报表冒烟段）：三段——
① **导出读回**：真实生成 xlsx 再解析单元格，断言利润导出的汇总角标（销售额/销售成本/销售毛利/库存金额/滞销库存金额）与成本口径提示**确实在单元格里**（`payload` 顶层同名数组曾是从未生效的死字段，仅断言 payload 不够）；
② **多 sheet 渲染**：有汇总块时**汇总行 C..末列必须为空**（`fillSheet` 的 `ws.columns.header` 会把整行表头钉在第 1 行，留下"幽灵表头"），且真表头落在 `summaryRows.length + 2` 行；无汇总时表头仍在首行（回归）；
③ **成本口径**：利润分析与 KPI 不得拿 `p.sale_price` 当成本，快照为空时区分「按当前进价估算」与「成本缺失」；并断言 `trend` / `byWarehouse` **不伪报**这两个量（`0` 不等于"没有"）。

夹具显式落在远期专属月份 `2031-03`（`created_at` 与 `sale_date` 都指定），因此**不依赖共享库恰好为空**；每个 INSERT 成功后立即登记待清理 ID。另有一个用例落在 `2031-05`，专门验证**行级可定位性**：造快照/估算/缺失/混合四类订单与商品，断言榜单每行的 `costBasis` 与两个量，并**生成真实利润 xlsx、按订单号/商品编码定位那一行**核对「成本来源」中文文案（只查表头不算覆盖——单独删掉导出映射会精准红）。

`npm run smoke:price-change-history`（独立回环测试库，Tests CI 报表冒烟段）：改价审批的**历史旧价**必须是**审批瞬间的真实当前价**——申请 old=100 → 期间主档改到 120 → 审批 110 ⇒ `product_items=110`（审批覆盖语义不变），而本次审批写入的 `product_price_history` 行必须是 **120→110**（用申请时快照即失真）。另覆盖**商品在审批期间被软删**：必须 409 `PRICE_CHANGE_PRODUCT_MISSING` 并回滚整个审批事务，申请与审批实例保持待审批、无伪历史。

`npm run smoke:product-price-history-integrity`（独立回环测试库，Tests CI 报表冒烟段，**紧邻上条**）：**商品手工改价的一致性**——① **并发**两次手工改同一商品 ⇒ `product_price_history` 必须是**连贯链**（同一 `price_type` 上每条的 `old_price` = 上一条的 `new_price`），且商品当前值 = 链尾 `new_price`（根因是 `products.update` 曾在事务外读快照）；② `allowDecimalQty` **未传**时保持原值，其中 `allow_decimal_qty IS NULL` 的既定语义是**默认允许小数**（迁移 254），不得在读裸列时当成 0；③ 对**已软删**商品改价必须**明确失败**，且**不写**单位 / 库存策略 / 价格历史等任何脏数据。运行需显式隔离库 + 回环（同本文件测试库约定），命令见本文件开头的环境要求。

**上述三条商品价格相关套件（`smoke:product-price-version-guard`、`smoke:price-change-history`、`smoke:product-price-history-integrity`）自备分类种子**：在**零分类**的全新隔离库上直接可跑——优先复用库中已有分类，**没有则自建一条**并在 `finally` 按 ID 删除（保留他人数据），跑完复查**自建分类残留为 0**。它们**不依赖**「库里预先存在商品分类」这一环境前提（2026-09-29 修复：此前依赖首条分类，CI 新库无分类即失败）。

### 2026-09-29 批 A 塑料盒作业流（放货 / 混批 / 还原整件）

`npm run smoke:plastic-box-batch-a`（`tests/plastic-box-batch-a.smoke.test.js`，**27 项断言**，自然退出码即结论）：走真实业务链（采购→收货→上架）造夹具，断言 HTTP 状态码 + **数据库库存事实**（容器余量、`inventory_stock` 汇总、`inventory_logs` 快照、`print_jobs` 条数与失败态、混合标识两跳继承）。覆盖放货全量转移与同键重放、范围校验覆盖重放、同商品混批与混合标识完整传递、效期保护不可绕、数量精度与箱数上限、参数互斥、并发守恒、PDA 设备闸、**取满**与**超量零副作用**、**空盒残留旧效期清除**、以及**标签渲染失败降级**（业务已提交、只把标签降为 `status=3` 可补打记录）。

隔离要求（比本文件通用约定更严，测试内**硬断言**后不符即直接失败）：`DB_NAME` 必须恰为 `flowcube_plastic_box_20260929_test`、`DB_HOST=127.0.0.1`、`DB_PORT=3307`——用于防止误连共享/生产库。
Tests CI 的 `regression-plastic-box` job 使用独立 MySQL 8 service（**映射 3307**）与 Node 22，建库 → 迁移 → 执行该命令；其它 job 仍用 3306，互不影响。

渲染失败那一条**不是**真实 worker 故障注入：真实故障源只有光栅 worker 的 `error`/`exit`（`LABEL_RENDER_FAILED`），而模板解析失败只会降级返回 `null` 并回退内置光栅渲染、不抛错。因此沿用 `tests/label-render-degrade.smoke.test.js` 的 `require.cache` 打桩范式（必须在 `label-command` 首次 require 之前），**默认透传真实实现**，仅该用例内打开 `globalThis.__PB_FORCE_RENDER_FAIL__`。边界见用例注释。

### 2026-09-29 批 B（B1+B2）：扫盒取货 + 独立取货标签

`npm run smoke:plastic-box-pick`（`tests/plastic-box-pick.smoke.test.js`，**17 项断言**）：与批 A 同一专库/回环约定，在同一 CI job `regression-plastic-box`（**3307 service**）内**顺序执行**，不另造 job。
覆盖：扫盒取货生成**本任务锁定的新 `I`**（盒减量、PICK **只落新 I** 且 `source_container_id=盒`、库存守恒）、同键重放不重复、合法第二次取货、取 1 个（散件模式）、超盒存 / 超未拣量 4xx 零副作用、旧「扫整件 I」路径不回归、**范围与设备仓校验覆盖重放**、取货标签 `pick_label`/模板 type 11 入队与变量**取自 PICK 行**、批次日期继承（单批继承真实值 / 混合全空）、**补打实跑**（用途仍 `pick_label`、容器量与 scan 数不变）、**两类打印降级**（无可用打印机 / 渲染失败各留 `status=3` 且业务已提交）、type 11 模板保存即默认且**实际渲染生效**。
套件**自建夹具逐笔登记**并在 `finally` 合法取消 + 归还，且**核对** `task.status=8` 与自身锁定容器为 0——任何失败计入 `failed` 并自然 `exit 1`。
**未验**：GUI、物理打印、减量/归还后的补打恢复（留 B4）。

### 2026-09-29 批 B3a：取货码分拣 / 复核下游链

`npm run smoke:pick-code-downstream`（`tests/pick-code-downstream.smoke.test.js`，**19 项断言**）：与前两批同一专库/回环约定，在同一 CI job `regression-plastic-box`（**3307 service**）内**顺序执行**，不另造 job。
覆盖：扫取货码**精确定位**自身任务/明细/格位与 PICK 有效量、**不回落他 SKU**；旧商品码路径原键重放与新取货码路径原键重放（**完成 3→4 后**与**进度中任务仍 3**两种）均返回原回执且不重复推进、不新增作业记录；取货码经真实 `sort-done` 推进 3→4 并落一条 `sorting_bin_items`；连续两张取货码 `sorted_qty` 为**两者之和**；**混合来源两种顺序**（旧50→标60→标90 / 标60→标90→旧50）逐步累加不覆盖且**未扫完标签不得完成**；**反向**（未扫标签时旧码上限为 `picked − A`）与**整任务完成（`items=null`）按份额写**；他任务取货码、放错格、**多张取货码**、**三位小数**均拒绝且零副作用；复核真实扫码闭合到 `checking→packing`、同键重放与新键重复的行为；**范围 / 设备仓校验覆盖重放**（分拣与复核各一组，**service 直调**，沿用批 A 口径）。
**证据边界**：`scope`/设备仓的两组断言走 **service 直调**，不得统称「HTTP 全链」；**未被覆盖**：`uk_task_container` 的真实并发冲突、分拣格抢锁期间被改配、多张取货码的批量写入路径（本期显式拒绝）、GUI、物理打印。
**未验**：GUI（分拣页取货码提示、待确认定位展示、恢复文案）、物理打印、取货码容器的「取消归还 → 再拣」生命周期（属 B4）。

### 2026-09-29 批 B3b：装箱配额按来源取货标签分行 + 回收

`npm run smoke:pack-quota`（`tests/pack-quota.smoke.test.js`，**8 项断言**）：与前几批同一专库/回环约定，在同一 CI job `regression-plastic-box`（**3307 service**）内**顺序执行**，不另造 job。
覆盖：扫取货标签**不传数量即整份装入**（60 / 90 / 真 150 各一例）且**同商品各成一行**；**幂等 + 回执定位**（同键重放不二次加量；`request-status` 的 **base 与 scoped 两种定位都能查到**原回执、**问别的箱子必须 not_found**；换新键重复装被拒）；**同 SKU 混合两种顺序**（标签先装 / 旧 SKU 先装）且旧 SKU 上限确为 `checked − Σ标签真实复核量`（尚未装的标签货不被吞）；**部分装箱 + 移出后配额释放不串份额**；**作废后同一标签可在新箱重装**；他任务标签被拒（底层归属闸）与「任务未到待打包时**建箱即拒**」（阶段闸，**两者分开断言**）；**取消后不得装箱**。
**前端组件**：`frontend/src/pages/pda/pack.test.tsx`（**4 例**）与 `sort.test.tsx`（**4 例**）验证待确认冻结、冻结定位展示、恢复文案区分「本次增量 / 累计量」、成功反馈收敛到单一回调。
**证据边界**：组件用例**只 mock `useCriticalPdaAction`**，**不代表** localStorage 持久化重挂恢复或真实网络中断→恢复链路；红测证据只有**源码层面对比**（HEAD 的 `add-item` 只收 `productCode`+`qty`、`packages.service.js` 无 `label_container_id`），**未取得**干净的「实现前先跑套件」红灯。
**未验**：GUI、物理打印、真实并发（锁序只做了顺序验证）、`PACK_LABEL_NOT_CHECKED` 在完整链下**不可达**（防御性兜底，未实跑）、`finish` 的 scope-先于-replay 与历史回执事务（**后续批 C2 已覆盖**，见 `docs/plastic-box-batch-c2-handover-2026-09-29.md`）、`remove`/`void` 无幂等键（**后续批 C1 已覆盖**）。

### 2026-09-29 批 B4：取货码取消 / 减量归还闭环

`npm run smoke:pick-cancel-return`（`tests/pick-cancel-return.smoke.test.js`，**5 项断言**）：与前三批同一专库/回环约定，在同一 CI job `regression-plastic-box`（**3307 service**）内**顺序执行**，不另造 job。
覆盖：**取消整份 150**（新 `I` 解锁、**货不回盒**、库存守恒、留痕、任务取消）；**减量 150→100 后增量回 150 + 补拣盒 50** 的**完整真实链**——改单 `PUT /sale/:id/adjust` → 改单确认 → `container-returns` 确认 → 增量 → 补拣 → `ready` → **真实 `sort-done`** → **真实复核闭合到待打包(5)** → **真实装箱**（补拣标签 50 + **旧码当前有效 100** = 150，旧 SKU 装 1 件被拒）→ **旧码补打**读出 `qty=100`；**取消归还后的码在下一任务按普通整件**（取货码形态被拒后，**继续走完**商品码分拣 → 复核 → 装箱 150）；**取消后补打被明确拒绝**（按当前任务锁 + 当前有效 PICK，不认历史 `source_ref_type`）；**同箱同 SKU 多标签（60+90）经 `finish` 打印链后合法减量**（`package-void` 受控拆箱 + 归还确认 → 箱作废、需求 100 → 重新复核 → 重新装箱）。
**修复前后对照**：后两项在修复前实测为 `409 PICK_CODE_EXCEEDS_PICKED`（补拣被历史作业份额挤掉）与 `200 queued`（照旧出未归属的取货标签）；修复为「聚合取小者」与「按当前任务锁定位」后转绿。**未改动历史作业记录、未用 SQL 直接改库存/任务/打印状态。**
**未验**：GUI、物理打印与**实际出纸**（第 4 项只证明入队结果）、`finish`/待出库链（第 5 项只走到**箱贴入队**，未要求客户端完成）、真实并发、`remove`/`void` 无幂等键（**后续批 C1 已覆盖**）、`finish` 的 scope-先于-replay 与历史回执事务（**后续批 C2 已覆盖**）、**取货标签容器已出库/已 `EMPTY` 后的「历史补打」**（**后续批 B4 补充项已覆盖**：可按唯一一条已出库任务的盒取货行补打原取货量）。
**第 5 项的完整闭合断言**：非作废箱 `SUM(package_items.qty)=100`、旧箱 `status=3`、`PICK` 合计 100、**历史 `sbi` 保持 `[60,90]` 未被改写**、**ACTIVE 容器余量合计 == `inventory_stock` 缓存**（守恒）。

### 2026-09-29 批 C4：打包末尾两入口（`pack-done` / 箱贴补打）

`npm run smoke:pack-done-replay`（`tests/pack-done-replay.smoke.test.js`，**8 项断言**）：与前几批同一专库/回环约定（开头硬断言库名/回环/端口），在同一 CI job `regression-plastic-box`（**3307 service**）内**顺序执行**，不另造 job。
**不使用 `prepareSmokeContext()`** —— 它会 upsert 共享 `SMOKE-PRN` 并 `DELETE` 该打印机下 `status=0` 的任务，与本批「不核销他人历史 job」的边界冲突；改为自建本批独立仓 / 库位 / 分类 / 供应商 / 客户 / 商品 / 分拣格 / 打印机 + 客户端绑定 / PDA 设备，收尾全走合法 API 并**断言终态**（失败计 `failed`，进程非 0）。
覆盖：**`pack-done` 原 key 重放回原回执**（并断言 `PACK_DONE` 事件与直接运单数**不增**）、**新 key 对已推进状态仍 400 且无残留回执行**、**箱贴同 requestKey 跨箱不串 job**（同 key 重放回原 job 且数不增；新 key 恰增 1）、**缺箱在 begin 之前 404**（回执 0 行、原 key 可重试）、**设备仓不匹配 / PDA 缺票 / ERP 无标记合法路径**、**限仓用户范围外 403**（先证明范围内可成功，再改范围，原 key 与新 key 均 `WAREHOUSE_SCOPE_DENIED`）、**历史错误回执经写重放与 `GET request-status` 两个入口都被 409 拦下**、**故障注入**（`UPDATE operation_requests` 抛错 ⇒ 整体回滚、队列无残留、原 key 重试成功）。
**红证据（先红后修）**：`pack-done` 原 key 重放与新 key 对旧状态**同为 400**；箱贴 B 箱拿到 **A 箱的 job**（`refId` 不符）；缺箱后回执行停在 `PENDING(0)`；`GET request-status` 对历史行返回 `success` 而 `resourceId` 与 `data.job.refId` 不符。
**防回归已验（无前置红）**：设备仓 / 缺票 / ERP 路径、限仓范围、历史回执的**写重放** 409、故障注入——这四项与实现同批落地，未在旧实现上单独取红。
**历史行查找**：`JOIN packages → warehouse_tasks → inventory_warehouses` 且 `w.name LIKE 'PB-C4-%'` + 当前 `user_id`（只读本批、本人）；找不到历史行时计 **SKIP**（独立计数，**不计入 PASS**），汇总打印 `N 通过 / N 失败 / N 跳过`。
**真实 GUI（**Claude 实测**，分两轮，详见 `docs/plastic-box-batch-c4-handover-2026-09-29.md` §8.1 / §8.2）**：
· **第一轮（共享仓，窄修之前）** ① 补打箱贴扣 2xx：同页冻结原 `WT202609291206 / L000468` → **切到任务 1207 仍显示原定位** → 放开确认后该箱 `print_jobs` **2 → 2 不增**；② 完成打包扣 2xx：任务 1207 后台已成 6 → **离页重挂仍见恢复入口**（未被「当前任务不能打包」顶掉）→ 切到仍为 5 的任务 1206 确认时，页面给出 **`原任务 #1207 的「完成打包」已确认；当前任务以本页状态为准`** 且**未把 1206 标成完成**。同轮那次**真 `reload`** 的读数（`navigate→reload`、`timeOrigin` 变化、localStorage 原 key 不变）**来自 Claude 当时的命令输出，root 未独立复核** —— **只作线索**。
· **第二轮（自建仓，窄修之后）**：箱件按**只读事实**呈现（`1/1 箱 / 45 件`，Claude 实测）。
· **未验**：新独立仓场景的**「刷新后原键保留」**与**「跨目标确认不误完成」**两项；**不得**据此宣称 GUI 闭环已验。
**契约变更**：箱贴缺箱由「409 + 留 PENDING」改为 **404 且不留回执行**；`print-label` 路由加 `pdaSessionOptional()`；箱贴幂等键绑 `packageId`；`GET /api/system/request-status` 对 `package.print-label` 的成功回执增加**领域自洽校验**（不一致 409 `PACKAGE_LABEL_RECEIPT_MISMATCH`）。
**未验**：真 PDA 真机、物理打印（用例与 GUI 的核销都是**真实 API 闭环**，**不代表实际出纸**）；`PF1` 只覆盖「回执写入失败」一种故障注入；本批相关**全量套件**（`smoke:mainline`、`smoke:print-queue`、`test:label`、`test:print` 等）留**发版前**统一跑。

### 2026-09-29 · 塑料盒专项的「箱贴打印前提」与自洁（批 C4 静态补齐）

`regression-plastic-box` job 里 9 个专项中**只有 4 处会调 `finish`**：
`pick-cancel-return:511`、`pick-label-reprint-lifecycle:208`、`pack-finish-receipt-tx:188`、`pack-done-replay:269`。

**前提**：C2 起 `finishPackage` 调 `printJobs.assertQueueReady({ jobType: 'package_label' })`，
而 `print-jobs.command.js` 对该用途用 `requireBinding=true, allowBindingFallback=false`：
`resolvePrinterForJob` **先查用途绑定**（`print-dispatch.js` 的 `fetchBindingCandidates` 命中
「**本仓** `b.warehouse_id = <任务仓>`」或「**公司级** `b.warehouse_id = 0`」的 `package_label` 绑定，本仓优先），
**没有候选时**才**拒绝回退**到未绑定的默认打印机 ⇒ **409 `PRINT_BINDING_MISSING`**。
换言之：**缺少有效 `package_label` 用途绑定时才会拒绝回退**；**公司级绑定（`warehouse_id=0`）是允许的**。
（区分：**打印机自身**的 `printers.warehouse_id IS NULL` 与**绑定**的 `warehouse_id` 不是一回事。）
`prepareSmokeContext` 只 upsert 全局 `SMOKE-PRN`（一台打印机）、**不建立任何用途绑定**，故需要本夹具。

**做法**：前三个专项（C4 的 `pack-done-replay` 本就自建独立仓/打印机/绑定）通过
`tests/helpers/ownedPrintFixture.js` 自备：

- `acquireOwnPackageLabelPrinter({ http, token, warehouseId, assert, randomRef })`：进入前**读取并记录**
  本仓原有 `package_label` 绑定（读不到即抛，不当作"无绑定"）→ 自建打印机（含工作站 `clientId`）→ 绑定到本套仓库；
- `releaseOwnPackageLabelPrinter(own, { http, token, assert })`：按**当前 GET 到的归属**收尾 ——
  本套自建则**恢复原值/删除自身**；**他人的指向一律保留**并记为失败（绝不覆盖）；
  停用自建打印机后 **GET 断言 `status=0`**；最终态断言到**原值或无绑定**；
  **逐项尽力执行并聚合失败**，任一项未净即 `assert` 真失败。

**为什么要自洁**：`smokeTestKit` 只 upsert 全局 `SMOKE-PRN`、**不建箱贴绑定**；若套件自己不清理，
就会**留下绑定让后续套件靠执行顺序侥幸通过**。本夹具不改 `smokeTestKit` 的全局状态与清理语义，
也不物理删除任何打印历史（job / 回执保留）。

**边界**：夹具的异常收尾另有**无 DB 的 mock 微验**（`/tmp/rel-prod/owned-print-fixture.test.cjs`，5 条路径），
它**只证明夹具逻辑**，不代表真实业务 API / 真实打印 / 物理出纸；专项的真实结论以**同 SHA 的 CI**为准。

### 2026-10-01 成套配件基础切片（C2b-1）

- `npm run test:kits-composition`：15 个纯计算用例，覆盖 A 价快照/全显式权重、微单位与大权重精确性、重复/两位数量/整数策略/零权重拒绝、分尾差守恒、共享组件与普通商业组独立、200 商业/物理维度边界。新预览采用 price4×qty2 的定点 half-up 金额，不改普通销售 round2 与八位内部单价口径。
- `npm run smoke:kits-foundation`：真实 HTTP/MySQL，20 组验收；自建唯一角色/用户/仓库/客户/商品/套件，按登记 ID 清理主档夹具并关闭 server/pool。覆盖列表/finder超大page的500→400回归、269实际 SQL重跑幂等与索引/FK列序、稳定键重放/创建载荷区分、编辑并发/旧revision、改组成新版本/旧版本不变、启停/软删历史可读、权限/范围/主数据禁用或软删、微/大权重 DB 往返、客户等级价与套默认价隔离、同 conn 回执失败整事务回滚/原键重试，以及库存/预占/日志/销售/应收应付总量与金额不变。故障用例仅注入回执 UPDATE 错误，出现预期500日志；不代表其它故障类型已验。付款表为 `payment_records`，不存在 `fin_receivables`，早期夹具命名错误不是业务红灯。
- `npm run smoke:kits-current-stock`：真实采购确认→PDA会话收货→上架，取得铰链1/螺钉8与应付9的实物基线；分别预览两个单套均有现货参考，合并向量明确缺铰链1，金额300守恒。追加允许小数的真实商品，采购1、实际收货上架0.30并合法短收结算应付0.30，真实普通销售预占0.20；每套0.10时finder无预占3套、有预占1套，与预览一套零缺量一致。该边界先红实测2/0，再按百分整数单位修复绿灯，日志为 `/tmp/kits-finder-qty-red.log`（自然exit1）与 `/tmp/kits-finder-qty-green.log`（自然exit0）。finder/预览前后容器/库存/预占/库存日志/AP/销售逐表不变。为保留真实业务审计，不直接清除入库/库存事实；精确ID保存在 `/tmp/flowcube-kits-stock-KST-*.json`（0600），退出前正常取消本轮普通销售单并核对预占为0，停用本轮测试账号、删本轮PDA会话/设备、关闭server/pool。此夹具不得视为生产或真机证据。

三条均已接 Tests CI（计算放 static，两个 HTTP smoke 在 MySQL regression 顺序执行），本地即时验证是该高风险基础切片的最小验收。运行环境遵守本文件开头：Node22 + NODE_ENV=test + 显式回环 DB_* 与可写 APP_UPDATE_DOWNLOADS_DIR；无 prepareSmokeContext / 全表清理 / backend/.env 读取。2026-10-01 在新建唯一测试库（utf8mb4_0900_ai_ci）完整执行269迁移文件，并在其上验收；该库与真实业务夹具保留，不DROP，未碰开发库或生产。原始红证据为缺组成行为及真实POST /api/kits的404→预期201；微小非零五位以上价拒绝另取到了 Missing expected exception 再修；`1.005×1` 原浮点round2实测1.00、应为1.01，新增定点金额用例先红13/14再修；现订单DECIMAL(14,4)金额容量守卫先红14/15再修，商业行/物理行/总额均有限；参考时刻从错误版本创建时间改为null并解释沿用依据，API断言先红后修。补充微/大权重与库存专项为实现后增强验证，不冒称均有实现前红灯。

**C2b当时未验/未实现（后续接点见本文件C2完整证据段）**：正式销售套单保存、草稿/复制/改单、整套分批派发与发货/退款分摊、退货、应收/凭证接点、GUI、真实PDA硬件、物理出纸、CI远端结果、生产迁移/部署。全量后端/前端套件留发版前按统一规则运行。

### 2026-10-01 商业行分批金额与来源组件退款纯规则（C2c-1）

`npm run test:sale-commercial-money` 为 C2c-1 的纯金额专项，Tests CI static job 实际执行，不连数据库。验证冻结套价累计、单调循环槽组件分摊、任意分批差额、ordinary 冻结成交额/两位基本数量、来源组件合格退款、精度/范围/快照守恒与不可变输入；还覆盖科学表示字符串指数±100与字符串长度128边界（超界409），以及JSON有限Number零正常接受。固定种子小 Q 逐槽独立参考与大量级 Q/50组件有界计算分别验证。旧累计组件前缀比例算法的负1分反例在测试中作为内存反向证据。此专项不能证明套单保存、占库、出库/退款事务、幂等或 GUI 已接通；既有 `test:kits-composition` 组成计算应一并回归。

### 2026-10-01 C2 后端完整接点与可复查证据

正式 HTTP 套单写入口已在本工作树接通，未提交/推送/部署。`npm run test:sale-commercial`（新契约、单位、日期、净金额与退款凭证13例）与原 `test:sale-commercial-money`（26例）共39例；`smoke:sale-commercial-lifecycle` 已接 Tests CI MySQL regression，server listen(0,'127.0.0.1')，只本轮精确ID夹具，无全表清理。环境为Node22、显式NODE_ENV=test/回环3307/独立库 `flowcube_kits20261001_7e429c_test`，不读取backend/.env凭据。

实际证据按层分开：

| 验收 | 日志及本轮精确metadata | 结果/界限 |
|---|---|---|
| 正式HTTP创建/更新、稳定物料ID、占库/整套派发、普通与套混排、关闭、改单、来源退货 | `/tmp/kits-formal-http-green.log`；`/tmp/flowcube-kits-lifecycle-KLC-8b8031a6.json` | 自然exit0；所有销售/来源创建均真实HTTP，实际PDA会话采购/仓储执行及打印client确认（非物理出纸） |
| marker/混输/全写动作key、draft headers/旧revision成功键重放/新key409、范围变更回执拒绝、HTTP回执UPDATE故障 | `/tmp/kits-formal-guards-scope-fault.log`；`/tmp/flowcube-kits-lifecycle-KLC-439f311c.json` | 自然exit0；故障500后订单/组/物料全回滚，原key重试只有一份；同一用户限仓后成功回执与更新重放403 |
| 已拣2套→减1、待实物归还阻断再派发/实发、PDA确认归还后quantity/reserved/WTI全为1且IDs不变 | `/tmp/kits-formal-pending-adjust.log`；`/tmp/flowcube-kits-lifecycle-KLC-e2863681.json` | 自然exit0；改单试改表头明确拒绝；`KIT_TEST_SLICE=adjust` 为收口最小分段，默认脚本执行全链 |
| 原100/10全退gross100/financial90/AR0；300/.0101仅A100实发关闭、登记.01先拒确认、真实退款后净99.9966/AR0 | `/tmp/kits-refund-voucher-tail-green.log`；`/tmp/flowcube-kits-lifecycle-KLC-3cb7fe63.json` | 自然exit0；收款/退款创建提交执行均真实API；正式HTTP日志也覆盖同金额规则，但历史两份日志第二个关闭小额PASS标签误复用了100/10文字；实际断言为99.9966。脚本现已修正标签，本轮未为文案重跑整链 |
| 最终diff新增收入basis修复：关闭gross3/.0151到2/.0101不得重排两期1.00/.99 | `/tmp/kits-closed-shipment-basis-red.log` → `/tmp/kits-closed-shipment-basis-green.log`；真实读取 `/tmp/kits-final-resource-proof.log` | 自然red exit1/green exit0；跨9/10月是pure函数输入，现owned正常WT7读取证明关闭后仍取冻结basis；未SQL伪造实发日期，不冒称完整跨期业务链 |
| .02/.01两次真实合格来源部分退：每次financial.005，凭证累计.01/0而总.01 | 同上 | 会计业务红 `/tmp/kits-refund-voucher-tail-red.log` 实测累计.02，再窄adapter修复；成本腿未省略 |
| 采购1箱=3基本组件、套内发1成本10/剩余库存2；mixedordinary1箱价1全发AR1；旧ordinary辅助单位真实占/派/发/退/AR0及cancel释放 | 同上与正式HTTP日志 | 辅助包装入库和混排录入是不同场景；套定义仍基本单位，不假装支持套内包装编辑 |
| cent/3同来源两个SR并发与等待前RR快照、退款回执故障回滚/原key再试；A-source退款与B实发两种库存阻塞顺序 | 正式HTTP及净金额链日志 | 使用真实业务service+独立conn控制事务交错（实发是HTTP），无手改状态；明确不是全部HTTP并发。gross80/net72后再发B，AR198/退货凭证72；同SKU来源混单拒绝，拆单A合格/B全拒收正常完成0 |

业务红与setup错误分开：正式HTTP原gate红为 `/tmp/kits-formal-http-red.log` 创建400；整单折扣红为 `/tmp/kits-discount-red.log` 真实已发90、计划gross100确认409。出库/退款交错红 `/tmp/kits-ship-refund-deadlock-red.log` 与 `/tmp/kits-ship-refund-deadlock-innodb.log` 显示冗余FK造成SO↔stock锁环；272后同一尝试两种顺序自然成功，未用deadlock重试。测试曾误查不存在的WTI.cost_snapshot、权限列名和退货明细嵌套，以及先收一商品就质检的setup顺序错误，均不算业务红。最后成本断言读取真实SOI快照。

270–275在该精确测试库已执行，并各作幂等重复核验；最终正式迁移runner两遍与db_migrations ledger、索引名字/列序结果保存 `/tmp/kits-final-migration-ledger-shape.log`。引用schema/列序/FK证据 `/tmp/kits-final-fk-proof.json`。275本轮精确fixture依据恢复 `/tmp/flowcube-kit-basis-owned-review.js`、`/tmp/kits-basis-owned-reviewed-manifest.json` 与 `/tmp/kits-basis-owned-review.log`：只已核本轮owned IDs改legacy_verified，未知历史不猜。metadata0600，保留真实交易/库存/资金审计，不DROP库。最后精确user/device/session/reservations/locked-container/printer/account收尾结果 `/tmp/kits-final-resource-proof.log`。

当前批即时检查：后端lint、combined39纯例、query-loop、API路由/写权限契约、migration ledger与shape、diff审阅。完整后端/前端全量lint/build/all套件及远端CI留整批统一验证；GUI响应丢失/草稿恢复、真实PDA硬件和纸张、生产迁移/部署均未验，不能由本轮HTTP/PDA会话或client打印确认推断。

### C2 独立规格复审两项P1收口（2026-10-01）

`npm run smoke:sale-commercial-review` 已接 Tests CI MySQL regression 的实际 step；依次运行 scope 与 gates/QA 最小分段，复用原真实履约脚本，不重复无关资金全链。业务代码只补已有 kit 保存/重放范围与销售退货完成门控；270–275未改、无新迁移/权限或数量台账。

| 证据 | 精确日志/metadata | 自然结果 |
|---|---|---|
| 原范围漏洞：保存保留旧仓quantity0，缩范围后旧update key、新key、原create key错误通过 | `/tmp/kits-spec-scope-red.log`；`/tmp/flowcube-kits-lifecycle-KLC-c01abcb0.json` | exit1；实际200/200/201 vs期望403，不是setup错误 |
| current saved scope修正，全范围合法旧键重放、普通创建旧政策 | `/tmp/kits-spec-scope-green.log`；`/tmp/flowcube-kits-lifecycle-KLC-fd8ce608.json` | exit0；三个漏洞触发均403，新key不变revision/remark |
| 多组件退货旧RR快照：B锁等待前读RTI，A入仓组件1commit，B入仓组件2 | `/tmp/kits-spec-current-gates-red.log`；`/tmp/flowcube-kits-lifecycle-KLC-e6853edc.json` | exit1；实际RTI已1/1与4/4，RT4/SR2，未调用退款完成；保留卡住业务审计，不强写状态 |
| 完整RTI当前读后，同交错kit/ordinary QA与上架、两组件kit全拒收 | `/tmp/kits-spec-current-gates-green.log`；`/tmp/flowcube-kits-lifecycle-KLC-cafc04e6.json` | exit0；RT5/SR3，合格来源receipts100/AR0/voucher100；全拒收receipts0/AR100 |
| 最终package实际两段执行 | `/tmp/kits-spec-review-package-green.log`；`/tmp/flowcube-kits-lifecycle-KLC-6b04838c.json`、`/tmp/flowcube-kits-lifecycle-KLC-81325002.json` | exit0；销售/采购/仓储与SR创建正常HTTP，QA/入仓两事务交错为受控service，单attempt无死锁重试 |

范围红前曾漏ordinary DTO两个展示字段，`/tmp/kits-spec-scope-setup.log`仅setup，不算业务红。旧quantity纯测试原stub硬编码SUM=0，现改为模拟实际received_qty更新；上架访问纯测试补无商业来源的lockExecution mock，避免在隔离测试加载真实环境。`/tmp/kits-spec-return-contracts.log`20/20，含1.2−拒收.3−入仓.9完成且真实剩.01仍阻断。最终受影响纯/契约合计59/59 `/tmp/kits-spec-final-pure-contracts.log`；后端lint `/tmp/kits-spec-final-lint.log`、query-loop `/tmp/kits-spec-query-guard.log`、CI资源守卫 `/tmp/kits-spec-ci-resource-guard.log`均自然exit0。

最后精确资源与实物缓存、当前QA/退款及真实原成本复核 `/tmp/kits-spec-final-resource-stock-proof.log`（只读脚本 `/tmp/flowcube-kits-spec-final-proof.js`）：新own账号停用、设备/session删除、范围/预占/容器锁/活动打印机无残留；库存缓存等于ACTIVE容器，最新kit/ordinary退货凭证各应收100、原成本5。夹具与metadata0600保留，审查者原夹具未动。采购退货走原purchase_return_out仓储链，不调用本销售RT门控；其规则未改。未提交/推送/部署，GUI/真机/纸张/远端CI与整批全量验证边界仍按上一段。

独立规格再审结论为接受：`/tmp/c2-respec-scope-green.log`、`/tmp/c2-respec-create-scope-green.log` 各自真实复验范围不足的旧更新重放/新保存/原创建重放403，以及完整范围合法重放；`/tmp/c2-respec-rr-multicomponent-green.log` 按原旧RR快照及来源等待交错取得RT5/SR3/两条退款回执/AR0；`/tmp/c2-respec-rr-qa-green.log` 另验质检交错推进RT4，随后真实HTTP上架RT5/AR0。四脚本自然exit0，受影响纯测试20/20、diff检查通过，独立精确资源已收尾；原失败SR156/RT154保留审计。此结论只覆盖后端规格，品质审查和页面验收继续后置。

### C2 独立品质P1：散件取消逐容器份额（2026-10-01）

`npm run smoke:sale-commercial-partial-cancel` 新增实际 Tests CI MySQL step，独立脚本 `tests/sale-commercial-partial-cancel.smoke.test.js` 自建精确夹具，通过采购→PDA收货/上架→正式套单创建/占库/派发→正常散拣→取消→逐容器PDA归还，不强写状态。新 `tests/sale-commercial-cancellation.test.js` 三例加入 `test:sale-commercial`，覆盖当前PICK来源、锁序与缺来源/错误item/超本单预占拒绝。没有新迁移，270–275未改；原品质审查夹具未修改。

| 验收 | 日志/精确metadata | 自然结果 |
|---|---|---|
| 新owned单容器5/PICK1/余10、双容器各PICK1旧释放错误 | `/tmp/kits-quality-partial-cancel-red.log`；`/tmp/flowcube-kit-partial-cancel-KPC-97443972.json` | exit1；真实取消保留5而非1、首次双容器释放2而非1、后续归还409，业务断言失败 |
| 当前PICK修正后同场景 | `/tmp/kits-quality-partial-cancel-green.log`；`/tmp/flowcube-kit-partial-cancel-KPC-d64d2357.json` | exit0；单容器取消留1/归还0，双容器逐份留1→0，.1/.2留.3→.2→0 |
| 最终package：上述三种、等量容器、普通散拣取消；缺PICK与本单预占不足故障回滚 | `/tmp/kits-quality-partial-cancel-package-final.log`；`/tmp/flowcube-kit-partial-cancel-KPC-b7156c40.json` | exit0；取消/归还原key重放只一次；他单预占全程不变；WT8、锁0、预占0、库存未扣实物；故障409无回执/不解锁，原key正常重试成功 |
| 精确actor/device/session/bin/cache/ledger/AR收尾及原审查红不变 | `/tmp/kits-quality-partial-cancel-resource-proof.log`；`/tmp/flowcube-kit-partial-cancel-final-proof.js`（0600） | exit0；user100–103停用，own设备/session删除，WH98–101无锁/预占，缓存等于ACTIVE容器，未实发不新增AR；失败user98–99也停用/删除设备会话，保留WH96–97真实业务锁审计 |

故障注入仅在该HTTP请求连接返回空的来源或本单预占读结果，用于证明原事务失败不解锁/不释放，未改业务数据库事实；不是现场数据已经缺失的模拟恢复。NULL-purpose兼容是SQL谓词/纯例覆盖，本轮新真实PICK记录使用purpose1。首次采购夹具合计误算保留 `/tmp/kits-quality-partial-cancel-fixture-po-sum.log`，不作验收依据；新增普通回归曾误以为旧ship响应有tasks（实际200/null），按成功订单查实际WT修正。该中断精确SO245在只读确认无PICK后，已由原cancel服务合法收尾，证据见资源日志，不强改状态。

受影响统一检查：金额26/26 `/tmp/kits-quality-final-money-pure.log`、商业16/16 `/tmp/kits-quality-final-commercial-pure.log`、原数量/上架契约20/20 `/tmp/kits-quality-final-affected-contracts.log`（合计62）；后端lint `/tmp/kits-quality-final-backend-lint.log`、query-loop `/tmp/kits-quality-final-query-guard.log`、CI资源守卫26/26 `/tmp/kits-quality-final-ci-resource-guard.log`均通过。新纯例最初隔离误加载环境JWT配置，已mock不受测scope依赖，不算业务红。文档守卫 `/tmp/kits-quality-final-doc-guard.log`自然exit0，最终diff检查通过。

失败资源边界：原审查SO211/WT197/I651仍锁、预占5；SO212/WT198/I653仍锁、预占0，资源日志只读确认未变。新owned业务红同样保留真实失败审计，账号/设备收尾不等于业务锁已净。最小恢复建议是先按精确PICK来源核对、在原SO/WT/库存锁下订正自身错误预占至真实待归还份额，再走正常PDA归还；单容器5→1、双容器已误释放后0→剩余1。不能min/cap假成功或借他单预占，本轮不执行旧失败数据修复。

本批只收口取消份额P1，尚待独立规格/品质复核。既有SO头仓+任务仓的归还范围要求未变，未独立验多仓订单限第二仓PDA归还授权；不得从本次数量绿推断权限政策已通过。未提交/推送/部署，远端CI、整批全量构建/回归、GUI、真机与纸张仍未验。

### C2 套单PDA归还权限P1收口（2026-10-02）

上一段数量修复阶段尚未验证的头仓授权问题，经独立真实对照后在本批窄修：SO X只协调同单预占，kit散件归还授权按当前WT仓库+真实设备绑定仓库。销售整单建改/占释/派发/取消/删除/来源退货全资源范围、直接取消销售WT禁令、ordinary与box路径保持。未改270–275或新增DDL/角色权限，root两份计划与旧红审计未修改。

新增校验接点为`scan-logs.controller`透传`req.pda.warehouseId`，`scan-logs.service`在当前WT锁之后、幂等begin/replay之前用`assertTaskScope`核用户范围/设备，业务当前WT再核。`sale.commercial-cancellation.lockReturnOrder`保留SO X但不要求PDA获得SO头仓范围，原数量与SO→WT→dim→container顺序保持。

| 验收 | 精确日志/metadata | 自然结果 |
|---|---|---|
| 修前：WT/设备/用户WH111，SO271头WH112；WT/detail200、SO403、合法归还被头仓挡403 | `/tmp/kits-cancel-task-scope-red.log`；`/tmp/flowcube-kit-partial-cancel-KPC-0d81b13c.json` | exit1；业务403≠201断言。扩大本轮actor范围后按原key合法归还并取消他单、资源收尾后才报红，不强写状态 |
| 修后package原5种数量/ordinary+新scope六例真实HTTP | `/tmp/kits-cancel-task-scope-final-green.log`；`/tmp/flowcube-kit-partial-cancel-KPC-6d6b0bfc.json` | exit0；SO293头WH116/WT241与设备WH115/scopeduser115仅WH115正常201，而SO GET403 |
| 当前范围/设备先于成功回执重放 | 同上 | 缩至头仓后成功原key403；完整actor范围下错绑头仓设备，新key403且无receipt/不解锁/预占不变，原成功key也403；body伪造设备仓不能替代req.pda事实；恢复本任务仓后原同payload/key/user/task结果重放且CANCEL_RETURN/receipt各一条 |
| 原5种数量、缺PICK/本单预占不足回滚、他单份额不变 | 同上 | 单/多容器、小数.1/.2、等量容器、ordinary规则全部自然绿，任务8/锁0/预占0；scope归还库存仍10、他单预占1，不产生实发/退款 |
| 精确五批新owned资源收尾、原审查红未变 | `/tmp/kits-cancel-task-scope-resource-proof.log`；`/tmp/flowcube-kit-cancel-task-scope-proof.js`（0600） | exit0；users107–115停用，device66–78/session删除，范围/临时角色权限清理；WH107–116无锁/预占、格空、缓存=ACTIVE；保留无权限角色与真实交易审计 |

首次reserve测试DTO漏warehouseName记录 `/tmp/kits-cancel-task-scope-setup.log`，另一次cleanup误用角色无deleted_at列记录 `/tmp/kits-cancel-task-scope-cleanup-setup.log`，均不算自然业务红；后者自身node57111已精确终止（非全局进程清理），对应业务已正常归还/取消，actor/device也已清理，最终资源proof只读复核。SO268 setup草稿在精确来源确认后通过原kit cancel服务正常收尾。脚本finally现在即使资源清理报错也关闭server/pool。

四个取消纯例（新增SO mutex一例）+原数量/上架20例共24/24 `/tmp/kits-cancel-task-scope-pure.log`，后端lint `/tmp/kits-cancel-task-scope-lint.log`、query-loop `/tmp/kits-cancel-task-scope-query-guard.log`、CI资源/PDA header守卫29/29 `/tmp/kits-cancel-task-scope-ci-pda-guard.log`均自然exit0。原package `smoke:sale-commercial-partial-cancel`已包含新scope，现CI同一实际step执行六例；未重复无关资金全包。文档守卫 `/tmp/kits-cancel-task-scope-doc-guard.log`与diff检查 `/tmp/kits-cancel-task-scope-diff-check.log`自然exit0。

此DONE仅本次权限P1实施，待独立spec/quality复核。旧quantity红单的错误预占仍保留，不由本修复自动修；只读cancel-return-detail仍显示容器余量，任务PICK/实物数量呈现属后续独立DTO/页面接点。未提交/推送/部署，远端CI、整批全量、GUI、真机与纸张边界保持。

### C2 最新归还权限独立规格再审（2026-10-02）

独立规格审查者使用新owned夹具执行同一package六种真实场景及来源/预占故障回滚，`/tmp/c2-respec-task-scope-package-green.log`自然exit0；24个受影响纯例/契约 `/tmp/c2-respec-task-scope-pure-green.log`自然exit0。SO304头WH118、WT247/设备WH117、仅WH117用户117：任务/归还详情200、销售整单403、合法归还201且同key一次；收窄范围或错误设备仓的新key和成功key均403，body不能伪造设备事实，错误新key无回执且PICK/锁/他单预占不变。只读代码确认SO锁只作协调，当前WT与task/device范围检查位于begin/replay前；销售资源范围闸门保留。

`/tmp/c2-respec-task-scope-resource-proof.log`自然exit0：users116/117停用、devices79–81及会话/范围/临时权限收尾、WT242–247全部8、own锁/预占0、格空、缓存等于ACTIVE、AR0、metadata0600，server/pool关闭，无打印资源。未修改旧失败审计。结论为完整最新后端**规格接受**，品质再审继续；PDA只读返库DTO数量呈现留到后续独立接点，页面、真机、纸张、远端CI、完整跨期与生产均未由本次证明。

### C2 完整最新后端品质接受及root检查点核对（2026-10-02）

独立品质再审 **APPROVED**，覆盖完整当前后端改动，无剩余确定阻断。原独立红场景的新owned复验 `/tmp/c2-quality-recheck-original-scenarios-green.log`自然exit0（SO306/307，单容器留1→0、双容器2→1→0）；六场景实际链 `/tmp/c2-quality-recheck-cancel-scope-green.log`自然exit0（SO317头WH121/WT255及设备WH120合法返库201、整SO读取403，范围/错设备先于新写/成功key重放）；24受影响纯例 `/tmp/c2-quality-recheck-pure-green.log`自然exit0。当前WT执行授权、SO互斥与库存锁顺序、来源守恒、直接取消WT拒绝均已读码确认。

`/tmp/c2-quality-recheck-owned-proof.log`自然exit0，新两批own预占/锁0、WT8、格释放、库存缓存=ACTIVE、actor停用/device/session/scope收尾、metadata0600、server/pool关闭。旧SO211/212错误份额及待归还实物保留，不由本改动自动修正。Root在Node22自行执行`npm run test:sale-commercial`17/17、`npm --prefix backend run lint`及`npm run test:agents-md-guard`自然exit0，原未暂存`git diff --check`通过；暂存包括新增迁移后，默认`git diff --cached --check`返回2，仅274第93行EOF空行。274已执行，按迁移不可改规则保留原字节；`git -c core.whitespace=-blank-at-eof diff --cached --check`自然exit0，未关闭其他空白校验。未重复无新疑点的资金全量，不以本地检查点代表已部署、完整C2或前端已完成。

### 成套配件维护前端切片（C2，2026-10-02）

本切片无需数据库或迁移，使用 Node22：

```bash
npm --prefix frontend run test:unit -- src/api/kits.test.ts src/hooks/useKits.test.tsx src/pages/kits/kitDraft.test.ts src/pages/kits/index.test.tsx src/router/kits.test.ts
./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit
cd frontend
./node_modules/.bin/eslint src/api/kits.ts src/api/kits.test.ts src/hooks/useKits.ts src/hooks/useKits.test.tsx src/types/kits.ts src/pages/kits src/router/kits.test.ts src/router/routeDefinitions.ts src/router/routeRegistry.ts
```

API单测核对真实分页与固定请求上下文；模型单测核对报价省略组成、原六位A价派生依据不被四位化、基本单位精度和全部显式比例；组件单测核对权限、服务端新版本/修订、409草稿保留与复制后显式重载、未知结果冻结原请求、删除原revision重试。原请求仅当前挂载页保留，未验证跨刷新恢复。单测不能替代真实GUI/API销售→履约→退货链路；全量构建与回归仍待本批发版前统一执行。

C2规格窄修回归另覆盖首次HTTP408→改输入/新提交被阻止→原键4xx重试仍未知、固定GET端点/代次与禁止fallback、A409→切B重载拒绝→回A保留原草稿、编辑及删除迟到读取的账号/代次校验、首次详情读取在端点切换后的迟到结果拒绝。独立复核探针保留在原只读目录，本批不修改其源或配置。

成套维护最终独立接受：规格`/tmp/c2-spec-backup-review-probes.log`33/33；品质原复制探针`/tmp/c2-quality-copy-recheck-green.log`15/15，旧红日志`/tmp/c2-quality-copy-probes.log`保留未改；新增备份边界`/tmp/c2-quality-backup-final-probes.log`5/5；完整当前7文件`/tmp/c2-quality-master-final-unit.log`59/59，TSapp/范围lint/diff均自然0。数量即时输入、精确四位报价/比例与原请求/读取来源保护不变。最终仅删除底部接口原始技术说明，双方只读核对，不重跑行为检查。

Root实际GUI在`flowcube_product20261001_fdb108_test`，API3011→自有故障代理3012→Vite5181（frontend工作目录、`DEV_API_TARGET=http://127.0.0.1:3012`，不含scheduler）完成创建A/B、报价100→123.4567与显式1:4改版、正常API并行改名修订3→4后真实页面409、保草稿/复制后继续编辑禁重载/再次复制显式重载、正常保存修订5。只读版本核查自然0，私有证据`/tmp/flowcube-product-c2-master-gui-evidence.json`0600，最终A id1/version3/revision5、B id2/version4/revision1；截图`/tmp/flowcube-c2-master-quote-gui.png`、`/tmp/flowcube-c2-master-conflict-gui.png`。最终文案重启后重新打开观察无createdAt技术段落，采样未知仍保留。

本次GUI没有同时更改组件A价，也未读回剪贴板字节；迟到复制竞态来自独立真实组件行为证据，不称已人工制造同样的GUI时序。三个自有服务自然退出0、端口无监听；浏览器close后即时列表短暂残留，第二次`agent-browser session list --json`确认本任务会话已消失。自有合成账号/设备保留供后续销售/PDA验收，未称已停用。未验证销售/退货整体页面链、原请求跨刷新、Android、纸张、员工效率或生产。

Root保存资料维护检查点前自行Node22执行前端约定5/5、前端API路由契约零缺口、AGENTS文档守卫及未暂存diff空白核对，均自然0。没有重跑已独立通过且行为未再改的59组件/API例或整批构建；完整C2后续切片的统一验证仍待执行。

C2备份竞态窄修的组件回归覆盖复制A在途改B后A迟到成功/失败、旧fallback不得承认B、当前手工文本确认及再次修改失效、改B再恢复A仍须新复制代次、复制时原来源/删除登录代次变化、数量输入即时精度保护及大额报价四位tooltip。组件回归不代表真实GUI剪贴板或生产验收。


### C2 三个只读接点专项（2026-10-02）

`npm run smoke:sale-commercial-readonly` 新增 Tests CI MySQL regression 实际 step，复用 lifecycle 的 readonly 最小切片：真实采购/PDA收货上架、A100+B200+ordinary30共享 hinge1/screw4 的完整套派发与真实 pick/sort/check/pack/client ack/ship；待执行 A0已发/占额度1，真实出库 A1/B0，关闭B后仍A1/B0。另核重复派发拒绝、active改变不抹已确认历史、跨订单坏事实409（仅自有事务rollback）、单批事实查询和不新增业务写锁。普通读兼容与取消归还读接点由原 `smoke:sale-commercial-partial-cancel` 同一CI step覆盖，未额外起浏览器/scheduler。

归还专项用本轮单容器PICK1/余量10、多容器各PICK1、小数.1/.2和普通单真实生命周期，核 `taskReturnQty/remainingQty/quantitySource` 与原qty、取消后未确认派发占用0、实际归还后预占/锁0，其他订单预占与实物库存保持。坏PICK缺失/串item/超余量/超picked_qty仅精确自有事务rollback，真实读helper拒409，两批查询与无FOR UPDATE/SHARE。第二仓合法HTTP原归还成功后本人base/exact回执200；SO详情仍403，任务范围撤销403、错task not_found、宽prefix403，换本人key的actor not_found。legacy base/exact、双候选not_found、存储尾ID与资源不符403、其他动作/非sale_out仍完整scope的HTTP验证以本轮原回执行为基础，在隔离事务修改证据并临时路由该请求的只读operation/WT查询，finally恢复pool.query并rollback；不提交坏事实。移除业务写权限后查询本人成功回执仍200且不带PDA头。

真实TDD初始红：`/tmp/c2-readonly-scope-red.log`（exit1：真实第二仓归还成功，详情无份额且base/exact原回执403）；`/tmp/c2-readonly-dispatch-red.log`（exit1：真实A出库关闭B后无商业派发字段）。第一轮绿为 `/tmp/c2-readonly-scope-green.log` 和 `/tmp/c2-readonly-dispatch-green.log`（均自然exit0）。最终扩展夹具输出见 `/tmp/c2-readonly-cancel-final.log`、`/tmp/c2-readonly-dispatch-final.log`，资源清理必须读取实际 `[cleanup proof]`，不能只依赖finally文案。运行前 validateTestEnvironment + SELECT DATABASE() 核固定本轮独立库，actor停用/device/session/scope精确收尾，业务审计行保留，旧失败夹具不复用/强改。

边界：本批未提交/推送/部署，未验证下一销售/退货/PDA前端消费、新GUI、真实PDA硬件或物理打印；测试打印客户端ack只证明完整业务履约闸门。全量套件留本批所有后续前端改动完成后统一验证。


最后历史兼容复核以当前写链实际形成：单套派发1→零出库执行期改单增为2→原WT完整实际确认。`replaceUnconfirmed` 留旧group inactive/confirmed_at=NULL，同WT7新group confirmed2；初读误拒真实 `/sale/362` 409（`/tmp/c2-readonly-withdrawn-real-red.log` 自然exit1），窄修仅允许inactive未确认WT7历史，仍不得累计旧group实发/占用；active未确认WT7继续拒。最终 `/tmp/c2-readonly-dispatch-final.log` 须含 `[PASS withdrawn actual]` 与正向收尾。纯规则17/17、受影响数量/上架/扫码30/30、后端lint、query-loop、API路由、CI资源26/26及文档守卫的原统一记录分别在 `/tmp/c2-readonly-{pure,affected-pure,lint,query-loop,api-contract,ci-resources,doc-guard}.log`；最后窄改只补相关read smoke/lint/diff/文档守卫，不重复无关资金全包。

### C2 smoke finally 品质P2收口（2026-10-02）

独立品质探针确认两个实际 smoke 的旧 finally 会覆盖原业务错误，lifecycle 的资源证明断言/查询错误还会跳过 server.close/pool.end。此轮仅修改 `tests/sale-commercial-lifecycle.smoke.test.js` 与 `tests/sale-commercial-partial-cancel.smoke.test.js` 的 main catch/finally：保存原业务错误，按 manifest、精确owned业务/actor/device/权限、资源证明分阶段尽力清理，各阶段失败带原因收集；最外层 finally 分别尝试 server.close 与 pool.end，一个关闭失败不跳过另一个。业务+cleanup同时失败用 AggregateError 保存全部原因；仅业务失败保留原异常；业务成功但cleanup失败仍自然失败。实际 main.catch 用 console.error(error) 输出完整错误及 cause，不仅输出泛化message。失败的审计事实仍保留，没有强写状态、预占或借用其他单据；正常业务清理仍走原 owned 取消/归还接点。

新增 `tests/sale-commercial-cleanup.test.js` 加入已有 `npm run test:sale-commercial`，Tests CI static job 在安装frontend TypeScript后实际执行。它解析真实两个 main，**仅替换业务体**，执行原 catch/finally 字节：分别验证原业务+断言/查询/manifest/device/server/pool失败、多个cleanup同时失败、单独cleanup失败与干净成功；24例、不加载app/DB/browser。初始旧路径红 `/tmp/c2-cleanup-runtime-red.log` 自然exit1（18例中14失败）；最终 `/tmp/c2-cleanup-runtime-green.log` 24/24自然exit0。仅在内存破坏错误保留或server关闭的反向probe分别自然exit1：`/tmp/c2-cleanup-guard-original-mutant-red.log` 16失败、`/tmp/c2-cleanup-guard-close-mutant-red.log` 24失败，工作树源码不被破坏。原独立审查脚本原字节重跑 `/tmp/c2-cleanup-quality-probe-green.log` 自然exit0，六个actual-finally模式均保留original且events为server.close/pool.end。

实际outer main.catch输出探针 `/tmp/c2-cleanup-original-plus-cleanup-failure.log` 自然exit1，输出原业务、清理query、server.close、pool.end四个可定位原因；`/tmp/c2-cleanup-success-plus-cleanup-failure.log` 业务体成功但cleanup三处失败仍自然exit1，两个关闭均尝试。这些离线探针不创建DB资源，不能替代实际smoke集成。

真实集成仅各跑一次：`/tmp/c2-cleanup-readonly-actual-green.log`、`/tmp/c2-cleanup-cancel-actual-green.log` 均自然exit0，validateTestEnvironment+SELECT DATABASE固定本轮kits独立库。owned manifests `KLC-2d06760d` 与 `KPC-db31a259`：readonly actor/device/lock/reserve全0；完整取消actor/device/session/scope/lock/reserve/stockCacheMismatches全0；`[cleanup proof] verified:true`表示已执行的owned事实证明通过，随后最终成功文案仅在transport关闭也成功时输出。原业务失败或任一cleanup失败不能称smoke通过。产品backend/DTO/write/DDL及root plans未改；新GUI、真机/实际出纸、远端CI、统一全量回归、生产仍未验。

### C2 三项只读接点最终独立接受（2026-10-02，本地）

独立规格已接受产品读取链：`/tmp/c2-independent-spec-{readonly,partial-cancel,commercial-pure,query-loop,dispatch-probes,cancel-probes-valid,scope-probes,final-proof}.log`均自然exit0。新增11项dispatch检查、10项PICK错误来源与本人回执反例、历史零量仓读取403实际验证；7份manifest/14actor/26单的最终资源计数0。NOT NULL列故障注入及宽prefix错误预期曾导致探针中止，日志保留且精确自有单据随后由新actor正常API收尾，不计业务red。后续同规格只读核测试finally窄修，并独立24/24守卫自然通过`/tmp/c2-independent-spec-cleanup-guard.log`。

最终同品质接受：`/tmp/c2-quality-readonly-finally-recheck-green.log`复验原actual-main故障，`/tmp/c2-quality-cleanup-commercial41-green.log`41/41；离线真实outer-catch子进程探针`/tmp/c2-quality-cleanup-natural-failure.js`的四次故障均自然exit1，原业务和query/server/pool原因完整保留。两条独立实际HTTP链`/tmp/c2-quality-cleanup-readonly-real-green.log`、`/tmp/c2-quality-cleanup-cancel-real-green.log`自然exit0；`/tmp/c2-quality-cleanup-resource-proof.log`正向核自有KLC-d8a13308与KPC-1eeeae09身份/设备/会话/范围/预占/锁/格/打印配置清零、缓存闭合、metadata0600，两个进程自然结束。旧失败审计与root GUI资源原样。

Root自行Node22运行新守卫24/24、自然exit0（`/tmp/c2-root-cleanup-guard.log`），核最终产品diff与两份计划并保存本地检查点。Root后续GUI的独立打印前提通过正常登录/API建立本仓17配置2（`/tmp/flowcube-product-c2-gui-printer.log`自然exit0），暂留后续验收，自有临时server/pool已关闭。没有真实出纸证据；销售/来源退货/PDA消费和最终统一验证继续，不以本检查点宣称完整C2、远端CI或部署。

### C2 第二批销售前端专项（2026-10-02）

在 Node22 环境，当前商业销售组件/API风险用例可用 `cd frontend && npm run test:unit -- src/pages/sale/commercial src/hooks/useCommercialSale.test.tsx src/api/sale-commercial.test.ts src/router/sale-commercial.test.ts`；均使用纯组件和 API mocks，不需数据库。覆盖共享组件整车预览、缺货仍可保存、四位包装依据、默认普通客户变价与人工/旧套保护、原单初始化/改单头只读、409 保草稿/复制竞态、408 原体原键冻结、双标签及端点/账号代次迟到隔离、商业派发确认与历史桥、客户打印新四位/旧两位与关闭包装口径、原履约事项动作/日期入口和固定来源、局部返回放弃确认、整数基本单位与辅助单位区别、头部普通默认缓存/API兼容和套销售读取/地址维护迟到来源拒绝。bootstrap 外国 kit 缓存只能触发 owned 重读，不能直接初始化编辑器。

受影响旧回归包括 `src/pages/sale/form`、`src/components/shared/OrderFulfillmentPanel.test.tsx`、`src/components/shared/OrderFulfillmentPanel.handoff-refresh.test.tsx` 、`src/components/finder/CustomerFinder.test.tsx` 和 `src/lib/printTemplatePreview.test.ts`。类型检查仍须 `tsc -p tsconfig.app.json --noEmit`，对改动路径执行 scoped ESLint。本批未跑全量构建/全量回归，留给本批集中验收；组件通过不是 GUI、生产、真机或物理打印证据，第三批来源退货与持久化原请求查询也未完成。

C2 第二批规格审查原字节探针 `address-reopen`、`gate-title`、`detail-retry` 分别复现自然失败后由窄修通过；原探针组合记录 `/tmp/c2-sales-spec-fixes-green.log`（3 文件 / 6 用例，自然 exit0）。仓内新增地址重开/同值重开/改后恢复原值和确认重试后原键重读最新派发额度回归，kit bootstrap 标签边界与同 ID 仓名断言补入既有 mounted 用例。探针/组件证据不代表真实 GUI。

`gate-late-bootstrap` 原字节探针复现 legacy 晚到普通单使已识别套 gate 退出的自然红；窄修日志 `/tmp/c2-sales-gate-late-bootstrap-green.log`。仓内 `modelGate.test.tsx` 覆盖读取仍 pending 时晚到普通 DTO、原标签保持及最终 owned 实际数据套用。

`gate-context` 原字节 probe 在同 SO 迟到 legacy 普通结果后改变 handoff 参数复现自然红；绿记录 `/tmp/c2-sales-gate-context-green.log`。仓内 `modelGate` 同时核同 SO handoff 保持 gate、实际换 SO81 普通资源重新判型。

实际 preview 原说明字符串的 mounted 文案红/绿记录 `/tmp/c2-sales-preview-copy-{red,green}.log`；映射后仍保留追加原因及缺货可保存事实。

`SaleOrderOverview.test.tsx` mounted 覆盖 4 成交行/2 物理 SKU、零目标历史不计当前及普通旧计数/金额卡兼容；实际 red/green 日志 `/tmp/c2-sales-overview-{red,green}.log`。

`CommercialEditor` mounted 复现选择包后基本单位个消失的自然红，修后保留基本单位并核回个的 preview entry；日志 `/tmp/c2-sales-unit-return-{red,green}.log`。

独立 QUALITY 原字节 `owned-cache-reopen` 的旧同源缓存首帧入草稿/新 GET 到达仍旧基线两断言亲自自然 red→green，绿记录 `/tmp/c2-sales-owned-cache-green.log`（1 文件2例）；仓内 `modelGate` mounted 补同 owned 缓存重开等待、新 revision 初始化、后台成功/失败不覆盖固定基线。

此初始化窄修另有 KIT80→KIT81 的 pending/已初始化两种 mounted 时序，稳定 `saleId` key 重挂新 gate，同 SO handoff 不重挂；旧80迟到结果不得入81。受影响回归记录 `/tmp/c2-sales-owned-cache-affected-green.log`，未为这两个边界人为移除已存在的 key 制造红。
第二批最后缓存初始化窄修的fresh规格真实整页探针6/6（`/tmp/c2-fresh-narrow-spec-green.log`）及modelGate7/7（`/tmp/c2-fresh-narrow-modelgate-green.log`）自然通过；同品质原字节2/2、app类型、scopedlint与diff通过，最终接受。Root接口对应、前端约定5/5、文档守卫自然exit0，日志`/tmp/c2-sales-root-test-*.log`。Root实际隔离GUI的SO15混合开单/2包12.3456/354.69/4成交行、parent打印四位单价、整单占库23+8、A1派发WT31实发仍0以及正向只读SQL核对，0600证据`/tmp/flowcube-c2-sales-gui-evidence.json`。本任务browser与三个services自然关闭且端口空；自有账号/设备/SO/WT/打印配置暂留后续链。此处仍不代表统一全量、刷新恢复、真实仓库完成/退货整链、真机、实纸或生产验证。
