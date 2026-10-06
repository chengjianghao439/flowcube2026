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

安全扫描整改入口（2026-10-06）：`npm run test:security-scan-remediation` 是离线真实函数/HTTP/子进程及发布契约回归，需安装前后端依赖，不连接数据库；`npm run smoke:security-scan-remediation` 串行验证新增迁移重放/schema、资源范围、会话族和随机打印凭据，必须先按下文加载显式独立测试环境并完成迁移，不能连接生产。两者分别接入 Tests 的 static / MySQL job；本地通过不代表远端已运行。原主链路、打印、认证及导入回归仍需按受影响范围补跑，完整发版门禁保持。27 项证据及部署边界见 `docs/security-scan-remediation-2026-10-06.md`。

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

`npm run test:party-profile` 是不启动应用、不连接数据库的真实 routes/service/导入/导出离线回归：仅 stub 数据库、鉴权及库存依赖，覆盖两主档字段、Unicode、原权限/唯一性、旧模板及地址尾列、原行号错误和 276 迁移的条件式源码/元数据计划。已接入 Tests CI static job；迁移 stub 不证明 MySQL 执行。`test:export` 另回读真实 XLSX 的完整名称/地址与换行行高；前端资料表单、跨端规则、打印数据适配和真实打印组件的受控 DOM 用例由既有 `npm --prefix frontend run test:unit` 通配发现并接 CI。GUI、Excel 客户端、真实 DB 与物理打印仍须独立验收。

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
运维/迁移回归（static job 「运维回归」步骤）：`node --test tests/ops-alert-notifications.test.js tests/ops-monitor-restore.test.js tests/deployment-resources.test.js tests/restore-trigger-normalize.test.js tests/migration-trigger-bodies.test.js`。前两项验备份恢复判定与资源边界，后两项验触发器分号规范化与迁移逐条切分，均不连数据库。

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


### C2 退货来源批次标签窄验收（2026-10-02）

`npm run smoke:sale-commercial-source-metadata` 复用 lifecycle 的 `KIT_TEST_SLICE=source-metadata` 最小路径，已接 Tests CI MySQL regression 的实际 step；不重跑后续全部金额场景。仍先 `validateTestEnvironment` 与 `SELECT DATABASE()`，Node22 / 显式回环独立库 `flowcube_kits20261001_7e429c_test`，正常采购/PDA收货上架、完整套 pick/sort/check/pack/client ack/真实 WT7 后读 source GET 与创建后保存 SR GET。`tests/sale-commercial-source-metadata.test.js` 六例已接 `test:sale-commercial` static：当前 flag 0/1/NULL、缺商品、同 SKU 不同批次各自时间/单号、单批无锁与缺标签 null。初次纯例隔离依赖误加载 JWT 配置失败不计业务红；隔离非受测 money adapter 后的纯例红才是字段缺失/缺 helper。

真实原字段缺失红 `/tmp/c2-source-metadata-red.log` 自然 exit1，owned manifest `/tmp/flowcube-kits-lifecycle-KLC-6a562a36.json`：SO420/WT313/SR166 的 GET 成功而 taskNo、confirmedAt、仓名、数量提示、保存 source 缺失；正常取消本轮草稿 SR、关闭销售且账号/设备/锁/预占为0后报原断言。初绿 `/tmp/c2-source-metadata-green.log` 自然 exit0。最终扩展 `/tmp/c2-source-metadata-final-green.log` 自然 exit0，manifest `/tmp/flowcube-kits-lifecycle-KLC-ee7fd079.json`：SO423/WT316/SR169，原预算80、合格退1实际金额80/AR20不变；只具 return.view/create、仅 WT 仓范围的账号 SR GET200，整SO source GET403/无sale.view，撤销 SR 仓范围后详情403。普通 SO424 来源与 SR170 保存详情均无新商业字段、金额30；普通草稿SR最终正常取消。

九种失配（product、sourceItem、commercialComponent、dispatchComponent、SR原SO、SR仓、d.group、WT原SO、WT仓）只在本轮拥有的行上做 rollback-only 事务。仅将 saved metadata 的一个 SELECT 定向读到该事务，实际 HTTP GET 其余鉴权、scope、原退货头/明细仍走原 pool；均返回 source:null，头/行金额80不变。随后回滚、恢复 pool.query，正例标签仍对应本批，不提交损坏事实；这不是现场已有坏数据恢复证明。

`/tmp/c2-source-metadata-pure.log` 自然 exit0 47/47（含原24项实际 main/finally故障守卫、新6例）；`/tmp/c2-source-metadata-{lint,query-loop,api-contract,ci-resources}.log` 均自然 exit0，资源守卫26/26。精确三批复核 `/tmp/c2-source-metadata-resource-proof.log` 自然 exit0，脚本 `/tmp/c2-source-metadata-resource-proof.js`（0600）：5个actor停用、各自device/session/scope/permission、业务锁/预占、分拣格占用、cache mismatch、打印绑定/在线本轮printer、未完成退货任务均0；3份 manifest 0600，5张销售及真实交易审计保留。两个绿与原红进程均自然结束，server/pool 关闭；不复用或清理旧失败夹具、root GUI库。对应文档守卫与最终 diff 检查记录 `/tmp/c2-source-metadata-doc-guard.log`、`/tmp/c2-source-metadata-diff-check.log`。未验前端GUI/真机/物理出纸、远端CI、发版前统一全量和生产；没有迁移、写规则、提交/推送/发布。


### C2 来源元数据事务 cleanup 窄修复验（2026-10-03）

独立品质原探针 `/tmp/c2-source-metadata-quality-rollback-red-recheck.log` 记录 inner metadata rollback-only 事务的旧 finally 在 rollback 失败时丢失原业务异常、且不尝试 release。此次仅补 lifecycle 的这段 cleanup：先恢复 `pool.query`，rollback 与 release 分别尽力，保存原业务错误与每个清理原因；finally 后才抛聚合或原错误。业务与清理同失败时 `AggregateError.cause` 指向原业务错误；业务成功而清理失败仍报错。没有修改产品读取/写入、DDL、原 outer main cleanup 或 root 两份计划。

新增8模式守卫继续从实际 inner try/catch/finally及紧随的聚合/原错 throw 提取 AST 原字节，只替换业务体，成功模拟不提前 return 绕过 post-cleanup。原24项 main 守卫字节与 HEAD 完全一致。最初对正常控制流要求的红 `/tmp/c2-source-metadata-cleanup-postfinally-red.log` 自然 exit1（原24通过、新8失败）；完成移动后 `/tmp/c2-source-metadata-cleanup-guard-green.log` 自然 exit0 32/32，商业纯例 `/tmp/c2-source-metadata-cleanup-pure-green.log` 自然 exit0 55/55。上段47/47是2026-10-02补 inner 守卫前的历史结果，不是当前计数。

品质原 `/tmp/c2-source-metadata-quality-rollback-probe.js` 仅适配实际事务 AST 定位、声明及 post-cleanup 原字节，保留原业务/release断言并补递归 rollback 原因核对；`/tmp/c2-source-metadata-quality-rollback-probe-green.log` 自然 exit0，原业务与 rollback 原因均保留，events为 rollback/release。`/tmp/c2-source-metadata-cleanup-old-finally-hook.js` 仅在内存恢复旧 finally、不改工作树：`/tmp/c2-source-metadata-cleanup-old-finally-mutant-red.log` 自然 exit1（26/32，6个故障模式失败），原品质断言重跑 `/tmp/c2-source-metadata-quality-rollback-mutant-red.log` 亦自然 exit1（原业务错缺失、events仅 rollback）。这两项反向结果证明新增守卫能拦实际旧缺陷。

Node22（v22.23.2）下新增 cleanup 守卫 scoped lint `/tmp/c2-source-metadata-cleanup-guard-lint-green.log` 自然 exit0。对 lifecycle 使用同 backend ESLint 配置的 `/tmp/c2-source-metadata-cleanup-narrow-lint.log` 自然 exit1，仍有7条错误；`/tmp/c2-source-metadata-cleanup-lint-baseline-proof.log` 对 HEAD 与当前同配置/同文件名的 JSON 结果逐项比较自然 exit0，新增错误0（保留既有 no-useless-catch、4处 no-unused-vars与原 outer finally 2处 no-unsafe-finally），不称 lifecycle 全文件 lint 通过。文档守卫及 diff 检查记录 `/tmp/c2-source-metadata-cleanup-doc-guard.log`、`/tmp/c2-source-metadata-cleanup-diff-check.log`。此次全为离线纯验证，无数据库、服务器或浏览器资源，也没有重跑上段真实 WT316/SR169 与三批资源 proof；GUI/真机/实纸、远端 CI、发版前统一全量和生产边界保持未验，未提交/推送/发布。

### C2 第三批前端窄验收（2026-10-03）

在 Node 22（先加载 `~/.config/flowcube/dev-env.sh`）的 `frontend` 目录运行：

```bash
npx vitest run src/hooks/useCommercialRecovery.test.tsx src/hooks/useKitOperation.test.tsx src/lib/kitRecoveryIdentity.test.ts src/hooks/useCommercialSale.test.tsx src/pages/sale/commercial/CommercialEditor.test.tsx src/pages/sale/commercial/CommercialSalePage.test.tsx src/pages/returns/sale/form/sourceReturn.test.tsx src/pages/pda/cancel-return.test.tsx
npx tsc --noEmit -p tsconfig.app.json
```

专项检查覆盖来源不自动全选/同品分单/原快照/真实创建 zod schema、来源读取迟到、普通原单兼容、净金额四位、SR 无回执的当前事实核对、销售八动作原 action、query-first 原 body/key、外国成功/失败回执、合法 failed 无资源字段、真实 auth persistence rehydrate 代次 0 与模块重载、登录旋转及续期保持、存储阻断与业务已确认但清理失败、两个原资源草稿、Editor 迟到/复制记录不能关闭新草稿、PDA task 1 vs barcode 10、原 task/container/location/box context 和塑料盒/拆箱兼容。相关 frontend 文件另做 scoped eslint 和 `git diff --check`。

这些是组件/实际 hook 与离线 DTO 契约证据，不是实际 GUI、真机或生产证据。统一构建、全量前端/后端套件及实际 GUI 由整批验收阶段集中执行；本专项不启动服务、不跑数据库清理、不改生产状态。

初次交审的8文件59例自然通过记录 `/tmp/c2-third-final-focus.log`；当时 app 类型、scoped frontend lint、diff 的自然退出记录分别为 `/tmp/c2-third-final-types.log`、`/tmp/c2-third-final-lint.log`、`/tmp/c2-third-final-diff.log`，均 exit0。首次最终回归58/59的失败属于测试跨模块重载保留旧文档监听器，已在测试收尾按真实文档销毁移除；产品身份观察仍由 main 静态导入覆盖真实登录/退出。

原行为红证据：query-first与外国成功回执 `/tmp/c2-commercial-red.log`，外国 failed `/tmp/c2-failed-identity-red.log`，草稿 scope 迟到 `/tmp/c2-scope-red.log`，来源自动选入 `/tmp/c2-source-red.log`，真实创建 schema `/tmp/c2-source-schema-red.log`，SR 当前事实入口 `/tmp/c2-facts-red.log`，PDA 数量与原查询入口 `/tmp/c2-pda-red.log`。身份观察与来源存储阻断的实际旧行为反向验证分别为 `/tmp/c2-identity-red-mutation.log`、`/tmp/c2-source-storage-red-mutation.log`；测试结束恢复产品原字节，最终59例包含相应反例。普通塑料盒、拆箱、普通销售/退货兼容均属组件证据，未升级为现场业务或设备证明。

独立 SPEC 后的单项时序修复：原探针字节 `/tmp/c2-independent-spec-probes/source.test.tsx` 的核对后刷新在途例亲自复跑 `/tmp/c2-spec-ack-original-red.log` 自然 exit1，23/24，旧确认 API 被调2次；修后原探针 `/tmp/c2-spec-ack-original-green.log` 自然 exit0，24/24。仓内 source 组件增加8例，确认/取消的刷新在途与成功、失败后显式只读重试，以及外资源、旧 status、同 UID 重登和离页：旧实现 `/tmp/c2-spec-ack-components-red.log` 自然 exit1（原9通过、新8失败），修后 `/tmp/c2-spec-ack-components-green.log` 自然 exit0，17/17。持久记录仅在原身份详情成功并匹配当前事实后清理，error+旧 data 不被当作成功。对应 app 类型/scoped lint/diff/文档守卫记录 `/tmp/c2-spec-ack-{types,lint,diff,docs}.log`；这次只复跑受影响 source 与独立原探针，没有重复其余无变化前端套件或启动资源。

独立 QUALITY 后三项窄修覆盖 actual `SaleFormPage`/gate/Editor handoff 正常写、unknown 原 key/body 重试、handoff URL 下 query-only 刷新及不同 SO 隔离；CommercialSalePage 同样覆盖正常发货/未知重试/刷新。PDA 组件改用真实 `usePdaCancelReturnDetail` 和 typed warehouse API，覆盖 owned cache/fixed GET、读前拒绝、A 开始 GET→B→A 后响应、DTO 的原 id、读后 owner 变化、loading/403 下 row/box 查询、查询失败重试、无扫码以及无 owner 默认兼容/legacy 人工阻断。旧行为 `/tmp/c2-quality-owned-components-red.log` 自然 exit1，15反例红、其余20例绿；修后受影响3文件36/36自然 exit0，记录 `/tmp/c2-quality-owned-components-green.log`。app 类型/scoped lint/diff/文档守卫分别记录 `/tmp/c2-quality-owned-{types,lint,diff,docs}.log`，未重跑其余无变化套件。

独立 handoff 原探针字节 `/tmp/c2-independent-quality-probes/handoff.test.tsx` 亲自复跑自然红 `/tmp/c2-quality-handoff-original-red.log`，修后 `/tmp/c2-quality-owned-handoff-original-green.log` 自然 exit0 12/12。PDA 原探针字节亦保留：修前 `/tmp/c2-quality-pda-read-original-red.log` 的 QUALITY 三触发为 control 绿、403入口/跨源 body 红；整个原文件另有4个继承测试未设置 actual GET 夹具，不计产品回归。修后以 `-t QUALITY` 精确复跑 `/tmp/c2-quality-owned-pda-read-original-trigger-after.log` 自然 exit1，2绿、1红、4跳过；剩余仅旧中间断言要求切 B 后 GET 次数2，而正确读前身份拒绝保持1，尚未走到其 foreignFinish。该原 probe 不称通过，由独立 QUALITY 调整临时触发夹具再证伪，产品不为维持第二次 foreign GET 绕过守卫。仓内固定 A 请求、wrong ID/owner 和 no foreign body 的新时序另有自然红绿证据，仍属组件/API契约而非现场库存损坏或实际 GUI 证明。

