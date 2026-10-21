# 2026-10-21 QA 问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 续办约束（2026-10-21）：先提交并推送隔离分支、建立草稿PR；不合并。随后撤回第5条候选业务/query更改。正式岗位先交改前/改后表，未认可前不写补丁；报税按全0及空列表复现并如实记录。下列勾选保留首轮实际执行历史，不代表正式验收。

**Goal:** 修复附件转交的 7 类问题，逐项保留根因、改动与证据；正式权限补丁以真实角色导出和认可的差量为前置条件。

**Architecture:** 基于正式验收相同版本 `8db3e40`，在 `codex/qa-fixes-20261021` 隔离工作树工作。沿用现有后端授权与 PDA 设备校验、React 权限 hook、路由注册和请求回执，不增加绕过权限的入口，不修改历史账款或已执行迁移。每项先复现，再最小修复与定向检查；批次结束统一检查并作本地页面验收。

**Tech Stack:** Node 22、Express/zod、MySQL 8、React/TypeScript、React Query、Vitest、node:test、agent-browser。

---

## 范围与当前证据

- 附件开头明确转交 7 项；后附旧 UI 全量报告只作为上下文，不自动扩大到所有旧设计建议。
- 本机原工作区 `codex/frontend-lint-cleanup` 的 `docs/local-tooling-2026-09-04.md` 已有改动，完全保留。
- 远端主分支当场取得 `8db3e40`。修复不合并 main、不推送、不打 tag、不运行生产迁移或发版；附件中的“只开草稿 PR”视为后续集成约束。
- 附件 `role-diff.json` 是测试库差量，不能充当正式库导出。已经请求正式角色元数据/权限与认可对照表的位置；收到前不编造生产目标或自动收紧尚未认可的其他权限。
- 不处理待复查的财务登录 403、审批流配置、商品重复提交政策、QA 实体 PDA 分配。

## Task 1：分类 ID 非法输入返回 400

**Files:** `backend/src/modules/categories/categories.routes.js`、必要时同模块 controller；新 `tests/categories-route-params.test.js`；`package.json`、`.github/workflows/test.yml`、`docs/backend-api-sql-conventions.md`。

- [x] 读取 `utils/route.js` 的 `validateParams` 和现有 ID 校验例子，使用真实 Express 路由边界的数据库替身复现。固定 `/tree`、`/flat`、`/leaves` 不能被 ID 校验吞掉。
- [x] 首先断言 `GET /abc`、`/0`、`/-1`、小数、科学计数、超安全整数以及 PUT/DELETE/PATCH 非法 ID 均 400，服务未执行；合法 ID 进入原 controller、缺失记录保持 404。运行测试确认原实现失败。
- [x] 在每条资源路由的原权限中间件后加入 `validateParams`，只接受安全正整数十进制路径。原查询、写权限、请求体规则保持。

```js
const idSchema = z.object({ id: z.string().regex(/^[1-9]\d*$/, '分类编号无效')
  .refine(value => Number.isSafeInteger(Number(value)), '分类编号无效') })
```

- [x] 定向运行 `node --test tests/categories-route-params.test.js`，并纳入 CI 静态 job 可达脚本；同步主题文档。记录红/绿与实际 HTTP 边界。

## Task 2：只读账号写按钮隐藏

**Files:** `frontend/src/pages/{returns,inventory,products,categories,price-change}/index.tsx`、`pages/finance/expenses/index.tsx`、`components/shared/{ReceiptPanel,StatementPanel}.tsx`、`pages/settings/{print-templates,printers}/index.tsx`、`pages/carriers/index.tsx`，及这些页面实际承载按钮的子组件和对应测试；`docs/frontend-pda-conventions.md`。

- [x] 逐一追踪附件列出的新建退货、库存导入/出库/盘点、商品编辑、分类增改停删、申请改价、新建报销、收付款核销、模板新建编辑、快递账号管理、打印机保存，核对实际后端写路由的权限码。
- [x] 先写组件用例：仅查看权限时 `queryByRole('button', {name: 操作名})` 返回 null；补上准确动作权限后出现。至少覆盖每个共享按钮承载组件，不能只测 `can()` 自己。
- [x] 复现原按钮泄露后，使用 `usePermission().can(PERMISSIONS.X)` 条件渲染；在 handler/弹窗入口复核当前权限，撤权后不能靠已打开弹窗提交。不根据角色名或“只读”字符串硬编码。

