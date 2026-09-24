# 深度验收问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `docs/system-deep-acceptance-2026-09-24.md` 的 ACCEPT-001～012，使主数据、仓储、月结和异常恢复的已复现路径可在 GUI 完成，并保留库存、账款及权限不变量。

**Architecture:** 保持现有 React ERP/PDA → Express routes/controller/service → MySQL 事务与 engine 边界。按主数据、财务、仓储、终端与审计四个独立工作包落地；每包先重现失败，再改最小代码，再用真实 GUI、受权限保护的 API 和隔离 MySQL 验收。ACCEPT-007 本轮维持整容器独占拣货策略，明确展示“可占库”和“当前可拣”差异；不引入容器数量级并行锁。

**Tech Stack:** Node 22、Express、mysql2、MySQL 8、React、TypeScript、Vite、React Query、Vitest、`node --test`、agent-browser。

---

## 基线、执行边界与文件职责

- 当前 `main` 为 `d26028e` 且有大量其他任务的未提交文件；验收报告本身也是未跟踪文件。开始实现前执行 `git status --short --branch`、`git diff -- <本包路径>`、`git worktree list --porcelain`，确认每个目标文件是否已被改动。不能把工作树的新 worktree 当成当前带未提交修改的等价基线。确认基线后为修复创建隔离工作树，按已核对的文件逐项移入所需变更；不使用 `reset`、`clean`、`git add .`。
- 根 `AGENTS.md` 与 `docs/backend-api-sql-conventions.md`、`docs/business-semantics.md`、`docs/inventory-transaction-invariants.md`、`docs/finance-permission-time.md`、`docs/frontend-pda-conventions.md`、`docs/print-deploy-ops.md`、`docs/verification-commands.md` 分别约束相应模块。改业务代码时同步对应主题文档；只有新增全仓行为约束才改 `AGENTS.md`。
- 四个工作包独立提交：A 主数据（001/002/003），B 月结（011/012），C 仓储与库存体验（005/006/007/009），D PDA/打印/审计（004/008/010）。每包提交前逐路径暂存并运行 `git diff --cached --check`；本计划不授权 push、tag、发版、生产写入。
- 所有数据库用例使用单独 `flowcube_<用途>_test`、`NODE_ENV=test`、显式回环 DB 参数和可写 `APP_UPDATE_DOWNLOADS_DIR`。先 `source "$HOME/.config/flowcube/dev-env.sh"`（文件存在时）切 Node 22；不读取或输出生产凭据/客户明细。
- 证据分层记录：代码实现、隔离库测试、真实浏览器/PDA Web、Electron、Android 真机、物理打印、生产数据是不同层级。任何一个通过不代表下一层通过。

| 文件组 | 职责 |
|---|---|
| `backend/src/modules/{suppliers,customers}/*.routes.js`、`backend/src/modules/import/import.service.js` | 创建 DTO 与导入枚举解析；不改变服务层自动编号与历史结算快照 |
| `frontend/src/api/payments.ts`、`frontend/src/components/shared/payments/*`、`frontend/src/pages/reports/ReconciliationView.tsx` | 明确候选与详情 DTO，并让月结应付能核对、确认后付款 |
| `backend/src/modules/{warehouse-tasks,sorting-bins}/*`、`frontend/src/pages/pda/sort.tsx` | 分拣格补分配的受权事务与 PDA 后续扫码 |
| `frontend/src/hooks/useInvalidate.ts`、`backend/src/modules/warehouse-tasks/warehouse-tasks.pick.js`、PDA 拣货页 | 库存查找缓存失效与整容器锁的可执行性提示 |
| `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx` | 盘点失败后保留输入并给出业务错误 |
| `frontend/src/main.tsx`/PDA 路由、`backend/src/modules/print-jobs/*`、`backend/src/middleware/opLogger.js` | PDA 初始化、打印状态语义、认证操作人 |

## 工作包 A：主数据创建与导入（P1）

### Task 1：ACCEPT-001/002，统一自动编号创建契约

**Files:** `backend/src/modules/suppliers/suppliers.routes.js`、`backend/src/modules/customers/customers.routes.js`；增补 `tests/masterdata.smoke.test.js`；核对 `frontend/src/pages/suppliers/index.tsx`、`frontend/src/pages/customers/components/CustomerFormDialog.tsx`；同步 `docs/backend-api-sql-conventions.md`、`docs/frontend-pda-conventions.md`。