统一前端 unit 后的旧手输入测试夹具修复，仅改 `return-scan-ui.test.tsx` 与本说明，不改业务 guard。原最小复现 `/tmp/c2-return-scan-original-red.log` 自然 exit1：取消退回例对 null 调用 HTMLInputElement setter。`/tmp/c2-return-scan-fixture-rootcause.log` 的临时独立对照自然 exit1（5绿1红）：当前页旧 fixture 未登录、旧 hook 被硬 mock 成已加载且旧 CriticalAction 被 mock 开放，新 owner 守卫使手输按钮 disabled、input 不存在；不是实际 GET loading 失败。仅给同原 fixture 加真实 login，当前两例通过；HEAD 原页面与原未登录 fixture 两例亦通过。临时比较没有改工作树业务文件。

修后 fixture 使用真实 authStore 登录、actual owned detail hook 和 typed warehouse/location API，只 mock payload client；保留真实 PdaScanner 手动输入进入原容器/原库位流程，并核 POST 的 task1/container7/location6/barcode、原 endpoint、会话代次、PDA header 与稳定请求键。新增 loading 无扫码/无提交及未登录 GET 前拒绝/无扫码守卫。`/tmp/c2-return-scan-green.log` 自然 exit0 4/4；app 类型/scoped test lint/diff 记录 `/tmp/c2-return-scan-{types,lint,diff}.log`。这次仅最小组件/夹具验证，不重跑全量、启动 GUI/服务/数据库或作为实物归还证明；root 的实际 GUI 作业保持独占，后续独立窄 SPEC→QUALITY 再接统一验收。

统一前端 unit 的下一轮 `/tmp/c2-final-frontend-unit-after-fixture.log` 当时187文件/1071例通过但有1个未捕获异常，自然 exit1，不能称整套通过：真实 Radix focus-scope 卸载 `setTimeout(0)` 中 `dispatchEvent` 收到非该 jsdom realm 的 Event。`kits/index.test.tsx` 的 helper 原 finally 同步 unmount 后直接返回，而 Vitest jsdom 环境 teardown 会关闭窗口并恢复全局构造器。原文件19/19与最后一例各自隔离自然 exit0（`/tmp/c2-kits-focus-{file,last}-original.log`），没有把隔离结果冒充该整套时序复现。

新增真实 Dialog DOM 事件守卫证明原 helper 返回时卸载 autofocus 尚未执行：`/tmp/c2-kits-focus-cleanup-red.log` 自然 exit1，事件0次而预期1次。只将此 fixture finally 改为在原 realm 内 `await act` 完成 unmount 与真实 `setTimeout(0)` 回调，再清 cache/host；不 suppress/ignore 异常、不 mock Radix 或改产品。最小守卫 `/tmp/c2-kits-focus-cleanup-green.log` 自然 exit0，1/1；文件 `/tmp/c2-kits-focus-file-green.log` 自然 exit0，20/20；scoped test lint与diff `/tmp/c2-kits-focus-{lint,diff}.log` 自然 exit0。

跨 realm 机制另由临时 `/tmp/c2-kits-focus-realm-repro.cjs` 受控模型复现：真实 React/FocusScope 挂载卸载后，模拟关闭 jsdom 并恢复全局构造器的 realm 切换。脚本实际先恢复全局构造器再关闭窗口，Vitest 实际先关闭再恢复，因此该模型不是对 Vitest teardown 顺序的逐步复刻，也不是原整套异常的稳定复现。未等待策略 `/tmp/c2-kits-focus-realm-undrained.log` 自然 exit1，同 `dispatchEvent` 非 Event 和 FocusScope timeout 栈；等待真实卸载回调的策略 `/tmp/c2-kits-focus-realm-drained.log` 自然 exit0，恢复环境前后均仅1次合法 CustomEvent。该临时机制模型与仓内清理守卫是不同证据；原整套未捕获异常是否已完全消失仍待 root 最终统一单测，不用20/20替代。此次仅改本测试清理/守卫与说明，没有产品文件、服务、数据库、浏览器或提交操作。

实际 GUI 发现商业销售未知操作的确认层遮挡页面查询入口后，窄修仅在父页 `pending && !busy` 时收起确认与发货弹窗；不清请求、发货数量或写阻断，不改变终端业务拒绝的原弹窗。使用真实 ConfirmDialog/AppDialog 的4动作和真实发货弹窗，并核请求在途时取消/关闭/Escape、原查询可达、显式同 key/body 重试、明确400与刷新后删除原回执只读不关闭页面。最终16例反向移除这6行修复后 `/tmp/c2-commercial-dialog-red-final.log` 自然 exit1，7红9绿，红均真实弹窗未收起；产品字节随后恢复。最早红日志 `/tmp/c2-commercial-dialog-red.log` 有1例释放按钮文案夹具错误，已纠正，不把该例计业务红。修后 `/tmp/c2-commercial-dialog-green.log` 自然 exit0，16/16；app 类型/scoped lint/diff/文档守卫为 `/tmp/c2-commercial-dialog-{types,lint,diff,docs}.log`。这是组件与 hook 接入点证据，实际断网 GUI 复验、全量与资源收尾由 root 独占执行，本窄修未操作浏览器、服务或数据库。

后续实际 GUI 中原业务已提交、前端仍待查询时，底层通用“操作失败，请稍后重试”与未知恢复指引冲突。本页保留原 `error || write.error || backup.error` 优先级，仅在 `write.pending` 且选中错误精确等于该通用句时替换为“原操作结果待确认，请先查询原回执”；原查询未找到、会话变化、存储清理失败及备份错误仍显示，终端400原文不变。真实弹窗17例的最终原展示 `/tmp/c2-commercial-wording-red-final.log` 自然 exit1，四确认动作显示定性失败句、其余13绿；修后 `/tmp/c2-commercial-wording-green.log` 自然 exit0，17/17。新增真实原请求待确认后会话变化的只读查询守卫，确认拒绝原文、未发 GET/POST且记录未清；现有4动作还核 not_found 原文。`/tmp/c2-commercial-wording-specific-red.log` 自然 exit1 证明把所有 pending 错误覆盖成统一句会掩盖该拒绝原因，因此不采用全覆盖提示。scoped lint/diff/文档守卫 `/tmp/c2-commercial-wording-{lint,diff,docs}.log`，不改 hook、请求、回执或弹窗逻辑。本轮未跑全量或操作 GUI/服务/数据库，等待顺序 fresh SPEC→QUALITY 后由 root 收尾。


### 2026-10-03 C2f：双草稿、迟到预览、四位净额列表补验（本地）

隔离库仍为flowcube_product20261001_fdb108_test，所有helper先validateTestEnvironment并核SELECT DATABASE()；合成owner=CGU-56520aee/仓17，未读写生产。SO25/26实际ERP工作区编辑、迟到真实预览、各自保存；SO27正常API采购→入仓→占库→仓库完整出库，SR4/5正常API确认→实收→合格QA→上架完成，随后实际ERP详情/来源选择与修后列表核四位。本次接口和只读SQL断言自然exit0，证据/tmp/c2-next-final-business-proof.json（600）及同名log；截图/tmp/c2-next-late-{A-response-B-unchanged,A-draft-retained}.png、/tmp/c2-next-tiny-{return4-detail,return5-detail-after-fix,source-cumulative,list-after-fix}.png。迟到原预览真实200与release的held=1/delivered=1/aborted=0保存在/tmp/c2-next-preview-latency-proof.jsonl（600），不是伪造响应。场景结论与局限见主计划本轮节。

列表修复的红→绿：新真实ReturnsPage例先因可见0.01而非0.0050失败，普通采购/销售例保持绿；后端契约先因无显式标记失败。测试夹具首次缺mock导出只是搭建错误，不作为产品红。最终新前端2/2及后端契约2/2绿；新后端用例沿现有test:sale-commercial执行。独立审查自行重复上述四例、正确tsconfig app类型和diff，并核已有return_id索引；没有实际EXPLAIN或测得性能收益。

本轮最终命令：npm --prefix frontend run test:unit（188文件1084项，自然exit0，/tmp/c2-next-list-full-unit.log）、npm run test:sale-commercial（56项exit0，/tmp/c2-next-list-commercial.log）、tsc --noEmit -p frontend/tsconfig.app.json（0）、分别在frontend/backend目录执行受影响文件eslint（0）、npm --prefix frontend run build（0，/tmp/c2-next-list-build.log）。整套单测仍有23条jsdom请求AggregateError控制台输出，与/tmp/c2-final-unit-checkpoint.log相同；测试自然结束、无Vitest未捕获错误失败，不称日志零噪声。没有重跑PDA构建、全后端、远端CI或完整跨期；这批局部只读marker/列表显示不能取代发版前统一回归。

资源：本任务Playwright finally退出0；API/代理退出0；Vite精确核本任务PID与完整命令后SIGTERM退出143。最终自有helper无进程、3011/3012/5181无监听、agent-browser session list为空，/tmp/flowcube-c2-next-resource-proof.json。预览重启时曾错用仓库根cwd造成Tailwind配置失败，已仅修到frontend cwd、重新启动并实际复验。合成资料和交易审计保留，无全表清理或生产操作。临时文件只是本机本轮证据，并非永久归档或他机可复现命令。


### 2026-10-03 B3–B6 日常工作衔接（本地整批）

授权范围是仓库下一步、财务来源/往来导航、物流打印解释及常用入口；不含到货建单或采购跟进，不改库存/财务写政策或数据库。完整流程、检查结果与现场边界见 `docs/superpowers/plans/2026-10-03-workflow-continuity.md`。

先加载 `~/.config/flowcube/dev-env.sh` 的 Node22，再在工作树分别执行：

```bash
npm --prefix frontend run lint
npm --prefix frontend run test:unit
# 类型检查明确进入 frontend；随后回到工作树根目录：
(cd frontend && npx tsc --noEmit -p tsconfig.app.json)
# 同一个 frontend/dist，必须串行：
npm --prefix frontend run build
npm --prefix frontend run build:pda
```

本批最终前端195文件/1226项自然通过；初次2项旧首页夹具失败后补真实路由环境，未删除原布局断言。lint为0错误、33警告；23条既有jsdom请求AggregateError控制台输出保留，不称日志零噪声。app类型和两种前端构建通过。三个只读来源投影服务做 scoped 后端 lint，独立测试库 `payments-default-scope.smoke.test.js` 7项通过；未跑全后端/跨期或远端CI。轮询门禁旧白名单行号104→105与现页对应，未放宽频率/分页规则；其他权限、路由、前端约定、查询循环、打印入口及文档守卫通过。

正常Chrome验证本批代表流程及原查询保持，正常GET核受控金额/状态与基线一致；B3是键盘扫码，箱贴只模拟原客户端回报。PDA构建、队列回执和手工运单不能代表真机、实际出纸和官方承运商。发版前仍须跑对应后端及整体回归并现场验收，不把本轮前端全量绿当所有既有C2/C4流程已验收。

### 2026-10-03 C2/C4 财务及受控跨期专项

`npm run smoke:product-finance-period`（`tests/product-finance-period.smoke.test.js`）接入 Tests CI 的 `prelaunch-regression` 独立矩阵项 `product-finance-period`：每项启动自己的全新 MySQL、完成迁移后单独运行，避免公司级凭证生成/结账扫到共享回归夹具。显式独立测试库、随机回环 HTTP 端口、自有商品/仓库/账号/PDA会话/打印绑定与现金账户，不借既有库存、不全表清理；所有出库、质检上架、资金登记、采购退货、结账/补录审批及凭证生成都走真实 HTTP。直接建基础合成主档，不强写业务 status、paid 或退货执行事实。本地运行与 CI 接线是两类证据，未据此声称远端 CI 已通过。

C2：套价100、原数量3/毛额300/折扣30.0101，真实分两批各发1，净应收89.9966→179.9933，会计收入90与89.99、原成本各22。关闭剩余头额保留已发毛额200，应收仍179.9933，原毛额/折扣依据不变；第一批组件2件分两次真实退1，独立字面预期核实际实收行的四位财务净退款35.9987与35.9986，累计来源毛退款80/净退款71.9973，应收143.9946→107.9960及HTTP回读一致；两次会计凭证按现行两位口径各冲36与原成本7。自有商品主档成本改成99后仍用原 `cost_snapshot=7`。核已闭出库月原收入/成本凭证及分录在后批出库、关闭剩余和后期退货之后不漂移；重复生成不新增/修订。

C4：100件采购的首任务40只实收20，真实早上架 ACTIVE20，收货仍开放、无本单应付/采购结算凭证；短装结束才首次应付200。真实财务确认/现金付款50、来源采购退货2件扫码出库20，通过HTTP将本轮供应商改为现结后，第二任务60再实收20早上架，关闭前原应付180不变，关闭后净应付380/已付50/余额330且确认打回0；首次应付日期、到期日与原月结方式保留。凭证沿现有口径在首次应付期修订采购毛额400、独立采购退货借应付20，不把净AP380再减一次退货。五月真实结账后付款409，资金余额/付款分录/流水和读明细保持；申请202、不同人员审批后补录10立即产生有效当期 `payment_out` 凭证，现金科目1001贷10、流水业务日期保持原五月，原闭期采购凭证不变。核自有现金账户开账1000→付款后950→审批补录后940，付款分录、资金流水、`PAYMENT_RECORDED` 与往来 `DIRECT_PAYMENT` 事件每笔仅一次，并逐笔核账户、方向、金额、来源及关联ID；原付款请求键重放、已执行补录再执行和回读均不再次移动资金或增加事件。

跨月是**受控日期投影**：实际操作在同一次运行完成；仅将已经真实执行的自有 `warehouse_tasks.shipped_at`、`sale_dispatch_groups.confirmed_at`、`sale_returns.updated_at`、`purchase_returns.updated_at`、首次 `payment_records.created_at` 及自有收货 `created_at/audited_at`、入库流水 `created_at` 调到合成月份。表/列白名单与精确ID校验后才写，原值/新值和凭证快照保存在0600 `/tmp/flowcube-product-finance-PFP-<随机值>.json`；**不修改全局时间，不通过SQL强写执行数量、账款金额、paid 或业务状态**。到期日取真实首次创建的快照并证明后批不改，不声称它由受控五月日期重新计算。跨期检查全部在重开期间前完成；finally仅重开本轮成功关闭的期间、正常取消/归还未完成自有销售、撤销自有打印绑定、停用自有账号/设备、清理精确设备会话，并分别关闭 server/pool。交易与失败证据保留供审计。

本专项补的是原 `smoke:sale-commercial-lifecycle` 会计规格检查与 `smoke:inbound-progressive-putaway` 已付/已退夹具的真实执行、落凭证和跨期关联。资金其他入口、补录权限/自批/当期也闭期及锁竞态继续由既有 `finance-period-guard.smoke.test.js`、`finance-backfill-approval.smoke.test.js`、`finance-period-lock-order.smoke.test.js` 覆盖，不重复造全链。测试通过不代表日历上实际跨月、GUI、PDA真机、真实出纸、远端CI或部署完成。