```tsx
const { can } = usePermission()
const canCreate = can(PERMISSIONS.RETURN_ORDER_CREATE)
// 操作入口与其提交都以当前 canCreate 为准，查看功能照常使用原读权限。
```

- [x] 运行新增定向 Vitest 用例，同步主题文档；测试与 GUI 结果分别记录，不把隐藏按钮当后台授权修复。

## Task 3：仓库发货入口

**Files:** `frontend/src/router/{routeDefinitions,routeRegistry}.ts`、新 `frontend/src/pages/warehouse-shipping/index.tsx` 与测试、`router/routeAccess.test.ts`、`docs/frontend-pda-conventions.md`。

- [x] 先断言仅持 `WAREHOUSE_TASK_SHIP` 的用户可在仓储菜单发现已注册的“仓库发货”，无权用户不可见且路由拒绝。
- [x] 注册 `/warehouse-shipping`，title/菜单/页头统一“仓库发货”；页面说明使用已绑定 PDA，提供指向真实 `#/pda/ship` 的新页入口。采用新页是因为现有 `CrossClientNavigationGuard` 禁止在同一实例跨 ERP/PDA 跳转。

```tsx
<a href="#/pda/ship" target="_blank" rel="noopener noreferrer">打开 PDA 出库确认</a>
```

- [x] 不把猜测地址映射到不存在的桌面发货功能、不调用发货写 API、不取消 PDA 会话/仓库校验。组件和路由测试确认入口可达；真实扫码发货仍列为真机验收。

## Task 4：报税页面崩溃

**Files:** `frontend/src/pages/accounting/tax/index.tsx`、`hooks/useTax.ts`、`pages/accounting/tax/index.test.tsx` 及专属真实数据边界用例；必要时 `backend/src/modules/accounting/accounting.tax.service.js`；对应前端/财务文档。

- [x] 用真实页面、真实 DataTable 与后端 DTO核对：同版新库、真实登录、空调整与合成调整均未重现原生产崩溃；原错误堆栈尚缺。后端返回数组，非 `{list}`，未以猜测修改DTO。
- [ ] 先增加与实际后端结构一致的契约用例，确认原代码报错，再在正确边界修复类型/解包；不以任意 `Array.isArray` 丢数据或静默显示零来掩盖失败。
- [x] 增值税/所得税切换、草稿保持、错误/暂停/加载、非法月份、只读写门与删除缓存归属已以真实组件回归；新增明确缺陷红绿，财务公式保持。
- [ ] 原生产崩溃仍待错误栈定位，不标记完成。确定的相邻缺陷15项前端/10项期间用例通过，真实页面两税种正常、非法月份给出校验；详见结果文档。

## Task 5：资金工作区与往来列表口径差异

**Files:** `frontend/src/pages/payments/PaymentsView.tsx`、`components/shared/StatementPanel.tsx`、`pages/reports/ReconciliationView.tsx`、`router/mergedPageGroups.ts`；`backend/src/modules/payments/{payments.service,payment-aging.service,reconciliation-statements.service}.js` 与 `modules/reports/reports.query.js`（只改查明有错的文件）；对应测试与 `docs/finance-permission-time.md`。

- [x] 沿资金卡片 → 往来合并子页 → 默认查询 → 账龄/账款/对账单接口追踪 type、结算方式、状态与日期。原有 358.43/33.13 只作为报告现象，不能用它们推造生产写操作。
- [x] 用合成非敏感夹具分别覆盖“原始未结账款但没有汇总对账单”、现结/月结、部分结清/全结清、范围限制；用同一未结定义比较卡片和相应列表，确认差异来自何处。
- [x] 若默认汇总对账单空但原始账款存在，明确区分两者并提供正确账款入口/默认视图；若筛选参数有误，修正源头并透传至导出。保留既定现结/月结及账款确认规则，不重算或改写历史账。
- [x] 运行组件/查询边界定向回归，文档说明根因与未触碰生产数据的边界。正式历史两笔仍需运营只读复核。