- [ ] **Step 1 — 红测。** 在独立库通过真实 `POST /api/suppliers`、`POST /api/customers` 发送 GUI 当前不含 `code` 的载荷；断言现在 400。再断言创建后编码非空且唯一、再次相同名称受业务约束拒绝、无创建权限 403；编辑旧编码与删除引用仍按现行规则。
- [ ] **Step 2 — 最小契约改动。** 创建路由采用 `base.omit({ code: true })`，编辑保留原有编码约束；不让客户端编号参与自动编号决策。例如：

  ```js
  router.post('/', requirePermission(PERMISSIONS.SUPPLIER_CREATE),
    validateBody(base.omit({ code: true })), ctrl.create)
  // 客户创建同样用 base.omit({ code: true })；PUT 保持自身编辑 schema。
  ```

- [ ] **Step 3 — 绿测与 GUI。** 同一隔离库在“新增供应商”“新增客户”表单各创建一条，刷新列表/详情仍可见；对重复名称、错误手机号验证只显示一次可理解的失败提示。运行 `npm run smoke:masterdata`、`npm run test:api-route-contract` 与新增 HTTP 用例。
- [ ] **Step 4 — 提交边界。** 只暂存上述创建路由、测试、对应主题文档；供应商和客户作为一个共用契约提交，避免一端恢复、一端继续失败。

### Task 2：ACCEPT-003，导入结算方式严格解析及历史核对

**Files:** `backend/src/modules/import/import.service.js`、`backend/src/constants/settlementType.js`（只增加导入用严格解析器，不改变历史读取的 `normalizeSettlementType()` 兜底）；增补 `tests/masterdata.smoke.test.js` 或新建 `tests/import-settlement.smoke.test.js`；同步 `docs/finance-permission-time.md`、客户/供应商导入模板说明。

- [ ] **Step 1 — 红测。** 使用 CSV/XLSX 行分别填 `现结`、`月结`、`1`、`2`、空值及 `货到立结X`；断言现行客户导入把“现结”存成 2 的失败样本，并比对供应商导入。断言任意未知非空值不得“成功 1 条”。
- [ ] **Step 2 — 实现明确枚举。** 两种导入共用严格解析；空值按模板公开的默认月结处理，未知非空值按行报错，禁止用 `normalizeSettlementType()` 的历史容错吞掉输入。契约：

  ```js
  // 导入边界的输入 → 存储枚举；历史记录读取仍调用 normalizeSettlementType。
  '现结' | '1' => SETTLEMENT_TYPE.CASH
  '月结' | '2' => SETTLEMENT_TYPE.MONTHLY
  ''             => SETTLEMENT_TYPE.MONTHLY
  其他非空值       => 当前行失败，不能写入 sale_customers/supply_suppliers
  ```

- [ ] **Step 3 — 绿测与关联搜索。** GUI 导入现结客户，刷新后为现结、账期 0；月结仍 30 天；非法值显示行号且数据库无该行。核对客户、供应商两个模板和导入预览文案，运行导入专项、`smoke:masterdata`、账款按结算类型分流回归。
- [ ] **Step 4 — 存量数据单列处置。** 从保留的原始导入文件或导入记录取得目标客户 ID，业务方再按客户协议确认结算意图；若数据库没有导入来源标记，不凭当前月结状态反推哪些客户来自导入。不能按“当前月结”批量改成现结；已关联销售/账款的记录先核对历史快照，再决定条件式数据订正或后续新单改档。本包只交付审计清单与代码修复，不擅自改生产客户账期。

## 工作包 B：月结对账与付款（P1）

### Task 3：ACCEPT-011，候选 ID 与对账单明细 DTO 分开

**Files:** `frontend/src/api/payments.ts`、`frontend/src/components/shared/payments/CreateStatementDialog.tsx`；新建 `frontend/src/components/shared/payments/CreateStatementDialog.test.tsx`；增补 `tests/payments-default-scope.smoke.test.js` 或新建 `tests/reconciliation-statement.smoke.test.js`；同步 `docs/finance-permission-time.md`。