SPEC补强的反向验证仅在专属测试进程加载临时变异器，未修改产品源码：净退款截到两位后，真实实收行35.99对预期35.9987自然失败（`/tmp/product-finance-period-precision-red.log`，exit1）；真实付款50后错误恢复现金余额，账户1000对预期950自然失败（`/tmp/product-finance-period-cash-red.log`，exit1）。两轮失败交易与finally资源记录保留600 manifest供审计，不把故意变异当产品缺陷。

补强后最终正常运行 `/tmp/product-finance-period-spec-final.log` 自然exit0（1/1），CI资源守卫 `/tmp/product-finance-period-spec-ci-guard.log` 自然exit0（26/26），文档守卫 `/tmp/product-finance-period-spec-doc-guard.log` 自然exit0；最终归属与收尾证据 `/tmp/flowcube-product-finance-PFP-891151ad.json`（600）。这些临时文件是本机本轮证据，尚需 root 的 freshDB 整批复验与独立审查，不作为永久归档或发布证明。

### 2026-10-03 数量精度覆盖守卫的明确委派

`npm run test:qty-precision-coverage` 仍由现有静态 CI 门禁运行。`foldEntryItem` 已返回 `foldEntryItemWithRate(item, rate)`，守卫分别核对该返回委派、helper 对原 `item.quantity` 和未取整 `entryQty * rate` 的两处尺度校验，以及 `foldEntryItems`/`foldEntryItemsBatch` 各自的折算委派和返回前 `await assertQtyPrecision(conn, out.map(...))` 基本单位数量校验；不能仅凭文件内存在 helper 或另一入口的校验放行。AST 契约固定当前明确调用结构，合法结构重构需同步守卫；新增最小行为用例调用真实折算函数，以合成查询结果验证两位数量尺度、整数商品规则及四位单价保留，不使用数据库。

旧门禁自然红为6项中2项误判包装函数缺少直接尺度调用；修正后8/8自然通过，既有数量精度与销售单位最小行为回归26/26通过，生产 `unitConversion.js` 未改。委派、原量/换算量 guard、两个批量 precision 及两个批量 delegate 共7个独立来源移除变异均自然 exit1（`/tmp/qty-precision-coverage-mutant-*.log`）；用进程内来源替换保留其他入口/导入/helper，不改产品文件。守卫内另逐项核删除、改名、注释伪装会失败；这些静态和行为证据不代表数据库、全量回归或远端 CI 已通过。

### 2026-10-03 普通销售收入折扣测试夹具同步

`npm run test:sale-revenue-discount` 的七个原场景继续调用真实 `buildSaleRevenue` 和出库期间投影；普通单夹具显式标记 `commercialModel: null`、提供物料商品/仓库字段，并对已确认商业派发金额查询返回空行。未识别的查询仍抛错，原净折扣、分批比例、税额、借贷平衡和零额凭证断言均未改。原七项因桩未支持 `sale_dispatch_groups` 查询自然 exit1，补齐后七项自然 exit0；相关 `test:accounting` 11项与商业出库会计规则3项自然通过。这是测试夹具契约失配，不是本轮修正了产品收入金额。

反向验证仅在测试进程内替换来源：去掉净额折扣后六项自然失败；去掉税额夹取时超额税场景被金额非负守卫拒绝，另将超额税错误置零时原销项税额断言直接以 `0 !== 10` 失败，均 exit1。正常、原红及变异证据分别位于本机 `/tmp/flowcube-revenue-stub-*.log`；产品字节未改，未跑数据库、GUI或整批全量，不作为发布证明。


### 2026-10-03 整批本地系统验收收尾与资源预算

C2/C4 与 A/B 已开发批次最终业务代码 `79a3c54` 的本地完整选定矩阵、独立库存集成、前端 195 文件/1226 项及受控财务跨期专项通过；独占审计/塑料盒/严格修复也已在同一代码复验。完整结果和各次失败/修正边界见 `docs/superpowers/plans/2026-10-03-system-acceptance.md`；上述早期切片记录仍代表当时状态，远端 CI、真机/纸张/官方平台、员工效率和生产仍未验证。

本机 Colima 约2GB内存，本轮并行三个 MySQL 导致原本地开发数据库被 OOM 停止；恢复原持久卷服务后剩余八组全部用全新库串行通过，原失败日志保留。今后在该资源条件下将独占 MySQL 专项串行安排，启动前核正在运行的实例与内存预算，不因每个专项单独拥有资源就默认可以并行；不得为腾资源关闭其他任务的实例。普通隔离库保留审计，严格修复临时容器/卷/归属文件按 runner 精确收尾。


### v0.12.0 发布依赖候选（2026-10-03）

首轮同SHA Tests在远端通过，但安全扫描阻断；该绿灯只覆盖原lock。用户批准调整构建依赖后的本地候选：四目录完整audit均0；固定桌面适配18项真实下载专项、最低Node22.12、官方NSIS下载/固定摘要/提取通过；原裸get5 override已撤回，不能混用中间audit0。根CI对应命令：

```bash
# 与桌面下载专项CI相同，不依赖实际Electron启动：
npm ci --prefix desktop --ignore-scripts
node desktop/build-support/patch-builder-download.cjs
npm run test:builder-download-compat
# frontend已安装、agent-browser已安装Chromium后，在根目录运行：
npm run test:style-compat
```

style-compat用真实共享React组件和原Tailwind3浏览器计算值；不可用新引擎重写黄金值掩盖差异。原基本896项通过；独立审查扩展隐藏项/窄汇总栏/响应式/交互后的2070项先红39差异，修后自然0差异，保留旧引擎黄金值并独立复跑绿。桌面hover/focus、弹窗与现代Chromium触摸模拟通过，触摸hoverCapability实际true，不当现场设备或hover:none验收。迁移后完整前端1226项、app类型、ERP/PDA前端构建与lint通过，最后CSS补正后已补lint/app类型/ERP与PDA页面构建自然0；不重跑未受影响JS单测。未确认PDA WebView≥111，不能当平台兼容；远端新SHA完整门禁、Windows/Android真实安装及线上三端未验收。原上传6项和Node原生watch证据保留；详细现状/中间失败见 `docs/release-v0.12.0-result.md`。

2026-10-04 代表真实电脑业务页以原合成测试库真实登录复验18张浅深截图，销售/套件/库存查询/月结对账及来源跳转自然成功；server/pool/owner自然退出、Vite受控停止、端口与自有浏览器已收尾。PDA仓库页/往来页/设备平台未补验，不据此称全部页面通过；报告 `/tmp/flowcube-v0120-business-pages-report.json`。新候选仅在本地发布分支，主线/线上未更新。

样式兼容真实浏览器脚本在初次启动显式设置 Chromium primaryHoverType=2，统一桌面 hover 测试前提（Linux无鼠标的headless默认能力可能不同）。仍通过实际鼠标移动和元素:hover/媒体能力双断言验真，2070项旧引擎golden不变；后段触摸为现代Chromium模拟，不能证明PDA真机。失败复现与CI轮次见 `docs/release-v0.12.0-result.md`。


### R2 库存预占离线回归（2026-10-04）

`bash scripts/with-dev-env.sh npm run test:inventory-reservations` 跑真实 routes/controller/service 与库存 projection/expected helper 的数据库边界 stub 回归，已接 Tests CI static job；不启动应用或连接数据库。前端可定向运行 `bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/pages/inventory/ReservationDetailsDialog.test.tsx src/api/inventory.reservations.test.ts`，由既有 test:unit 进入 CI。覆盖只读同连接、授权先于 count/page、隐藏原单隐私、有效/孤儿/未知来源、ATP不双扣绑定、准确行关联及异步读取所有者隔离。真实 MySQL SQL/隔离/EXPLAIN、GUI与现场属于独立证据，尚待验收。


R2 服务器订阅补正可定向运行 `bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/api/client.base-url.test.ts src/api/inventory.reservations.test.ts src/pages/inventory/ReservationDetailsDialog.test.tsx src/api/plastic-boxes.recovery.test.ts src/api/client.refresh.test.ts src/api/client.session.test.tsx`。真实无draw组件回归先自然 exit1（旧原单仍显示）后修复，三条合法改址链与相邻Axios会话/续期/回退回归共6文件55项自然exit0；均由既有 test:unit 接入 CI。此证据不含真实服务器、GUI或数据库。

### R3 统一审批原单级来源离线回归（2026-10-04）

`bash scripts/with-dev-env.sh npm run test:approval-list-batches` 继续经既有Tests CI static命令覆盖真实service/routes的混合来源、原查看/动作权限、count/page同只读快照、自批NULL边界、无活动实例重复来源及失败释放；数据库边界stub，不启动应用。前端定向 `bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/pages/approvals/pending.test.tsx src/pages/approvals/pending.sources.test.tsx src/hooks/useApprovals.invalidation.test.tsx src/api/dashboard.test.ts src/hooks/useDashboard.polling.test.tsx` 覆盖真实API身份、单级原单跳转、四岗位OR入口、首页同count、合法服务器订阅/KeepAlive/会话晚响应，以及原成功动作失效两key。新增Vitest文件均由原test:unit自动进入CI，不另增无CI调用的脚本。

先红证据分别为 `/tmp/go-live-r3-backend-red.log`（旧pool双连接读取及路由单权）、`/tmp/go-live-r3-frontend-red.log`（document NULL身份拒绝/层级与rowkey）、`/tmp/go-live-r3-invalidation-red.log`（原成功回调未刷新统一待办）；均自然exit1。这些证据仅证明离线源码/组件行为，不代表MySQL、EXPLAIN、真实GUI/仓库或生产；全批统一lint/类型/构建和数据库现场验收另行执行。

最终离线服务9项自然exit0见 `/tmp/go-live-r3-approval-green.log`；与首批原单草稿/详情、默认API取齐及R2服务器setter相邻回归合计前端9文件89项自然exit0见 `/tmp/go-live-r3-frontend-final.log`。反向把role1误设为自批豁免，目标自批用例自然exit1（`/tmp/go-live-r3-self-guard-reverse.log`），恢复产品字节后再次9项通过。SQL标识符、只读查询循环、权限、路由、轮询及主题文档守卫分别验证，不代替上述真实业务链边界。

六类成功动作缓存接线补正：`useApprovals.invalidation.test.tsx` 真实授信hook、改价页面及请购form的13个新增动作，409/网络未知后不刷新，真实成功才失效两待办key；原3项保留。先自然exit1（13红/3绿）见 `/tmp/go-live-r3-engine-invalidation-red.log`，修后16项自然exit0见 `/tmp/go-live-r3-engine-invalidation-green.log`。请购沿真实form.run/refetch链，不虚构专用hook；改价未finished保留原商品缓存规则，草稿创建不启动引擎。

### R4–R6 连续前端批次定向离线回归

通过 CI 已有 `npm --prefix frontend run test:unit` 自动收录，无新增独立脚本。Node 22 下定向命令：

```bash
bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/store/workspaceStore.test.ts src/router/mergedPageGroups.test.ts src/components/shared/MergedPage.test.tsx src/components/shared/MergedFinancePages.test.tsx src/components/shared/DailyWork.integration.test.tsx src/components/dashboard/registry.test.ts src/pages/dashboard/index.test.tsx
```

原相邻基线 6 文件 30/30。新增行为首轮自然 exit1（4 失败/13 通过），真实资金页和登记弹窗隐藏后读数反例自然 exit1（2/2 失败）。实现后上述 7 文件 39/39 自然 exit0，分别记录 `/tmp/go-live-r456-baseline.log`、`/tmp/go-live-r456-red.log`、`/tmp/go-live-r456-finance-red.log`、`/tmp/go-live-r456-green.log`。最终加入相邻 KeepAlive、成套路由、登记跨目标、手工应付及财务原单导航回归后，12 文件 88/88 自然 exit0（`/tmp/go-live-r456-final-targeted.log`）。定向 lint 自然 exit0（TopNav 原有 Fast Refresh 导出警告仍保留），前端约定 5/5、文档索引守卫与 diff 检查通过。资金页反例使用真实 KeepAlive、QueryClient、router、原表单及 API 边界 stub；不启动服务、不连接数据库。日志为本地证据，不能证明 GUI、真实财务动作或部署。

### R7/R8 普通拆分回执与塑料盒三动作定向离线回归

```bash
bash scripts/with-dev-env.sh npm run test:container-split-recovery
bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/pages/pda/split.recovery.test.tsx src/pages/pda/plastic-box.test.tsx src/pages/pda/index.permissions.test.tsx src/pages/pda/workflow-continuity.test.tsx src/router/pdaRoutes.binding.test.tsx src/api/plastic-boxes.recovery.test.ts
```

后端真实 service/controller/engine/routes 仅在 DB、打印、设备与幂等工具边界 stub，覆盖同连接一次提交/回滚、重放顺序、当前范围/设备、PC全量/PDA部分量、自并拒绝、原流水仓及首发明确未执行证据；新增脚本接 Tests CI 无DB契约步骤。前端真实页面/hooks/存储/API client 用离线 Axios adapter，覆盖 5xx与重挂/退出、失败查询、TTL、原键原body重试、错身份、账号/撤权/服务器往返晚响应、三动作固定码种、保留实例与隐藏扫码/自动核对，以及旧填盒深链订阅改址。Vitest沿原test:unit自动收录。

自然 red 日志：`/tmp/go-live-r78-backend-red.log`（原行为6/6失败）、`/tmp/go-live-r78-definite-reject-backend-red.log`（1失败/8通过）、`/tmp/go-live-r78-definite-reject-pda-red.log`（1失败/14通过）、`/tmp/go-live-r78-fill-owner-red.log`（1失败/5通过）、`/tmp/go-live-r78-preflight-403-red.log`（前置403两条失败）、`/tmp/go-live-r78-pending-home-red.log`（持久未决返回首页失败）。最终自然 exit0：后端9/9 `/tmp/go-live-r78-backend-final.log`，前端6文件59/59 `/tmp/go-live-r78-frontend-final.log`。反向去掉隐藏实例成功守卫，`/tmp/go-live-r78-hidden-guard-reverse-red.log` 自然exit1；恢复后同用例exit0 `/tmp/go-live-r78-hidden-guard-restored-green.log`。定向 lint 后端0错误，前端0错误/路由27条FastRefresh警告；相关库存/路由/API/SQL/扫码/数量/CI接线契约 `/tmp/go-live-r78-contracts.log` 均自然exit0。

