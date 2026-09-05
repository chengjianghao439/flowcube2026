# 上线前运行时、工资和运维修复（2026-09-05）

本记录只表示独立工作树的实现和本机测试；未提交、未推送、未部署。无真实环境文件或生产数据修改。

## F09：Electron 与依赖门禁

修复前完整 npm audit：backend 1（high 1）、frontend 3（high 1 / moderate 1 / low 1）、desktop 22（critical 1 / high 20 / low 1），合计 26 个受影响包条目，不等于 26 个独立 CVE。修复前后机器可读结果见 [runtime-dependencies.json](audit-evidence-2026-09-05/runtime-dependencies.json)。原门禁 `--omit=dev` 排除了 desktop devDependencies 中实际装入安装包的 Electron 33.4.11。

依据 [Electron 支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)（最新三个稳定主版本）和 [44.2.0 官方发布说明](https://releases.electronjs.org/release/v44.2.0)，将运行时固定到 44.2.0，配合 npm latest 的 electron-builder 26.15.3。[Electron 44 兼容变更](https://www.electronjs.org/blog/electron-44-0) 将 macOS 最低版本提高到 13，移除 Windows ia32；本仓库 Windows 目标为 x64，不使用 ia32。若需要分发 macOS 包，不能再承诺 macOS 11/12。官方 [安全建议](https://www.electronjs.org/docs/latest/tutorial/security) 强调 Electron 更新及 IPC 来源验证；[安全通告列表](https://github.com/electron/electron/security/advisories) 作为后续复查入口。此次还复查了 [executeJavaScript IPC 回复伪造通告](https://github.com/electron/electron/security/advisories/GHSA-xj5x-m3f3-5x3h) 与 [会话缓存隔离通告](https://github.com/electron/electron/security/advisories/GHSA-r4w5-6pfg-jxp5)，44.2.0 不在其受影响版本范围。

后端/前端只升级兼容传递依赖；桌面明确更新两个直接 devDependency 及其锁文件，无 `audit fix --force`、TLS 绕过或真实环境改动。CI 三端全量审计，所有 high/critical 直接或传递项阻断；原有 JSON 结构/条目数/退出码完整性检查保留。

桌面保留 nodeIntegration=false、contextIsolation=true，全部应用 IPC 经注册窗口+主 frame+精确 file 文档 URL 验证（HashRouter hash 可变）。阻断外部导航/重定向、打开新窗口及 webview。普通打印为当前窗口 window.print 和已有 RAW IPC，不依赖新窗口。

## F15：Sentry

补齐 @sentry/node，errorHandler 加载时先按可选 SENTRY_DSN 初始化，未知异常显式捕获。禁用默认自动集成，不自动采集 HTTP、SQL、用户、请求体、breadcrumbs，只附方法、路由模板和 requestId。未配 DSN 不发送；测试使用真实 SDK 的内存 transport，无真实 DSN或外部上传。

## F16：工资录入契约

新增既有工资模块 API：`GET /api/hr/payrolls/:id` 返回含员工名、是否录入、应发及核算结果的明细；`PATCH /api/hr/payrolls/:id/lines/:lineId` 接受 `{ gross: number }`，要求稳定 `X-Request-Key`（或 Idempotency-Key），最多80字符，复用会计查看/凭证管理权限和 companyScope。无新前端产品页面。

工资只能为有限非负数字，最多两位小数、上限 999999999.99；必须明确填写，显式 0 合法。detail_json.grossEntered 区分未填与零工资。修改按单头行锁和明细归属进行绝对值覆盖，使用 operation_requests 在同事务保存原回执，action 绑定账套/工资单/明细；旧请求重放不覆盖较新的录入；仅草稿允许，核算或发放后返回 409，不自动重置或改写已核算结果。核算/发放持相同行锁，校验所有行都已录入且员工属于当前账套；缺失输入和旧版默认零核算单禁止发放。核算保留明确录入标记，重复核算覆盖同一累计台账，不生成重复行。

个人社保及个税超过应发时拒绝核算，不支持的负实发场景不能截零后继续入账。发放再核对每行金额守恒和单头汇总，个人社保直接取明细合计。新增真实账套非零工资、社保核算、四张凭证借贷与金额、二次发放不增凭证及低工资社保下限回归。

旧版已核算但无明确录入标记的工资单会被阻止发放；本次不擅自重置历史状态，需要核实单据后另行授权的数据恢复操作。

## F17：Compose 与环境

主配置保持现行 server-update 的基础部署入口。prod 叠加文件使用 `!override` 清空 MySQL 宿主端口、保持前端只映射 127.0.0.1:8080 给宿主 Caddy。依据 [Docker 合并规范](https://docs.docker.com/reference/compose-file/merge/)，要求 Compose >= 2.24.4。解析测试只给假环境、显式 `--env-file /dev/null`，不读取真实 `.env`。

透传 JWT_ACCESS_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN / JWT_SECRET_PREVIOUS / DB_POOL_SIZE / SENTRY_DSN，删除死变量 JWT_EXPIRES_IN。更新根与后端样例、DEPLOY 和 key-rotation；轮换验证改用受鉴权 auth/me（公开 health 不能证明 token 有效），Compose 改环境需 recreate。

## 验证

先红后绿：`node --test tests/prelaunch-runtime-ops.test.js` 4 项通过（含真实 Sentry SDK 和 errorHandler 联动）；`tests/prelaunch-hr.smoke.test.js` 10 项通过（含实际 HTTP 权限/zod/账套和并发核算编辑）。工资回归使用独立 flowcube_hr_fix_test、MySQL 8 专用容器回环 13308，复用 configureTestEnvironment 与完整迁移，测试数据 finally 删除。迁移提示历史重复/缺号，不是新失败。

最终三端完整 `npm audit --json` 均为零，报告经过 check-npm-audit 校验；后端 lint 通过；最终 `node --test tests/audit-desktop.test.js tests/audit-tooling.test.js tests/prelaunch-runtime-ops.test.js` 共 21/21，部署脚本边界回归 17/17，`npm run test:print` 两组全部通过。桌面既有测试 harness 只补齐新守卫要求的注册窗口和主 frame，原清单/摘要/损坏安装包拒绝断言保留。

Electron 官方下载首次因 Node fetch 未使用本机系统代理而失败；以仅本命令的 `ELECTRON_GET_USE_PROXY=true` 和 HTTP(S)_PROXY 使用本机已启用的代理后，官方 install.js 成功校验下载并解压，无 TLS 降级或真实配置修改。`ELECTRON_RUN_AS_NODE=1` 实测运行时 Electron 44.2.0 / Node 24.20.0 / Chromium 152.0.7977.76。`desktop/node_modules/.bin/electron tests/prelaunch-electron.smoke.cjs` 使用临时本地页面及独立 profile，真实验证 preload IPC、node 隔离、hash 路由、外部导航阻断和打印机枚举。Windows 安装、自动更新交互及真实打印机任务无法由 Mac 单测证明，需 Windows 验收。

本机 `electron-builder --projectDir desktop --dir --mac --arm64 --publish never`（指定已校验的 electronDist、CSC_IDENTITY_AUTO_DISCOVERY=false）退出 0，产物位于 `/tmp/flowcube-prelaunch-mac-pack-20260905/mac-arm64/极序 Flow.app`。已检查 ASAR 包含 main.js、preload.js、新 rendererSecurity.js，以及独立 renderer/index.html。该目录包未签名、未公证、未发布；构建日志仅有未配 author/default icon/跳过签名提示，不是 Windows 安装包证据。