- [ ] **Step 1 — 红测。** 用真实 `GET /api/payments/statements/candidates` 返回的 `{id:1,orderNo,...}` 渲染弹窗，勾选后截获 POST；现状 `recordIds:[null]`/400。覆盖 type=1 供应商及 type=2 客户、全选/单选/取消/空集合、刷新后勾选集合清空。
- [ ] **Step 2 — 改前端类型和取值。** 不改变后端候选响应；新增 `StatementCandidate`，其身份字段为 `id:number`，`getStatementCandidatesApi` 返回该类型；`StatementItem` 继续只用于已建对账单详情且身份为 `recordId`。弹窗所有 `picked.has`、`key`、全选、合计、POST 使用 `candidate.id`，提交前过滤非正整数并让按钮不可用。
- [ ] **Step 3 — 绿测与 GUI。** 在隔离库从采购上架产生月结应付，直接 GUI 建对账单并确认，核对 `reconciliation_statement_items.record_id` 指向同一账款且没有重复明细；另一客户月结候选跑同一 UI 契约。运行新增组件/HTTP 用例、`npm run smoke:finance`、`npm run test:api-route-contract`。
- [ ] **Step 4 — 提交。** 候选字段修复、类型、回归、财务文档同批提交；不把 API 正常但 GUI 错误的旧绕行方式当正式修复。

### Task 4：ACCEPT-012，月结应付财务确认入口

**Files:** `frontend/src/pages/reports/ReconciliationView.tsx`、`frontend/src/components/shared/payments/SettlementConfirmDialog.tsx`、`frontend/src/components/shared/payments/usePaymentViewInvalidation.ts`；新建 `frontend/src/pages/reports/ReconciliationView.confirm.test.tsx`；增补 `tests/payments-default-scope.smoke.test.js`；同步 `docs/finance-permission-time.md`、`docs/frontend-pda-conventions.md`。

- [ ] **Step 1 — 红测。** 月结供应商应付 `confirmStatus=0` 出现在“全部账款”，当前只有“原单”；已确认对账单付款返回 409。断言无 `PAYMENT_CONFIRM` 权限时 GUI 无确认动作且直调 `POST /api/payments/:id/confirm` 为 403。
- [ ] **Step 2 — 只复用确认弹窗，不复用现结付款操作。** `ReconciliationRecord` 已包含 `confirmStatus`；在 type=1 且值为 0 的行显示“确认结算”，打开 `SettlementConfirmDialog`，核对实际上架量、单价和退货冲减后调用现有受权限保护的确认接口。保留“原单/收货单”跳转为次操作。type=2 和已确认应付不显示该动作；月结付款仍经对账单，不能在“全部账款”绕过对账单直接付款。
- [ ] **Step 3 — 绿测与闭环。** GUI 执行“收货上架→月结应付待确认→确认结算→新建并确认对账单→付款核销”；断言 `payment_records`、对账单、付款单均核销 ¥50，资金账户从 ¥100 变 ¥50，`finance_account_transactions` 只有一笔支出。重放/重复确认不重复扣款；确认后发生金额重算仍按既有闸门回待确认。运行 `npm run smoke:finance`、`npm run smoke:accounting`、`npm run test:permissions`、新增组件/HTTP 用例。
- [ ] **Step 4 — 提交。** 月结视图、弹窗适配、缓存刷新、测试和文档同批；记录 type=1/2 及有/无权限四种结果。

## 工作包 C：分拣、库存参考与盘点（P1/P2）

### Task 5：ACCEPT-005，为既有无格任务提供受控补分配

**Files:** `backend/src/modules/warehouse-tasks/warehouse-tasks.routes.js`、`warehouse-tasks.controller.js`、`warehouse-tasks.command.js`、`backend/src/modules/sorting-bins/sorting-bins.service.js`、`backend/src/constants/warehouseTaskStatus.js`；ERP `frontend/src/pages/sale/form/components/FulfillmentProgressCard.tsx`、`frontend/src/pages/sorting-bins/index.tsx` 和 `frontend/src/pages/pda/sort.tsx`；新建 `tests/sorting-bin-recovery.smoke.test.js`；同步 `docs/business-semantics.md`、`docs/frontend-pda-conventions.md`。