质量复核补写事务重放的 RR 可见性边界：同一真实 service/helper 在维度锁等待期间模拟首请求提交，修前自然 exit1（9通过/1失败，`/tmp/go-live-r78-replay-snapshot-red.log`），写重放改当前读后同命令自然 exit0（10/10，`/tmp/go-live-r78-replay-snapshot-green.log`）。同时断言初始维度读取无容器锁、重放无新拆分/打印/回执写、本人独立查询仍非锁读；这是离线 SQL 边界模拟，未运行真实 MySQL 并发。

smoke默认旧split标题取源码 `LEGACY_PAGE_TITLE`，兼容新固定动作动态标题；这里只同步夹具，不执行浏览器或DB smoke。真实 MySQL隔离/并发/回滚、实体打印及真实PDA票据/扫码、GUI、整批全量lint/type/build留总验收；不把离线stub或源码契约当现场证据。

### R5 月结权限落点补正定向离线回归

```bash
bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/pages/reports/ReconciliationView.access.test.tsx src/pages/reports/ReconciliationView.confirm.test.tsx src/pages/payments/PaymentsView.retention.test.tsx src/components/shared/payments/SettleReceiptDialog.test.tsx src/components/shared/payments/finance-navigation.test.tsx src/components/shared/MergedFinancePages.test.tsx src/components/shared/DailyWork.integration.test.tsx
```

新增实际月结 leaf/HTTP adapter 反例先自然 exit1（6/6 失败，`/tmp/go-live-r5-monthly-red.log`），另核销 closed Finder 无查看权自动读取反例自然 exit1（1 失败/8 通过，`/tmp/go-live-r5-monthly-receipt-finder-red.log`）。窄修后包含原确认、保留与财务导航的 7 文件 63/63 自然 exit0（`/tmp/go-live-r5-monthly-final.log`），无 XHR 取数噪音。原相邻基线 6/6 有既有未 stub XHR 噪音，因此只作为旧断言基线；当前保留夹具补报表边界并用拒绝 adapter 断言无遗漏读取。新增测试沿 CI 原 `test:unit` 自动收录，不新增独立脚本。仅离线组件/API 边界，不连接 DB、不启动应用；整批全量 lint/type/build 与现场仍待总验收。

### R9 最小重复销售开单定向离线回归

```bash
bash scripts/with-dev-env.sh npm run test:sale-reorder-source
bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/pages/sale/reorder.test.tsx src/hooks/useRepeatSaleCreate.test.tsx src/pages/sale/RepeatSaleRecoveryPage.test.tsx src/pages/sale/form/index.test.tsx src/pages/sale/commercial/CommercialSalePage.test.tsx src/router/sale-commercial.test.ts
```

后端真实来源 service、原 create service/controller/routes 仅在 DB 与原依赖边界 stub，不加载数据库配置、不启动 HTTP；来源三批只读 RR/全单scope/白名单、准确父套及零目标/历史单位、单组件拒绝、严格参数与首发成功rollback证据均为实际行为。新增 `test:sale-reorder-source` 接 Tests CI static job；前端真实新建页面、KeepAlive、工作区 store/hooks 与 Axios adapter 沿原 `test:unit` 自动收录，覆盖当前报价/版本和0量、已有输入保护、source/raw query身份、满30拒绝/同源focus、三草稿同实例、隐藏晚ACK、原键原body、网络/5xx、重挂query-only、7天TTL、撤权查询与错误成功身份。

自然业务 red：普通页面路由/导入4失败 `/tmp/go-live-r9-import-red.log`；保存冻结/恢复4失败 `/tmp/go-live-r9-create-behavior-red.log`；零目标/组件身份2失败4通过 `/tmp/go-live-r9-source-group-red.log`；原create与controller修正出口2失败2通过 `/tmp/go-live-r9-service-red.log`；旧概要服务器往返入口1失败 `/tmp/go-live-r9-opener-owner-red.log`。隐藏ACK导航反例见 `/tmp/go-live-r9-page-boundary-red.log`，该轮另一个失败是preview夹具漏必填说明字段，已补夹具，不将该错误当产品反例。最初新module/hook尚不存在的加载失败另存日志，不充作业务行为证据。

最后diff自检发现先确认A后改址B仍露旧result ID，独立反例自然exit1（`/tmp/go-live-r9-confirmed-owner-red.log`），结果读取代次隔离后通过。本人普通create回执范围/动作/资源反例自然exit1（三失败四通过，`/tmp/go-live-r9-receipt-scope-red.log`），窄修后七项通过。恢复落点最初缺文件的加载失败不作业务证据；加空入口定位后，实际撤权重挂无核对界面和未注册落点两失败（`/tmp/go-live-r9-recovery-landing-behavior-red.log`），实现后真实 TopNav/KeepAlive/API adapter 两项通过，无来源/主档/额外POST（`/tmp/go-live-r9-recovery-landing-green.log`）。

最终自然 exit0：后端13/13 `/tmp/go-live-r9-service-source-final.log`；前端R9与原详情五文件51/51，加相邻路由契约一项，共六文件52/52 `/tmp/go-live-r9-frontend-final.log`。相邻路由原测试仍要求独立套销售菜单，与已实现R4入口约定冲突，仅同步无独立nav、保深链/CREATE的期望，不改R4产品代码。两端原触及文件定向lint自然exit0 `/tmp/go-live-r9-eslint-front.log`、`/tmp/go-live-r9-eslint-back.log`；最后窄修lint `/tmp/go-live-r9-recovery-frontend-lint.log`、`/tmp/go-live-r9-receipt-backend-lint.log` 均exit0，TopNav保留既有HMR常量导出warning。首次窄lint未指定子目录config导致工具配置错误，补明确config后重跑，不将该错误当产品失败。本轮没有DB/app/browser或真实业务测试，没有迁移/提交/推送/部署；实际SQL与EXPLAIN、MySQL快照/并发/回滚、员工GUI与商业/普通创建后续库存资金链仍待验收。整批lint/type/build及全量单测留R11统一运行。

R9规格窄补的来源隐藏反例自然exit1（54项中2失败，`/tmp/go-live-r9-source-pause-red.log`）：source迟到后仍GETcustomer、product迟到后仍GETquote；逐段代次检查后恢复只读新代次。真实Header/AddressBook/Select与Axios adapter新增`reorderAddress.test.tsx`，地址读取暂停、同实例未保存输入、unknown/ABA、合法UPDATE晚完成、旧onSelect/onValueChange及慢删除确认均有行为覆盖。反向仅撤Header的R9 opt-in接线，12项自然失败（`/tmp/go-live-r9-header-callback-red.log`）；测试捕获真实组件旧回调，复核冻结后原仓/承运商/运费/产品/地址的选择文本和输入不变。一次额外Select键盘展开步骤在jsdom中act超时，已移除该不稳定步骤，不计入业务反例或GUI证据；地址Portal仍为真实DOM验证。

使用禁HTTP/socket/项目env的临时runner：`bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs r9-spec-frontend`。新增地址测试及原`commercial/headerOwner.test.tsx`、`commercial/addressDraft.test.tsx`已纳定向名单，沿仓库`test:unit`自动收录。窄补终验9文件73/73、自然exit0，`/tmp/go-live-r9-spec-fix-final.log`与对应`.result.json`，workerGuards=9、auditEvents=0；九个触及TS/TSX文件定向lint自然exit0且audit0（`/tmp/go-live-r9-spec-fix-lint.runner.log`），后端本次无改不重跑13项。本证据仅离线组件/接口边界，原41文件交付和52项日志保留，DB/GUI与整批验收边界不变。

### R10独立报废第一段定向离线回归

```bash
bash scripts/with-dev-env.sh npm run test:disposal-transition
bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/api/disposal.test.ts src/hooks/useDisposalExecution.test.tsx src/pages/disposal/transition.test.tsx src/pages/disposal/DisposalRecoveryPage.test.tsx
```

后端严格VM只加载纯helper，DB/config/库存/日志/回执边界stub，执行真实service/routes/controller/domain guard，未知require直接拒绝。覆盖完整明细当前读、旧1/2/mixed拒绝无库存写、原驳回/取消/自批/范围、缺键、终态原键回放、RR当前读metadata、同conn排序维度/批量台账/一次commit及首发rollback证据。前端真实页面/hooks/KeepAlive/路由与Axios adapter覆盖共享持久占位、5xx/查询失败/TTL/缺body、原键原body、清理失败、晚confirm/ACK/隐藏/server ABA、撤VIEW后本人查询及真实建议API/草稿query/满30保留。建议用例仅替换低层Select的jsdom浮层定位，其他leaf和API为真实代码；不充作GUI证据。

业务自然红包括新方式限制、完整旧行审批/执行和单位估值（/tmp/go-live-r10-backend-red.log），旧详情的动作与VIEW建议入口/API自动重放（/tmp/go-live-r10-frontend-existing-red.log），未查询就允许retry（/tmp/go-live-r10-fresh-proof-red.log），以及新审批交接隐藏旧驳回输入的相邻反例（/tmp/go-live-r10-reject-draft-red.log）。新文件未实现的加载失败、jsdom Select定位超时和夹具漏认证token另记为测试设置问题，不当业务红灯。最终定向证据沿/tmp/go-live-final-r10-*.log与.result.json，检查自然exit、worker-ready及audit0，不将守卫杀进程或超时称通过。前端随既有test:unit进入CI；新增backend脚本已接static job。

旧tests/disposal.smoke.test.js仅同步源码：新1/2创建拒绝、合法全报废、稳定键原结果回放、容器/缓存一致、报废台账与原超可用量/状态断言；本轮不执行该DB smoke。状态3取消错误提示改documentStatusRules源文案；generated/status未包含该取消guard，也未手改生成物。尚待隔离MySQL的SQL/索引/并发/实际回滚、设备与员工GUI、真实库存/打印验收；整批lint/type/build/fullunit留R11统一，未完成06c–f关联或旧3签认出口。

R10首轮交付（以下为规格窄修前）定向自然exit0：后端12/12、前端4文件33/33，相邻后端26/26、前端2文件38/38；对应`/tmp/go-live-final-r10-{backend,frontend,neighbors-backend,neighbors-frontend}.log`及`.result.json`，两组前端workerGuards分别4/2，全部auditEvents=0。临时撤完整旧明细分类守卫会自然exit1（2失败10通过，`/tmp/go-live-r10-classification-reverse.log`及`.result.json`）；finally还原后12/12再绿。反向仅离线交易模拟，不能称MySQL已复现。作者git diff --check通过；全lint/type/build留R11。

最终资源复用自检补两条真实hook回归：A成功后切B旧反馈/answer不得挡B，A在途切B不能以A的running挡B或清B；A未知原记录仍持久供本人核对。前者自然exit1（1失败31通过，/tmp/go-live-r10-resource-context-red.log）；后者实际blocked反例存/tmp/go-live-r10-inflight-resource-red.log（该轮另两项失败由反例提前退出未释放延迟夹具连带，补finally释放，不算另两业务缺陷）。按原资源隔离反馈、uncertain及running后33/33自然exit0、4workers/audit0；此前31项结果为中间证据，最终以最新result.json为准。

R10规格两Missing窄补：真实hook的延迟POST/查询拒绝覆盖server/actor ABA与撤权，清理失败反馈复核原epoch；真实详情覆盖A→B→A草稿恢复、准确原ID/reason提交及归属变化隔离。原实现自然11失败33通过（/tmp/go-live-r10-spec-fix-red.log及.result.json），修后4文件44/44、相邻审批交接2文件38/38自然exit0，workerGuards分别4/2、auditEvents均0；终验另存/tmp/go-live-r10-spec-fix-green.log、/tmp/go-live-r10-spec-fix-neighbors-green.log及对应.result.json。原首轮33项证据另保留/tmp/go-live-r10-before-spec-fix-frontend.log及.result.json；后端本次无改，不重复12项。仅离线组件/接口边界，MySQL/GUI/整批R11边界不变。

R11首轮集成窄补只执行受影响离线名单：`bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs r11-fixes-frontend r11-fixes-backend`。新增真实ProductFinderModal.reorder.test.tsx经Axios adapter覆盖原端点、actor/server ABA、隐藏/未知保存暂停与保输入、旧回调禁止回填、CATEGORY_VIEW；恢复入口测试覆盖损坏记录及打开前重核/MAX30。实际红为9失败40通过及商业Editor集合加载失败（新Finder7+恢复入口1+旧普通hook实参1，/tmp/go-live-r11-fixes-red.log/.result.json），修后6文件65/65、自然exit0/6workers/audit0。实际库存路由VM补pdaSessionOptional并将未知依赖严格拒绝，不读真实auth/DB配置或补JWT；原scope与库存查看权断言保留，文案/标准多行路由布局随原契约验收，后端窄12/12自然exit0/audit0。绿证据另存/tmp/go-live-r11-fixes-{frontend,backend}-green.log及.result.json，新组件测试沿既有test:unit进入CI。

上述是定向证据，R11首轮全部日志保留initial前缀；两端lint和两build首轮0，前端36 warnings为HEAD既有33+本批新增3个react-refresh/only-export-components，非全为基线且无error。作者不重复全lint/type/build/fullunit；类型修复与15次被严格拦截、尚未定位来源的HTTP企图由根代理独立复核后按worker testPath整批复验，不能据定向audit0宣称15已消失。MySQL/GUI/设备与06c–f/旧3签认边界不变。

Finder续批自检另有真实红：首批挂起→隐藏→返回仍GET第二批（1失败64通过，/tmp/go-live-r11-finder-batches-red.log/.result.json，exit1/6workers/audit0）。仅R9 scoped query消费并透传React Query取消signal，默认请求分支不消费/透传；还原可见后从新代次首批重新读并取齐第二批，原输入保留，终验65/65自然exit0/6workers/audit0。

R11完整前端单测的15次被拦HTTP按worker定位为请购转单键测试9次、PDA收货测试6次，本次只补这两个真实页面夹具：严格Axios adapter分别接受原GET `/suppliers`（空keyword、page1、pageSize200）及GET `/products/qty-policies`（当前夹具商品169或162），返回合法列表/数量策略；未知请求在afterEach显式断言失败，finally还原adapter并清理QueryClient/DOM，不改SupplierFinder闭窗行为、收货业务或网络守卫。命令`bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs r11-http-fixtures-frontend`初跑14断言均绿但wrapper因audit15失败（/tmp/go-live-r11-http-fixtures-red.log/.result.json）；修后2文件14/14、自然exit0/2workers/audit0（/tmp/go-live-r11-http-fixtures-green.log/.result.json）。临时拒绝该供应商URL会产生9失败5通过、自然exit1/audit0，证明查询库接住rejection也不能吞掉未知请求；finally还原后再绿（反向证据/tmp/go-live-r11-http-fixtures-unknown-red.log/.result.json）。这是两文件离线证据，完整frontend-unit以及受影响类型/lint复验由根代理接续，不能把窄audit0写成整批完成。

