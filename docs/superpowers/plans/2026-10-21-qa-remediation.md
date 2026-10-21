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

- [x] 用真实页面、真实DataTable与后端DTO核对；续办明确验证全0与空数组，验收基线及候选均未复现，console error/page error均0。后端返回数组，未猜测修改DTO。
- [ ] 先增加与实际后端结构一致的契约用例，确认原代码报错，再在正确边界修复类型/解包；不以任意 `Array.isArray` 丢数据或静默显示零来掩盖失败。
- [x] 增值税/所得税切换、草稿保持、错误/暂停/加载、非法月份、只读写门与删除缓存归属已以真实组件回归；新增明确缺陷红绿，财务公式保持。
- [ ] 原生产崩溃仍待错误栈定位，不标记完成。相邻边界及零数据形状16项前端/10项期间用例通过，真实页面两税种正常、非法月份给出校验；详见结果文档。

## Task 5：按续办事实撤回候选，等待业务决定

用户转述运维核对：3月两笔未结月结金额正确，现结不含月结是原有分流。本项不改变分流、查询或历史账。

- [x] 初始候选先随4565f5b提交并创建draft PR #98，随后单独记录撤回。
- [x] reports.query、资金dashboard及查询守卫恢复8db3e40；删除本批导航测试。
- [x] 月结默认tab、日期、状态、列表及导出参数恢复；PaymentsView撤回新增说明/导航，仅保留Task2权限门和只读标签。
- [x] 独立比对无第5条业务变更残留，定向前端33项及后端19项通过。
- [ ] 等用户决定“往来页要不要显示月结单”，此前不实施相关逻辑变更。

## Task 6：PDA 手动输入与反馈四项

**Files:** `frontend/src/components/pda/PdaScanner.tsx`、`hooks/usePdaScanner.ts`、`hooks/usePdaFeedback.ts`、`components/pda/PdaFlash.tsx`、`pages/pda/{ship,sort,inventory-query,plastic-box,index}.tsx`、相关塑料盒作业/放货实际页面、对应测试；`docs/frontend-pda-conventions.md`。

- [x] 追踪共享扫码 callback 返回约定及全部调用点；先写“异步失败保留原内容并聚焦选中，成功收起、防连续回车重复提交”的失败用例。不能通过只改按钮点击而漏回车，也不能令异常被吞成成功。
- [x] 共享输入等待处理结果；失败保留并允许修正重试，成功沿原流程收起；不改变硬件扫描、串行队列、幂等键或库存逻辑。
- [x] 出库找不到码必须说明原因；对库存条码不存在/失效使用统一中文，反馈位置一致，保留真实业务失败原因与不确定结果恢复入口。
- [x] 未绑定首页只保留一处解释和“去绑定设备”；不显示假的可用作业数量，也不被自动重试弹出相同 toast 遮挡操作。只收敛这一已知状态，其他认证与网络错误继续提示。
- [x] 定向运行 scanner、相关页面与权限测试，再用手机尺寸真实页面检查回车失败和未绑定首页；成功及原键恢复正例由真实组件回归覆盖，网页结果不冒充 PDA 真机。

## Task 7：正式角色权限新增补丁（资料前置）

**Files:** 收到正式角色导出后确定当前最大编号+1的全新迁移/补丁、对应 manifest/比对工具与 `tests/role-duties-*.test.js`、`docs/role-defaults-approval-2026-10-19.md`、`docs/finance-permission-time.md`。

- [x] 经用户授权通过Grok Bot取得运维正式13角色完整元数据/权限附件，核对来源声明、导出时间、唯一身份及351条完整授权；未直接查询生产。旧295修订回执未导出，不能把角色清单当成其执行证明。测试库 `role-diff` 仅作参考。
- [x] 生成13角色逐权限改前/改后提案v2，351→319（35撤回、3新增），列出共享报表撤权影响及经营金额/授信/dashboard等保留边界；正式warehouse/sales/viewer完整集合替代旧摘要。用户已认可该完整版本，296严格按该集合实施。
- [x] 先构造真实正式元数据形状的合成测试，覆盖角色不匹配、权限漂移、重放、部分已应用、事务回滚和自定义角色保留。任何不匹配明确失败，不能静默跳过或照净数量猜差量。
- [x] 新补丁使用精确身份和全权限集合前置断言、事务行锁、明确授权差量和一次性修订记录；不修改295及所有历史迁移。运行仅针对专属测试库，不连接生产。
- [x] 首轮6角色摘要表已被运维完整13角色逐项表替代；未写或执行权限补丁，不把UI候选或对照表写成岗位越权解除。