- [ ] **Step 1 — 红测。** 没有分拣格时创建销售出库任务，PDA 拣货完成；随后新建同仓空格，现状扫码仍提示未分配。另测跨仓格、已占格、已取消/已完成任务、两名主管同时补分配、权限不足与缺请求键。
- [ ] **Step 2 — 单事务补分配。** 增加 `POST /api/warehouse-tasks/:id/assign-sorting-bin`，挂 `WAREHOUSE_TASK_ASSIGN` 和仓库范围校验；在同一 `conn` 中锁任务行，限 `PICKING/SORTING` 且 `sorting_bin_id` 为空、无取消/改单挂起，再锁同仓空格，写两端绑定与任务事件；相同请求键回原结果，竞争者只有一方能成功。与 `forceRelease`、任务取消和原自动分配对照锁序，避免循环等待。不绕过 PDA 分拣格扫码校验。
- [ ] **Step 3 — GUI 恢复。** ERP 在销售单仓库任务进度卡显示“待分配分拣格”，并在分拣格管理页给主管“补分拣格”入口；PDA 提示联系主管、刷新任务后重新扫码。补分配成功后原任务继续分拣→复核；取消、退回及结束仍释放该格。
- [ ] **Step 4 — 验证。** `sorting-bin-recovery` 实际 MySQL 并发测试通过，容器锁和分拣格占用无孤儿；运行 `npm run smoke:mainline`、`npm run smoke:warehouse-ops`、`npm run test:inventory-lock-order`、`npm run test:route-permission-contract`，再做 ERP/PDA GUI 回归。仓储代码、测试与主题文档同批提交。

### Task 6：ACCEPT-006，库存相关写事件统一失效商品查找缓存

**Files:** `frontend/src/hooks/useInvalidate.ts`、`frontend/src/hooks/useProducts.ts`；新建 `frontend/src/hooks/useInvalidate.stock.test.tsx`；必要时增补 `frontend/src/components/shared/ProductFinderModal.test.tsx`；同步 `docs/frontend-pda-conventions.md`。

- [ ] **Step 1 — 红测。** 同一会话先打开查找器显示可用 5，再销售占库 3，重新打开仍显示 5；释放后反向验证。对 `sale_reserve/cancel/delete/adjust/ship`、`inbound_putaway/void_receipt`、`stockcheck_submit`、`transfer_complete`、`return_complete`、`disposal_execute`、`inventory_change` 枚举事件核对。
- [ ] **Step 2 — 集中修复。** 让所有改变 `ACTIVE` 或 `reserved` 的上述事件失效 `['products','finder']`，保持不变库存的纯单据事件不触发。`useProductFinder` 的 `placeholderData` 在仓库参数切换时不能把上一仓值当当前仓“可用库存”展示；需要时显示加载态直到当前仓响应。
- [ ] **Step 3 — 绿测。** GUI “占库→再开销售→释放→调拨查找”各处可用量即时与 `quantity-reserved` 一致；后端继续作为最终占库裁决。运行前端定向 Vitest、`npm run test:frontend-conventions`，库存主线回归与文档同批提交。

### Task 7：ACCEPT-007，区分可承诺与当前可拣的产品口径

**Files:** `backend/src/modules/warehouse-tasks/warehouse-tasks.pick.js`、`warehouse-tasks.query.js`、`frontend/src/pages/pda/picking.tsx`、`frontend/src/pages/sale/components/ReserveAllocationDialog.tsx`；增补 `tests/warehouse-scan-closure.test.js` 和 `frontend/src/pages/pda/picking.test.tsx`；同步 `docs/business-semantics.md`。

- [ ] **Step 1 — 固定当前策略。** 保留“同一容器拣货期间由一个任务独占”，不允许第二任务偷用锁内剩余量，也不在此包拆分容器。以 5 件容器、A 拣 3、B 占 2 的样本写红测：B 可占库但拿不到可拣容器，界面应明确锁在 A、释放条件是 A 完成或逆向归还。
- [ ] **Step 2 — 受权限范围的阻塞信息。** `pick-suggestions` 无候选时，同仓读取 `locked_by_task_id` 的 ACTIVE 容器及任务号，返回有界、无跨仓泄露的 `blockedByTasks` 摘要；PDA 给出可执行指引。销售占库页将“可承诺库存”和“当前可拣库存”分开标注，不改变预占引擎的合法数量账。
- [ ] **Step 3 — 绿测。** A 释放后 B 刷新出现推荐并能拣货；并发/取消/部分拣货仍无重复扣库或负库存。跑 `smoke:concurrency-guards`、`smoke:mainline`、`test:warehouse-scan-closure`，附界面截图。若业务后来要求真正并行拣同箱，另立容器拆分设计及测试，不在本修复中暗改锁模型。

### Task 8：ACCEPT-009，盘点异常路径给出明确反馈

**Files:** `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx`；新建 `frontend/src/pages/stockcheck/components/CheckDetailDialog.error.test.tsx`；同步 `docs/frontend-pda-conventions.md`。