2026-10-04 R11最终记录：最后两夹具分别通过独立规格和质量门，各自2文件14/14、自然exit0/worker2/audit0。随后根完整复跑frontend-unit为225文件1546/1546、自然exit0/worker225/audit0，日志无OFFLINE_NETWORK_DISABLED；受影响frontend lint（0 error/36 warning）和正确tsconfig类型复跑exit0/audit0。已通过的backend纯离线115/115、契约81/81、backend lint及ERP/PDA静态构建未受最后仅测试/文档变动影响；各job日志/结果位于`/tmp/go-live-final-<job>.log/.result.json`，完整汇总见`docs/superpowers/plans/2026-10-04-go-live-continuation-execution.md`的R11最终表。33 lint warning既有、3新增，非零警告。tmp runner与配置仅为本轮离线防护；没有DB/应用/真实HTTP/迁移/设备/打印/生产证据，276迁移与隔离/现场验收仍待执行。完整处置06c–f及旧批准单签认、供应商退款仍未实施。


### E1 采购退货协调门的定向离线回归

专项 `test:purchase-return-lock-budget` 在 package.json 和 Tests static job 接线，包含 `tests/purchase-return-lock-budget.test.js`、`tests/return-payment-lock-order.test.js`；前端 `src/pages/returns/purchase/form/cancel.test.tsx` 沿原 test:unit 自动收录。仅真实函数/页面与 SQL/引擎/Axios 边界 stub，VM require 白名单未知直接拒绝，不读 config/db、项目 env 或启动 app。原 inbound 来源断言默认可纯加载，新显式限仓调用才加载范围工具（测试替换该依赖）；不弱化业务限仓检查。

本轮唯一测试运行方式为临时禁外连/项目凭据读取 runner：

```bash
bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs e1-backend
bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs e1-frontend
```

正确夹具的首轮业务红为15失败2通过（/tmp/go-live-e1-red.log/.result.json）；先前缺 binding SQL stub 的设置错误不作业务红。当前成员投影0.1+0.2的四位精度反例1失败22通过（/tmp/go-live-e1-money-red.log/.result.json），补写回精度后绿。历史准确PO ID但缺可选单号反例被新 guard 错拒1失败23通过（/tmp/go-live-e1-historical-no-red.log/.result.json）；保留缺单号合法性，非空错单号仍拒绝。取消页真实确认/提示反例1失败1通过（/tmp/go-live-e1-cancel-red.log/.result.json），修后2/2（/tmp/go-live-e1-cancel-green.log/.result.json）。

临时撤创建本次RC与对账成员漂移检查，等锁预算/待取消预算/对账成员三条断言自然失败，3失败20通过（/tmp/go-live-e1-guards-reverse.log/.result.json，exit1/audit0），finally还原正确代码。最终后端25/25、前端1文件2/2自然exit0、auditEvents=0，前端workerGuards=1，证据另存 /tmp/go-live-e1-backend-green.log/.result.json 与 /tmp/go-live-e1-frontend-green.log/.result.json，避免审阅重跑覆盖。取消用例严格只接受实际详情GET及原ID取消POST，未知请求afterEach断言失败，finally清理DOM/缓存及还原adapter；证明一次请求和两种真实员工提示，不充作GUI。

离线只证明源码函数/交易模拟与响应边界，不称MySQL已复现或死锁已消除。实际SQL/索引/RC可见性、PO/PR/IT/WT/AP真实等锁并发、库存/实物归还与数据库提交回滚、ERP/PDA/设备验收仍待隔离环境执行。没有DB/app/browser/网络业务测试、迁移或提交推送；本批未跑全lint/type/build/全套件，留统一收尾。没有新增PR修改/删除、confirm/cancel成功回执、供应商退款或来源解除。


E1质量门指出共享helper空 identity 的静态缺口：普通销售退货已读金额/model时，RR空快照不能证明AR当前不存在。仅补`returns.helpers.js`空分支当前存在性查询与`return-payment-lock-order.test.js`两个真实VM边界：recordType2快照无行/当前有行409且无statement/金额/event写；当前也无行保持null且无写。自然红2失败25通过（/tmp/go-live-e1-empty-identity-red.log/.result.json，exit1/audit0）；窄修绿27/27。临时撤新分支，精准同两项自然失败（/tmp/go-live-e1-empty-identity-reverse.log/.result.json，exit1/audit0），finally还原后最终27/27自然exit0/signalnull/audit0（/tmp/go-live-e1-empty-identity-green.log/.result.json）。只运行原e1-backend禁网runner，未重跑前端/整套；前述25/25+2/2为本修补前固定证据。原相对before的整体增量已刷新，同时提供/tmp/go-live-e1-quality-fix.diff，不将SQL stub的RR反例写成MySQL已复现。

### 2026-10-05 · H1来源基础（离线，未执行277）

`npm run test:disposal-handling` → `tests/disposal-handling.test.js`，已接Tests CI静态job。本批仅以Node22禁网/禁listen/禁受保护env读取的根临时runner `h1-backend`运行；VM默认拒绝未知require/SQL，只实际加载纯规则、领域service/routes/controller及纯zod/权限/operator/requestKey/sqlStatements，pool、连接、Express/auth及原业务模块为明确stub。没有DB/app/HTTP或DDL。

首轮可调用空骨架14项红中，9项为输入/范围/身份/预算/结果断言缺失，5项空返回导致fixture TypeError单列，不当作业务复现（`/tmp/go-live-h1-scaffold-red.log/.result.json`，自然exit1/audit0）。后续三个夹具问题（JSON对象键序比较与将事务SET也误当数据SELECT）仅修夹具，不算业务红。真实模块新增两项明确反例：来源revision变更误阻原创建ACK、相同损坏digest被当作本人成功，14通过2失败（`/tmp/go-live-h1-original-receipt-red.log/.result.json`，自然exit1/audit0）；真实新API注册缺失16通过1失败（`/tmp/go-live-h1-route-red.log/.result.json`）；canonical JSON拼undefined的真实纯反例23通过1失败（`/tmp/go-live-h1-json-red.log/.result.json`）。

完成后24/24，自然exit0/signalnull/audit0，固定 `/tmp/go-live-h1-green.log/.result.json`。覆盖范围先于连接/重放/总数/分页、UUID/key/actor/action/fullbody/resource永久身份、同conn一次提交及原响应写失败全回滚、当前master/unit/integer规则、Q/A/R异常不夹0、本人撤写权仍可核准确原结果/撤仓拒绝、不泄露目标、pending/not_found不猜成功、raw参数/controller/routes及277与真实INSERT列对齐。Date保留ISO、对象undefined省略/数组null保持真实JSON语义。反向同时撤范围/UUID身份/Q上限/旧JSON实现，精确5项失败19通过，`/tmp/go-live-h1-reverse.log/.result.json`自然exit1/audit0；finally还原后固定green来自最终24/24。

277仅源码：四新表、三个nullable头marker，旧行历史ID无明细FK；索引/FK按名字与列序核对，所有证据RESTRICT而非cascade，具名CHECK及列形状漂移fail-loud。纯迁移拆句/结构守卫不能证明MySQL接受DDL、CHECK元数据规范化、重复执行、FK/索引形状或真实锁/并发/EXPLAIN。以上与完整主链、GUI/员工/PDA/打印均待独立验收；H2目标、H3事实、H4解除、H5旧单签认、H6UI/F退款未实施。最终全量lint/types/build/回归留本轮统一收尾。

收尾静态核对发现原`disposal-transition.test.js`严格controller夹具需显式隔离新增`./disposal.handling`require；仅加空stub，不改原dispose/权限/状态断言。根将已核纯离线旧12项加入同一h1-backend，最终新24+邻接12=36/36，自然exit0/signalnull/audit0，固定`/tmp/go-live-h1-final-green.log/.result.json`；前述red/reverse仍为新增24项范围，旧12没有被降级或删除。

H1规格窄修：277三头FK共用`fk_dh277_link`属数据库级symbol冲突。新增真实迁移源码守卫先在旧SQL自然exit1（36通过1失败，ERR_ASSERTION跨三表3≠1，audit0），`/tmp/go-live-h1-fk-fix-red.log/.result.json`。仅改三个全库唯一名字及对应两个metadata查询，保留各表原索引名；37/37。临时撤名称修复、另单独破坏metadata symbol归属，均精准同项36通过1失败，分别`/tmp/go-live-h1-fk-fix-reverse-symbols.log/.result.json`和`/tmp/go-live-h1-fk-fix-reverse-metadata.log/.result.json`，自然exit1/audit0。finally还原后最终37/37自然exit0/signalnull/audit0，固定`/tmp/go-live-h1-fk-fix-green.log/.result.json`。H1整体增量刷新；精准四路径fix单独保存。没有执行277/任何DDL、DB或整批套件，原36绿为修补前证据。

H1质量CHECK窄修：旧归一化删除所有括号，弱budget/JSON分组被接受。新测试提取真实277 `SET @dh277_sql`条件，用严格有限模型执行生产比较，不是只测独立helper或SQL通用解析器；12个MySQL8源码打印canonical先全绿，两个弱式行为反例自然红49通过2失败（`/tmp/go-live-h1-check-fix-red.log/.result.json`，exit1/signalnull/audit0）：TERMINATED A=R=E=0弱式放行、evidence NULL/response bad-json弱式放行。生产仅改pending277的逐CHECK BINARY精确有限原文与CREATE/ADD字面introducer，未自动DROP/重建未知约束。

新增12canonical/缺约束ADD/未知打印形态回归及两个反例，原37保持，最终51/51自然exit0/signalnull/audit0（`/tmp/go-live-h1-check-fix-green.log/.result.json`）。临时恢复生产旧删括号方法，12未知形态+2弱式共14精准失败、37通过，`/tmp/go-live-h1-check-fix-reverse.log/.result.json`自然exit1/audit0；finally还原后取固定最终green。四路径精准fix、15路径整体增量分别更新，根计划不动。源码打印规则取官方8.0分支（后端主题列来源）；仍非真实MySQL初次执行/重跑/DDL或并发证据，没有执行DB/app/整批检查，也未进入H2。

## 2026-10-05 H2 离线创建验证

`npm run test:disposal-handling` 现同时接 `tests/disposal-handling.test.js` 与 `tests/disposal-handling-create.test.js`，沿既有 Tests CI 静态 job 可达。本批只运行根严格临时 job `h2-backend`：H2 新文件、H1 两文件、sale-repeat-create、E1 两文件共六文件。命令为 `bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs h2-backend`。新夹具实际加载三个原 create wrapper、领域规则/预算/永久操作/目标/本人读取、权威 unitConversion 与原 schema/controller/routes；仅 SQL/WMS/履约/事件/取号边界 stub，未知 require/SQL 抛错，新领域查询按准确资源绑定参数、marker/revision 模拟 WHERE/CAS，事件及 generic/永久占位纳入同 conn snapshot。

首轮103项88绿15失败，其中1项原 schema 必填头缺失的 ZodError 是夹具错误，不计业务红；其余14项是缺关联、永久回放/回滚和拒绝断言。补合法头后的生产 schema 撤修独立证伪来源被 strip。自审补基础预算应先于 generic/普通主档查询的真实顺序反例105绿3红；随后在 source X 下将一次当前预算读取移到新 revision 后，fold 后只比较 A、不重复查询。最终108/108自然 code0/signal null/audit0；H2 新23项和必要邻接85项。覆盖三原创建同连接一次提交、link/marker/永久结果失败回滚、源 scope 先于 ACK、全域 UUID/action/actor/key/body/resource 身份、revision/TTL/当前行删除后原 ACK、fold 基本量、PR 原价/剩余/准确 PO、current active/单位漂移、超预算、无源原载荷同形/新表零读、本人查询及 POST/编辑/商业/repeat 组合边界。

生产反向：撤早 scope/永久身份/预算组104绿4红；单撤预算107绿1红；撤 POST 来源 schema107绿1红；撤 edit raw 守卫107绿1红，均自然 code1/signal null/audit0，finally 已恢复正确源码后重跑108绿。固定证据 `/tmp/go-live-h2-{red,order-red,reverse-domain,reverse-budget,reverse-post-schema,reverse-edit,green}.{log,result.json}`；首红夹具归因必须保留。未运行277/真实 MySQL 并发与事务、HTTP/app、GUI/设备、业务 smoke、全量 lint/types/build；这些仍需授权后的隔离验收与最终统一检查。不能将离线模型称作数据库已验证。


## 2026-10-05 H3 离线目标保护验证

`test:disposal-handling` / 原 Tests CI 增接 `tests/disposal-handling-target-guards.test.js`。本批只运行根严格 `h3-backend` 四文件（新 H3、H2-create、E1 两文件），命令 `bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs h3-backend`。真实 sale/disposal/WT ship wrapper、statusTransition、数量与领域守卫执行，SQL 按宣告 SELECT 投影返回字段、核准确 bound ID，未知 require/SQL 直接抛错；WMS/履约/授信/DB 边界仅离线 stub，禁止 source 查询。相邻两 fixture 只补纯 guard 的明确 require 名单，未改变原业务断言。

有效首红68项57绿11红（4重建、零预占跨仓、pending软删、link身份、实发旧量9≠当前2、错 SO、历史行/量和真实重复行），自然 code1/signalnull/audit0，固定 `/tmp/go-live-h3-red.log/.result.json`。此前 DELETE 被 SELECT fixture 宽匹配与错 SO fixture 没提供合法旧头造成的 setup 另存 `setup-red`，不计业务红。修后覆盖原无来源零新表查询、同仓 reserve/release/部分派发、部分实发结案保历史 A、删除归还门无 WT 锁、当前 SOI/WTI 量和单价2（旧99）、头/任务身份、scope/device先于 ACK、原 ACK 后删行兼容及回执失败回滚。

冻结前 exact-A 反例：未终结当前量9<A10本不合法，旧≤守卫72项70绿2红，`quantity-red`；改==后绿。生产反向撤 editable、pending删除门、新实发 current context，71项62绿9红（`reverse`）；单撤==回≤，72项70绿2红（`quantity-reverse`）。均自然 code1/signalnull/audit0，finally 精确恢复原正确字节。最终72/72（H3新21+必要邻接51）自然 code0/signalnull/audit0，固定 `/tmp/go-live-h3-green.log/.result.json`，全部反向已还原。

这些是源代码/事务与 SQL 边界模拟证据，不是 MySQL 竞态或锁验证。277仍未执行；真实事务/等锁/索引、完整应用与业务 smoke、GUI/设备现场、整批 lint/types/build 尚未运行，留授权后的隔离验收与统一收尾。H4执行全集/解除、H5旧单签认、H6 UI/F退款未实施。