## Task 6：PDA 手动输入与反馈四项

**Files:** `frontend/src/components/pda/PdaScanner.tsx`、`hooks/usePdaScanner.ts`、`hooks/usePdaFeedback.ts`、`components/pda/PdaFlash.tsx`、`pages/pda/{ship,sort,inventory-query,plastic-box,index}.tsx`、相关塑料盒作业/放货实际页面、对应测试；`docs/frontend-pda-conventions.md`。

- [x] 追踪共享扫码 callback 返回约定及全部调用点；先写“异步失败保留原内容并聚焦选中，成功收起、防连续回车重复提交”的失败用例。不能通过只改按钮点击而漏回车，也不能令异常被吞成成功。
- [x] 共享输入等待处理结果；失败保留并允许修正重试，成功沿原流程收起；不改变硬件扫描、串行队列、幂等键或库存逻辑。
- [x] 出库找不到码必须说明原因；对库存条码不存在/失效使用统一中文，反馈位置一致，保留真实业务失败原因与不确定结果恢复入口。
- [x] 未绑定首页只保留一处解释和“去绑定设备”；不显示假的可用作业数量，也不被自动重试弹出相同 toast 遮挡操作。只收敛这一已知状态，其他认证与网络错误继续提示。
- [x] 定向运行 scanner、相关页面与权限测试，再用手机尺寸真实页面检查回车失败和未绑定首页；成功及原键恢复正例由真实组件回归覆盖，网页结果不冒充 PDA 真机。

## Task 7：正式角色权限新增补丁（资料前置）

**Files:** 收到正式角色导出后确定当前最大编号+1的全新迁移/补丁、对应 manifest/比对工具与 `tests/role-duties-*.test.js`、`docs/role-defaults-approval-2026-10-19.md`、`docs/finance-permission-time.md`。

- [ ] 读取运维导出的正式 `sys_roles` 与每角色权限码，核对来源/导出时间及旧295修订记录；只处理获认可的角色与差量。测试库 `role-diff` 仅作23撤8增目标对照。
- [ ] 生成逐角色、逐权限的改前/改后表，既有已生效两岗位保持，实际别名 `warehouse` / `viewer` 名称及 sales 49 项以正式导出为准。表未认可时不执行正式补丁。
- [ ] 先构造真实正式元数据形状的合成测试，覆盖角色不匹配、权限漂移、重放、部分已应用、事务回滚和自定义角色保留。任何不匹配明确失败，不能静默跳过或照净数量猜差量。
- [ ] 新补丁使用精确身份和全权限集合前置断言、事务行锁、明确授权差量和一次性修订记录；不修改295及所有历史迁移。运行仅针对专属测试库，不连接生产。
- [x] 资料未到，记录“待正式导出/认可表，尚未编写或执行正式权限补丁”；另提供 `docs/qa-role-review-2026-10-21.md` 的最小只读导出清单。不把UI修复写成越权解除。

## 批次交付与验证

- [x] 已实现的六组代码逐组完成独立规格、质量审阅；补齐退货行确认/取消撤权、税务删除原期间缓存归属问题。正式权限及原报税崩溃仍单列待处理。
- [x] 两端lint、前端正确项目tsc、395文件3600项前端全量、76项新增后端、46项相邻后端及相关契约通过。ERP/PDA构建输出 `/tmp`；不覆盖产物。完整后端/专属业务DB发布矩阵待发版前验证。
- [x] 回环预览与具label专属合成库完成实页验收；浏览器close后两次session list为空，Vite/API/runner进程、任务容器和卷均确认已退出/移除，私有认证文件删除。
- [x] 更新计划及结果文档，diff检查与文档守卫通过；历史迁移未变，原工作区仍为原分支与原文档改动。改动留在隔离工作树，未提交、推送或发布。