- [ ] **Step 1 — 红测。** `submit.mutateAsync` 返回“另有 5 件正被拣货任务占用”时，现状无业务提示且触发 unhandled rejection。覆盖保存、提交、刷新账面、取消四个异步入口的拒绝路径；断言输入值和弹窗保留。
- [ ] **Step 2 — 明确处理。** 每个异步入口 `try/catch/finally`，在 `catch` 将可见业务消息交给 `toast.error` 或弹窗内错误区；未知错误显示统一恢复指引，`finally` 只解锁按钮。确认框回调只调用已捕获异常的函数，不能向全局抛裸 Promise。
- [ ] **Step 3 — 绿测。** 锁占盘亏提交后能看懂原因、无需重填，释放锁后可刷新/重试；确认 400/409 均不改库存。运行定向 Vitest、`npm run smoke:mainline`、`npm run test:frontend-conventions`；更新主题文档。

## 工作包 D：PDA 入口、打印状态和审计日志（P2/P3）

### Task 9：ACCEPT-004，ERP 可达 PDA 路由也先初始化设备缓存

**Files:** `frontend/src/router/pdaRoutes.tsx`、`frontend/src/router/index.tsx`、`frontend/src/lib/pdaDeviceBinding.ts`、`frontend/src/pages/pda/bind.tsx`；增补 `frontend/src/api/pda-session.test.ts` 与 ERP/PDA 路由集成用例；同步 `docs/frontend-pda-conventions.md`。

- [ ] **Step 1 — 红测。** 普通 ERP 构建直达 `#/pda/bind` 与从 ERP 导航进入，现状同一有效测试设备凭据被误报无效且没有 `/api/pda/sessions`；独立 PDA 构建成功。测试网络失败时凭据仍保留，业务 401/403 才清掉。
- [ ] **Step 2 — 路由级水合。** 在所有 ERP/PDA 共用 `/pda` 入口渲染绑定页或作业页之前只执行一次 `initDeviceBinding()` 并等待完成；独立 PDA 入口沿用既有启动水合，不在每次页面切换重复覆盖内存中新保存的凭据。初始化失败显示“本机设备缓存读取失败/请重新绑定”，不误报服务端密钥错误。
- [ ] **Step 3 — 绿测。** ERP Web 与独立 PDA Web 用同一测试设备码/密钥均能进入有效会话；刷新与解除绑定后状态正确。运行路由/会话 Vitest、`npm run test:frontend-session-contract`、`npm run smoke:pda-device-session`；Android 真机仍是独立验收项。

### Task 10：ACCEPT-008，未配置打印机独立于真正超时

**Files:** `backend/src/modules/print-jobs/print-jobs.status.js`、`print-jobs.query.js`、`frontend/src/pages/settings/barcode-print-query/constants.ts`、`index.tsx`、`frontend/src/utils/displayFormatters.ts`、相关前端类型；增补 `tests/print-status.test.js`、`frontend/src/pages/settings/barcode-print-query/index.test.tsx`；同步 `docs/print-deploy-ops.md`。

- [ ] **Step 1 — 红测。** `status=FAILED,printer_id=NULL,error_message='no printer available'` 当前被显示/筛成“超时待确认”；真正 PENDING/PRINTING 超过阈值、客户端失联、普通失败分别建对照样本。
- [ ] **Step 2 — 独立状态。** 先于超时判断将无打印机记录映射为 `unassigned`/“未配置打印机”；入库、出库、物流三类列表筛选、计数、标签、错误说明采用同一口径，提示“绑定打印机后到打印记录补打”。真正 TTL 超时及客户端失联仍用原超时状态，不修改 `print_jobs` 原始写入或自动补打规则。
- [ ] **Step 3 — 绿测。** `npm run test:print`、`npm run smoke:print-queue`、条码查询前端定向用例通过；无打印机与超时截图并列核对。物理走纸另在设备验收中完成。

### Task 11：ACCEPT-010，成功认证操作记录显示已验证身份

**Files:** `backend/src/modules/auth/auth.controller.js`、`auth.service.js`、`backend/src/middleware/opLogger.js`、`frontend/src/utils/operationLogFormatters.ts`；增补 `tests/auth-session-remediation.smoke.test.js`、`frontend/src/api/oplogs.test.ts`；同步 `docs/frontend-pda-conventions.md`、`docs/finance-permission-time.md` 中审计说明。