H3规格派发窄修：SQL fixture 真实执行原派发过滤，新增两个真实 wrapper 负例（同仓额外零预占/已全派发行）、合法 sole 全派发仍原400及原 ACK 跳过当前行。生产旧过滤先行75项72绿3红（`/tmp/go-live-h3-dispatch-fix-red.log/.result.json`），均真实业务断言，没有新 setup/import 红。仅 linked 在 ACK 后完整当前 SOI 读/核，再原余量选择。反向只撤新增 full-row 校验，75项72绿3红，两个额外行负例及既有派发精确A负例（`dispatch-fix-reverse`），finally 精确恢复；最终四文件75/75自然code0/signalnull/audit0（H3新24+必要邻接51），固定 `/tmp/go-live-h3-dispatch-fix-green.log/.result.json`。原72绿及原反向证据保留为修前结果；六路径精准fix及13路径整体increment刷新。仍未执行MySQL、应用/业务smoke/现场或整批检查，没有进入H4/277新改。

## 2026-10-05 H4 离线执行事实与解除验证

`test:disposal-handling` / 原 Tests CI 增接 `tests/disposal-handling-facts.test.js` 和 `tests/disposal-handling-release.test.js`，现包含 H1/H2/H3/H4 五个本域文件。仅根严格临时 `h4-backend` 运行两新文件、H1 handling、H2 create、H3 guards、E1 purchase-return-budget 与原 disposal-transition 共七文件：`bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs h4-backend`。真实领域/provider/永久操作/原 ready/controller/routes 执行；VM 显式 require 白名单，未知 require/SQL 抛错，不加载 config/db/app/env，SQL 依真实投影与准确 bound ID 模拟，同 conn snapshot/CAS/提交回滚可归因。

首红128项107绿21个业务断言失败，固定 `/tmp/go-live-h4-red.log/.result.json`，自然 code1/signalnull/audit0。后续 finite 反例分别关闭新 release 路由/真实权限映射（142绿2红）、数量/进度/legacy 完整批准身份（148绿6红）、正常 no-WT/PR3 全量完成口径（160绿5红）、canonical UUID 与冻结缺 flag（166绿2红）、无 WT 真实必要字段（168绿1红）。固定证据为同前缀 `route-red/boundary-red/progress-red/proof-red/no-task-proof-red`，均自然 code1/audit0，不将 fixture/setup 当业务红。

生产反向仅撤范围、永久 UUID 身份、日志候选完整身份、PR3 全量 E=A 与新 return ready 状态门，最终183项163绿20个业务断言失败，自然 code1/signalnull/audit0（`/tmp/go-live-h4-reverse.log/.result.json`）；四生产文件 finally 精确恢复字节，记录 `/tmp/go-live-h4-reverse-restore.json`。首次加入 R10 邻接曾有9个缺 pure target-guard require 的 setup 失败，另存 `reverse-setup`，不计进20个业务反例；补真实纯 guard 和 NULL marker 后原断言保留，没有宽放 require/SQL。

恢复正确源码、补 originKind/link.state 与原 R10 邻接后的最终七文件183/183，自然 code0/signalnull/audit0，固定 `/tmp/go-live-h4-green.log/.result.json`。这次 green 包含相邻原断言，不能把未运行层级写作已验收。

覆盖全历史软删 WT、合法分段日志/typed 候选与脏跨域/错 SKU/仓/move、取消 picked 非 E、ANY 容器锁和取消/已发箱、准确 PR/POI/原价身份、报废台账、无 WT 强创建证明及 missing 字段、批量查询数不随 links 增长、目标概要真实 VIEW/full scope、Q10/A6/E2/R4/avail8、六档进度、ordinary/legacy 分类与 ACTIVE/TERMINATED（含 R0）、RC/固定锁序/无事实锁、CAS 全回滚、永久 UUID 全身份/revision/TTL 重放与本人撤写权查询、new ready terminal 拒绝/原 ACK 保留。真实 MySQL、RC/等锁/并发/索引与180天流水缺失现场、完整 app/HTTP/业务 smoke、GUI/PDA/打印及统一 lint/types/build 未运行，留授权隔离验收；277 本批未改/未执行，未进入 H5/H6/F。

### H4 规格两处窄修

新增真实读/release SO4 反例：删除实发 WT21/流水只留取消 WT22，或全部历史 WT8，均不能以当前 SOI 证明 E0。legacy 正例升级完整原199/277头行、批准、固定 DTO、两旧行/两来源和成功原 operation；新增 canonical null、缺字段/错 ID/no/UUID/fingerprint、漏/重/多/错映射来源、错误冻结快照/key/原响应/永久操作等27反例。结构反例同步同一错误响应到 conversion/source/op，确保检验协议本身而非仅副本不同。另有 current revision 前进仍保原 DTO revision1、全来源同连接一次非锁批读正例。

修前七文件215项183绿32个业务断言红，自然 code1/signalnull/audit0，没有 setup/import/SQL 红，固定 `/tmp/go-live-h4-spec-fix-red.log/.result.json`。只改 SO4 E>0 与 legacy 纯协议 validator/非锁批读后215绿。有限生产反向恢复修前 facts/release 两文件，215项183绿32业务红，固定 `spec-fix-reverse` 同前缀 log/result；finally 两文件精确字节恢复（`/tmp/go-live-h4-spec-fix-reverse-restore.json`）。这是本域代码/事务边界证据，不是实际 MySQL 竞态或 H5 serializer/签认验收；277、DB/app 与全量检查未执行。

恢复后最终七文件215/215自然 code0/signalnull/audit0，固定 `/tmp/go-live-h4-spec-fix-green.log/.result.json`；11路径修补增量与原21路径整体快照 diff 分别保存。作者停止写入待独立规格复验与质量门，不能将作者绿称作 H4 已验收。

### H4 质量 PR 事实窄修

将独立只读探针转成现有严格夹具15个真实反例：PR4+WT7/准确 E2 的 getSource 与 release、PR WT4/8/7 的 sale_order_id 为987/0/缺字段的读取及解除、冻结取消 PR 的脏销售指针，以及冻结 PR3 实发证据被重标 PR4。原合法 PR 夹具显式 NULL 与真实 SELECT* 字段一致，PR3 全量完成/R0 等相邻原断言保持。没有新增测试文件，原 package/CI 接线沿用。

首红七文件230项215绿15 BUSINESS 红，natural code1/signalnull/audit0，无 SETUP/import/SQL 错误，固定 `/tmp/go-live-h4-quality-fix-red.log/.result.json`。生产只补 evaluate 的显式 NULL PR 归属和 PR4 E0 两个条件；单独恢复本次之前 facts 源码撤这组新条件，230项215绿15 BUSINESS 红（`quality-fix-reverse` 同前缀 log/result），finally 精确恢复一个生产文件，`/tmp/go-live-h4-quality-fix-reverse-restore.json`含字节一致与SHA256。未改 SQL/锁/277、H5/H6/F 或其他业务；这些仍是代码/事务模拟证据，不是 MySQL/实物、应用或全量验收。

恢复后中间221绿9个夹具断言失败，是 combined getSource/release 用例把原只读快照 commit 误计为写提交；单列 `quality-fix-fixture-commit-red`，不计业务缺陷。仅将该断言限定为读取结束后解除不新增 commit，保留 pending/E/状态快照不变断言。修正夹具后，同最终测试文本再次只撤上述两条 PR 守卫：230项215绿15 BUSINESS 红，自然 code1/signalnull/audit0，固定 `/tmp/go-live-h4-quality-fix-final-reverse.log/.result.json`；finally 精确恢复，`/tmp/go-live-h4-quality-fix-final-reverse-restore.json`记录一致字节/SHA256。最终七文件230/230自然 code0/signalnull/audit0，固定 `/tmp/go-live-h4-quality-fix-final-green.log/.result.json`。早先 reverse/green 文件保留为过程记录；7路径窄补与整体21路径增量刷新，停止写入待原 Spec→Quality 复验。

## 2026-10-05 H5：旧批准整单签认离线验证

`test:disposal-handling` 和原 Tests CI 静态接入 `tests/disposal-conversion.test.js`（本域现6文件）。本轮只运行根登记严格临时 `h5-backend`：新转换测试+H4原7文件，共8文件。唯一命令 `bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs h5-backend`；VM require显式白名单/未知SQL抛错，真实 snapshot/conversion/handling/operations/proof/routes/controller/dispose 与原邻接执行，DB/stock/generic请求为准确 stub，不加载 config/db/app/env，所有 net/listen/fetch 禁止。SQL按准确where参数/声明投影/列集合模拟，FK父S与同conn耐久状态/批插真实不连续source ID覆盖。

首红268项230邻接绿38新缺能力断言红，natural code1/signalnull/audit0，`/tmp/go-live-h5-red.log/.result.json`：API/serializer/own转换无intent和真实route不存在。它不证明每个数量/rollback守卫已单独证伪。再加actual dispose纯3转换门，269项230绿39红，`/tmp/go-live-h5-dispose-red.log/.result.json`，新门真实 Missing expected rejection且已执行。第一轮实现后5项旧fixture跨realm数组断言误报（first-implementation），单列为夹具问题，不算业务缺陷；只使用clean(params)保留准确ID断言，269/269后续补有限规范/权限/锁序覆盖。

最终文本的有限生产撤修只撤 conversion 自批flag/实物候选门和 dispose 已转换新执行门，277项273绿4 BUSINESS 红，自然 code1/signalnull/audit0，`/tmp/go-live-h5-reverse.log/.result.json`；两个生产文件 finally 字节精确恢复，`/tmp/go-live-h5-reverse-restore.json`含equal/SHA256。最终八文件277/277自然 code0/signalnull/audit0，固定 `/tmp/go-live-h5-green.log/.result.json`。原code与事务模型不等同真实MySQL/隐式FK/并发；277 DDL未执行、完整app/HTTP/business smoke、GUI/PDA/打印、全量lint/type/build未运行。H6/F未进入；作者停止写入待独立Spec→Quality。

### H6 员工来源入口及完整持久请求（2026-10-05，本地离线）

`npm run test:disposal-handling-ui` 精确调用五份 Vitest 回归（完整记录、实际 write hook、真实处置/普通销售/采购退货 leaf+API adapter），已静态接入 Tests CI；原 `test:unit` 也会发现这些文件。本轮仅根登记的 Node22 guarded `h6-frontend` 执行，禁 HTTP/socket/listen/protected env，未知 adapter 请求 afterEach 显式断言；没有执行常规 CLI、应用、DB、277或业务 smoke。

固定首红 `/tmp/go-live-h6-red.log/.result.json` 为14能力断言红，natural code1/signalnull/5 worker guards/audit0；显式未接线 stub和真实旧页/路由缺入口仅证明能力缺失，不当完整边界覆盖。后续 JSX语法、缺 QueryClient 和旧展示词/数量尾零预期属于 setup/fixture，单列不计业务。`boundaries-red` 同前缀45项42绿3 BUSINESS 红（完整预览纯3/已执行4未禁签、新来源报废落点遗漏原CREATE）；`freeze-red` 49项45绿4 BUSINESS 红（数量政策 hidden/server ABA晚数据、客户 Finder 自动续批、实际 POST 未用持久体）；此前 send fixture 对 undefined 使用 JSON.parse 的错误已纠正，不计业务。`callbacks-red` 51项49绿2 BUSINESS 红：首次意图 Dialog 提前绑旧owner，以及PR成功后异步刷新server ABA关闭/导航旧草稿。上述固定均 code1/signalnull/5guards/audit0，无未知 adapter/网络审计事件。

最终文本有限 production reverse 只撤持久读回闸、send 使用持久 body/key、PR异步刷新后与导航前 canApply 两处复核。51项48绿3 BUSINESS 红，natural code1/signalnull/5guards/audit0，固定 `/tmp/go-live-h6-reverse.log/.result.json`；`reverse-mutations.diff` 和 `reverse-restore.json`（同前缀）记录三生产文件 finally 按原字节恢复、equal/SHA256。恢复后最终五文件51/51自然 code0/signalnull/5guards/audit0，固定 `/tmp/go-live-h6-green.log/.result.json`。相邻 R9/原报废/工作区三文件35/35自然 code0/signalnull/3guards/audit0，固定 `neighbors-green`；旧相邻 fixtures不具本轮显式未知 adapter 收集，仅证明原行为回归。固定 `.result.json` 保留原 runner logPath，验收时读取同前缀固定 `.log` 而非后续可被覆盖的 `/tmp/go-live-final-*`。

覆盖完整body持久/readback零POST/容量与损坏保留、confirmed/cleanup失败阻断、原键端点配置、own成功资源及身份验证、owner/session/权限/server ABA及hidden晚响应、撤权auth-only source/conversion精确GET不伪造intent/无业务查询、实际单SKU/原仓/基本单位/当前客户价、重复SKU精确原POI与原价、已有备注不覆盖、来源报废新草稿、完整mixed签认/资格变化/漂移保预览、终结R0禁解除、说明重开保留、第二页和标签容量/同身份focus。真实浏览器/localStorage故障、GUI/员工操作、MySQL事务/277首次及重跑/隐式FK/并发、远端CI和整批 E7 lint/type/build尚未验证。作者绿与静态接线不能代替独立Code Spec→Quality。


H6 独立 Code Spec 曾发现三个 Important：错误销售退货模型降空白、工作区删除 mixed 来源空/重复参数、confirmed 后归属变化仍清理。修补在现五文件内补真实 SaleReturn leaf、registered sale/scrap path 与真实 hook confirmed storage ABA；修前63项51绿12 BUSINESS 红，自然 code1/signalnull/5guards/audit0，固定 `/tmp/go-live-h6-spec-fix-red.log/.result.json`。有限反向仅撤三处生产门，最终同文本63项51绿12 BUSINESS 红，code1/null/5/audit0，固定 `spec-fix-reverse`；三文件 finally 字节精确恢复的 equal/SHA 在 `spec-fix-reverse-restore.json`，`spec-fix-reverse-mutations.diff` 为准确撤修。缺 alert 对空串及记录应保留的断言是真业务失败；无未知 adapter、导入或 setup 红。恢复后最终63/63证据见 `spec-fix-final-green`，仍待独立 Spec→Quality，真实 GUI/存储/MySQL/E7 边界不变。

受影响四邻接（R9、原处置、工作区、returns/sourceHandoff）最终80/80自然 code0/signalnull/4guards/audit0，固定 `/tmp/go-live-h6-spec-fix-neighbors-green.log/.result.json`。四邻接首跑旧 sourceHandoff client mock 缺 subscribeApiClientBaseURL，0 test 的导入 SETUP 红单列在 `spec-fix-neighbors-setup`；仅补明确纯订阅 stub，无真实 client fallback、原断言不变，不算业务红。


