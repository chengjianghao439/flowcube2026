# 登录权限落地与供应商月结欠款 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 登录仅进入当前账号可访问的页面；供应商往来默认页独立展示月结未结清应付（含未出对账单）。两项在同一分支、同一草稿 PR 交付。

**Architecture:** 以现有路由注册和 hasPermission 为登录目的地的唯一权限依据，游客守卫和登录回调共用解析函数，保留正常登录清空工作区的行为及直接越权地址的 403。供应商页复用 GET /payments 的 settlementTypes=2、status=unsettled 查询及服务端汇总，增加只读月结区域；不改变现结查询、月结核销流程或数据库。

**Tech Stack:** React / TypeScript / Zustand / React Query / Vitest / agent-browser。

---

## Task 1: 登录目的地

**Files:**
- Create: `frontend/src/router/erpLoginDestination.ts`
- Modify: `frontend/src/router/index.tsx`, `frontend/src/hooks/useAuth.ts`, `frontend/src/pages/login/index.tsx`
- Test: `frontend/src/router/login-landing.test.tsx`
- Document: `docs/frontend-pda-conventions.md`

- [x] 先通过真实 AppRouter / LoginPage / useLogin / KeepAliveOutlet 及合成 HTTP 登录响应重现：未登录访问待办中心，业务员登录后进入 403；以认可的 13 岗位 fixture 中六个角色 after 权限为测试输入。
- [x] 覆盖管理员、财务、业务员、仓管、只读、作业员；财务允许待办，拒绝来源回仪表盘；已登录游客入口和异步登录回调均验证；管理员缓存恢复再换业务员不落 403，登录清空旧标签；允许的来源保留 query。
- [x] 实现 `resolveErpLoginDestination(user, requestedPath)`：无来源按待办查看权选默认页；来源必须是注册 ERP 路径并通过现有权限要求，否则返回 `/dashboard`；两个入口共用。PDA 保留原登录分支。
- [x] 运行 `npm --prefix frontend run test:unit -- src/router/login-landing.test.tsx`，记录修前失败与修后通过。

## Task 2: 月结欠款独立展示

**Files:**
- Create: `frontend/src/pages/payments/SupplierMonthlyPayables.tsx`
- Modify: `frontend/src/pages/payments/PaymentsView.tsx`
- Test: `frontend/src/pages/payments/supplier-monthly.test.tsx`
- Document: `docs/finance-permission-time.md`, `docs/frontend-pda-conventions.md`, `docs/verification-commands.md`

- [x] 先渲染真实供应商合并页，HTTP transport 返回现结未结清 70 与没有对账单的月结采购欠款 33.13；断言默认页同时显示两笔、各属自己的区域，月结清楚标明、不能逐笔直接付款；现结查询参数和金额不变。
- [x] 月结区域使用独立 `['payments', 'supplier-monthly-outstanding']` 缓存，固定 `{ type: '1', settlementTypes: '2', status: 'unsettled', page: 1, pageSize: 200 }`；不带日期或 statementId；金额取 API 同范围 summary，不从当前加载行加总。
- [x] 默认现结记录区内显示单独标题和现结原表；月结只读区单独标题、月结未结清金额、关联单号/供应商/总金额/已付/余额/到期日；有 report.view 才提供现有月结对账链接。首读/刷新失败提供独立重试，不把未知显示成零；隐藏页不读取。
- [x] 自动测试覆盖无对账单、部分付款、现结反例、无报表查看权仍能按 payment.view 查看、加载/错误重试、客户页不新增查询、切换核销时不读取月结。
- [x] 运行 `npm --prefix frontend run test:unit -- src/pages/payments/supplier-monthly.test.tsx`，记录修前失败与修后通过。

## Task 3: 验证与交付

- [ ] 真实浏览器打开实际路由、页面和 CSS，网络边界仅使用合成数据；复验登录和默认供应商页，查看截图。脚本 finally 关闭专属会话并通过 session list 核实退出。
- [ ] 前端 lint / 正确项目 tsc / 全量单测 / ERP 与 PDA 临时目录构建；相关权限、会话、工作区、文档守卫；新用例沿已有前端全量测试进入 CI。
- [ ] 独立代码审阅，按结果修订；检查没有数据库迁移、权限表、真实配置、版本发布文件或未知改动。
- [ ] 列明提交路径，逐个暂存、检查 cached diff，提交并推送 codex/login-supplier-balances；创建唯一 draft PR，attach_artifact。
- [ ] 等最终提交 CI 全绿，PR 分两项写原因、文件、红绿测试与实际页面证据，补最终 SHA 的 CI 链接与状态；不合并、不发版。

## 本地执行记录

- 基线4文件27项通过；初始新增30项在旧代码上19失败，包含真实403及月结区域缺失，11项原控制通过。
- 独立审阅提出PDA合法尾斜杠兼容，新增真实路由用例先失败（设备换票期望1次，实际0次），改用matchPath后复核2项通过。
- 最终前端397文件3644项通过；新增登录25项、供应商8项共33项，含5001笔上限与全范围金额。
- 最终前端lint、正确项目tsc、ERP/PDA临时目录构建通过；真实AppRouter/AppLayout浏览器11项通过，1440px/900px截图已查看，专属会话关闭并核实。
- 权限、前端会话、页面约定、文档、API/路由、query-loop、QA104项与部署/浏览器资源35项通过；未改迁移、权限表或真实配置，未操作数据库。
- 独立审阅问题修订后无新增问题。远端提交、草稿PR与最终head的CI事实在PR正文记录，不能以此处的本地结果替代。

首轮CI静态文案守卫发现“正在读取”加载提示不符合既有“加载”口径，改用“正在加载”，原守卫未放宽。原页面验收脚本仍等待供应商旧标签/旧说明，已同步账款概览，并修正两条API注入式登录等待以适配权限落地；受限账号不再允许登录即403。新增limited-login-403反例及反向验证，保留原页面/授权/回跳断言。最终CI对应后续修订提交，以PR正文记录为准。

追加验收：文案守卫6项、实际产品浏览器11项、原页面验收含新反例11项、浏览器资源/部署/凭据契约50项均通过。反向允许403令新反例准确失败，已恢复；审阅未发现阻断问题。
