# FlowCube 深度审计报告（2026-08-21）

> 审计方式：多智能体 10 维度并行扫描（工作流）+ 4 个定向子代理（安全/财务/前端/CI）+ 人工基线核对（机械验证 CLAUDE.md 全部可验证声明 + 生产环境实查 + 核心引擎不变量验证）。
> 状态：深度扫描工作流因模型性能中途挂起（已停），4 个定向子代理运行中；本报告主体基于**人工核对结论**（全部经代码/生产实证），子代理结果到达后并入附录。

---

## 摘要

**核心结论：CLAUDE.md 严重滞后于代码（计数级错误 6 处、漏记功能模块 11+ 个、漏记状态机 5 个），但已记录的存量描述（库存不变量、状态机语义、安全配置、部署链路）经逐项验证全部准确。无发现紧急生产事故级代码缺陷。**

---

## 一、CLAUDE.md 文档滞后（高优先级，需立即修订）

| 声明 | CLAUDE.md 声称 | 代码实际（已验证） | 差异 |
|------|--------------|---------|------|
| 迁移数 | 150 | **210 文件 / db_migrations 211 条** | 差 60 |
| 模块数 | 47 | **58 目录 / app.js 59 条 /api 路由** | 差 11 |
| 权限码 | 145 | **184（前后端一致）** | 差 39 |
| 数据库表 | 83 | **131（生产实测）** | 差 48 |
| 状态机 | 10 个 | **14 个（documentStatusRules.js）** | 漏 5 个 |
| 测试脚本 | 列了部分 | 根 package.json **30+ scripts** | 大量未列 |

### 1.1 漏记的状态机（documentStatusRules.js，已验证）
| 状态机 | 对应模块 | 动作 |
|--------|---------|------|
| refundOrder（退款单 P2-6） | refunds/ | edit/submit/execute/cancel |
| purchaseRequisition（采购请购 P2-7） | purchase-requisitions/ | edit/submit/withdraw/approve/reject/convert/complete/cancel |
| inventoryDisposal（呆滞处置 P2-9） | disposal/ | edit/submit/approve/reject/dispose/cancel |
| procurementPlan（采购计划） | procurement/ | edit/convert/cancel |
| creditOverride（授信放行 P2-7） | credit-overrides/ | edit/submit/approve/reject/cancel |

### 1.2 漏记的模块（11 个新增，58 vs 47）
accounting（多账套/凭证/结转）、approvals（审批流）、fixed-assets（固定资产折旧）、hr（工资社保报税）、refunds（退款单）、credit-overrides（授信放行）、disposal（呆滞处置）、customer-addresses、purchase-requisitions（请购）、procurement（采购计划）、logistics（物流面单）、plastic-boxes、price-lists、import、export、oplogs、search、pda-devices、print-templates、printer-bindings、printers、app-update、admin、categories、containers、notifications、packages、sorting-bins、roles、users、departments、settings、reports、system、scan-logs、warehouses、racks、locations、stockcheck、dashboard

### 1.3 漏记的引擎/中间件/常量（已验证）
- `engine/approvalEngine.js`（多级审批流引擎，P2-7）
- `middleware/companyScope.js`（多账套公司隔离）
- `constants/voucherSource.js`（凭证来源）
- `utils/creditExposure.js`（授信敞口计算）
- `utils/inboundThresholds.js`、`utils/priceLevels.js`、`utils/priceReference.js`、`utils/printSummary.js`、`utils/route.js`、`utils/requestContext.js`

### 1.4 漏记的运维/测试脚本
- `scripts/schema-reconcile.js`（表漂移对账，已存在且可用——生产实测通过）
- `scripts/smoke-reports.js`、`scripts/cleanup-*.sh`、`scripts/git-*-check.sh`、`scripts/read-deploy-config.js`、`scripts/build-frontend-bundle.js`
- 测试：smoke:accounting、smoke:accounting-period、smoke:invoice-quota、smoke:refund-orders、smoke:disposal、smoke:credit-outbound、smoke:reports-values、test:accounting、test:oplog、test:print-purge、test:permissions

### 1.5 其他滞后
- docker-compose.yml 有 loki/grafana（observability profile，未启用）——CLAUDE.md 未记录
- 版本号 v0.4.80（文档知识停留在 ~v0.4.37；v0.4.73~v0.4.80 的 8 个版本内容未记录）
- 会计标准 5 项（多账套/固定资产/结转/工资/报税）全部落地但未记录

---