H6 Quality 活动 ABA 窄修新增严格实际 adapter 延迟反例：同实例隐藏→恢复后，销售旧报价成功/错误、PR 旧 PO 成功/错误与数量策略旧数据不得应用；各例继续证明当前新活动可重新读、原数量/PO 文本保留，PR 旧收尾不能结束当前新请求。R9 邻接另补相同真实普通表单晚报价反例，并在 finally 显式断言未知调用0。修前五文件68项63绿5 BUSINESS 红、四邻接81项80绿1 BUSINESS 红，固定 `/tmp/go-live-h6-quality-fix-red.log/.result.json` 与 `quality-fix-neighbors-red`；均自然 code1/signalnull、5/4 worker guards、audit0，无 SETUP/未知接口红。

有限反向同时只撤四处本次生产活动防护，不撤先前 Spec 三门：来源对外活动代次和 PR 进度代次共同覆盖两条 PO 反例；共用普通表单 opt-in 读取代次覆盖 H6 两报价和 R9 一报价；数量策略读取/缓存代次覆盖一数量策略反例。最终同测试文本为68项63绿5 BUSINESS 红及81项80绿1 BUSINESS 红，固定 `quality-fix-final-reverse` 与 `quality-fix-neighbors-final-reverse`，code1/null/5或4guards/audit0；这是联合撤修证据，不称每门分别独立 mutation。四文件 finally 字节精确恢复，`quality-fix-final-reverse-restore.json` 含 equal/SHA256。原 readCurrent 未提供及数量策略默认调用不新增活动键/读取门，原业务断言保留。真实 GUI/持久存储/MySQL/277、设备/员工现场与统一 E7 边界不变。

恢复后的最终五文件68/68、四邻接81/81自然 code0/signalnull、5/4guards/audit0，固定 `/tmp/go-live-h6-quality-fix-final-green.log/.result.json` 和 `quality-fix-neighbors-final-green`。最终复跑曾出现67/68的一条 PO success 夹具失败：请求在 await 后复用共享计数，将旧请求误挂新等待器；固定 `quality-fix-final-attempt`，不计生产 BUSINESS 红。仅改为每次请求起点固定序号，保留旧 success/error、当前再读和旧 finally 不清新 loading 断言；按修正后最终文本再联合撤四门、finally精确恢复、最终绿。早先 `quality-fix-reverse` 和中间绿保留为过程证据，验收使用上述 final 文件。活动代次窄补共11路径，H6整体相对原before共45路径，未新增测试文件或扩散默认普通模式；当前只冻结作者结果，仍待独立 Spec→Quality。

### 供应商退款基础 F1（纯离线）

`npm run test:supplier-refunds` 接入 CI 静态门，精确覆盖四文件：`supplier-refunds.test.js`、`supplier-refunds-source.test.js`、`supplier-refunds-pr-gate.test.js`、`supplier-refunds-schema.test.js`。严格 VM 执行实际 service/source/actor/rules/operations、原 PR wrapper、真实 route.parse/controller；未知 require/SQL 拒绝，config/db 仅精确连接 stub，无 app/env/实际网络。278 只拆结构及有限实际 SET 决策模型，不执行 DDL；MySQL8 打印形式依据沿277已有源级证据，不能称真实数据库验证。

本轮作者通过 root 注册的 `f1-backend`/`f1-neighbors-backend`/`f1-generate-status` 禁网 runner；状态由官方纯 generator 产生，不手改产物。首轮合法能力红38项：36缺新能力断言、2原 PR 未拒 reserved；另存语法/夹具 setup，未计产品反例。实际资源、金额、长期 ACK、日期/100键/列宽、事务回滚及278漂移反例和有限生产门反向证据保存在 `/tmp/go-live-f1-*`。根统一 lint/type/build/full 功能/契约门留后续收尾，现场 GUI、278 首次及幂等、真实 RC/RR/并发、银行/会计/人员验收全部待验；F2–F6尚非本批交付。

F1 作者最终固定证据：四文件77/77、两个原 PR/处理来源邻接41/41，均自然 code0/signalnull/audit0（纯 BE 无 Vitest worker，workerGuards=0）。最终五生产门撤修为77项52绿/25 BUSINESS红、0 SETUP，finally 字节/SHA恢复后再取77/77。原同数字ID即拒的假设已撤销，不把旧 `source-collision-red` 当真实来源 bug；完整双 parent 碰撞和错三元组的有限实际门反证另存 `exact-triple-clean-red`（74绿/2业务红），实际财务提示描述先75绿/2业务红再修。所有 `*.result.json` 的 mutable logPath 对应另复制的同前缀 fixed log，以 handoff 为准。


### 供应商退款实际收到 F2（纯离线）

`npm run test:supplier-refunds` 同原 CI 门精确加入 `tests/supplier-refunds-receive.test.js`。本轮只通过已注册 Node22 禁网 runner 的 f2-backend 与 f2-neighbors-backend：实际新域 service/context/receive/operations/source，实际 finance.recordTransaction/refreshBalance、reconciliation.refreshSettlement/paymentEvents/period guard，实际 route.parse/controller 与原 PR cancel 均在严格 VM 白名单和 SQL 投影/参数/事务夹具中运行。未知 require/SQL 直接拒绝，不实际加载 config/db/auth/app/env；禁止所有网络/listen。

作者固定最终专项51/51、六文件邻接118/118，均自然 code0/signalnull/audit0，纯 BE workerGuards=0；固定 `/tmp/go-live-f2-final-green.log/.result.json` 与 `final-neighbors-green`。首红34项全部缺新 receive 能力，`f2-red` 不冒充事务缺陷；后续真实 IN 污染七反例、借用原 ACK 撤权反例及金额 opt-in 反例分别固定。有限联合撤实际四文件生产门，最终同文本51项35绿/16 BUSINESS红、0 SETUP，自然 code1/null/audit0；fixed `f2-reverse`、`reverse-mutations.json` 与四文件 finally equal/SHA `reverse-restore.json`，恢复后取上述最终绿。

金额证据分两层：两成员 0.000099182… 为浮点表示/四位字符串合同差异，旧 SQL DECIMAL 写回会舍入为 .0001，不能称数据库吞量；实际 refresh 的1000个合法高值成员用例则证明 Number 汇总 paid9999999999.7999/balance0.1001 对应精确9999999999.8000/0.1000，差一个 .0001，总额仍在 DECIMAL14,4 内。这仍是源码/离线算术与 SQL 参数模型，不是真 MySQL、实际资金或银行证明。

覆盖同账户旧 OUT 当前流水与异账户不追锁、NULL entry.statement_id 的当前月结成员、归属漂移、完整 receipt 型 NULL account/独立 ID 碰撞、PR/entry/AP .0001 上限、各写失败回滚、借用零事务管理/门前读取、永久身份/TTL/闭期/撤权、实际 PR 后续取消不冲钱和提交后失败固定 ACK。278 首次/幂等与实际 SQL/索引/FK、RC/RR/并发/事务、GUI/员工/银行/会计和整批 E7 lint/type/build 均未运行；F3–F6 留后续审阅批，作者绿不代独立 Code Spec→Quality。

### 供应商退款 F3 定向离线验证（2026-10-05）

`npm run test:supplier-refunds` 在原 CI 门加入实际 `tests/supplier-refunds-accounting.test.js`。新测试使用严格 VM 的真实 source/projection、原 voucher-engine.generate/upsert、单笔/default postcommit、原 closePeriod、实际勾稽 service、route/controller；原 F1/F2/PR 邻接保留。FE两文件使用真实资金流水/凭证页与精确 Axios adapter，afterEach断言未知调用0。禁止网络/listen/真实config/env/app/数据库。

作者首轮冻结固定证据 `/tmp/go-live-f3-final-*`：BE56、FE8、邻接169（7文件），均自然 code0/signalnull/audit0，FE两个 worker 已加载禁网守卫；仅本地模型。首 BE31 是缺能力红；初 FE3 是 adapter/刷新时点 SETUP，修正后3项1绿2真实行为红。净已付相消红有1业务+1手工错误保存注入时点 SETUP；闭期已有证明红53项52绿1业务。带可选 reason 的实际 F1→F2→F3 链另取得56项55绿1业务红，固定 `f3-reason-red`，修后严格保完整 action body/hash。最终文本有限生产联合撤9门后，BE56项47绿9业务红、FE8项6绿2业务红、0SETUP，finally4生产文件字节/SHA恢复；固定 `f3-reverse-*`。实际零分/半分、永久来源、合法历史、hash/腿/期间、手工当前权限、逐 AP 相消、真实消费和晚owner均有必要断言。另一账套的完整 RF/账户/FAT 父身份由实际 SQL 条件的严格边界模型排除，缺父仍 fail-loud；这不是数据库账套隔离或并发证明。

这些不是 MySQL 金额/并发/隐式锁、实际凭证/银行/GUI/现场验收。整批 lint/type/build/full suites 留统一 E7；本轮未执行数据库或迁移，也未提交发布。


F3 独立 Code Spec 的辅助类型窄修另有固定 `f3-spec-fix-*`：62项修前56绿/6 BUSINESS红、修后62/62；供应商/资金腿 × 实际 proveSources/default postcommit/actual closePeriod 六反例均保留 hash、现金与 AP 断言。仅撤本轮 aux_type 核对后同文本62项56绿/6 BUSINESS红、0SETUP，单 builder finally 字节/SHA精确恢复，最终62/62自然 code0/signalnull/audit0。只运行已登记 f3-backend；未重跑无关 FE8/邻接169，其生产及夹具 SHA 未变。旧九门反证属于首轮56文本，本轮新门独立反证属于62最终文本，不混称完整新版九门验证。原 CI 专项已覆盖此既有测试文件，无新增导入/SQL或测试接线。


F3 Code Quality 的结果schema窄修固定 `f3-quality-fix-*`：strict fixture纯读实际278列名和VARCHAR500，不再凭空生成RF时间字段；已知具体RF列/长度违规则模拟ER_BAD_FIELD_ERROR/ER_DATA_TOO_LONG并记录，未知require/SQL仍afterEach拒绝。首66/47/19中13直接schema业务红、5生成前置TypeError及1ACK跨VM原型SETUP单列initial-setup；补真正前置断言与按值比较后，正式首红66/48/18 BUSINESS、0SETUP。generated/zero/pending/500/error-save-fail及实际controller→findById/list均覆盖，原62来源/辅助腿用例保留。

修后及恢复后66/66自然code0/signalnull/audit0。仅撤结果列名66/48/18 BUSINESS红，单撤500限制66/65/1 BUSINESS红，均naturalcode1/null/audit0、0SETUP；单accounting文件finally字节/SHA恢复。只已登记f3-backend，未改共享receivefixture或前端，不重跑FE8/169/旧九门及aux变异；旧证据按原版本保留。6路径本轮增量与整体28路径SHA重新冻结，278只纯文本核对、未执行或修改；这不是MySQL迁移/存储/并发或实际凭证验收。


F3 实际资金页结果schema消费者窄修另固定 `f3-frontend-schema-fix-*`：真实页面/严格 Axios adapter 使用实际278形态，没有生成时间字段；非零4.0000、voucher_id正值且errorNULL显示“凭证已生成”，zero的ID为NULL，普通pending仍原说明。正式首红10项9绿/1 BUSINESS红，单撤实际呈现条件后同文本10项9绿/1 BUSINESS红、0SETUP，finally页面字节/SHA精确恢复；修后及恢复后10/10，自然code0/signalnull、2worker/audit0。所有未知调用afterEach断言0。只已登记 f3-frontend；BE66生产/夹具未改不重跑，旧FE8仅证明当时zero/trace范围，本轮新增真实generated正例补足消费者。旧九门与aux反证按修前文本保留，不冒充本轮新版反证。证据仍限源码/离线页面模型，未作真实GUI、存储/MySQL或会计验收。

### 供应商退款补录 F4 定向离线验证（2026-10-05）

`npm run test:supplier-refunds` 的既有 CI job 现精确包括 `tests/supplier-refunds-backfill.test.js`。本轮只用 Node22 禁网/禁.env 临时 runner 的 `f4-backend`（51项）和 `f4-neighbors-backend`（8文件235项），没有直接运行该 npm 总脚本或真实业务 smoke。actual backfills/guard/RF/F3/HTTP adapter 在 strict VM 中执行，DB、旧支付域和 Express 边界精确声明，所有未知 require/SQL、被吞断言均 afterEach 拒绝。模型纯读258/260的列与300长度、保278原500模型，不执行迁移。

固定作者证据 `/tmp/go-live-f4-*.log/.result.json`：正式首红31项1绿30红，其中4批准日期/重开行为、26明确缺能力，0SETUP；中间31项28绿3SETUP（前置锁事件混入/文本金额预期/注入失败误列未知）另存 intermediate，不当产品红。period-order-red 31/30/1业务；expanded-red 43/41/2中1全关联错类型FAT业务、1同义提示断言SETUP；consumer-red 47/45/2业务；http-identity-red 49/47/2业务；snapshot-order-red 50/49/1业务。最终51项/235邻接分别保 fixed final 证据，均自然退出与审计0后才称本地通过。

同最终51文本有限联合撤修六路径有25业务链/断言红，批准日期的早拒会遮住部分后续consumer，不能将它们都称单独反证；分组 identity/snapshot 51/46/5、results 51/47/4 是对应真实断言红，0SETUP/审计0，finally逐文件字节/SHA恢复。固定 mutations/restore/proof、before/current、精准增量/清单位于 `/tmp/go-live-f4-*`。旧种类正例只证明原 executor 的执行日传参，不是旧付款真实业务验收；F3原无批准申请的 override 用例改为非法来源负例，合法F4完整源保批准日正例。

本地源码/离线模型不等于 MySQL期间/DATE_FORMAT/FK/并发等锁/资金金额/实际会计、GUI/员工/银行、远端CI或上线验收。258/260/278均未执行；未跑E7全量lint/type/build、未改旧种类日期历史，没有DB/app/browser/网络业务测试/提交推送，F5/F6留后续双门批。

F4 Code Spec 共享来源修补另存 `/tmp/go-live-f4-source-fix-*`：最终文本66项。首轮66/53/13中8为实际旁路业务、1缺批量读取能力、4为已有身份拒绝的错误码预期 SETUP；纠正后 clean-red 66/57/9（8业务+1缺能力，unknown0）。生产接入新批读后一次跨 VM Array 深比较造成的夹具失败单列 batch-fixture-setup，不当产品反证。仅撤共享 unique 和已执行 originalFund 两门，同最终文本66/58/8业务红，natural1/signalnull/audit0、0SETUP，finally两文件字节/SHA恢复。最终 f4-backend 66/66 与八邻接235/235均自然0/null/audit0。原51项及旧三组反证保留修前版本边界，不宣称覆盖新门；package/CI既有精确文件接线不变。