## 批次交付与验证

- [x] 已实现的六组代码逐组完成独立规格、质量审阅；补齐退货行确认/取消撤权、税务删除原期间缓存归属问题。正式权限及原报税崩溃仍单列待处理。
- [x] 两端lint、前端正确项目tsc、395文件3600项前端全量、76项新增后端、46项相邻后端及相关契约通过。ERP/PDA构建输出 `/tmp`；不覆盖产物。完整后端/专属业务DB发布矩阵待发版前验证。
- [x] 回环预览与具label专属合成库完成实页验收；浏览器close后两次session list为空，Vite/API/runner进程、任务容器和卷均确认已退出/移除，私有认证文件删除。
- [x] 更新计划及结果文档，diff检查与文档守卫通过；历史迁移未变，原工作区仍为原分支与原文档改动。改动留在隔离工作树，未提交、推送或发布。

## 续办交付记录

- [x] 先提交4565f5b、推送隔离分支并开draft PR #98；未合并main。
- [x] 第5条按运维事实撤回业务候选，后续独立差异审阅通过；原往来权限/筛选定向33项及后端19项通过。
- [x] 第4条在全0/空数组下分别查看8db3e40基线和候选，均未复现，console error/page error均0；新增形状用例后税务16项通过。
- [x] 第1条先形成不完整摘要表；后通过Grok Bot收到完整13角色导出，现已补全精确元数据、权限和建议前后集合。未写权限补丁。
- [x] 最终前端394文件3593项、lint、正确项目tsc、ERP/PDA构建通过；浏览器/预览/专属容器与卷清理核实。
- [x] 用户已认可每个角色精确集合及整项撤报表，296独立完整检查，旧295回执保留且不作跳过依据。第5条等待是否合列月结的决定。

## 已认可岗位提案v2：新增296迁移执行计划

用户已明确认可b7df530中的完整对照表，7角色report.view整项撤回，不拆分。补丁只在codex/qa-fixes-20261021 / draft PR #98继续；不合并、不发布。以表中13个精确ID/元数据和351项改前、319项目标为唯一事实，不改001—295。

- [x] 先新增测试：表格与SQL/夹具集合一致；同数换权、权限大小写、元数据/缺失/多出角色、未改角色漂移全部报错；报告完整缺少/多出项。验证当前实现缺少296/差异输出时测试失败。
- [x] 新增 `296_qa_role_permissions.sql`：完整manifest临时表；事务内按ID锁全部角色及授权，当前读取核元数据与全权限；无漂移后仅35撤/3增；原修订表写13条同版本完整回执。重放只认完整回执和完整目标；半应用、未知回执、重放后人工变更都失败。提交前复核目标；任一异常回滚。
- [x] 迁移入口通用读取 `migration_error` 诊断行并完整抛出，显式回滚；SQL另有硬失败守卫，直接SQL客户端也不能继续写。现有SQL切分、逐条执行及迁移记录不变。新增有界through选项仅供测试建立旧schema，不提供自动忽略296的环境分支。
- [x] 测试准备入口严格限定回环独立测试库、空业务及精确旧默认集合，在001—295后显式装载认可13角色合成基线，再由普通迁移入口执行296。CI及专属实例调用这个测试入口；不让生产迁移自动识别/修平未知基线。已迁移测试库不重置角色。
- [x] MySQL专项：准确35撤3增、回放、变更后拒绝、并发角色保存/直接授权、写后故障回滚与失败不登记迁移；真实Express路由/真实权限加载使用迁移后的实际授权，逐条撤权接口403，7角色全部reports路由403，同时财务/会计及保留能力正例可过权限门。补入原CI入口。
- [x] 统一检查修改JS的lint、迁移/权限/部署资源守卫与新专项，核001—295字节不变；独立审阅并更新实测报告，准备按明确路径提交至PR #98。原报税未复现、第5条分流保持不变。提交推送在最终交付核实。


296实测续记：迁移静态/测试准备与原QA入口90项、MySQL/HTTP及并发40项、原完整授信链、权限28项、相邻契约56项、归属守卫19项通过。完整新实例原293专项40项通过并cleanup confirmed。初始诊断/rollback及RC插入gap反证红，补充完整诊断与本事务RR后绿；元数据与授权集合仍按认可原值。规格审阅发现旧仓管测试编码已精确对齐ID2/warehouse，全部原出库/金额守恒断言保留。详情以QA实测记录为准，未执行生产、未合并或发版。