## 二、已验证的准确声明（CLAUDE.md 可信部分）

以下声明经代码/生产逐项验证**全部准确**：
- 库存 9 条不变量（唯一写入口、reserved 引擎约束、锁顺序、deductFromTaskLockedContainers、assertNonNegativeQty、PENDING_PUTAWAY 不计入）
- 状态机语义（purchase/sale/transfer 等 10 个已记录机器的动作与 CLAUDE.md 表格一致）
- 安全配置（contextIsolation、nodeIntegration=false、JWT token_version、全局限流 60s/1000 次、登录专用限流）
- 手动入库/调整 403 关闭
- 打印只收 zpl、幂等 job_unique_key
- Electron contextIsolation、PDA 扫码枪/useCriticalPdaAction/X-Client: pda
- 迁移编号模式（重复 057/064/089、缺 008/009/040）
- 依赖版本（express 4.21.2、react 18.3.1、zustand 5.0.2、capacitor 8.2.0、Android minSdk 22/target 35）
- exceljs 4.4.0/archiver^5 告警链（第 20 节第 12 条仍成立）
- 生产 cron 4 条、环境变量必填项

---

## 三、运行时/运维现状（生产实查）

### 3.1 健康项
- 3 容器运行正常（backend/frontend/mysql 12 天 healthy）；磁盘 74%（11G 可用）；内存 3.5G/1.4G
- 4 条 cron 正常；备份 5 份有效
- **schema-reconcile 生产实测通过**：已执行迁移声明表 127 个全部存在，唯一意外表 `sys_users_dedupe_backup_20260424`（手工备份）