F4 Code Quality 后提交窄修固定于 `/tmp/go-live-f4-postcommit-fix-*`。首红70/66/4均实际 execute/retry 的种类读取异常向外抛，0SETUP/unknown；最终71文本额外含缺期间错误保存异常后继续下一旧核销的有限 consumer。只撤本轮 settle/逐笔隔离的单文件生产改动，同71文本71/66/5业务红，natural1/null/audit0，finally原字节/SHA恢复。修复后的最终专项71/71及原八邻接235/235均自然0/null/audit0；原51/66与共享来源反证保修前版本边界。无新imports/test路径/package/CI脚本，不跑真实业务smoke。实际MySQL锁/FK/期间/DDL/资金银行/会计/GUI与E7仍未验。

### 供应商退款 F5/F6 受控验收入口

`npm run test:supplier-refunds`包括supplier-refunds-approvals.test.js：统一只读RF document/count/page、六引擎不扩、当前权限/自批/范围与准确source、confirmAllowed；使用严格VM与有限模型，无DB/network。`npm run test:supplier-refund-ui`明确枚举真实Axios adapter恢复hook、supplier-refunds实际页面/store/KeepAlive和accounting/backfills新kind呈现；未知调用afterEach0，无默认API或真实HTTP/listen。二者在CI明确可达。

本批实际执行仅由主线程静审登记的 /tmp/go-live-final-runner.cjs 禁网job，记录自然退出、guard readiness与audit0；初始缺能力、导入/setup错误、业务断言红、有限生产门反证与恢复后绿分别登记，不互相冒充。当前lint/type/build/全量验证集中E7；真实DB/迁移、资金、会计/人员审批、GUI/PDA/打印/生产与上线均未在此离线批执行。

F5/F6 补录邻接修正：`getBackfillsApi` 显式 `listMode: paged`，准确透传页号/页大小/筛选，避免取齐层将第二页重置到首页。供应商退款补录金额四位，快照只读 `supplier_refund.frozen` 原日期、收入账户与原 RF 身份；零分逐笔证明显示“零分投影已核对/无需分位凭证”，核销旧说明保持。原回款与补录申请须全组已确认，再一次 CAS 持久清理；刷新、存储、owner 或活动变化保留完整组，不能孤立删除原回款。专项离线证据不代表 MySQL、GUI、实际收款或上线验收；统一 lint/type/build 留 E7。

F5/F6 Spec 三点窄修仍使用已注册 f5-f6-frontend / f5-f6-neighbors-frontend / e1-backend：真实列表 GET 迟到与 Section 代次、delegate 真实 Radix/Confirm 捕获旧 Portal 关闭回调、真实 PR AxiosError code/data 与 helper/锁后 PR 身份透传。实际绿 47/47、54/54、29/29；旧 E1 缺 F2 纯 decimalMoney 依赖的 10 个 SETUP 红单列保留，补准确真实依赖后 clean red 29/27/2 才属结构身份业务红。RF 原 6/6 与未变闭包 252/252 保前轮独立固定证据；本轮不重复或宣称新增 DB/GUI/资金/会计/上线证据。有限联合撤读代次/slot 清理/结构 code 与 finally 原字节 SHA 恢复另存 /tmp/go-live-f5-f6-spec-fix-*；完整 lint/type/build 仍归 E7。

F5/F6 Quality 唯一清理缺口采用原 f5-f6-frontend 入口：真实 QueryClient invalidate deferred、actual hook 与真实 storage save/replace/remove helper，覆盖同 coarse 新 confirmed UUID/key/body、同 immutable 换有效 ACK、同 UUID/key 换 body/source/date、session/epoch/活动代次/创建时点、原 app 来源/parent/等待换组。首红 55/48/7 为业务失败，底层 CAS 旧完整 snapshot 拒新记录及原47例保持绿；不是 import/SETUP 反证。固定日志与 finally 字节/SHA 恢复存 /tmp/go-live-f5-f6-quality-fix-*，当前整体以 quality-final 的47路径包为准。BE/E1/邻接54闭包未变沿原固定证据，不重复全套；E7及真实DB/资金/会计/GUI仍未执行。

Quality 新增确认申请永久 ID/单号反例后 57/55/2 业务红，原55例包括合法 accepted→executed 仍绿；永久身份门补齐后 57/57。联合有限撤完整 immutable/ACK、原 app 关系与永久申请身份门产生 57/48/9 BUSINESS（不声称各门全独立），finally 原 hook bytes/SHA 恢复后 fresh 57/57，自然0/audit0/3guards/每afterEach unknown0。

同57例随后细化两错申请身份为先显示合法 accepted、再错误 GET，旧缓存呈现清理首红 57/55/2（quality-fix-cache-red）；仅当前 owner 的 guarded catch 清本次 application/answer 后 57/57。最终联合3组身份门撤修仍57/48/9、finally精确恢复后 fresh57/57；此联合未撤缓存清理门，不称缓存自身独立反证。早先 identity-version 57绿及9红日志/测试字节另存历史，不与新缓存版本混用。

E7 初检记录由共同 runner 冻结，linter/type 的夹具修正、可见文案、RF 三路由格式及 supplierRefund 状态1–4手工登记独立形成 overlay；状态机器预期仍手工固定为16。旧 sourceHandoff 夹具使用真实 API 客户端的 owner/base/epoch/订阅及严格 adapter，afterEach 未知请求必须为0；初四次被阻止 HTTP 来源需临时 trace 核对，不能把断网或断言绿当零企图。此段编辑尚未宣称 E7 检查通过。

E7 全前端 trace 将初四次被阻止 HTTP 定位到 `OrderEntryForms.test.tsx` 的真实仓库、客户与承运商自动读取；该旧夹具默认 enabled:false 被 hooks 的显式 enabled:true 覆盖。现仅夹具安装准确三 GET 的 Axios adapter、客户空分页契约和未知调用 afterEach0，卸载/清缓存后恢复 adapter/base/auth；生产读取与权限未改。首次1692断言全绿但 audit4 的诊断仍是失败证据，待受控重验确认零企图。

E7 B 严格 F4 VM/Controller 首轮82/74/8因跨 VM 参数数组原型为 SETUP，copy(args)补准后82/74/8才为最后详情查询/JSON业务红。扩旧 payment/receipt_settle后88/74/14 BUSINESS；实际窄修后后端88/88自然0/null/audit0。FE新增五例和真实结果形状初62/56/6含一例初始zero隐藏重试按钮的 SETUP；精确起始状态修正后62/56/6均BUSINESS（含原零分例），实现真实Result/toast后62/62自然0/null/audit0/3guards/未知0。固定 /tmp/go-live-e7-B-*；这仅严格离线调用链，不代表实际DB/资金/会计/GUI。后续有限撤门与最终累计检查另记，历史初检不覆盖。

E7 A 定向由根固定 /tmp/go-live-e7-A-green-manifest.json：源交接/数量48、HTTP夹具2、H6五文件68均自然通过/guard ready/audit0/未知0；1692断言绿但audit4历史诊断仍为失败，最后全量零企图待根统一检查。supplierRefund单条手工登记撤回在原16机器守卫产生367通过/2失败，finally原bytes/SHA恢复后379/379绿；这是静态状态契约，不是业务数据库状态验收。B 单次只撤postcommit最后详情隔离产生88/74/14 BUSINESS，finally service bytes/SHA恢复后最终88/88；未称独立验证所有结果字段。

E7 C 原首BE17/4/13含两primary SETUP（严格fixture漏管理页既有单位批读），后续首次实现17/8/9为同漏SQL/累积unknown的SETUP，保历史不作业务绿。补唯一准确product_units SQL/params后，用原pre-C helper固定clean-red17/5/12 BUSINESS/未知0，finally恢复当前helper后17/17；FE首红13/11/2 BUSINESS，当前13/13。有限联合撤rank1/2区别、literal转义与数字id tie产生BE17/7/10、FE13/12/1 BUSINESS，不称各门独立；finally两生产文件bytes/SHA准确恢复，fresh最终BE17/17、FE13/13，均自然0/null/audit0，FE两workerguards/每afterEach未知0。SQL/CASE/参数与实际API组件链为离线证据，真正MySQL排序/SQL_MODE/EXPLAIN待隔离验收。

E7 A/B/C精确overlay仅保存本作者开改前实际WIP与当前字节，历史357/47路径冻结不改；完整lint/type/build/全量门与本包独立Spec/Quality/Whole仍由根执行，当前不称整批通过或上线。

### 2026-10-06 本轮真实 MySQL/API 有限验收入口

新增 `tests/go-live-runtime.smoke.test.js`，仅由本批专属临时实例的根 runner 执行；夹具为 `tests/helpers/goLiveRuntimeFixture.js`。入口先调用既有 `configureTestEnvironment` / `validateTestEnvironment`，再在任何种子、业务写入及 app 导入前调用真实 `assertOwnedRepairInstance`，不注入 probe stub。数据库固定 `flowcube_golive20261006_test`，`DB_HOST=127.0.0.1`，端口由本批随机映射且禁止 3306/3307；0600 归属文件、容器/卷实时 label、端口、runner 存活、时间窗及实例 UUID 由既有归属门核对。本脚本不创建数据库、不执行迁移、不读取 `backend/.env`，不能复用共享 smoke 环境或以库名替代归属证明。

根先完成新实例完整迁移，在 runner 仍存活且归属窗口有效时，注入 `NODE_ENV=test`、明确 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`、`FLOWCUBE_REPAIR_INSTANCE_FILE`、`FLOWCUBE_REPAIR_DOCKER_CONTEXT`、`JWT_SECRET`（至少32位合成密钥）、绝对且可写的 `APP_UPDATE_DOWNLOADS_DIR`，并保持与归属 runner 一致的 locale。使用 Node22；已有 backend 依赖须可用。命令不包含凭据：

```sh
node --test --test-concurrency=1 tests/go-live-runtime.smoke.test.js
```

脚本只加载实际 app 并以 `app.listen(0, '127.0.0.1')` 监听，禁用打印回收任务及外部日志传输，不加载 server/scheduler/外发 worker。全合成的独立仓、商品、供应商、客户、角色及员工通过实际登录、权限、仓范围、PDA 会话和业务路由验收；制单人与批准人分离，无自批豁免。采购→收货→上架提供实物及准确 POI/AP；普通 sale/PR/scrap 来源关联后实际执行/终结/解除，含销售部分实发和 PR 全发 R0 冻结；旧批准 mixed1/2/3 仅用合成历史头行提供转换证据，原记录不变、无现金库存副作用，mixed3 重走新报废审批。

资金主链读取准确 PR/PO/AP、直付与汇款核销的原 entry/receipt/OUT，覆盖四位部分回款、确认只占额度、实际 IN、AP 净已付、原本金保持、对账单/往来/资金 API、准确资金 ID 驱动的分位凭证、0.0001 零分真实回款和无需凭证、原 UUID/action/key 永久 ACK 及合法 PR 出库/取消后的重放。准确来源负例通过另一 PO 的实际收货/上架/支付获得正 entry 与 OUT，将其用于当前 PR；当前实链在 `source.payments` 先返回409 `SUPPLIER_REFUND_SOURCE_INVALID`，并核无 RF/分配/操作记录、两边 AP 与资金及原付款事实保持。并发用例覆盖同 PR 两个超合计草稿最多确认一个、取消释放预算、同原键并发回款只一笔 IN，以及四位超额、精度、权限和仓范围拒绝。

闭期用例从实际查询未存在的1990年月份中选择本次合成历史期，业务日期固定该月15日；只 INSERT 本次新期间的已结事实，不覆盖旧轮已存在的 `199001` 或其他期间。默认回款409；当前 RF 补录申请接口200返回申请对象，以 `backfillRequested=true/executed=false` 和 AP/资金无变化区分申请与已收。另人批准后核原申请人、原业务日期、首次批准日凭证期、准确 backfill_id 和凭证，并核重复执行无第二资金变化。这不覆盖完整结账操作、关账与登记竞争、故障注入回滚及全部污损来源组合。合成 PDA 请求和自建工作站打印 ACK 只证明 API 闸门；GUI、员工、Android 实机、纸张和真实银行证据仍须独立验收。

收尾逐项关闭本批 API、两连接池，精确删除本批 PDA 会话/设备，恢复本仓打印绑定并停用自建打印机；期间 INSERT 成功立即读实际非空 `closed_at`（dateStrings），仅按本次记下的 `(company_id,period,closed_by,closed_by_name,status=2,closed_at)` 回读核对并以同一原子 DELETE 谓词删除新建期间元数据。任一身份或结账时间变化（含原人反结重结）即保留并报收尾失败，不碰旧轮期间。保留其他业务 ID 和记录供根取证，最终由根按准确容器/卷销毁本批实例，无全表清理或强制退出。失败须分别登记 `[SETUP]`、`[FIXTURE]` 与业务断言，不把设置错误或静态解析通过称为产品通过。此入口初次作者交付仅为静态准备；实际 MySQL/API 结果由根另行记录，不表示 CI 接线、生产或上线验收。根首轮真实运行的三处状态拒绝为既有400（已实发PR取消、未提交新报废执行、已收RF取消），夹具修正为精确400及原消息，并核拒绝前后原单、库存或资金事实保持，不接受任意4xx或修改业务状态机。

钉钉预警回归（2026-10-04）：`tests/ops-alert-notifications.test.js`运行真实运维脚本并仅在临时目录捕获模拟机器人请求，验证JSON排版、故障级去重/恢复/重试、近期重启与日报；隔离scheduler验证作业worker注册和经营worker移除，并验证作业消息内容及只读有界SQL契约。不访问生产或真实机器人；SQL契约本身不证明MySQL执行结果。实际查询需在独立测试实例核对最新打印、终态排除与近期扫码；本批在专属临时MySQL8.0.46中用脱敏夹具执行，两条查询自然成功，按容器归属label清理且无数据卷，不等同于生产数据验证。

### v0.13.0 整合后的专属验收入口（2026-10-07）

`npm run smoke:go-live-owned` 使用 `repair-smoke-ephemeral.sh --go-live` 新建本批专属 MySQL 实例，全量迁移后调用 `smoke:go-live-runtime`，继续通过原实例归属门并在退出时清理核实；后者不能直接用于共享 3307。未知参数在任何 Docker 操作前拒绝。Tests CI 独立 go-live-owned job 和 `test:go-live-runner` 保证可达及归属边界。

`npm run test:expense-pay-backfill-integration` 覆盖费用付款闭期/申请/借用事务、固定首次批准日重试和 smoke 精确清理；`smoke:expense-pay-period-guard` 为真实资金回归。`smoke:operation-alerts` 只在当前独立测试库创建随机事务夹具并回滚，不发机器人。新增 PDA 塑料盒 HTTP 场景接入 `smoke:security-scan-remediation` 中的 scope 测试。

迁移编号冲突整合为安全276/277、资料278、处理279、退款280；原 go-live 验收日志中的276–278保留为原分支历史证据。完整映射和合并树验证见 `docs/release-v0.13.0-integration.md`。
