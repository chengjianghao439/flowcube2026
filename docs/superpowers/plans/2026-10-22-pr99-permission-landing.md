# PR99 低权限账号登录落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在 PR #99 原分支修复无权限和仅有账款查看权限账号的登录落地，推送后核对最终提交的34项检查，保持草稿、不合并、不发版。

**Architecture:** 游客守卫与登录回调继续共用 `resolveErpLoginDestination`。先保留合法且有权限的来源；否则待办中心优先，再按现有路由注册顺序选择有权页面，对外查询入口放在业务页面之后。权限来自原路由及 `hasPermission`，不复制角色授权。完全没有业务页面时进入受登录保护、位于 AppLayout 外的 `/no-access`，沿用 `performSessionLogout` 退出。

**Tech Stack:** React、TypeScript、Vitest、agent-browser、GitHub Actions。

审阅补充：既有 `KeepAliveOutlet` 对固定仪表盘标签提前放行。为覆盖已登录后的直接越权，在 `frontend/src/components/layout/KeepAliveOutlet.tsx` 补同一权限门并阻止无权组件先挂载；`frontend/src/pages/403/index.tsx` 的返回按钮对无仪表盘权限者共用解析器，避免反复进入无权仪表盘。`login-landing.test.tsx` 先补4个失败反例，浏览器另检查实际点击固定首页及403返回供应商往来。

## 1. 先写失败回归

文件：`frontend/src/router/erpLoginDestination.test.ts`、`frontend/src/router/login-landing.test.tsx`。

- [x] 纯函数反例断言：`resolveErpLoginDestination({ roleId: 99, permissions: [] }, '/dashboard') === '/no-access'`；`permissions: ['payment.view']` 时无来源和无权来源均为 `/payments/payable`。
- [x] 实际 AppRouter/LoginPage/useLogin/KeepAlive 回归：无来源、原仪表盘来源、原待办来源都不挂载无权仪表盘；无权限展示完整提示并可退出；仅账款角色进供应商往来。原六岗位扩展到采购、会计并保留只读角色；合法来源及查询参数、403、同机换人、PDA换票继续覆盖。
- [x] 执行 `npm --prefix frontend run test:unit -- src/router/erpLoginDestination.test.ts src/router/login-landing.test.tsx`，确认旧代码因错误落地失败。

## 2. 最小修复

文件：`frontend/src/router/erpLoginDestination.ts`、`frontend/src/router/index.tsx`、新建 `frontend/src/pages/no-access/index.tsx`。

- [x] `canOpen` 对仪表盘与其余页面采用同一权限判断；合法来源保持 query，无权或非法来源共用有权默认页。候选不包含登录、403或PDA。
- [x] 无候选返回 `/no-access`；路由放在 `ErpProtectedRoute` 内、AppLayout 外，页面完整显示“当前账号没有可用页面，请联系管理员分配权限”，退出按钮调用 `performSessionLogout`。
- [x] 重跑同一专项确认通过；临时恢复旧解析函数，确认新增反例失败，再精确还原修复并复跑。

## 3. 页面及最终提交验证

文件：`scripts/browser-smoke/login-supplier-fixture.tsx`、`scripts/browser-smoke/login-supplier.cjs`、`docs/frontend-pda-conventions.md`、`docs/verification-commands.md`。

- [x] 扩展原合成HTTP浏览器夹具：新增采购、会计、零权限、仅账款角色；低权限登录必须没有仪表盘请求/403提示，无权限页退出必须清会话并回登录。查看实际1440px及窄屏截图，finally关闭本任务会话并核对session list。
- [x] `source "$HOME/.config/flowcube/dev-env.sh"` 后，执行前端lint、`tsc -p frontend/tsconfig.app.json --noEmit`、全量前端单测、ERP/PDA临时目录构建及权限/会话/页面/文案/文档/浏览器相关守卫。
- [x] 独立代码审阅；同步上述两份主题文档，记录红绿测试与证据范围。无数据库、权限定义、认可权限夹具、版本或生产变更。
提交前逐路径暂存、复核cached diff与敏感文件；随后普通push原分支。最终提交、Tests 27项、Security Scan 6项及独立gitleaks合计34项的远端结果以 PR #99 正文登记为准，不回写此提交前快照。不合并、不发版。

## 提交前验证记录

- 初始新增回归在旧解析器上72项中38项失败；修复后72项通过。临时恢复旧解析器时，纯函数33项中29项失败，精确恢复后通过，证明无条件回仪表盘会被直接拒绝。
- 审阅补出的固定首页/403返回4个反例全部先失败；最小修复后登录专项合计76项通过，含KeepAlive、WorkspaceSafety和模板权限的5文件113项通过。独立只读复审未发现阻断问题。
- 最终前端全量398文件、3695项通过，比89afefa7增加51项（纯解析33项、真实路由新增18项）；原供应商与其他回归继续通过。前端lint、正确项目tsc、ERP/PDA临时目录构建通过；最后两处ERP修改后补跑ERP构建及前端全量、lint、tsc。
- 实际AppRouter/AppLayout/页面/CSS的受控HTTP浏览器24项通过，比原11项增加13项；1440px、390px提示页及固定首页403/返回截图已实际查看，专属会话关闭并经session list确认退出。
- 权限、API/写路由、query-loop、会话、页面约定、文案、文档及原浏览器11项守卫通过。额外桌面审计首次因本工作树缺少semver失败；按原desktop锁文件执行npm ci --ignore-scripts后33项全过，包与锁文件无改动。
- 最终12个拟提交文件gitleaks扫描无发现。未改数据库迁移、权限表/常量或认可夹具，未读取生产配置或操作数据库、删除数据。受控HTTP与本地浏览器不代表正式账号或生产验收。