### 3.2 待确认/待清理项
- **db_migrations 211 条 vs 迁移文件 210 个**：多 1 条手工执行记录，需确认来源（schema-reconcile 判为无缺失表，风险低）
- admin id=6 残留（已逻辑删除、零关联，物理删除需用户确认）
- 22 个 claude/* 分支遗留
- 13 个打印模块文件未提交（380+/108- 行，另一任务进行中）

---

## 四、测试覆盖评估（32 个测试文件）

### 4.1 有专门测试的新模块（质量良好）
会计、审批流、授信（出库+放行）、处置、财务、HR 报税、发票配额、退款、报表值——均有对应 smoke 测试。

### 4.2 无直接测试的模块（7 个，多为轻量）
logistics（物流面单）、plastic-boxes（塑料盒拆分）、price-lists（价格表）、notifications（通知）、departments（部门）、carriers（承运商）、racks（货架）——风险等级低，但建议至少补 smoke-pages 级页面可达性覆盖。

---

## 五、深度扫描状态与后续建议

### 5.1 已完成的深度核对
- 库存引擎核心不变量：**全部符合**（无直接 UPDATE quantity、reserved 仅引擎写、锁顺序正确、出库仅扣任务锁定容器）
- 状态机实现：14 个机器动作与常量定义一致
- 迁移内容：200-210 均为 P2/会计功能，与记忆文件进展一致

### 5.2 待补充的深度审计（工作流挂起未覆盖）
- 后端安全逐路由审计（4 个子代理运行中）
- 财务金额/幂等逐模块审计（运行中）
- 前端 XSS/权限绕过审计（运行中）
- CI 供应链安全（运行中）
- 库存引擎极端并发场景模拟

---

## 六、修复优先级建议

1. **P0（文档）**：按本报告第一节全面修订 CLAUDE.md
2. **P1（运维）**：确认 db_migrations 211 vs 210 差异；清理 claude/* 分支；提交/处理打印模块未提交改动
3. **P2（补测）**：为 7 个无测试模块补页面级 smoke；将 schema-reconcile 挂 CI 门禁
4. **P3（数据）**：admin id=6 物理删除（需用户确认）

---

*报告生成：2026-08-21。审计范围：backend/src（4.4 万行）、frontend/src（6 万行）、scripts/、tests/、.github/workflows/、docker-compose.yml、生产服务器。子代理结果到达后并入附录。*

---

## 附录 A：定向子代理审计发现（已验证）

### A.1 高危：warehouse-tasks 模块跨仓 IDOR（已确认）

**发现**：`backend/src/modules/warehouse-tasks/` 是唯一一个写操作全链路不传 `scopeWarehouseIds` 的核心业务模块。`detail`/`cancel`/`assign`/`updatePriority` 等接口直接用 `req.params.id` 调 service，service 层无 `assertInScope`。对比同仓 `sale.service.js:505`、`inbound-tasks.command.js:197` 都有单据级 `assertInScope(scopeWarehouseIds, warehouse_id)` 校验。

**影响**：配置了 `user_warehouse_scope` 的限仓用户（非超管）猜到任务 id 即可：
- 查看任意仓库任务详情（客户名、商品、数量）
- 取消他人仓库任务（释放预占 + 改销售单状态）
- 分配操作员、改优先级

**证据**：
- `warehouse-tasks.controller.js:14`：`const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }`——无 warehouseIds 传入
- `warehouse-tasks.query.js:30`：`findById(id)` 无 assertInScope
- 模块内仅 list/pendingCancelReturns/pendingAdjustments 三处传了 scope

**修复建议**：controller 的 detail/assign/cancel/updatePriority/cancelReturnDetail/debugSnapshot 等接口把 `req.user?.warehouseIds ?? null` 传入 service；service 层在 findById 及每个写操作拿到任务行后调用 `assertInScope(scopeWarehouseIds, task.warehouse_id, '仓库任务')`。

### A.2 高危：warehouse-tasks PDA 作业接口可跨仓出库（已确认）

**发现**：`ship`/`sortDone`/`checkDone`/`packDone`/`readyToShip`/`startPicking` 挂 `pdaOnly` + `pdaSessionRequired` 但业务层不校验 `req.pda.warehouseId` 与 `task.warehouse_id` 是否一致。对比 `inbound-tasks.putaway.js:106-107` 有明确的设备绑定仓库校验（"当前设备绑定仓库与该收货订单所属仓库不一致，无法上架"）。

**影响**：绑定 A 仓 PDA 设备的用户可对 B 仓任务执行 ship 出库——**触发真实库存扣减、写应收、释放预占**，是最严重的越权面。

**证据**：
- `warehouse-tasks.ship.js:218`：`async function ship(id, operator, saleData, { requestKey } = {})` 无 scope/pda 参数
- 模块内全文件 grep 无 `pdaWarehouseId` 引用

**修复建议**：在 ship/sortDone/checkDone/packDone 的事务内取到 taskRow 后，先校验 `req.pda.warehouseId`（若设备绑定了仓库）与 `task.warehouse_id` 一致，再叠加用户级 `assertInScope(req.user.warehouseIds, task.warehouse_id)`。

### A.3 中危：picking-waves 模块无仓库数据权限校验（已确认）

picking_waves 有 `warehouse_id` 列，但全部接口不传 `req.user.warehouseIds`、无 assertInScope。限仓用户可查看/操作其他仓库波次（推进拣货/分拣状态）。与 warehouse-tasks 缺口联动放大。

### A.4 中危：全局搜索跨 16 类单据不做仓库过滤（已确认）

`search.service.js:10-12` 注释明确承认"跨全部业务的只读查询，不经数据权限过滤"。搜索结果含单号/关联方名称，可配合 detail 缺口扩大泄露面。

### A.5 中危：CI 部署竞态——PDA 发布绕过部署锁（已确认）

`build-pda-apk.yml:214-226` 直接 ssh 服务器执行 `docker compose up -d --build backend` + `git reset --hard`，不经过 `server-update.sh` 的 flock 锁，concurrency group 独立。与 Deploy workflow 并发时可能互相抢容器——正是 2026-08-11 事故注释描述的场景复现路径。

### A.6 中危：迁移失败无回滚（已确认）

`server-update.sh:83-88`：先 `docker compose up --build`（新镜像替换旧容器）再 migrate，migrate 失败时新代码已运行在旧 schema 上，无回滚机制。

### A.7 中危：MySQL initdb 挂载与显式迁移双跑（已确认）

`docker-compose.yml:13` 把 `backend/src/database` 挂载为 `docker-entrypoint-initdb.d`——空数据卷首次启动会执行全部迁移文件（不记录 db_migrations），随后 server-update.sh 显式 migrate 再跑一遍，ALTER TABLE 会因 Duplicate column 失败。生产首次部署/灾备重建（空数据卷）时链路必坏。

### A.8 中低危：第三方 Actions 未 pin SHA、secret 内插、镜像浮动 tag

- 5 个 workflow 的 actions/checkout@v5 等均按 tag 引用（持 contents:write + SSH 密钥的 build-desktop 风险最高）
- `secrets.SSH_PRIVATE_KEY` 直接内插进 run 脚本（deploy-browser.yml:79 等 3 处）
- `nginx:alpine`、`rclone:latest` 浮动 tag 不可复现
- Grafana 默认口令明文（observability profile 未启用，风险低）

### A.9 低危：restore-check 未纳入 cron、rotate-slowlog 失败不告警、JWT 7 天可无限续期

- 备份可恢复性无定期验证（install-cron.sh 只装 4 条）
- 监控告警单通道（webhook 失败静默 || true）
- JWT 7 天 + refresh 无限续期（token_version 兜底有效）

---

## 附录 B：安全审计确认的安全项（无问题）

- 所有业务 routes 挂 authMiddleware + requirePermission（唯一公开 app-update/latest 是刻意设计）
- 全仓 SQL 参数化 + 白名单片段拼接，无注入点
- opLogger 敏感字段脱敏；multer memoryStorage + 5MB + MIME 白名单，无路径穿越
- 无硬编码密钥；backend 容器 su-exec 降权非 root；端口回环绑定
- backup-db.sh .part + 校验 + 原子 mv；server-update.sh 有 flock 锁

---

## 附录 C：前端审计发现（已验证）

**总评**：权限体系完整（路由守卫 + PdaRoutePermission + 菜单过滤 + dashboard widget 权限 + 后端 requirePermission 兜底）；XSS 面干净（全仓 0 处 dangerouslySetInnerHTML/innerHTML/eval）；API 封装规范（仅 3 处工具性裸 axios，均不带 token）。无 critical/high。

### C.1 中危：登出时 React Query 缓存未清理（切换账号数据残留）
`performSessionLogout()` 只调 workspaceStore.closeAll() + authStore.logout()，**从不 queryClient.clear()**。登出再登录后，上一账号的查询数据（销售/应付/审批等）留在内存缓存（staleTime 5min），keepAlive 页面组件不卸载，新账号打开同一页面可能短暂看到旧账号数据。所有 queryKey 无用户维度。
**修复**：performSessionLogout 中调 queryClient.clear()。

### C.2 中危：打印模板编辑器 keepAlive 残留（违反 CLAUDE.md 第 13 节要求）
PrintTemplateEditor 是 keepAlive 页面，tabIdentity 为 pathname，切换模板 id 时组件不卸载，`hydrated` 标志只在初始化时置位，id 变化后远程数据不覆盖现有表单态——**在模板 A 编辑未保存后打开模板 B，会看到 A 的内容并可能把 A 的修改保存到 B**。且无 useDirtyGuard。
**修复**：id 加入 hydration 依赖、变化时重置表单态；接入 useDirtyGuard。

### C.3 中危：工作区标签持久化无上限，keepAlive 组件无限累积
workspaceStore 用 zustand persist 全量持久化 tabs 到 localStorage，无数量上限；keepAlive 架构下每个 tab 对应永久挂载的组件实例。长年使用后内存/DOM 单调增长。
**修复**：tabs 设上限（如 20-30，超出按 LRU 关闭）；或改 sessionStorage + 数量裁剪。

### C.4 中危：PDA 设备凭据明文长期存 localStorage
deviceSecret 与设备会话票据（30 天）明文 JSON 存 localStorage，无加密无 HttpOnly。设备丢失或 WebView 被注入脚本可完全冒充设备身份（服务端可停用设备吊销票据兜底）。
**修复**：至少改为一次性使用票据 + 心跳续期；评估 Capacitor Secure Storage。

### C.5 低危
- PDA 错误堆栈明文写 sessionStorage（pda_last_error，含业务数据可能）
- PDA 版本检查用裸 axios 请求可配置地址，downloadUrl 无签名校验（服务端信任链问题，前端无校验）
- useNetworkStatus 全局心跳模块级注册永不清除（dev 热更新会叠加定时器）

---

## 附录 D：审计方法说明

- **人工基线核对**：机械验证 CLAUDE.md 全部可验证声明（计数/路径/脚本/配置/状态机），生产环境实查（容器/cron/表数/schema 对账/备份/磁盘）
- **定向子代理**：4 个并行（后端安全/财务/前端/CI），各自产出结构化发现
- **深度扫描工作流**：10 维度并行扫描启动后因模型性能挂起未完成（8 个 agent 运行中无产出），其设计可复用（scripts/flowcube-deep-audit-*.js）
- **验证**：高危发现（warehouse-tasks IDOR、PDA 跨仓出库）已人工逐行确认代码证据

**审计范围**：backend/src（286 文件/4.4 万行）、frontend/src（441 文件/6 万行）、scripts/、tests/（32 文件/8423 行）、.github/workflows/（5 个）、docker-compose.yml、生产服务器运行时状态。