- [ ] **Step 1 — 红测。** 成功登录、有效 refresh 令牌退出后，通用 `operation_logs` 当前 `user_id/user_name=NULL`；失败登录与无效退出必须继续匿名，不得把未验证请求体的 `username` 作为操作者。GUI 同时核对中文展示文案。
- [ ] **Step 2 — 可信身份传递。** 登录成功后控制器从 `authService.login()` 已核验的 `result.user` 设置请求内的 `operationActor`；有效 logout 仅在 refresh jti 成功作废后由服务返回用户 ID/账户名给控制器；`opLogger` 在响应落库时优先用该内部可信对象，其他路径沿用 `req.user`。不从请求体或 JWT 未验证解码结果回填身份。前端将认证操作显示为“登录成功/退出登录”，原 HTTP 路径保留详情。
- [ ] **Step 3 — 绿测。** 成功登录/退出、失败密码、无效/重复退出、token 刷新与普通写操作各一例；通用日志与 `auth_audit_logs` 身份一致且不记录密码/refresh token。运行 auth smoke、日志前端单测、`npm run test:permissions`；现有 `opLogger.js` 正在其他未提交工作中修改，合并前先逐行核对其 diff。

## 跨包验证、发布前门槛与收尾

- [ ] **每包结束**：代码审阅、受影响 diff、主题文档、红→绿证据；新增源码守卫须做一次反向验证。测试失败先分离环境故障和业务失败，不把“命令无输出”当通过。
- [ ] **全部本地完成后统一回归**：`npm run test:api-route-contract`、`npm run test:route-permission-contract`、`npm run test:permissions`、`npm run test:print`、`npm run test:frontend-conventions`，以及受影响的 `smoke:mainline`、`smoke:concurrency-guards`、`smoke:warehouse-ops`、`smoke:finance`、`smoke:accounting`、`smoke:pda-device-session`、`smoke:print-queue`；按 `docs/verification-commands.md` 在不同独立测试库组织，避免共享夹具互相污染。前端使用 `tsconfig.app.json` 做类型检查，受影响端执行 lint/build。
- [ ] **真实 GUI 再验收**：沿报告原样重跑 001～012 的复现步骤；采购→收货→上架→销售占库→拣分复核打包→调拨、盘点、月结付款与取消逆向路径在同一隔离样本串联。每个问题记录“修前/修后”截图、API 状态码、关键表状态；不把页面首屏渲染当业务通过。
- [ ] **上线前外部验收**：接入真实打印工作站完成箱贴/出库/应收/销售退货；Android 真机验证扫码广播、软键盘、返回键、断网恢复；按脱敏或用户执行的只读方式核对生产历史导入客户；大数据和并发资金核销补专项。缺这些证据时状态写“本地修复，现场/生产待验”，不得写“上线验收通过”。
- [ ] **交付状态**：分别列明已实现、已提交、已推送、已部署、已验证的 SHA/环境；未经明确要求不 push、打 tag 或发布。浏览器测试用独立命名会话，结束逐会话 `close` 并 `session list --json` 核实；停掉本轮开发进程、保留他人会话和共享 MySQL。

## 自检矩阵

| 报告编号 | 计划任务 | 判定完成的核心证据 |
|---|---|---|
| 001/002 | Task 1 | 两种主档正常 GUI 创建、唯一编号、错误及权限回归 |
| 003 | Task 2 | 现结/月结/非法导入严格入库；历史可疑数据清单独立 |
| 004 | Task 9 | ERP 和 PDA 两入口同凭据绑定、刷新、错误归因 |
| 005 | Task 5 | 无格任务补分配后 PDA 继续、并发与跨仓拒绝 |
| 006 | Task 6 | 占库/释放/调拨后商品查找即时可用量 |
| 007 | Task 7 | 被锁任务可见且不偷库；释放后可拣 |
| 008 | Task 10 | 无打印机和真正超时分开展示/筛选/计数 |
| 009 | Task 8 | 盘点 400/409 有提示、保留输入、无裸拒绝 |
| 010 | Task 11 | 成功认证显示可信身份、失败认证保持匿名 |
| 011 | Task 3 | GUI 生成对账单提交真实 ID，供应商/客户两型 |
| 012 | Task 4 | 月结应付确认权限与 GUI→付款→资金流水闭环 |

**验收边界：**本计划修复报告已确认的问题；报告中尚未实际测试的会计关账、真实打印、Android 设备、生产历史数据与容量测试是独立验收工作，不能因本计划测试通过而自动关闭。
