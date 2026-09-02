# CLAUDE.md

本文件是 Claude Code（claude.ai/code）在本仓库工作的**唯一权威说明书**。内容以当前代码、数据库结构与配置为准。

> 最近一次核对：**2026-08-21**，通过多智能体深度审计 + 逐项机械验证（见 `docs/audit-report-2026-08-21.md`）。本次修正了自 v0.4.37 以来累积的大规模计数滞后：迁移 150→**210**（db_migrations 实际 211 条，含 1 条手工执行记录）、表 83→**131**（生产实测）、模块 47→**58**、权限码 145→**184**（前后端一致）、路由 47→**59**、状态机 10→**14**（documentStatusRules.js 新增 refundOrder/purchaseRequisition/inventoryDisposal/procurementPlan/creditOverride）。同时记录了 v0.4.73~v0.4.80 的 8 个版本、会计标准 5 项（多账套/固定资产/结转链/工资/报税）、P2 收官功能（审批流/授信放行/退款单/呆滞处置）。计数口径 = **已合并到 main**。历史教训（仍适用）：**凡是需要数一下或实跑一遍的条目最容易被照抄旧文本而滞后**——改本文件时，数字和"某某不存在/未启用"这类断言必须当场验证再写。

> 仓库里还有一份 `AGENTS.md`（已被 `.gitignore` 忽略），是本文件的**旧快照**（模块数、状态机、PDA 描述均已过期）。**不要把 AGENTS.md 当事实来源。**
> `docs/01-系统技术与架构总规范.md` 是设计规范文档，与本文件冲突时以**代码**为准，其次以本文件为准。

---

## 1. 项目概述

极序 Flow（flowcube）是单租户 ERP/WMS 系统，三个客户端形态共用一套后端与一套前端代码：

| 形态 | 载体 | 用途 |
|------|------|------|
| ERP 桌面端 | Electron 壳 + React SPA | 办公端：建单、审核、报表、打印机管理 |
| PDA | Android Capacitor APK（同一份 React 代码，`/pda/*` 路由树） | 仓库现场：收货、上架、拣货、分拣、复核、打包、出库、调拨、退货 |
| 浏览器 | 同一份前端产物由 Nginx 提供 | 应急/临时访问 |

**核心设计取向**：仓库端只执行、不决策（谁拣什么、放哪里由系统给；PDA 不提供"自选/判断"入口）；所有库存与账款的事实变化都发生在后端事务里，前端只展示。

---

## 2. 技术栈

- **后端**：Node ≥20，Express 4.21，CommonJS，`mysql2/promise` 连接池（**无 ORM，全部手写 SQL**），zod 校验，jsonwebtoken，bcryptjs，helmet，cors，express-rate-limit，multer，exceljs。
- **前端**：React 18.3 + TypeScript 5.7 + Vite 6 + Tailwind 3.4 + Radix UI(shadcn 风格) + React Query 5 + Zustand 5 + axios + react-router-dom 6（**HashRouter**）+ recharts。
- **桌面端**：Electron 33 + electron-builder 25（NSIS 安装包，仅 Windows x64 走 CI）。
- **PDA**：Capacitor 8（CLI 7），Android `minSdk 23 / target 35 / compileSdk 35`（2026-08-26 由 22 上调：ML Kit 扫码插件 camera 依赖要求 23，Android 5.0 无实际设备），`@vitejs/plugin-legacy` 兼容 Android ≥6，构建目标 `es2015`。
- **数据库**：MySQL 8.0，`utf8mb4_unicode_ci`，连接池 `timezone=+08:00`。**业务时间唯一权威时区 = 北京时间**（2026-08-27 固化，见第 20 节第 45 条）：mysql 容器 `TZ=Asia/Shanghai` + my.cnf `default-time-zone='+08:00'`（`NOW()`/`CURRENT_TIMESTAMP` 生成北京字面量）、backend 容器 `TZ=Asia/Shanghai`、前端日期工具强制 +08:00（`lib/dateTime.ts`，不依赖宿主时区）。
- **部署**：Docker Compose（mysql / backend / frontend-nginx）+ GitHub Actions。

---

## 3. 目录地图

```
flowcube/
├── backend/
│   ├── index.js                    进程入口（dotenv → testConnection → listen → scheduler）
│   ├── scripts/                    migrate.js / bootstrap-admin.js / resync-inventory-stock.js / smoke-reports.js / smoke-pages.node.js / smoke-reconciliation-jumps.node.js
│   ├── apk/version.json            PDA 版本清单（APK 本体不入库）
│   ├── downloads/                  ⚠️ 已废弃的旧桌面发布目录，勿使用
│   └── src/
│       ├── app.js                  中间件装配 + 61 条 /api 路由注册 + 静态目录 + 404 + errorHandler
│       ├── scheduler.js            仅启动 operation_requests TTL 清理
│       ├── config/                 db.js（连接池）、env.js（环境变量校验，生产缺项直接拒启动）
│       ├── constants/              documentStatusRules / warehouseTaskStatus / saleOrderStatus / settlementType / voucherSource / permissions
│       ├── database/               228 个 .sql 迁移 + migrate.js
│       ├── engine/                 containerEngine / inventoryEngine / reservationEngine / approvalEngine ← 库存唯一合法入口（approvalEngine 为多级审批流引擎，P2-7）
│       ├── middleware/             auth / errorHandler / loadRolePermissions / opLogger / pdaOnly / pdaSession / requestLogger / companyScope（多账套公司隔离，会计标准）
│       ├── modules/                60 个业务模块，统一 routes → controller → service
│       └── utils/                  AppError / response / statusTransition / operationRequest / warehouseScope / codeGenerator / creditExposure / inboundThresholds / priceLevels / priceReference / printSummary / route / requestContext …
├── frontend/
│   ├── src/{api,components,config,constants,flows,generated,hooks,layouts,lib,pages,router,store,types,utils}
│   ├── android/                    Capacitor 原生工程（cap sync 生成，手改需谨慎）
│   ├── dist/                       ⚠️ 构建产物，勿手改
│   └── vite.config.ts              纯 Web 构建被显式禁止
├── desktop/  main.js / preload.js / lib/{localPrint.js,updateCheck.js,print-zpl-raw.ps1}；release/ 为产物
├── scripts/  发版、门禁、部署、备份、监控脚本
├── tests/    smoke + 集成 + 纯函数单测（CI 门禁跑这些）
├── docker/   nginx.conf 等
├── deploy/   production.example.json（production*.json 已 gitignore）
└── docs/     架构规范、部署、发布说明、release-notes
```

**不要随意改动**：`frontend/dist/`、`desktop/release/`、`frontend/android/` 的生成物、`backend/downloads/`、任何 `.env`、`deploy/production*.json`。

---

## 4. 本地开发命令

```bash
# 根目录（发版与测试）
npm run release:prod            # push main + 打 v* tag（要求在 main 且工作区干净）
npm run release:gate            # 服务器端发布门禁
npm run generate:status         # 由后端常量生成 frontend/src/generated/status.ts
npm run test:label              # 标签几何 / ZPL 纯函数单测
npm run test:print              # 打印调度策略 / 状态纯函数单测
npm run smoke:mainline          # 主链路冒烟（需 MySQL）
npm run smoke:concurrency-guards
npm run smoke:sale-adjustment
npm run smoke:atp             # 销售占库「在途预计量」(采购单 ATP) + 取消/短装先解绑拦截
npm run smoke:p0-regression
npm run smoke:p1-regression
npm run smoke:warehouse-scope   # 仓库级数据权限
npm run smoke:pda-device-session # PDA 设备会话（设备未绑定即拒绝作业）
npm run smoke:finance           # 财务：收款核销 / 对账单 / 资金账户 / 费用报销
npm run smoke:accounting        # 会计：凭证 / 结转 / 月结（会计标准）
npm run smoke:accounting-period
npm run smoke:invoice-quota     # 开票量校验
npm run smoke:refund-orders     # 退款单（P2-6）
npm run smoke:disposal          # 呆滞处置单（P2-9）
npm run smoke:credit-outbound   # 授信出库拦截
npm run smoke:reports-values    # 报表口径值
npm run test:permissions        # 前后端权限码一致性（两份常量表的唯一校验器）
npm run test:accounting         # 凭证映射纯函数
npm run test:oplog              # 操作日志
npm run test:print-purge        # 打印任务清理
npm run test:integration        # 库存一致性集成测试（独立测试库）
```

```bash
# 后端
npm --prefix backend run dev            # nodemon
npm --prefix backend run migrate        # 迁移（后端进程启动时不会自动跑；本机改完 schema 要手动执行）
npm --prefix backend run lint           # ESLint 9 flat config（backend/eslint.config.js），当前 0 问题
npm --prefix backend run bootstrap:admin
npm --prefix backend run resync:inventory-stock   # 由容器重算 inventory_stock 缓存
```

```bash
# 前端
npm --prefix frontend run dev           # Electron target，端口 5173
npm --prefix frontend run dev:pda       # PDA target，端口 5173
npm --prefix frontend run build         # VITE_ELECTRON=1
npm --prefix frontend run build:pda     # VITE_CAPACITOR=1
npm --prefix frontend run lint          # ESLint 9 flat config（frontend/eslint.config.js），当前 0 error / 5 warning
```

> **两端 lint 已于 2026-07-27 补齐**（此前后端没装 eslint、前端没有配置文件，两条命令都必失败），并接进 CI 的 `static` job。
> 分工：**lint 管 tsc 管不到的**（失效的 hooks 依赖、漏删的死代码、控制字符），**类型正确性归 tsc**，风格问题两边都不管。
> `react-hooks/exhaustive-deps` 已是 **error**（13 处存量于 2026-07-27 清完）。全仓唯一一处 `eslint-disable` 在 `pages/categories/index.tsx`：表单重置刻意只认 `parentCat?.id` / `editCat?.id` 而不认对象引用，否则父组件每次渲染传新对象会在用户填写过程中清空表单。**新增 disable 请照此写清楚为什么**，不要为了让 CI 变绿而静默。
> 剩余 5 条 warning 是 `react-refresh/only-export-components`，来自 shadcn 组件「组件 + variants 常量同文件」的固有结构，不必处理。

```bash
# 前端类型检查：tsconfig.json 是空壳（files:[]），必须指定 app 配置，否则永远 0 错误
# 根目录没有 node_modules，直接用 frontend 里的 tsc 二进制
./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit
```

```bash
# 桌面端（生产安装包只能由 GitHub Actions Windows runner 产出）
npm --prefix desktop start
```

---

## 5. 本地"开发者模式"（浏览器预览调试）

用户说"开启开发者模式 / 给我网址"时，用 Browser 面板的 `preview_start`（**不是 Bash**）按 `.claude/launch.json` 的配置名启动：

- `backend-dev`（3000）、`frontend-dev`（5173，Electron target）、`frontend-pda-dev`（5173，PDA target）、`frontend-dev-prod-api`（前端本地 + 后端指向生产）

起完后把 Browser 面板给出的地址（`preview_start` 返回的端口，5173 被占时会另分配）交给用户。本机 MySQL（`backend/.env` 中 `DB_HOST=127.0.0.1`，真实库非 mock）里有固定的 `admin` 测试账号（密码不写入本文档，向用户确认）。

**登录这一步必须由用户本人完成**：AI 助手不能代为在密码框输入口令（属于其系统级安全约束，本文档无法豁免——写进来也不会生效）。因此需要「登录后才能看到的页面」时，标准流程是：助手起好服务、把标签页停在登录页，请用户在 Browser 面板里手动登录一次。不要为了绕开这一步去改代码临时关掉鉴权。

**用户只需登录一次**：本地 dev（且后端也在本机）时登录态存 `localStorage` 而非 `sessionStorage`，见 `authStore.ts` 的 `USE_PERSISTENT_DEV_SESSION`。同一端口下，新开标签页（含 PDA 验证必须新开的那个）、刷新、重启 dev server、跨会话都保持登录（JWT 有效期 7 天）。**端口变了就是另一个 origin，localStorage 不共享，要重登一次**——所以 5173 被别的会话占用而 `preview_start` 换了端口时，别指望旧登录态还在。

开关由 `vite.config.ts` 的 `__DEV_LOCAL_BACKEND__` 注入，**只有 `command === 'serve'` 且代理目标是 localhost 才为 true**；生产产物与 `frontend-dev-prod-api`（连线上后端）恒为 false，走原来的 sessionStorage，并在启动时清掉 localStorage 里可能残留的会话。改这段逻辑等于动生产的鉴权存储，务必保持这条边界。

- 后端重启不会使登录态失效（`JWT_SECRET` 固定在 `backend/.env`，`token_version` 只在改密码/禁用用户时变）；过期或被顶下线时前端会自动跳回登录页。
- **验证完不要 `preview_stop`**——用户可能正在自己的浏览器里用着同一个开发服务器。端口被别的会话占用时 `preview_start` 会自动换端口（`server.port` 读 `PORT`），不要去 kill 别人的进程。
- 验证 PDA 页面必须 `tabs_create` 开新标签页：`CrossClientNavigationGuard` 会拦截同标签页内 ERP ↔ PDA 互跳。新标签页现在会自动带上登录态。

---

## 6. 后端分层与约定

`routes → controller → service → db`，**禁止跨层**。

- **routes**：注册路径、挂 `authMiddleware` / `requirePermission` / zod 校验 / `pdaOnly`，然后交给 controller。无业务逻辑。
- **controller**：取参、调 service、`successResponse`。**无 SQL**。
- **service**：全部 SQL 与业务规则，**不碰 HTTP 对象**。
- 大模块按职责再拆文件（如 `inbound-tasks.{command,putaway,settle,status,query,void,suggestion}.js`、`warehouse-tasks.{pick,sort,check,pack,ship,cancel-return,adjust}.js`、`print-jobs/*` 见其 README），**新逻辑放进对应窄文件，不要塞回 `*.service.js` 门面**。
- 所有错误 `throw new AppError(msg, statusCode, code?, data?)` → `next(err)` → `middleware/errorHandler.js`。

**响应信封**（全站统一）：

```jsonc
// 成功
{ "success": true,  "message": "操作成功", "data": {...} }        // 列表页含 data.pagination { page, pageSize, total }
// 失败（errorHandler 统一产出，业务代码不要自己拼）
{ "success": false, "code": "STOCK_SHORTAGE", "message": "...", "data": {...} }
```

API 路径：小写、连字符、复数名词，最多两级嵌套。用户可见文案一律中文，标识符英文。

---

## 7. 核心业务链路

### 7.1 采购 → 收货 → 上架 → 结算

```
ERP  采购单(草稿1) → 提交(2) → [可撤回确认 2→1，前提是没有关联收货订单]
     → 建收货订单(待收货1) → 提交到 PDA
PDA  收货(逐箱扫码 + 建容器 status=4 待上架 + 入队标签打印) → 收满(待上架3)
     → 扫码上架(扫容器 → 扫库位；容器 4→1 ACTIVE) → 刷新库存缓存 + 更新移动加权成本
     → 全部上架完 ⇒ 同一事务内 tryFinishTask：收货订单→已完成(4)、audit_status→1
        ⇒ settlePurchaseOnAudit：按 SUM(putaway_qty × 采购单价) 全量重算应付（幂等 upsert）
          - 该采购单全部收齐 ⇒ 采购单自动完成(3)
          - 短装 ⇒ 采购单不自动完成，需人工 POST /purchase/:id/close 关闭剩余结案
```

关键点：
- **没有人工审核环节**（v0.4.22 起移除），`audit_status` 仅剩 `0 → 1` 这一条自动路径。
- 收货有两道闸门（`inbound-tasks.command.js`）：**超收确认**（超收比例 > 20% **或** 超收金额 > `OVER_RECEIVE_CONFIRM_AMOUNT`，默认 500 元，需前端带 `confirmOverReceive:true`）与**疑似重复扫码检测**（需 `confirmDuplicate:true`）。任何超收都写事件留痕，不阻断作业。
- 收货容器记录 `inbound_task_item_id`（迁移 132），上架量优先回写到该归属明细行，避免多采购单混单时按错误单价结算。
- 应付按 `payment_records UNIQUE(type, order_id)` 幂等；金额变化会把 `confirm_status` 打回 0（待财务确认），付款登记要求已确认。
- **应付/应收到期日由结算方式决定**（`constants/settlementType.js`，迁移 135）。供应商与客户各有 `settlement_type`：1现结 2月结 3预付定金 4货到付款；`payment_terms_days`（迁移 120）**只有月结才有意义**，取 30/60/90，其余方式服务端强制归零。到期日 = 基准日 + 账期，基准日两种：**现结/预付取单据创建日**（下单当天就该付），**月结/货到付款取结算发生时刻**。两处计算都必须走 `buildDueDateSql()`，不要各写一套 `DATE_ADD(NOW(), ...)`。注意现结/预付的应付记录要到收货上架完成才落库，届时到期日已回溯到下单日，会立即被 `notifications.service.js` 的逾期扫描捞出来提醒——这是「下单当天付款」的正确语义，不是 bug。
- **账款上的结算方式是快照**（`payment_records.settlement_type`，迁移 136）。它与 `due_date` 一样**只在首次 INSERT 时写入，重算（补收货/退货/分批发货）不更新**：账款是历史事实，当初按什么条件结算就是什么条件，把客户从现结改成月结不能把老账追溯改写、也不能让它整批换页面（同 `sale_order_items.cost_snapshot` 的道理）。账款页与对账页按结算方式分流时**一律读这个快照列**（`SETTLEMENT_SCOPE_COLUMN`），**禁止回溯 JOIN 往来方主数据**。
- **撤回收货** `POST /inbound-tasks/:id/void-receipt`（`inbound-tasks.void.js`）可把已收/已上架/已完成的收货订单整单打回待收货，并反冲库存与应付；容器被后续动作碰过时会被拒绝。

### 7.2 销售 → 占库 → 仓库任务 → 出库

```
ERP  销售单(草稿1) → 占用库存(已占库2 / 部分占库6，只加 reserved，不动实物)
     → 发起出库：按明细行的发货仓库分组，每组建一个仓库任务；订单 2/6→3 拣货中
PDA  拣货(扫容器条码，scan-logs 累加 picked_qty) → 拣货完成(校验闭合) → 待分拣(3)
     → 分拣(扫商品 → 扫分拣格) → 待复核(4) → 复核(扫容器) → 待打包(5)
     → 打包(建箱、装箱、完成箱 → 打印箱贴) → 全部箱完成 ⇒ 待出库(6)
     → 出库确认(扫箱码) ⇒ FIFO 从"本任务锁定的容器"扣减 + 释放预占 + 写应收 + 成本快照 ⇒ 已出库(7)
销售单：全部明细发完 ⇒ 已出库(4)；应收按 shipped_qty 全量重算（分批幂等）
```

必须知道的五件事（旧版文档均未覆盖）：
1. **分仓发货**：`sale_order_items.warehouse_id` 是行级发货仓库，一张销售单可以有多个仓库任务。任何按 `product_id` 关联 `sale_order_items` 的 SQL **必须带 warehouse_id 维度**，否则出库明细会被 JOIN 放大成 N 倍扣减（`warehouse-tasks.ship.js` 有 `assertNoShipItemFanout` 兜底）。
2. **按产品/按数量占库（迁移 220）**：`sale_order_items.reserved_qty`（已占）、`dispatched_qty`（已派发到任务）是数量语义，替代旧的布尔 `dispatched`（列保留兼容）。占库经专用弹窗可只勾部分产品、按数量占（需求 100 占 60），`reserveStock(id, items:[{id,warehouseId,qty}])`；不传 items = 占满全部未占余量（向后兼容）。占完统计全满→`已占库(2)`、否则→`部分占库(6)`。发货只发 `reserved_qty - dispatched_qty` 差额，一行可多次「补占→发货」。释放支持按产品/数量（`releaseStock(id, items:[{id,qty}])`）或整单。
3. **执行期改单 / 占库期改单**：`PUT /sale/:id/adjust`（`sale.service.requestAdjustment`）。有仓库任务（拣货中 3）走执行期改单（`warehouse-tasks.adjust.js`）：增量退回拣货中，减量命中已打包/已复核需 PDA 物理确认，落表 `sale_order_adjustments*`。无仓库任务（已占库 2/部分占库 6）走占库期改单（`adjustReservedWithinTransaction`）：保留已占量（改数量时夹到新数量、删商品释放预占、加商品占 0），重建明细后重算状态 2/6。多仓、已发货订单明细仍锁定。
4. **取消**：草稿直接取消；已占库/部分占库释放预占；拣货中会逐个取消活跃仓库任务（走逆向归还，PDA `/pda/cancel-return` 确认归还库位），并整单兜底释放预占。若已有任务出库过，则**不是取消**——未发行整行删除、部分发的行数量降到实发量，订单直接结案为已出库(4)。
5. **回款状态独立于订单状态**（2026-08-29）：列表「回款状态」列不混进状态徽章，读 `receivableStatus`（应收快照）+ `receivableSettlementType`（快照优先、未出库回退客户主数据）。决策表：已付清(3)=绿「已付清」；部分付(2)=蓝「部分付」；未付未逾期时现结灰「未付」/月结蓝「月结」；逾期时月结红「逾期」、现结红「未付」。逾期边界=到期日<北京今天（当天不算逾期，与对账页 `isOverdue`、`pr.due_date<CURDATE()` 一致）。

### 7.3 退货

```
采购退货（库存流出）：草稿1 → 确认2（自动建 task_type='purchase_return' 的仓库任务）
  → 走标准出库流程 → WT ship 完成 ⇒ syncPurchaseReturnShipped：冲减应付 + 退货单→已执行3
销售退货（库存流入）：草稿1 → 确认2（建 return_tasks 行）→ submit 到 PDA
  PDA receive(建 status=5 PENDING_QA 容器) → check(质检，合格→PENDING_PUTAWAY，不合格计 rejected_qty)
  → putaway(扫容器 → 扫库位) → 全部上架 ⇒ syncSaleReturnCompleted：冲减应收 + 退货单→已执行3
```

`return_tasks` 有自己的内联状态机（`return-tasks.service.js`）：1待收货 2收货中 3待质检 4待上架 5已完成 6已取消，用 `RT_TRANSITIONS` + `compareAndSetStatus` 校验，**不在 `documentStatusRules.js` 里**。

### 7.4 调拨（两阶段 PDA 扫码）

```
ERP 草稿1 → 确认派发(待出库2)
PDA 源仓 scan-out(2/3→3 在途，容器带 transfer_order_id) → 目标仓 scan-in(3→4 已完成)
```

用 `containerEngine.transferContainers()`：源仓 FIFO 扣减 + 目标仓建容器（保留批次）+ 双仓刷新缓存。在途(3)不可取消；卡死的在途单走 `POST /transfer/:id/force-close`（写入 `closed_reason='force_close'`，需权限码 `transfer.order.force-close`）。

### 7.5 盘点

`inventory_checks` / `inventory_check_items`：1进行中 → 2已完成 / 3已取消。账面数**实时取自 ACTIVE 容器合计**（不是 `inventory_stock`）。提交时先整单校验账面是否漂移，任一行漂移就整单拒绝（409）并列全漂移行；通过后逐行 `adjustContainersForStockcheck`（盘盈建容器、盘亏 FIFO 扣减）。单行漂移可用 `POST /stockcheck/:id/items/:itemId/refresh` 重置账面并清空实盘。

### 7.6 打印（客户端拉取模型，无推送）

```
业务动作 → enqueue*LabelJob() → print_jobs(status=0 PENDING, job_unique_key 幂等)
打印机解析：printer_bindings(按 printType+仓库，含 fallback 链) → 兜底策略（print-policy 评分 + 心跳）
桌面客户端轮询 POST /print-jobs/claim-client { clientId }
  → 事务内 FOR UPDATE 选 PENDING 且 printers.client_id = 本机 → CAS 置 PRINTING + 生成 ack_token
客户端 RAW 打印 → POST /print-jobs/:id/complete-local（或 complete-client 带 ack_token 校验）
sweeper（print-jobs.dispatch.js，进程内 setInterval）：过期任务失败化 + 从离线客户端回收任务
```

- 队列**只接受 `content_type = 'zpl'`**，html/pdf 在入队时就被拒（`PRINT_CONTENT_TYPE_UNSUPPORTED`）；单据打印走浏览器打印或导出。
- 幂等：`job_unique_key` + 活跃期唯一索引 `uk_print_jobs_idem_scope_live(job_unique_key, warehouse_key, job_type_key, live_guard)`；重复入队返回既有任务。
- 派发**与用户账号无关**，取决于哪台桌面客户端注册了该打印机。

---

## 8. 数据库与核心模型

- 131 张表（生产实测，含 `db_migrations`），命名 `[模块]_[资源]`，均带 `created_at/updated_at`，多数带 `deleted_at` 逻辑删除。表漂移对账用 `backend/scripts/schema-reconcile.js`（只读检查，`--strict` 可挂 CI）。
- 迁移：`backend/src/database/` 下 228 个 `.sql`，编号 001–228（**存在重复编号 057/064/089，缺 008/009/040**，靠文件名排序执行；db_migrations 有 212 条执行记录，含 1 条手工执行的迁移）。**后端进程启动时不会自动迁移**（本机改完 schema 需手动 `npm run migrate`）；生产部署由 `server-update.sh` 代跑，见第 16 节。
- ⚠️ **数据库里的 `COLUMN_COMMENT` 曾大面积过期，现已大部分订正但仍有残留**（2026-07-27 抽查：`sale_orders.status`、`warehouse_tasks.status` 的注释都已更新并注明"见 documentStatusRules / warehouseTaskStatus"；`sale_orders.closed_reason` 仍写着迁移 127 已废弃的 `partial_ship_close`）。**状态语义一律以 `backend/src/constants/` 下的常量文件为准，不要相信列注释。**

核心事实表 / 派生字段：

| 表 | 角色 | 关键点 |
|----|------|--------|
| `inventory_containers` | **库存唯一事实源** | `remaining_qty` 是真实数量；`status` 1ACTIVE 2EMPTY 3VOID 4PENDING_PUTAWAY 5PENDING_QA 6REJECTED；`locked_by_task_id` 拣货锁；`inbound_task_item_id` 收货归属行 |
| `inventory_stock` | **缓存 + 预占账** | `quantity` 是缓存（= ACTIVE 容器合计，只能由 `syncStockFromContainers` 写）；`reserved` 是受控投影（只能由 reservationEngine / inventoryEngine 写） |
| `stock_reservations` | 预占明细 | 1预占中 2已履行 3已释放；合计必须等于 `inventory_stock.reserved` |
| `inventory_logs` | 流水 | 每次库存动作写一条，带 `container_id` 与 `move_type` |
| `purchase_orders/_items` | 采购 | `closed_reason='short_close'` 表示短装结案 |
| `inbound_tasks/_items` | 收货 | `ordered/received/putaway_qty` 三段量；`lock_version` 乐观锁；`audit_status` 只走 0→1 |
| `sale_orders/_items` | 销售 | 行级 `warehouse_id`、`shipped_qty`、`reserved_qty`(已占)、`dispatched_qty`(已派发，迁移 220 取代 `dispatched` 布尔)、`cost_snapshot`(COGS) |
| `warehouse_tasks/_items` | 出库任务 | `task_type` sale_out / purchase_return；`cancel_requested_at`、`adjustment_requested_at` 非空时该任务对正向 PDA 流程不可见 |
| `payment_records` | 应收应付 | `UNIQUE(type, order_id)` 幂等；`confirm_status` 财务确认闸门 |
| `operation_requests` | 幂等回执 | `UNIQUE(request_key, action, user_id)`，7 天 TTL 清理 |
| `print_jobs` | 打印队列 | 活跃期唯一索引做幂等；`ack_token` 回执校验 |
| `product_items` | 商品 | `avg_cost` 移动加权成本（仅上架时正向更新，退货/撤回不反冲）；`batch_managed` 批次管控 |
| `user_warehouse_scope` | 数据权限 | 无行 = 不限仓；有行 = 只能访问这些仓库 |

---

## 9. 库存核心不变量（最高优先级，违反即事故）

1. **唯一事实源是 `inventory_containers.remaining_qty`（status=1 ACTIVE）**；`inventory_stock.quantity` 只是缓存。
2. **禁止任何代码直接 `UPDATE inventory_stock SET quantity=...`**。唯一合法写入口是 `containerEngine.syncStockFromContainers(conn, productId, warehouseId)`（内部 `SUM(...) FOR UPDATE` 后 upsert 绝对值）。
3. **`reserved` 只能经 `reservationEngine`（reserve / releaseByRef / markFulfilled / partialReleaseByProduct）或 `inventoryEngine.moveStock` 变更。**
4. **可用库存 = ACTIVE 容器合计 − reserved**，判定一律走 `containerEngine.getAvailableStockForDecision()`，不要自己 SUM。
5. **待上架（status=4）容器不计入账面、不可被销售占用**；只有上架（→1）后才进入可用库存。
6. **销售任务出库只能扣本任务锁定的容器**（`deductFromTaskLockedContainers`），禁止退回全局 FIFO。
7. **不允许负库存**：`assertNonNegativeQty` 直接抛 500；可用量不足在服务端拦截。
8. **所有库存动作必须在调用方开启的事务连接 `conn` 上执行**，引擎不自己开事务；调用方负责 BEGIN/COMMIT/ROLLBACK。
9. **上架类操作必须先 `lockStockDimension(conn, productId, warehouseId)` 再锁单个容器**——顺序反了会死锁，不加汇总锁会丢失更新（库存凭空蒸发）。
10. **数量字段全部 `DECIMAL`**，比较与累加避免浮点误差（打包侧用整数单位换算 `toQtyUnits/fromQtyUnits`）。
11. **手动入库(type=1) 与手动库存调整(type=3) 已被关闭**（`inventory.service.changeStock` 直接 403），入库只能走收货订单，调整只能走盘点单。仅保留手动出库(type=2)。
12. **建容器只允许经 `containerEngine.createContainer`**；只有 `transfer` / `container_split` 来源可直接落 ACTIVE，其余必须先 `PENDING_PUTAWAY(4)` 再 promote。
13. **打印与库存完全解耦**：补打标签（`/inbound-tasks/:id/reprint`、`/print-jobs/barcodes/reprint`）只创建打印任务，**绝不建容器、绝不加库存**。
14. 缓存漂移的修复手段是 `npm --prefix backend run resync:inventory-stock` 或 `GET /inventory/check-consistency`，**不是手改数据库**。

---

## 10. 状态机规则

**统一入口**：`assertStatusAction(machine, action, currentStatus)`（`constants/documentStatusRules.js`）与 `assertWarehouseTaskAction(action, status)` + `isValidTransition(from,to)`（`constants/warehouseTaskStatus.js`）。写状态一律用 `compareAndSetStatus()`（`utils/statusTransition.js`，`affectedRows!==1` 抛 409），读单头一律用 `lockStatusRow()`（`FOR UPDATE`）。

| 机器 | 状态 | 动作（from→to） |
|------|------|------------------|
| `purchase` | 1草稿 2已提交 3已完成 4已取消 | edit(1)、confirm(1→2)、withdrawConfirm(2→1)、createInboundTask(2)、complete(2→3 自动)、close(2→3 短装人工)、reopen(3→2 仅撤回收货内部联动)、cancel(1/2→4) |
| `sale` | 1草稿 2已占库 3拣货中 4已出库 5已取消 6部分占库 | edit(1)、adjust(2/3/6，无任务走占库期改单/有任务走执行期改单)、reserve(1/6→2或6)、release(2/6→1或6，按产品或整单)、ship(2/6→3，只发已占未发)、completeShip(3→4)、cancel(1/2/3/6→5)、delete(5) |
| `warehouseTask` | 1待拣货(跳过) 2拣货中 3待分拣 4待复核 5待打包 6待出库 7已出库 8已取消 | startPicking、readyToShip(2→3)、sortTask(3→4)、checkDone(4→5)、packDone(5→6)、ship(6→7)、cancel(活跃→8)；改单专用反向边 adjustReopenPicking / adjustReopenChecking **仅供 adjust.js 内部调用** |
| `inboundTask` | 1待收货 2收货中 3待上架 4已完成 5已取消 | submit、receiveStart(1→2)、receive、receiveComplete(2/3→3)、putaway、finish(3→4 含自动结算)、cancel(1→5)、voidReceipt(2/3/4→1) |
| `inboundTaskAudit` | 0待结算 1已结算 | approve(0→1)，仅供上架完成时自动结算复用；状态 2(已退回)已下线不可达 |
| `transfer` | 1草稿 2待出库 3在途 4已完成 5已取消 | confirm(1→2)、scanOut(2/3→3, PDA)、scanIn(3→4, PDA)、cancel(1/2→5)；在途另有 force-close |
| `purchaseReturn` / `saleReturn` | 1草稿 2已确认 3已执行 4已取消 | confirm(1→2)、execute(2→3，由回调触发)、cancel(1/2→4) |
| `expenseClaim` | 1草稿 2待审批 3已批准 4已付款 5已驳回 6已取消 | edit(1)、submit(1→2)、withdraw(2→1 本人撤回)、approve(2→3)、reject(2→5)、pay(3→4)、cancel(1/2/5→6；已批准需先驳回，已付款不可取消) |
| `stockcheck` | 1进行中 2已完成 3已取消 | edit(1)、submit(1→2)、cancel(1→3) |
| `refundOrder` | 1草稿 2已提交 3已执行 4已取消 | edit(1)、submit(1→2)、execute(2→3)、cancel(1/2→4)（P2-6 退款单，见 `refunds/`） |
| `purchaseRequisition` | 1草稿 2待审批 3已批准 4已驳回 5已转换 6已取消 | edit(1)、submit(1→2)、withdraw(2→1)、approve(2→3)、reject(2→4)、convert(3→5)、complete、cancel(1/2/4→6)（P2-7 采购请购） |
| `inventoryDisposal` | 1草稿 2待审批 3已批准 4已执行 5已驳回 6已取消 | edit(1)、submit(1→2)、approve(2→3)、reject(2→5)、dispose(3→4)、cancel(1/2/5→6)（P2-9 呆滞处置单） |
| `procurementPlan` | 1草稿 2已转换 3已取消 | edit(1)、convert(1→2)、cancel(1→3)（采购计划） |
| `creditOverride` | 1草稿 2待审批 3已批准 4已驳回 5已取消 | edit(1)、submit(1→2)、approve(2→3)、reject(2→4)、cancel(1/2/4→5)（P2-7 授信超额放行） |
| `return_tasks`（内联） | 1待收货 2收货中 3待质检 4待上架 5已完成 6已取消 | 见 `return-tasks.service.js` 的 `RT_TRANSITIONS` |

> **不在 `documentStatusRules.js` 里的状态机还有财务三张表**（2026-07-27 核实）：`payment_receipts`（1待核销 2部分核销 3已核销完）、`reconciliation_statements`（1草稿 2已确认 3已核销完）、`finance_accounts`。它们各自在 service 里用「事务 + `SELECT … FOR UPDATE` 锁单头 + 校验状态 + `UPDATE`」实现，与 `compareAndSetStatus` 等效、并发安全，只是没走统一入口。**找状态机时别只翻 `documentStatusRules`**；新增财务状态流转请沿用它们现有的加锁写法，不要退化成不加锁的裸 `UPDATE`。

进入/退出各仓库任务状态时的副作用与前置校验，见 `warehouseTaskStatus.js` 里的 `WT_ON_ENTER_ACTIONS` / `WT_ON_EXIT_ACTIONS` 注释表（是当前实现的准确记录，改动副作用时同步更新它）。

拣货→分拣的推进有**三重闭合强校验**（`warehouse-tasks.helpers.js`）：`picked_qty == required_qty` + 扫码流水合计一致 + 锁定容器与扫码容器一致；出库前还会校验复核闭合、装箱闭合、箱贴打印闭合。

---

## 11. 并发、事务与幂等规则

- **必须在事务内**：占库、释放、发起出库、出库、收货、上架、撤回收货、拆分/移动容器、调拨扫出扫入、盘点提交、退货收货/质检/上架、任务取消与改单、打包完成、结算应付/应收。
- **单头行锁**：`lockStatusRow()`（`SELECT … FOR UPDATE`）在改状态前锁住单据主表行。
- **CAS**：`compareAndSetStatus()` 保证并发下只有一方推进成功，另一方拿到 409「状态已变化」。
- **加锁顺序统一**：占库与出库都按 `product_id`（再 `warehouse_id`）排序后逐行处理；上架先 `lockStockDimension` 再锁容器。**新增涉及多商品的库存事务必须沿用同一顺序**，否则死锁。
- **幂等键**：前端 `createRequestKey()` → 请求头 `X-Request-Key` → 服务端 `beginOperationRequest/completeOperationRequest`（表 `operation_requests`）。已接入：`sale.create`、`sale.adjust`、`purchase.create`、`inbound.receive`、`inbound.putaway`、`transfer.scanOut/scanIn`、`return.receive/check/putaway`、`warehouse.ship`、拣货/复核/分拣/打包/取消归还扫码、包裹增删项。重放命中已成功记录时**直接返回原响应，不重复执行**。
- **唯一键兜底幂等**：`payment_records UNIQUE(type,order_id)`、`print_jobs` 活跃期唯一索引、`operation_requests UNIQUE(request_key,action,user_id)`。
- **事务内禁止做外部 I/O**（HTTP、真实打印）。打印只是"入队一条 DB 记录"，物理打印由客户端异步完成；打印副作用失败不得回滚业务事务（见 `printOptionalSideEffect`）。
- 新增高危写接口时，**先想清楚"用户连点两次 / PDA 断网重试"会发生什么**，再决定用 requestKey、唯一键还是 CAS。

---

## 12. 权限与安全规则

- 登录 → JWT（`Authorization: Bearer`）。`authMiddleware` 每次请求都回查用户并校验 `token_version`：改密码/禁用用户会使旧 token 立即失效（`AUTH_SESSION_INVALID`）。
- 权限码在 `backend/src/constants/permissions.js` 与 `frontend/src/lib/permission-codes.ts` **两份手工同步**的常量表（各 181 个，当前双向一致）；改动后跑 `npm run test:permissions` 校验（它做双向 diff + 命名合规检查，已进 CI）。角色权限存 `sys_role_permissions`，`requirePermission` 在校验前按角色现查。
- **roleId === 1 是超管，跳过所有权限校验**（前后端都是）。
- **数据范围**：`user_warehouse_scope`（迁移 122）→ `req.user.warehouseIds`（null=不限仓，超管恒 null，60s 缓存）→ 列表查询用 `scopeFilter()` 拼 SQL。新增涉仓列表接口应接入。
- 每个业务 routes 文件顶部都有 `router.use(authMiddleware)`。**唯一完全公开的模块是 `/api/app-update/latest`**，另外 `/api/pda/version`、`/api/pda/download`、`/api/auth/login`、`/api/auth/refresh`、`/api/auth/logout`、`/health`、`/api/health` 免登录。**刻意豁免**：`GET /api/settings/logo` 与 `/api/settings/logo/image`（公司 Logo 元数据/图片流）在 authMiddleware 之前注册——消费方全部以 `<img src>` 渲染（ERP 顶栏、设置页预览、单据打印模板），`<img>` 无法带 Bearer；仅返回 Logo，无任何业务数据。（2026-08-26 双区品牌后登录页/PDA 门面改显系统品牌，不再消费公司 Logo，但 `<img>` 场景仍要求公开，豁免不变。）`POST /api/settings/logo`（上传，`settings.update` 权限）仍在 auth 之后，不受此豁免影响。**`/api/auth/refresh` 与 `/api/auth/logout` 免登录的合理性**（2026-08-30）：两者都只接受 refresh token 作为输入，refresh token 自身带 `tokenType='refresh'`，`authMiddleware` 会拒绝它访问业务接口；refresh 用于 access 过期后续期（此时 authMiddleware 会拦），logout 用于 access 过期后仍能作废 refresh。它们不返回任何业务数据，安全性由 refresh token 自身的校验（签名 + jti 一次性轮换）保证。
- 少数登录后免细粒度权限的低敏感接口：`/users/options`、`/products|suppliers|customers/next-code`。新增接口**不要**跟随这个例外，一律加 `requirePermission`。
- **PDA-only 接口**（`pdaOnly` 校验请求头 `X-Client: pda`）：收货、上架、调拨 scan-out/scan-in、退货 receive/check/putaway、扫码写入（`/scan-logs`、`/scan-logs/check`、`/scan-logs/cancel-return[/box]`；`/error`、`/undo` 不限）、仓库任务 start-picking/ready/sort-done/check-done/pack-done/ship、改单的两个 PDA 物理确认接口。**ERP 端不得绕过这些接口直接改任务状态。**
- **PDA 设备会话已强制启用**（`pda_device_sessions` + `middleware/pdaSession`）：前端 `api/client.ts` 会带上 `X-PDA-Session`（含自动续期），`pdaSessionRequired()` 已挂在调拨 scan-out/scan-in、退货 receive/check/putaway、`/scan-logs` 写入等关键作业接口上；设备需先在 `/pda/bind` 绑定。回归由 `npm run smoke:pda-device-session` 守着（设备未绑定即拒绝作业）。上架接口另用 `req.pda?.warehouseId` 做跨仓拦截。
- **PDA 未绑定 = 受限模式**（2026-08-26）：后端强制未绑定即 403 `PDA_SESSION_REQUIRED`，但前端此前只在请求发出后弹全局错误 toast（用户看到「显示错误」而非「受限模式」）。修复（纯前端）：`PdaRoutePermission` 新增「未绑定设备」分支（`!getDeviceCredential()` → 显示「当前 PDA 未绑定设备 + 去绑定设备」引导页，不发请求），工作台作业区同样显示受限卡（替代可点作业入口），与既有「权限未加载/无权限」两种受限态并列。
- 全局限流 `/api`（默认 60s/1000 次，`RATE_LIMIT_*` 可调），登录另有更严限流；`/health` 不受限流影响。
- 生产必填环境变量：`DB_*`、`JWT_SECRET`（≥32 位）、`APP_PUBLIC_URL`，缺一后端拒绝启动。
- **绝不**把密钥、Token、数据库口令写进代码、文档或提交；`.env*`、`deploy/production*.json`、备份 SQL 已 gitignore，CI 有 gitleaks 扫描。

---

## 13. 前端开发规范

- 双路由树（`src/router/index.tsx`，HashRouter）：ERP `/*` → `ErpProtectedRoute` → `AppLayout`（多标签工作区）；PDA `/pda/*` → `PdaProtectedRoute` → `PdaLayout`。`CrossClientNavigationGuard` 禁止同一标签页在 ERP 与 PDA 之间跳转。
- **新增 ERP 页面的标准步骤**：① `src/pages/xxx/index.tsx` ② 在 `src/router/routeRegistry.ts` 追加 `routeRegistry`（含 `permission`、`keepAlive`、`tabIdentity`、`nav.group/order`）或 `routePatterns`（详情/表单页，带 `listPath`）③ 需要新权限时**同时**改后端 `permissions.js`、前端 `permission-codes.ts`，并加一条 seed 迁移把权限授予相应角色。菜单由 `buildTopNavSections()` 自动生成，不要手写菜单。
- 状态：**Zustand** 只存会话级全局态（`authStore` 存 sessionStorage、关窗即失效，**本地 dev 连本机后端时例外**，见第 5 节；`workspaceStore` 标签页；`dirtyGuardStore`）；**React Query** 管所有服务端数据。
- **API 一律经 `src/api/*.ts` + `payloadClient`**（自动解信封）。不要在组件里直接 `axios`。需要自行处理错误时传 `{ skipGlobalError: true }`，否则拦截器会弹全局 toast；401 自动登出。
- **登出必须清 React Query 缓存**：`performSessionLogout()` 要调 `queryClient.clear()`（2026-08-21 审计发现缺失，登出再登录会短暂看到上一账号数据）。新增登出/切号逻辑时检查缓存清理。
- 状态常量用 `src/generated/status.ts`（由 `npm run generate:status` 从后端常量生成，**不要手改**）。
- **状态徽章全站唯一写法**：任何「状态」展示（单据状态、任务状态、启用停用、打印结果、分类标识）一律用 `components/shared/StatusBadge` 的 `<SoftStatusLabel label tone>` 或 `<StatusBadge type status>`，tone 取自 `lib/statusTone.ts` 的 6 档：`draft`（草稿/停用/空闲）、`active`（进行中）、`success`（完成/启用）、`warning`（在途/待确认/超时）、`danger`（取消/失败/逾期）、`info`（类型/角色/等级等分类标识）。**禁止**直接写 `<Badge variant="default|secondary|destructive">` 当状态用，**禁止**硬编码 `bg-green-50`/`bg-blue-100` 这类调色板 class。语义色 `success`/`warning`/`info` 已注册进 `tailwind.config.js` 的 theme，`bg-*/10`、`border-*/20` 才会生成——不要退回 `index.css` 手写 utility 的老路（那样 `border-success/20` 会静默失效）。
- **禁止在前端复制后端业务规则**：可用库存、状态可否流转、金额结算等一律以接口返回为准；前端不得传"目标状态值"让后端照单执行。
- 复用优先：`components/shared/*`（DataTable、LimitedTextarea 等）、`components/finder`、`hooks/use*`（`usePermission`、`useDirtyGuard`、`useInvalidate`…）、`lib/*`（`confirm`、`toast`、`dateTime`、`exportDownload`、`permissions`）。
- 多标签页 keepAlive：页面会被保留，**编辑页必须在挂载/参数变化时显式重置表单**，否则会看到上一单的残留数据；离开有未保存改动的页面走 `useDirtyGuard`。
- 桌面端判定**必须用运行时 `window.flowcubeDesktop`**，不要用构建 flag（用构建 flag 会把网页端误判成桌面端）。

---

## 14. PDA 开发规范

- PDA 与 ERP 是**同一份前端代码**，靠 `/pda/*` 路由树与 `PdaLayout` 隔离；每个 PDA 路由用 `PdaRoutePermission` 声明所需权限（与后端权限码一致）。
- 当前 PDA 页面：`inbound`、`receive/:id`、`putaway[/:id]`、`picking`、`task/:id`、`sort`、`check[/:id]`、`pack[/:id]`、`ship[/:id]`、`split`、`cancel-return[/:id]`（取消归还）、`adjustments[/:id]`（改单物理确认）、`transfer`、`transfer-out/:id`、`transfer-in/:id`、`sale-return`、`sale-return/:id/receive`、`sale-return/:id/putaway`；另有两个不在作业流里的：`/pda/login`（挂在 `PdaProtectedRoute` 之外）与 `/pda/bind`（设备绑定，树内但不校验业务权限）。
- **PDA 相机扫码**（2026-08-26 引入，2026-08-27 修复实现）：PDA 红外/激光枪只能扫一维条码，绑定二维码（QR）扫不了。`/pda/bind` 绑定页新增「相机扫码」按钮：`hooks/useCameraScanner.ts` 走 `@capacitor-mlkit/barcode-scanning@8.1.0`（ML Kit 原生解码，Capacitor v8 兼容），仅 `Capacitor.isNativePlatform()` 时显示按钮；扫码结果与扫码枪走同一 `handleScan`。原生配置：AndroidManifest `application` 内加了 `com.google.mlkit.vision.DEPENDENCIES = barcode_ui`（README 要求；`barcode` 不含相机取景 UI 会运行时报错），CAMERA 权限已有。**只服务绑定页；其余 PDA 作业页仍用扫码枪（一维条码），不引入相机扫码。**
  - **2026-08-28 修复「绑定页显示密钥失效」**（提交 `8cf5375`）：根因在 `useAuth.ts`——登录成功后**无条件**调 `applyErpApiBaseFromStorage()`，而在 Capacitor WebView（origin=`https://localhost`）上 `getEffectiveApiOrigin()` 返回 null 时该函数把 `apiClient.baseURL` 重置回相对 `/api`，真机上 axios 请求全发到 `localhost/api`（无服务）→ 绑定请求从未到达后端（后端 7 天 0 条 sessions 请求，但 `/api/pda/version`、APK 下载、`/api/auth/login` 都正常——它们走 fetch 显式 origin 不经 axios baseURL）。表现：登录成功但登录后 `ensureDeviceSession`/`todo-counts` 全挂，绑定页误报「设备码或密钥无效」。修复：① `useAuth.ts` PDA（`IS_CAPACITOR_PDA`）登录后**不**调 `applyErpApiBaseFromStorage`（baseURL 由 boot 时 `applyPdaApiBaseFromStorage` 设好）；② `pda-session.ts` 区分失败——业务拒绝（401/403、`PDA_DEVICE_SECRET_INVALID` 等）连凭据一起清，网络/基址失败保留凭据 + console.warn；③ `bind.tsx` 以「凭据是否还在」分提示（网络问题说"请检查网络，凭据已保存无需重扫"，不再一律误导重新生成二维码）。**排查 PDA 请求没到的 bug 时，先对比「fetch 显式 origin 的请求（version/download/login 部分）到了、axios 的请求没到」——这是 baseURL 被覆盖的指纹。**
  - **2026-08-27 修复「点了没反应」**：8.1.0 的 `scan()` 路由到 GMS Code Scanner 一键式界面——要求设备有 Google Play Services 且预装 GMS 扫码模块（`isGoogleBarcodeScannerModuleAvailable` 假直接 reject `ERROR_GOOGLE_BARCODE_SCANNER_MODULE_NOT_AVAILABLE`）；而本项目声明的是 ML Kit 本地模型 `barcode_ui`（unbundled，deps 确为 unbundled 坐标），表单形态不对接，工业 PDA 大多无 Play Services（本地依赖树已验证：`com.google.mlkit:barcode-scanning:17.3.0` 的 AAR 内置 `assets/mlkit_barcode_models/*.tflite`，声明 `barcode_ui` 即模型已打进 APK；如设备无前置相机 `isSupported` 也同理失败）。修复：hook 改用插件自带的 **CameraX 连续扫描 `startScan`**（ML Kit 本地解码，无 GMS 依赖；扫描期持续运行、一次扫码即回调 `barcodesScanned` → `close()` + `handleScan`）；取景机制为「WebView 背景透明 → 插件把原生预览塞进 WebView 底层的兄弟视图」——扫描期间页面根必须透明（`open` 时绑定页**整体让位**只渲引导浮层 + `body.barcode-scanner-active` 透明规则 + PdaLayout 根补 `pda-root` 类），否则原生画面被不透明背景盖住。**改这段前先读 `useCameraScanner.ts` 头注释**（记录了本次根因）。
- **关键操作不做离线队列**（这是刻意设计，`useOfflineQueue.enqueue` 会直接抛错）：`useCriticalPdaAction` 在断网时**阻断提交**；只有"已提交但结果未知"（网络波动/超时）才记为 pending，恢复网络后先查回执，再由页面提供的 `resolveServerState` 回查真实业务状态兜底。**不要给关键动作加自动重放。**
  - 回执查询走 `GET /api/system/request-status/:key`（`modules/system/system.routes.js`，前端 `api/operation-requests.ts`），断网重连后先查回执确认「上次到底成没成」。**新增关键动作时仍要提供 `resolveServerState`** 作为第二道兜底——回执只覆盖走过 `beginOperationRequest` 的动作，业务真实状态还得回查。目前 PDA 各作业页（含 `sale-return-receive/putaway`）都已提供。
- 扫码枪走键盘模式，`usePdaScanner` 统一处理：字符间隔 50ms 聚合、最短 3 位、1s 内同码去重；手动输入框需标 `data-scanner-manual="true"` 以避免被扫码缓冲吞掉。
- 所有 PDA 写接口必须带 `X-Client: pda` 头（见 `src/api/*.ts` 里的 `withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })`）。
- Android：`windowSoftInputMode="adjustResize|stateHidden"`、`launchMode=singleTask`、竖屏锁定；返回键在 `PdaLayout` 里通过 `@capacitor/app` 的 `backButton` 统一接管。已申请权限：INTERNET、ACCESS_NETWORK_STATE、CAMERA、VIBRATE、REQUEST_INSTALL_PACKAGES。
- APK 的后端地址：构建期注入 `VITE_ERP_PRODUCTION_ORIGIN`，运行期可被 localStorage `API_BASE_URL` 覆盖（支持扫码写入）。
- PDA 版本：`backend/apk/version.json`（`version` / `versionCode` / `filename` / `releaseNote`）必须与 `frontend/android/app/build.gradle` 的 `versionName` / `versionCode` **同步递增**，否则 PDA 端检测不到更新。

---

## 15. Electron 与打印规范

- `desktop/main.js` 主进程：窗口、自动更新、本地打印、IPC；`preload.js` 用 `contextBridge` 暴露 `window.flowcubeDesktop`（**`contextIsolation: true`、`nodeIntegration: false`，不得放开**）。暴露的能力仅限：版本/打包状态、更新检查与下载、消息框、系统打印机枚举、客户端标识、`printZpl`。**不要新增通用命令执行类 IPC。**
- 本地打印 `lib/localPrint.js`：Windows 走 PowerShell→WinSpool（`print-zpl-raw.ps1`），macOS/Linux 走 `lp -o raw`。生产实际依赖 Windows 打印链路。
- 桌面端通过 `DesktopPrintClientBridge` 定时轮询 `claim-client` 领取打印任务，完成后回执。**回执接口受 `print.client.consume` 权限保护，`complete-client`/`fail-client` 还要校验 `ack_token`**；新增回执路径必须保持这两道校验。
- 自动更新：`lib/updateCheck.js` 轮询后端 `/api/app-update/latest`（后端读取服务器上 `latest.json`），安装包从同域 `/current/<filename>` 下载，避免境内直连 GitHub。
- **打印规则**（新增打印功能必须遵守）：① 打印任务只能由 `print-jobs.label-command.js` 的 `enqueue*LabelJob` / `reprint*` 创建；② 必须给 `job_unique_key`；③ 打印失败不得改变业务状态，业务成功也不得因打印失败回滚；④ 补打只创建新打印任务，**不得产生任何库存或账款副作用**；⑤ 标签尺寸/内容差异靠 `job_type` + `printer_bindings` 区分，不要硬编码打印机。
- **生产安装包只能由 GitHub Actions Windows runner 构建**；本机 macOS 构建的 NSIS 包可能损坏。

---

## 16. 部署与服务器

- 生产服务器 `root@47.93.228.251`，项目在 `/opt/flowcube`，SSH alias `flowcube-prod`（密钥在本机 `~/.ssh/`，不入库）。
- **`main` 是唯一发布来源**：push main → GitHub Actions `deploy-browser.yml` → SSH 到服务器 → 精确 checkout 到该 commit → `docker compose up -d --build backend frontend`。
- 打 `v*` tag → `build-desktop.yml`（Windows runner）构建安装包并发布 `latest.json`；`frontend/**` 变更 → `build-pda-apk.yml` 构建 APK。发版统一用 `npm run release:prod`（要求在 main 且工作区干净），或直接用 `/release-flowcube` 技能，**三端版本号必须同步递增**。
- 数据库迁移**由部署链路自动执行，不需要手动补跑**：`scripts/server-update.sh` 在 `docker compose up -d --build` 之后、健康检查之前显式跑 `docker compose exec -T backend npm run migrate`（用新镜像里的迁移文件，失败即中断部署）。「后端进程启动时不自动迁移」说的是 `backend/index.js`，别把两者混为一谈——推 main 时迁移是跟着一起上的。只有绕开该脚本手动改动服务器时才需要自己跑一次。**2026-08-27 起该脚本在 up backend/frontend 之后、migrate 之前追加 `docker compose up -d --no-build mysql`**——mysql 容器不在重建列表里，但首次部署时区改动（`TZ` + my.cnf 挂载）需要显式 up 才生效；数据卷不动、无停机迁移。
- 桌面更新源：`/var/www/flowcube-downloads/latest.json`（顶层唯一权威入口，由 `scripts/release-desktop.js` 写入）；`current/` 只放固定文件名的当前安装包；`/downloads` 是**已废弃**的兼容别名（仅 GET/HEAD）。
- 应急手动部署：`ssh flowcube-prod 'cd /opt/flowcube && SKIP_RELEASE_GATE=1 bash scripts/server-update.sh'`。
- 其他运维脚本（2026-08-21 重构，容器名不再硬编码）：
  - `scripts/lib/ops-common.sh`：运维脚本公共库——`resolve_container()` 三级回退解析 compose 容器名（`docker compose ps -q` → 期望名 → 捞被 Docker 改名加 hash 前缀的容器，2026-08-21 事故的教训：容器被改名后硬编码名字会让备份静默失败 12 天）、`read_dingtalk_webhook()`、`dingtalk_send()`、`ts()`（2026-08-27 补：server-update.sh 的 fail_deploy 经公共库调 `$(ts)` 曾 command not found，部署失败告警缺时间戳；各脚本自带同名 ts() 覆盖它，行为不变）。
  - `scripts/backup-db.sh`（每日 02:00 容器内 mysqldump，保留 14 天）：**失败零残留**——先写 `.part` 临时文件，通过体积 + gzip + 建表语句三重校验才落正式名；任何失败删除残骸并推钉钉。**不要改回 `set -e` + 管道直写最终文件的旧写法**（那是 8-10 起连续 12 天空备份的根因）。
  - `scripts/monitor.sh`（每 5 分钟健康检查 + 钉钉告警）：状态去抖改为 `bad <epoch>` 格式，持续异常按 `REMIND_HOURS`（默认 24h）重提醒，不再只响一声。
  - `scripts/daily-report.sh`（每日 09:00 日报）：只统计体积 ≥ `MIN_BYTES`（默认 1024）的有效备份，损坏文件单列"待清理"。
  - `scripts/rotate-slowlog.sh`（每日 04:00，`install-cron.sh` 安装）：容器内 `truncate` 慢查询日志（MySQL 持写句柄，mv 改名会让日志不再增长，truncate 才无损），>1M 才轮转并保留一份 `.prev`。
  - `scripts/install-cron.sh`：幂等安装上述四条 cron（backup / monitor / daily-report / rotate-slowlog）。
  - `scripts/release-gate.sh`（服务器端发布门禁）：`smoke-pages.node.js` 页面烟雾——ERP 页面轮询等待（`PAGE_SMOKE_TIMEOUT_MS` 等环境变量可调），PDA 页面在**新标签页**真验证（`openPdaAndCheck`：tab-new → 注入 sessionStorage 登录态 → 水合 → 断言 PDA 标题），另用 `smoke_limited` 受限账号（密码 `SmokeLimited123!`，与 `tests/helpers/smokeTestKit.js` 一致，仅 `inbound.order.view` + `dashboard.view`）验证 403 权限拦截。门禁账号：`smoke_gate`（超管 role 1，CI secrets 注入）。
- MySQL 慢查询配置（`docker/mysql/my.cnf`）：**`log_queries_not_using_indexes` 已关闭**（2026-08-21，该开关把 0.0004s 扫 1 行的查询全记成"慢查询"，12 天堆 10.9 万条/83M 假阳性，让 monitor 的慢查询告警形同虚设）；`max_connections=151`，monitor 连接数告警阈值 `MAX_CONN_WARN` 默认 120（与上限拉开检测余量）。
- CI 门禁 `test.yml`：纯函数单测 + 在临时 MySQL 上跑 migrate + `smoke:mainline` / `concurrency-guards` / `sale-adjustment` / `p0-regression` / `p1-regression` / `warehouse-scope` / `pda-device-session` / `finance` + `test:integration`。**绝不连接生产库。**

---

## 17. 禁止事项（硬约束）

1. 禁止绕过 `assertStatusAction` / `assertWarehouseTaskAction` / `compareAndSetStatus` 直接 `UPDATE ... SET status=`。
2. 禁止直接写 `inventory_stock.quantity`；禁止绕过三大引擎操作库存或预占。
3. 禁止在没有事务、没有单头行锁的情况下做多表库存/账款写入。
4. 禁止在事务里执行 HTTP 请求或真实打印。
5. 禁止补打/重打标签时产生库存或账款副作用。
6. 禁止在前端实现或复制后端业务规则（可用量、状态流转、结算金额），禁止由前端传入目标状态值。
7. 禁止给 PDA 关键动作加"离线自动重放"，禁止去掉 `X-Request-Key` 幂等。
8. 禁止在 ERP 端新增绕过 `pdaOnly` 的仓库作业接口。
9. 禁止新增接口时省略 `requirePermission`；禁止靠前端隐藏按钮当作权限控制。
10. 禁止未经确认删除数据库字段、旧兼容代码、迁移文件，或修改已执行过的迁移（只能新增迁移）。
11. 禁止把密钥/口令/Token 写进代码、文档或提交；禁止覆盖生产环境配置（`.env`、`deploy/production*.json`）。
12. 禁止在没有读完整调用链的情况下重构 `engine/`、`documentStatusRules.js`、`warehouseTaskStatus.js`。
13. 禁止本机构建生产桌面安装包；禁止直接在服务器上改代码（只能通过 main 部署）。
14. 未经用户明确要求，禁止 `git push`、打 tag、发版、重启生产服务、执行会删数据的 SQL。

---

## 18. 修改前检查清单

- [ ] 这个改动属于哪一层（routes / controller / service / engine / 前端 / PDA）？是否已有窄职责文件该放进去？
- [ ] 是否触碰库存、预占、状态、账款、打印任一项？如果是，先读对应引擎/常量文件的注释（它们记录了历史事故的根因，别推翻）。
- [ ] 是否需要新的权限码？（后端 + 前端 + seed 迁移三处）
- [ ] 是否涉及并发？需要 `FOR UPDATE`、CAS、`requestKey` 还是唯一键？加锁顺序是否与现有代码一致？
- [ ] 是否需要新迁移？只能新增文件，编号取当前最大值 +1。
- [ ] 是否是仓库现场交互？先确认没有把"决策权"交给仓库操作员。
- [ ] 相关 smoke/集成测试（`tests/`）是否覆盖了这条链路？

## 19. 修改后检查清单

- [ ] `npm --prefix backend run lint` / `npm --prefix frontend run lint`（前端只看 error，warning 是存量）
- [ ] `./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit`（**不要用 tsconfig.json，那是空壳，永远 0 错误**）
- [ ] 涉及后端逻辑：`npm run smoke:mainline`、`smoke:concurrency-guards`、`smoke:p0-regression`、`smoke:p1-regression`、`test:integration`（本机有真实 MySQL，可直接跑）
- [ ] 涉及账款/资金账户/报销：`npm run smoke:finance`
- [ ] 涉及打印/标签：`npm run test:label`、`npm run test:print`
- [ ] 涉及前端页面：用 `preview_start` 起本地服务实际点一遍（PDA 页面记得开新标签页）
- [ ] 状态机改了：`WT_ON_ENTER/EXIT_ACTIONS` 注释表、`documentStatusRules.js` 是否同步
- [ ] 库存改了：跑一遍 `GET /inventory/check-consistency` 或 `resync:inventory-stock` 确认缓存与容器一致
- [ ] 权限改了：前后端权限码是否一致、seed 迁移是否补上
- [ ] 幂等改了：模拟"连点两次 + 断网重试"验证不会重复推进
- [ ] 三端版本号是否需要同步递增（发版时必须）
- [ ] **文档同步（每轮修复必做）**：修复/功能改动落地后，把变更记录到本文件第 20 节——已修复项改标 `~~...~~ 已修复`（注明提交号与验证结果），新风险追加新条目；若涉及计数/配置/路径断言，当场验证再写（见文件头教训）。**不要等"下次一起更新"。**

---

## 20. 当前已知风险与待确认事项

> 本节 2026-07-27 逐条对代码核过一遍。原 1–7 条里有四条（回执断链、PDA 会话、缺货上报、打包 pdaOnly）在写下之后已经被实现或了结，却因为文档没跟着核而继续挂着——**这类条目不核实就当事实引用，会导致重复修一个已经修好的东西**。下次改本节，请连带核实一次。

1. **v0.4.33 的四条财务链路是最新的高风险区**（资金账户、收款核销、汇总对账单、费用报销）。它们直接改钱，错法和库存一样是"静默出错"：界面正常、金额悄悄不对。已由 `npm run smoke:finance`（84 项断言）锁住关键口径，改动这四块务必跑它。
   2026-07 架构审计的 P0/P1 修复（v0.4.30，`23debe5` + `b17950b`，迁移 130/131/132）已在生产运行数版，但 engine 三件套、收货/上架、销售占库与出库的锁顺序与幂等仍是全仓最敏感的代码，改动要跑齐 `smoke:p0-regression` / `smoke:p1-regression`。
2. ~~幂等回执查询接口缺失~~ **已实现**：`GET /api/system/request-status/:key`（`modules/system/`）已注册，前端 `api/operation-requests.ts` 的调用路径与之匹配；PDA 各作业页（含 `sale-return-receive/putaway`）也都提供了 `resolveServerState` 第二道兜底。见第 14 节。
3. ~~PDA 设备会话形同虚设~~ **已启用**：`pdaSessionRequired()` 已挂在调拨扫出扫入、退货 receive/check/putaway、`/scan-logs` 写入等接口上，前端 `api/client.ts` 会发 `X-PDA-Session` 并自动续期，回归由 `smoke:pda-device-session` 守着。见第 12 节。
4. ~~缺货上报功能未落地~~ **已了结**：迁移 134 `drop_warehouse_task_shortages` 已删表与相关列，代码里也没有残留引用（`sale` 模块里的 shortage 是"缺货弹窗"，与此无关）。
5. ~~数据库列注释与实际语义脱节~~ **已系统订正**（迁移 146，2026-07-27）。方法是把 61 条状态类列注释逐条对 `constants/` 与前端 `StatusBadge` 核，改掉 5 条：`transfer_orders.status`（旧注释少一个状态且把中间态"在途"写成"已执行"，最严重）、`sale_orders.closed_reason`（`partial_ship_close` 已由 127 废弃）、`purchase_returns`/`sale_returns.status`（"已退货"→"已执行"）、`print_jobs.content_type`（实际只收 zpl）。**状态语义一律以 `backend/src/constants/` 为准这条不变**，注释只作参考。
6. ~~前后端权限码没有一致性校验~~ **已有校验**：`npm run test:permissions` 做双向 diff + 命名合规检查并已进 CI，当前两边各 184 个、完全一致（2026-08-21 核对）。仍是两份手工常量表，新增权限码要改三处（后端常量、前端常量、seed 迁移）。
7. ~~`/packages/*` 缺 `pdaOnly`~~ **已收紧**：装箱、完成箱、作废箱等写接口都已挂 `pdaOnly`。
8. **生产库存在 schema 漂移史**（曾出现迁移未真正生效导致缺列；也出现过迁移文本声明了生产从没有过的列）。改动依赖新列的逻辑时，先确认生产已跑过对应迁移。2026-07-27 新增的一例同类问题：`payment_records.order_id` 实际是 `NOT NULL`，而 054 的建表文本与 091 的注释都写它可空——已由迁移 145 订正。
9. **`avg_cost` 只随入库正向移动**，退货/撤回收货不反冲——这是刻意简化，利润分析用 `sale_order_items.cost_snapshot` 口径，不要"顺手修正"。
10. `docs/` 下少数历史文档可能滞后于当前实现，任何冲突一律以代码为准。
11. ~~`npm run lint` 两端都是坏的~~ **已补齐并清完存量**（2026-07-27）：两端 ESLint 9 flat config + CI 的 `static` job（顺带把前端 `tsc` 第一次接进 CI），13 处 `react-hooks/exhaustive-deps` 存量已逐个修复、规则恢复为 error。修复中发现的真问题：`CategoryPathDisplay` 条件调用 `useState`（Hook 顺序会在列表行间错位）、6 处 `data ?? []` 让下游 `useMemo` 完全失效、`DataTable` 列宽依赖漏了 `columns`。
12. **后端 `exceljs` 依赖链上有一条修不掉的高危告警**（2026-07-27 调查结论，别重复折腾）：
    - 已修：`body-parser` 1.20.5→1.20.6、顶层与 `readdir-glob` 下的 `brace-expansion`（`npm audit fix`，只动 lock 不动 package.json）。
    - 剩下的 9 条 `npm audit --omit=dev` 告警**全部同源**：`exceljs@4.4.0`（已是最新版）固定依赖 `archiver@^5` → `glob@7` → `minimatch@3` → `brace-expansion@1.1.16`。上游没有可升的版本，`npm audit fix --force` 也无版本可换，只会破坏依赖，**不要执行**。
    - 风险实际不可达：该 DoS 需要攻击者控制传给 `glob` 的模式串，而本项目只用 exceljs 读写文件，glob 模式全是库内部的固定路径，不接受任何用户输入。
    - 解除条件：exceljs 发布带 `archiver@6+` 的版本，或改用别的导出库。
13. **2026-08-21 运维事故已修复**：生产 MySQL 容器被 Docker 改名为 `d96fcce6a90a_flowcube-mysql`（`docker compose up` 遇 container_name 冲突时的既定行为），硬编码容器名的 `backup-db.sh` 连续 12 天 mysqldump 失败，且因脚本缺陷无人察觉（每天留下 20 字节空 gzip 被日报当"今日✓"；monitor 去抖只响一声后沉默）。已修复：`lib/ops-common.sh` 的 `resolve_container()` 解析容器名、backup 失败零残留 + 钉钉告警、daily-report 只认体积达标备份、monitor 持续异常重提醒。见第 16 节。**运维脚本的容器名一律经 `resolve_container()` 解析，不要硬编码。**
14. **门禁测试账号体系**（2026-08-21 补齐）：`smoke_gate`（超管 role 1，CI secrets 注入）跑全量页面；`smoke_limited`（`SmokeLimited123!`，仅 `inbound.order.view` + `dashboard.view`，生产库与测试 helper 同款）专测 403 权限拦截。**新增受限账号密码不得外泄**（它是 CI 门禁专用，不是业务账号）。
15. **`/pda/*` 页面烟雾现在是真的了**（2026-08-21）：`openPdaAndCheck` 用 playwright-cli `tab-new` 新标签页 + 注入 sessionStorage 登录态（sessionStorage 按标签页隔离，新页要重放 `flowcube-auth-v3`）→ 等 zustand 水合（`#/pda/login` → `#/pda`）→ PDA 内部导航 → 断言 PDA 标题 → `tab-close`。覆盖 4 个列表页（inbound/picking/split/transfer）；带 id 的作业页依赖真实任务数据 + `X-Client: pda` 写接口，不纳入静态烟雾（与 ERP 带 id 页同策略）。
16. ~~**2026-08-21 深度审计发现的高危缺陷**~~ **已全部修复**（提交 `2590836`/`0377fae`/`15a3133`，详见 `docs/audit-report-2026-08-21.md`）：
    - ~~warehouse-tasks 跨仓 IDOR（高危）~~ **已修复**：controller 全接口传 `req.user?.warehouseIds`，service 层新增 `assertTaskScope()`（helpers.js）在 9 处调用 `assertInScope`。
    - ~~warehouse-tasks PDA 作业可跨仓出库（高危）~~ **已修复**：`assertTaskScope` 增加 `pdaWarehouseId` 校验（设备绑定仓库与任务仓库不一致即 403），对齐 inbound-tasks.putaway 范式。
    - ~~picking-waves 无仓库数据权限（中危）~~ **已修复**（提交 `039afe1`）：findAll/findById/create/start/finishPicking/finish/cancel 全链路 scopeWarehouseIds + assertInScope。
    - ~~全局搜索不过滤仓库（中危）~~ **已修复**（提交 `71a72c9`）：10 个单据实体标注 warehouseColumn（调拨 from/to 双列 OR），限仓用户只搜本仓单据。
    - ~~CI 部署竞态（中危）~~ **已修复**（提交 `603e175`）：build-pda-apk 发布改走 server-update.sh（复用 flock 锁）。
    - ~~迁移失败无回滚（中危）~~ **已修复**（提交 `603e175`）：迁移前打 rollback tag，失败自动回滚旧镜像。
17. ~~**2026-08-21 深度审计发现的前端缺陷**~~ **已全部修复**（提交 `039afe1`/`603e175`）：
    - ~~登出不清 React Query 缓存（中危）~~ **已修复**：queryClient 提取为 `lib/queryClient.ts` 单例，`performSessionLogout()` 调 `queryClient.clear()`。
    - ~~打印模板编辑器 keepAlive 残留（中危）~~ **已修复**：`hydrated` 改为按模板 id 重置的 state，切换模板重新水合表单态。
    - ~~工作区标签无上限（中危）~~ **已修复**：tabs 上限 30，超出按 LRU 关闭最旧可关闭 tab。
    - ~~PDA 设备凭据明文长期存 localStorage（中危）~~ **已缓解**（提交 `603e175`）：票据 TTL 30 天→7 天 + 心跳续期（`/pda/sessions/renew`，前端 4h 低频续期）；deviceSecret 明文仍是现场可用性权衡，风险由「ERP 可停用设备吊销全部票据」兜底。
18. **审计确认的安全基线**（2026-08-21，可信）：全仓 SQL 参数化无注入点；所有业务 routes 挂 authMiddleware + requirePermission（唯一公开 app-update/latest；另 `GET /api/settings/logo`、`/logo/image` 为公司 Logo 的 `<img>` 消费方刻意豁免——ERP 顶栏/设置页预览/打印模板均无法带 Bearer 头，见第 12 节；登录页/PDA 门面自 2026-08-26 起改显系统品牌，不再依赖该豁免）；opLogger 敏感字段脱敏；multer 无路径穿越；无硬编码密钥；前端 0 处 dangerouslySetInnerHTML；仅 3 处工具性裸 axios（不带 token）；库存引擎 9 条不变量与第 9 节描述完全一致。
19. ~~**2026-08-21 财务审计发现**~~ **已全部修复**（提交 `0377fae`/`15a3133`/`039afe1`/`603e175`，详见 `docs/audit-report-2026-08-21.md` 附录 E）：
    - ~~手工建账款无幂等（高危）~~ **已修复**：`createManual` 接 `beginOperationRequest`（action='payment.record.create'）+ controller 传 requestKey。
    - ~~多账套未隔离（高危）~~ **已修复**：accounting.routes 挂 `companyScope`，`req.companyId` 贯穿科目/凭证/总账/报表/期间结转/导出全部 SQL。
    - ~~退款/退货回冲不刷新对账单投影（中危）~~ **已修复**：refund execute 与 adjustPaymentRecordForReturn 同事务 `refreshSettlement`。
    - ~~开票量校验无事务锁（中危）~~ **已修复**：createInvoice 校验+INSERT 同一事务，`assertInvoiceQuota` 先 FOR UPDATE 锁单据行。
    - ~~退款流水无凭证不进现金流（中危）~~ **未修复**：biz_type=5 无分录（需补凭证生成 + 现金流归集，涉及会计引擎改造，另行排期）。
    - ~~已使用科目可硬删（中危）~~ **已修复**：remove() 加「已有凭证分录禁止删除，引导停用」。
    - 改动财务模块务必跑 `npm run smoke:finance` + `smoke:accounting`。
20. **2026-08-21 第二轮修复（13 项遗留问题，提交 `603e175`）**，全部已部署验证：
    - **CI 部署安全**：PDA 发布改走 server-update.sh（复用 flock 锁）；迁移失败自动回滚旧镜像（rollback tag）；移除 MySQL initdb 挂载（防空数据卷首启与显式 migrate 双跑）；5 个 workflow 的 actions 全部 pin commit SHA + SSH_PRIVATE_KEY 改 env 注入。
    - **前端内存**：workspace tabs 上限 30（LRU 关闭最旧）；PDA 设备票据 TTL 30 天→7 天 + 心跳续期（`/pda/sessions/renew`，前端 4h 低频续期）。
    - **安全加固**：opLogger MODULE_MAP 补 15 个前缀（财务写操作审计不再记成 system）；JWT_EXPIRES_IN 默认 7d→24h；发票 update/remove 加状态 CAS（已红冲/已抵扣禁止编辑删除）；资金流水默认日期 UTC→本地时区。
    - **运维**：restore-check 每周一 05:00 恢复演练（install-cron 第 5 条，失败推钉钉）；生产删除 admin id=6 残留（确认 0 关联）；清理 22 个已合并 claude/* 分支。
    - 遗留：退款流水无凭证（biz_type=5，见第 19 条）、PDA 设备凭据明文（已缓解，见第 17 条）。
21. **2026-08-21 第三轮修复（6 项遗留，提交 `9d9fc63`）**，全部已部署验证：
    - **退款流水无凭证（biz_type=5）**：`voucher-engine.buildFundVouchers` 生成退款凭证（借应收/贷银行），`SOURCE_TYPES` 新增 `REFUND_PAY`，现金流量表加退款流出桶。
    - **查询弹窗默认当天**：17 个 `*QueryDialog.tsx` 与页面级筛选默认 `startDate=endDate=todayYmd()`（新增 `lib/dateTime.todayYmd` helper）；全局搜索的时间范围下拉此前已做。
    - **useNetworkStatus 心跳清理**：改引用计数管理（首订启动/末退清理），dev 热更新不再叠加定时器。
    - **PDA 错误堆栈脱敏**：`PdaErrorBoundary` 只存 message 摘要 + 组件名（去 stack，防业务数据入 sessionStorage）。
    - **PDA APK 下载签名校验**：`/api/pda/version` 下发 sha256（mtime 缓存），原生 Java 下载后比对（不匹配拒绝安装），浏览器 fallback 用 `crypto.subtle` 比对。
    - **server-update 自动装 cron**：部署后幂等同步 `install-cron.sh`，cron 改动随部署自动生效（此前需手动跑）。
22. **2026-08-21 设计权衡项修复（2 项，提交 `4cd558f`/`e92499a`/`579adf7`）**：
    - **JWT refresh token 分离**：access 2h（`JWT_ACCESS_EXPIRES_IN`）+ refresh 30 天（`JWT_REFRESH_EXPIRES_IN`，`tokenType='refresh'`）。`/auth/refresh` 不再挂 authMiddleware（access 过期仍能续期）；authMiddleware 拒绝 refresh token 访问业务接口；`token_version` 校验切断「无限续期」（改密码/禁用用户后旧 refresh 立即失效）。前端 authStore 存 refreshToken，401 自动换新重放（并发去重 + 单次重试）。
    - **PDA 凭据 SecureStorage**：自建 `SecureStoragePlugin`（Android Keystore AES-GCM 加密存 SharedPreferences，明文不再落盘；密钥系统级保护）。`pdaDeviceBinding` 改内存缓存 + `initDeviceBinding()` 启动水合（boot 调用），同步 getter 兼容 axios 拦截器；非原生回退内存态。**需重新构建 APK 生效**（已随本提交触发 build-pda-apk，服务器新包已上线）。
    - 已无未解决的设计权衡项；「avg_cost 不回冲」「前端 5 条 warning」「exceljs 告警」等为语义正确/风险不可达的技术债，CLAUDE.md 已记录不处理。
23. **2026-08-22 全仓死代码/过期文件清理**（分支 `chore/cleanup-dead-code-2026-08-22`，未发版）：
    - **扫描结论**：5 路多智能体全仓扫描（backend/frontend/desktop+scripts+tests/依赖配置/docs）+ 人工交叉验证。代码引用链非常健康——后端 286 文件全部可达、前端 443 文件全部被引用、无整块注释死代码、无孤儿中间件/脚本、无未用依赖、218 个迁移全部在用。
    - **已删除（git 历史可恢复）**：`frontend/src/types/desktop.ts`（零引用）、`frontend/src/constants/labelZplDefaults.ts`（自证 deprecated 的 re-export shim，消费方已直连 `printFieldDefs.ts`）、`scripts/cleanup-fix-all.sh` + `cleanup-debug-logs.sh` + `cleanup-dep-report.sh`（自包含孤儿组，零调用方）；空目录 `frontend/src/pages/{warehouses,locations}/components/`、`desktop/release/`。
    - **文档修订**：`docs/proposals/04-序列号管理.md`（取向被 13 推翻）与 `07-采购收货质检.md`（功能已随 v0.4.77 整体下线）删除，README 状态表 10 项「待实现」改为「已实现（版本号）」并补 15 行；`docs/RELEASE.md` 删「登录页改地址/Ctrl+Shift+S」过期句；`docs/换服务器与桌面端自动更新说明.md` 第五节改「域名已启用（v0.4.80）」；`docs/02-部署指南.md` 重新定位为「本地开发部署指南」。
    - **保留未动**（确认非死代码）：后端 45 个「未引用导出」（均为内部自用的活函数/常量）、`react-is`/`terser` 前端依赖（传递依赖显式遮蔽，删有风险）、CI 死角测试 `print-jobs-purge`/`oplog`（有 script 但 test.yml 未跑，未补）、`seedTestData.js`/`resetBusinessData.js`（gitignore 的本地造数工具）、docker 三件套（nginx 配置/backup-entrypoint/Caddyfile 均在用或属备份骨架）。
    - **验证**：backend lint 0 问题、frontend lint 0 error、tsc 通过、test:permissions/label/print/accounting/oplog/print-purge 全绿、test:integration 96 + mainline 49 + concurrency-guards 83 + p0 41 + p1 44 全部 0 failed。
24. **2026-08-22 全面优化 + 功能实现**（分支 `feat/optimize-2026-08-22`，提交 a9e38ef/700f157/ef61fdb/e2e05e1，未发版）：
    - **安全（P0）**：refunds/stockcheck/disposal 三模块跨仓写 IDOR 补 scope（动钱/动库存/动台账）；报销详情与导出强制 applicantId/VIEW_ALL 过滤；transfer scan-out/scan-in 补 PDA 设备绑定仓拦截；inbound-tasks 建单校验仓库范围；前端 `npm audit fix`（axios high、tar critical 清零，react-router 6.x 2 条 moderate 需 v7 breaking 升级记录保留）。
    - **数据正确性**：收货效期推算与退货 fmtSqlDate 的 `toISOString().slice(0,10)` 改 Date 透传（+08:00 下效期回退一天的 bug）。
    - **性能**：loadRolePermissions 加 60s roleId 缓存（角色权限变更即清）；销售列表全表 GROUP BY 派生表改两段式（分页取 id 再 IN 聚合）+ 日期半开区间；迁移 211 补 6 组索引（print_jobs ref_id/operation_requests created_at/sale_orders sale_date/scan_logs operator_time/inventory_checks status_created/payment_records type_status_due）；9 个 service 接 normalizePagination；前端 26 处 pageSize:99999 改真分页/收缩；导出统一 10000 行上限截断+告警。
    - **测试/CI**：新增 3 个测试——`status-rules-integrity`（状态机动作表 321 断言）、`search-scope`（全局搜索仓库过滤 4 场景，守护审计 A.4）、`users-roles`（改密/禁用后 token 立即失效）；test.yml 补 5 个 CI 死角（accounting-period/print-purge/oplog/status-rules/search-scope/users-roles）。
    - **运维**：monitor 补公网 HTTPS 探测+证书到期+容器重启计数；compose 三容器 json-file 日志轮转（50m×3）；restore-check 关键表行数硬失败+MIN_TABLES 从迁移数推导+数据新鲜度检查；server-update 回滚覆盖 frontend 双镜像+钉钉通知；backup-db chmod 600；新增 `docs/runbooks/failure-recovery.md` 故障预案。
    - **数据库**：迁移 212——carriers/warehouse_locations guard 唯一键（product_items/supply_suppliers 已确认是 (code,deleted_at) 复合唯一等效 guard）、adjustment_no 唯一、3 张事件表 created_at 索引、打印四表 COLLATE 统一；scheduler 加 event-log-cleanup（4 张事件表 180 天 TTL）。
    - **功能（10 项）**：① 钉钉预警推送（scheduler worker + `DINGTALK_ALERT_WEBHOOK`，30 分钟扫描高危项当天去重）；② 审批待办聚合（通知铃 PENDING_APPROVAL + 工作台「待我审批」widget + 审批流新增 product_price bizType）；③ 价格体系（findCustomerPrice 价格表优先+等级价回退、`product_price_history` 表、商品改价写 before/after 历史）；④ 客户/供应商门户（portal 模块：对账单确认+供应商到货查询）；⑤ 批量操作（DataTable 多选+销售批量确认 batch-confirm+客户/价格表导入+利润/账龄报表导出）；⑥ PDA 只读库存查询（扫条码查库位/批次/效期）；⑦ 角色复制（/roles/:id/duplicate）；⑧ 库位标签打印（location_label+模板 type 10）；⑨ 报表增强（库存周转率/周转天数+采购价格趋势）；⑩ 单号规则自定义（sys_settings `code_prefix_*` 覆盖，迁移 215）。
    - **已知边界**：商品改价走审批的完整闭环（申请→审批→生效）已具备 bizType 支撑但未做商品页审批入口 UI（复用 approvalEngine 即可补）；react-router 2 条 moderate 待 v7 升级。
    - **验证**：tsc 0 错误、两端 lint 0 error、test:permissions 184/184、integration 96 + mainline 49 + concurrency 83 + p0 41 + p1 44 + finance 103 + accounting 11 + accounting-period 14 + warehouse-scope 41 + disposal 27 + refund 14 + 3 个新测试全绿。
25. **2026-08-22 后续两轮（改价审批闭环 + 安全加固，提交 d061582/8cbb243，未推送）**：
    - **商品改价审批闭环**：迁移 216 `price_change_requests` 表；新模块 `price-change`（create/submit/approve/reject/cancel），submit 走 approvalEngine（bizType=`product_price`），审批通过自动更新商品价格并写 `product_price_history`（change_source='approval'）；documentStatusRules 新增 `priceChangeRequest` 状态机（1待审批 2已通过 3已驳回 4已取消，submit 不流转）；前端页面「商品改价申请」（库存→商品资料）；审批内控（申请人不得自批等）由引擎兜底。
    - **安全加固（第 5 轮）**：settings.updateMany key 白名单；role.assign 提权链（permissions 更新与角色复制）路由层仅超管；oplogs/clear 仅超管；import 错误脱敏（不回显 MySQL schema 细节）；error-report url 剥查询串+控制字符清洗；logistics.createdBy 修正（req.user.id→userId）；env 生产必设 TRUST_PROXY；stockcheck.submit 与 refund.execute 接事务内幂等（断网重试不再重复入账）。
    - **验证**：lint 0 error、integration 96、mainline 49、warehouse-scope 41、refund 14、disposal 27、p0 41、status-rules 338、改价审批端到端（申请→审批→价格 100→88 生效+历史留痕）全绿。
26. **2026-08-22 第 6 轮 P2 加固（提交 986eb07）**：
    - PDA 设备会话 TTL 清理（scheduler 每日，过期/吊销且 30 天前）；裸 throw 统一 AppError(500,'INTERNAL_CONFIG')（statusTransition/warehouseTaskStatus/documentStatusRules）；loadRolePermissions 缺表显式告警；deprecated /downloads 日志降噪（console.warn→logger.warn）；operation_logs 清理改分批（每批 2000 行）；scheduler worker 注入 `scheduler:<name>` requestId 上下文。
    - 验证：lint 0 error、mainline 49、pda-device-session 28、status-rules 338 全绿。
27. **2026-08-22 落地页（landing）优化收尾（净增量，未发布）**：
    - 说明：本批的 P0/P1 项（数据失实修正 60/5+/0、robots/sitemap/favicon 落地、meta/OG、size-4.5→size-[18px]）已由并行会话完成并随 **v0.5.3 上线**，此处只记录未发布的净增量。
    - **手机端汉堡菜单**（landing header，<sm 显示汉堡，点击展开四项锚点，点击项自动收起；窗口拉宽到 sm 断点以上自动收起，避免与桌面导航同时出现）。
    - **登录回跳**：`ErpProtectedRoute` 未登录跳 `/login` 时带 `state.from`；`ErpGuestRoute`/`LoginPage`（`useLogin(from || '/dashboard')`）登录成功后回原页——落地页能力卡片点击 → 登录 → 回到目标页，动线不再断。
    - **scrollToSection 参数修复**：`(e?: React.MouseEvent)` 改为可选 + `e?.preventDefault()`，使手机菜单按钮（无事件对象）可复用同一滚动逻辑。
    - 变更文件：`frontend/src/pages/landing/index.tsx`、`frontend/src/router/index.tsx`、`frontend/src/pages/login/index.tsx`。
    - 验证：tsc 0 错误、前端 lint 0 error（5 warnings 存量）、生产 build 通过、dev 浏览器实测（菜单展开/收起、数字动画终值 60/5+/3/0、meta 生效）。
28. **2026-08-23 落地页（landing）视觉升级（净增量，未发版）**：
    - 说明：本批视觉体系（安全线琥珀色 `--fc-amber`、JetBrains Mono 等宽数字、图纸网格、纯 CSS 条码、扫描下划线、扫描光带、mockup 琥珀占用格）已由并行会话随 `74e6ece`/`d9cabaa`/`52a7c1c` 提交并在线上验证，此处只记录工作区未提交的净增量。
    - **能力矩阵改目录式清单**：从 3 列卡片阵改为 2 列编号列表（`01`-`06`），等宽编号 + 细底线分隔 + hover 琥珀底线扩出（`.mod-link`）+ arrow 浮现。
    - **Barcode 组件加 `bars` 参数**（默认 22，导航用 10 根短条码避免挤占标题），用 `Array.from` 替代固定数组。
    - **Hero 背景清理**：移除 inline 网格背景（`absolute inset-0 opacity-[0.06]`），改用统一 `.bg-sheet-grid` 类；`landing-hero.bg-sheet-grid` 白色网格线（原 `.landing-hero .bg-sheet-grid` 后代选择器不生效，改为同元素匹配）。
    - **扫描下划线修正**：删 `display: inline-block`（会覆盖 hero-line 的 block 换行，导致标题折行异常）。
    - 变更文件：`frontend/src/pages/landing/index.tsx`、`frontend/src/index.css`。
    - 验证：tsc 0 错误、前端 lint 0 error（5 warnings 存量）、生产 build 通过、浏览器实测（条码渲染 flex/14px、琥珀格 border-amber-400/30、目录列 6 项编号 01、Hero 扫描下划线 relative 正常）。
29. **2026-08-23 Landing 整体重构「轨道叙事」（未提交，工作区）**：
    - 动机：用户反馈「卡片特效和别的不一样」「整体重构一下」——六板块拼装（Hero/能力矩阵/场景/业务流/下载/价值/页脚）卡片语言不一致、缺叙事主线。
    - **轨道叙事主线**：以「一条货从下单到出库在系统的轨道上流动」重排全页叙事，所有卡片统一语言（`scan-card` 琥珀扫描光 + 白底图标 + 灰底/白底圆角），扫过哪块哪块亮。
    - **「一条货的旅程」水平交错轨道时间线（核心新增，替换原 FLOW_STEPS 平铺卡）**：桌面 md+ 上排三卡（01/03/05）+ 轨道行（6 节点均布 + `.rail-track` 琥珀点亮点 + `.rail-dot` 移动货点）+ 下排三卡（02/04/06）；移动端 <md 降级为垂直轨道（节点在左、卡片在右）。滚动进入视口逐站点亮（300ms/站，IntersectionObserver，`.is-lit` 琥珀呼吸 + rail-ping 扩环）。
    - **Hero 轨道线装饰**：副标语下加 `.hero-rail`（常驻琥珀渐隐线，opacity 0.55）。
    - **能力矩阵**：标题改「六大业务域，把每一种货管到底」；编号角标移左上角（`01/06`，hover 变琥珀）。
    - **下载区压缩为三端横幅**：两张大卡改深蓝横幅（Pill「三端随时可用」+「一个系统，三种打开方式」+ 双按钮 + 右侧两列版本信息等宽字 v0.x.x 动态读 + 条码），收尾标语并入横幅底部。
    - **价值区改信条列表**：3 张大卡改竖排信条（编号 + 大字 + 小字，琥珀细线分隔 `.value-rule`）。
    - **清理**：删 FlowCard 组件/flow-card CSS/`.mod-link` CSS/MODULES 的 color 字段。
    - 变更文件：`frontend/src/pages/landing/index.tsx`（重组 JSX：JourneyTimeline + StationCard）、`frontend/src/index.css`（rail-track/rail-dot/rail-node/value-rule/hero-rail 新样式 + reduce 清单补齐）。
    - 验证：tsc 0 错误、lint 0 error（5 warnings 存量）、build 通过、DOM 实测（移动端 6 节点全亮 .is-lit、桌面轨道行 6 节点、节点 x=31 与竖线对齐、Hero 轨道线 2px/0.55、能力矩阵编号 01/06 右上角）。截图工具滚动后偶发空白是已知 bug，用 inspect/eval 兜底。
    - 备注：浏览器预览面板视口固定 537px（resize 工具不生效），桌面形态用注入 CSS 临时验证后已清理。
30. **2026-08-23 Landing 配色收敛 + 简化（用户反馈，未提交）**：
    - **配色收敛为单一蓝**：`--fc-amber` 从 `#F5A524` 改 `#1E5AE6`（品牌蓝），全部 `rgba(245,165,36,...)` 替换为 `rgba(30,90,230,...)`；mockup 占用格/窗口黄点/下划线装饰的 amber Tailwind 类改蓝。**着陆页不再有橙色**。
    - **删除全部序号**：旅程卡 01-06、能力矩阵角标 `01/06`、价值区编号 01-03 全删，含 StationCard 的 `n` prop、map 的 `i` 参数清理。
    - **删卡片 hover 橙色扫描光**：`.scan-card` 类 + `fc-card-scan` keyframes 全部删除（TSX 4 处 class + CSS 1 块 + reduce 清单引用），卡片 hover 只保留上浮 + 阴影。
    - **统一卡片箭头**：场景卡（原无箭头）、旅程移动/桌面卡（原无箭头）补上 hover 浮现 ArrowRight；全部统一为 `opacity-0 group-hover:opacity-100 group-hover:text-[#1E5AE6]`（价值区深底也统一品牌蓝）。
    - **修复轨道行 bug**：`.rail-track` 忘了接 `is-active` 条件（`litCount > 0` 时轨道点亮，之前轨道线永不亮）；`.rail-node` 逻辑反向改写（`is-lit` 按条件加而非 base 写死再覆盖）；IO threshold 0.2→0.05 + rootMargin（537px 小视口下 0.2 永不达标）。
    - 变更文件：`frontend/src/pages/landing/index.tsx`、`frontend/src/index.css`。
    - 验证：tsc 0 错误、lint 0 error（5 存量 warning）、build 通过；DOM 检查 amber 计数 0、节点 12、轨道线 CSS 规则在（`.rail-track.is-active::before = scaleX(1)`）、货点背景 `rgb(30,90,230)`。
    - 备注：浏览器面板 `innerHeight: 0`（工具 bug）导致 IO 逐亮动画在面板不触发，但 CSS/DOM 验证正确——真实浏览器正常。**着色页唯一强调色 = 品牌蓝 #1E5AE6（--fc-amber 已改名复用）**。
31. **2026-08-25 财务/会计/报表三大类页面精简与重新分类（未提交，工作区）**：
    - 用户反馈「三大类页面功能重复多，一个功能一个页面」+ 点名「退货退款应在财务而非会计」。经 3 路多智能体深度扫描确认。
    - **分类修正**：退货退款单 `/refunds` 从「会计→发票税务」移**「财务→往来账款」**（routeRegistry.ts + permission-codes.ts 权限分组同步；依据：退款单锁 payment_records/写 payment_entries/刷新对账单投影，是销售退货的钱侧配套）；补货建议 `/reports/replenishment` 从「报表→经营分析」移「报表→**库存分析**」（后端在 inventory 模块，属库存决策工具）。
    - **报表去重**：报表中心删「热销商品 Top20」（与利润分析商品毛利同源同过滤）、删「库存周转各仓价值卡」（与利润分析库存金额汇总数一致）、头部删两个对账按钮（菜单+卡片已有入口）；利润分析删「滞销库存」tab 明细、汇总卡可点击跳库龄与呆滞（跳转已实测）；仓库运营看板异常卡片补分工文案（今日快照 vs 区间分析）。
    - **成本对账后端二合一**：`avgCostReconciliation`（reports.metrics）与 `checkStockConsistency`（inventory.service，`GET /inventory/check-consistency` 运维入口）本是同一库存不变量（ACTIVE 容器合计 vs inventory_stock.quantity）两套 SQL——抽公共基座 `findStockDrift`（双向覆盖 + 价值列 + scope），两入口各自适配。接口实测两个入口数据一致（同一漂移 -150）。
    - **会计缺陷修复**（均为真实 bug）：① `voucher-engine.generateVouchers` 补传 companyId（此前账套 2 点「生成本期凭证」写进账套 1；内部函数 loadAccountMap/makeSeqAllocator/upsertVoucher 本就支持该参数，只差透传）+ `voucher.service` 4 处 assertPeriodOpen 补 companyId；② `loadTaxMaps` 进项发票加 `status IN (2,3)`（待认证发票不再静默计入 222101/申报表；销项 status<>2 排除已红冲不变）；③ 利润表与报税口径统一：`categoryNet`/`profitAndLoss` 均排除结转凭证（PERIOD_CLOSE/PERIOD_CLOSE_Y，与 period.service.loadPlNets 一致），利润表净利润改全类别净额并新增「其他损益」行（此前硬编码 6001/6401/6601/6602 且不含结转排除，结账后与报税/期间页口径互相矛盾）。
    - 验证：后端 lint 0 问题、前端 lint 0 error / tsc 0 错误、test:permissions 184/184、smoke:accounting 11 + smoke:finance 103 + smoke:mainline 49 + smoke:accounting-period 14 + test:integration 96 + test:accounting 7 全绿；浏览器实测（报表中心销售/库存 tab 去重、利润分析 tab 3 个 + 汇总卡跳转、成本对账出数据、退款单在财务菜单往来账款段、补货建议在库存分析段）。
    - 注：landing 色（#1E5AE6）在本轮无关，未触碰。
    - 后续（同日）：报表中心再精简——删「每日待办」「作业绩效」「对账与分析」三个引导区块和头部快捷按钮，只留经营总览（采购/销售/库存统计）；改单入口收敛：对账走财务菜单+页面卡片，岗位工作台/库龄呆滞/PDA 异常等走报表菜单，页面不再重复引导。
32. **2026-08-25 经营 KPI 页面丰富（未提交，工作区）**：
    - 用户要求「丰富经营 KPI 页面」。扩展为「5 张卡 + 近 12 个月趋势图 + 当月分仓表」仪表盘。
    - **后端**：`reports.query.js` 新增 `fetchKpiTrendRows`（近 12 月序列，口径与卡片一致——销售 status=4+sale_date、回款 payment_entries 按 payment_date，空月补零、MONTHS 上限 36）与 `fetchKpiByWarehouseRows`（当月按订单头仓库 GROUP BY，CLAUDE.md 7.2 分仓发货注意：这里刻意用订单头仓而非行级 soi.warehouse_id，与卡片同口径）；`reports.metrics.js` 的 `kpiMetrics` 追加 `trend`/`byWarehouse` 字段（原 period/prevPeriod/metrics 不变，兼容）；`backend/scripts/smoke-reports.js` 补 kpiMetrics 覆盖（此前 smoke 无 KPI 项）。
    - **前端**：`api/reports.ts` 加 `KpiTrendRow`/`KpiByWarehouseRow` 类型；`pages/reports/kpi.tsx` 重写——5 张 StatTile（loading 骨架 + chartTheme.money 金额格式，替掉原手写 fmtMoney 整数格式）+ ComposedChart 趋势图（Bar 回款 success + Line GMV primary + Line 毛利 warning，照抄 ChartSaleTrend 范式）+ 分仓 DataTable（含 GMV 占比列）+ QueryErrorState 标准化。
    - 验证：后端 lint 0、前端 lint 0 error / tsc 0、test:permissions 184/184、smoke:reports 全绿（含新增 kpiMetrics）；接口实测 trend 12 月序列与卡片口径一致（2026-08 gmv 5740 = 分仓合计）、分仓合计 = 总 GMV；浏览器实测月份联动（2026-08→07 卡片/趋势/分仓表同步切换）。
    - 明确不做：导出 Excel（后端 /export/kpi 未做）、月末库存快照（inventory_logs 有 180 天 TTL，历史不可靠）、OTD 指标（warehouse-ops 已有当日口径，月度 OTD 需另行定义）。
33. **2026-08-25 库存漂移「自动巡检 + 一键修复」（未提交，工作区）**：
    - 背景：用户问「漂移是什么 / 设计足够好是否可取消对账」→ 结论：缓存(投影)与容器(事实源)失联是架构固有风险，设计防不住测试残留/手改库/未来 bug，对账应**自动化**而非取消。
    - **自动巡检**：`scheduler.js` 新增 `stock-drift-check` worker（默认 30 分钟，`STOCK_DRIFT_CHECK_INTERVAL_MS` 可调）：跑 `findStockDrift` 发现漂移即推钉钉（复用 `sendDingtalkAlert`，未配置静默），含前 5 项明细 + 总价值差 + 「成本对账页修复」指引；同日去重。**只报警不自动修**——漂移是机制失效信号，自动改可能掩盖根因。
    - **一键修复**：后端 `POST /inventory/resync-stock`（`inventory.service.resyncStock`，权限 `INVENTORY_TRACE_VIEW`，与 check-consistency 同级）：仅对漂移组合重算 `syncStockFromContainers`（不扫全表、支持 scopeWarehouseIds 限仓），返回修复明细；前端成本对账页（avg-cost-reconciliation.tsx）加「修复缓存」按钮——confirm 二次确认 + toast 结果 + refetch，无漂移时按钮禁用，修复中显示 loading。
    - 验证：后端 lint 0、前端 lint 0 / tsc 0、smoke:reports 全绿、test:permissions 184/184；闭环实测——注入漂移(42/80) → 页面识别「1 项漂移」→ 点修复 → 数据库恢复 80 + 按钮自动禁用；巡检模拟——注入后 `findStockDrift` 命中、修复后静默；幂等（再跑 fixed=0）。
    - 设计说明：`resyncStock` 与 `scripts/resync-inventory-stock.js` 的区别——只扫漂移组合（快、少锁）而非全表；非超管只修 scope 内仓库。
34. **2026-08-25 全系统商品显示补「货号/型号/颜色」（未提交，工作区）**：
    - 用户反馈「显示商品的地方有的只有编码+名称，要把货号/型号/颜色全部显示」。经探索代理全量扫描：主档 `product_items` 有 article_number/spec/color；7 张业务表（采购/销售/调拨/收货/双退货/装箱/仓库任务）有快照（迁移 082/092/093/095/096/097/099/114）；商品管理页/选择弹窗/各单据表单**已完整**（好先例）。
    - **设计决策**：有快照的表读快照列（历史单据按当时信息展示）；无快照的过程性表（退货任务/盘点/处置/波次/请购/采购计划/改价申请）**JOIN 主档取当前值，不追加快照列**（避免 7 个迁移+回填连锁改动，主档是唯一事实源）。
    - **后端 A 档**（JOIN 主档补字段，约 15 处）：inventory.service（总览/流水/overview/trace/对账/条码×2/补货）、inventory.aging（库龄/效期）、inventory.procurement（采购计划）、reports.query（采购/销售 Top20 改快照字段、库存周转、利润分析商品/库存/滞销）、reports.metrics 映射、stockcheck.cycle（ABC）、disposal.service（呆滞候选）、plastic-boxes、warehouse-tasks.findMyTaskSkuSummary（快照字段）、sale.service ship 回读。
    - **后端 B 档**（无快照表 JOIN 主档）：stockcheck.findById、disposal.findById（明细）、picking-waves.findById（波次明细）、return-tasks.findById（退货任务）、purchase-requisitions.findById、procurement 计划明细、price-change 列表/详情。
    - **前端**（约 18 处）：库存总览表格（手动 th 加 3 列）+ 类型补字段；利润分析商品/库存列；报表中心采购 Top20；库存周转表；库龄/效期列；成本对账列；补货建议列；ABC（拼接）；改价申请列；处置详情/创建（拼接）；波次/请购/采购计划/塑料盒（拼接）；发货选择/占库弹窗/ContainerDrawer（拼接）。
    - 验证：后端 lint 0、前端 lint 0 / tsc 0、smoke:reports 全绿、test:permissions 184/184、smoke:mainline 49/49；浏览器实测——库存总览「SKU0001 | YN-1001 | X200 | 测试商品1 | 黑色」五列同屏、利润分析商品 tab 列出现；本地测试库给 SKU0001-0004 补了货号/型号/颜色便于验证（测试数据，非业务改动）。
    - 说明：空值渲染 `—`（沿用商品页先例）；后端返回字段名统一 `articleNumber/spec/color`（null 或缺失由前端兜底）。

34. **2026-08-25 上传公司 Logo（2026-08-26 已调整为双区品牌，见第 40 节）**：
    - 需求：用户增加「上传 Logo」功能，上传入口在系统设置页。当时范围=系统品牌位全部（ERP 顶栏、ERP 登录页、PDA 登录页/首页）；**2026-08-26 调整**——产品门面位（登录页/PDA）改回系统品牌，公司 Logo 只显示客户内场位（ERP 顶栏、打印单据）。
    - **架构**：Logo 以 base64 data URL 存 `sys_settings`（键 `company_logo` + `company_logo_updated_at`），零部署改动、备份/恢复天然覆盖；**不落盘**（避免新 compose 卷+静态挂载+nginx location）。
    - **迁移 218**：`sys_settings.value` 扩 `MEDIUMTEXT`（原 201 字符的 VARCHAR/TEXT 容不下 2MB base64）；seed 两个键（type=`image`/`timestamp`）。注意本机此列实测为 `TEXT`（64KB）且 `key_name` 为 100 字符，与 011 建表文本漂移（第 20 节第 8 条的老问题），迁移判断条件按「非 mediumtext 就 ALTER」覆盖两种现状。
    - **接口**：`GET /api/settings/logo`（返回 `{url, updatedAt}` 元数据）与 `GET /api/settings/logo/image?v=<时间戳>`（图片二进制流，未设置 404）——**公开**（authMiddleware 之前，登录页/PDA 无 JWT 也要显示；Logo 非敏感，见第 12 节刻意豁免）；`POST /api/settings/logo`（multipart，`settings.update` 权限）、`PUT /api/settings` 的 `updateMany` **拒绝** image/timestamp 键（防「保存设置」整组提交误清 Logo，`SETTINGS_KEY_SPECIAL`）。
    - **安全**：multer memoryStorage + 2MB 上限（MulterError 转 AppError）；fileFilter 只收 png/jpeg/webp/svg；PNG/JPEG/WebP 魔术字节校验防伪装；SVG 黑名单（`<script`/`on*=`/`href=javascript:`/外部引用/`<iframe`/`<foreignObject`）——前端一律 `<img>` 渲染双保险。opLogger 截断 500 字符，大 base64 不爆 `operation_logs`。
    - **前端**：新组件 `components/shared/BrandLogo.tsx`（React Query 键 `['brand-logo']` 多点位共享一次请求；有 Logo 渲染 `<img>`，无/失败回退默认图标盒或空；`imgClassName`/`boxClassName` 分开控制图片与回退盒；不导出常量键避免 react-refresh warning）；接入 AppLayout 顶栏（`hideFallbackIcon` 保纯文字现状）；设置页新增「品牌标识」卡片（预览+上传按钮+前端校验 ≤2MB/类型）；`api/settings.ts` 加 `getLogoApi`（经 `resolveApiFetchUrl` 拼绝对 URL——注意它自带 `/api` 前缀，后端返回先去 `/api` 再传）/`uploadLogoApi`（FormData）。（2026-08-26：login/pda/login/pda 首页三处的 BrandLogo 替换为 SystemBrand，见第 40 节。）
    - **缓存**：`GET /logo/image?v=<YYYYMMDDHHMMSS>`——时间戳随上传变化，URL 变即破 HTTP 缓存；React Query 侧上传后 invalidate `['brand-logo']`。
    - 验证：后端 lint 0、前端 lint 0（5 warnings 存量）/tsc 0、test:permissions 184/184、smoke:mainline 49/49、迁移 218 本机实跑；curl 全链路（公开 200/未设置 404/无 token 401/伪装 400/超限 400/SVG 脚本 400）+ 浏览器 5 品牌位实测（上传替换/回退/跨端口 PDA 代理）。
    - 不做（范围外）：单据打印模板 logo（TemplateRenderer 仅文本字段，需扩展引擎另议）、官网 landing（已确认不含）。
35. **2026-08-25 单据打印模板支持公司 Logo（image 元素，未提交，工作区）**：
    - 需求：继第 34 条上传 Logo 后，用户要求**单据打印模板也显示 Logo**。范围经确认：**仅 HTML 单据模板**（type 1-4：销售/采购/出库/仓库任务单，A4/A5/A6 浏览器打印）；**条码标签（type 5-10，ZPL）不做**——走热敏机需图片解码 + `^GF` 位图，后端 Node 无此能力且标签场景少。
    - **元素类型**：`TemplateElement.type` 加 `'image'`（纯前端类型，layout_json 是 MySQL JSON 列，无需迁移）。渲染语义：`data[fieldKey]` 取系统 Logo URL，**空值渲染 null**（未上传时打印/预览无空白框）；`object-fit: contain` 固定，不裁剪。
    - **数据来源**：`fieldKey` 固定 `companyLogo` = `getLogoApi().url`（公开接口，带 v= 破缓存），与 BrandLogo/设置页共享 React Query 键 `['brand-logo']`。注入点仅 2 处覆盖 4 种单据：`OrderPrintOverlay`（`SaleOrderPrintTemplate` 复用它）+ 编辑器 `previewData.companyLogo`。
    - **改动文件**（纯前端 5 个）：print-template.ts（type 联合）、printFieldDefs.ts（PrintFieldDef + DOC_FIELD_DEFS 加 companyLogo 40×12mm）、TemplateRenderer.tsx（ElementNode image 分支）、editor.tsx（fieldIcon/mkElement 中性默认/ElementNode 编辑占位+预览 img/PropertiesPanel 白名单排除 image + 来源说明/顶部 brand-logo 查询）、OrderPrintOverlay.tsx（data 合并 + 打印前 `Promise.all(img.decode())` 防首帧空白）。
    - **安全**：src 来自系统内部 Logo URL 而非用户输入；标签画布经 `resolveLayout → normalizeElement` 白名单剔除未知类型，image 不可能进 ZPL。
    - 验证：tsc 0、前端 lint 0（5 存量）/后端 lint 0、test:label + test:permissions 184/184、smoke:mainline 49/49；浏览器实测——编辑器预览/打印预览 logo 出图（40×12mm→151×45px 精确对应）、未上传不渲染、编辑器拖拽/属性面板（字体与对齐正确排除）、标签模板字段面板无 image 项、模板 #1 测试数据已还原。
    - 备注：若未来做 ZPL 标签 logo，需后端图片解码（建议 sharp）+ `^GF` 位图 + labelGeometry/labelZpl/测试快照三处同步，属于独立工程，勿与本次混做。
36. **2026-08-25 打印模板编辑器「全部修复」（评审驱动，未提交，工作区）**：
    - 背景：对 A4 单据打印模板编辑器做双评估评审（A=设计评审 21/40 Nielsen、B=浏览器实测），发现 P0×1 + P1×5 + P2×2 优先级问题，用户要求全部修复。
    - **P0 类型切换**（editor.tsx）：切换类型前 confirm（"将重建画布"），且切换入 undo 栈。undo/redo 历史从「仅 elements 数组」升级为**全量 EditorSnapshot**（elements+type+paper+canvas+margins+selectedIds）——否则 undo 回退类型切换时元素与类型会错乱。
    - **P1 预览≠打印（3 处）**：① editor 编辑预览文本补「label：」前缀（与 TemplateRenderer 打印端一致）；② 表格属性面板加「打印高度随行数自适应」说明；③ **TemplateRenderer 修复丢弃区间**——非表格元素 y 落在 `[table.y, tableBottom)` 原先直接不渲染（打印无声消失），现归入下方跟随区（normalizedBelow 按 y 排序相对表格底部堆叠）。
    - **P1 属性输入无约束**：`numInputValue()`（空→不写 NaN、越界→clamp 回画布内）用于 x/y/宽/高（canvasW/canvasH 动态边界）、字号/字高、页边距、标签画布尺寸；此前 x=-20 会飞出画布、9999 原样保存、NaN 永久不可点选。
    - **P1 未保存保护**：`useDirtyGuard(tabPath, isDirty)` + water 完成时从 `remote` 构造 cleanSnapshot 基准（不依赖 setState 时序）+ 保存成功 markClean。笔误：水合 effect 的 setTimeout(0) 读 refs 会滞后，基准直接读 remote 构造。
    - **P1 可达性**：画布元素加 `tabIndex`/`role=button`/`aria-label`/`onFocus` 选中/Enter-空格选中（键盘用户此前完全被锁画布外——选择只能鼠标）；17 个图标按钮补 aria-label；4 个自造 toggle 加 `role=switch`+`aria-checked`；画布占位文字 `text-muted-foreground/60`（2.30:1）→ `text-muted-foreground`（4.76:1）。
    - **P2 粉线分离**：吸附参考线 `#ec4899` → `hsl(var(--primary))`（蓝）；打印安全区 `rgba(236,72,153,.35)` → `rgba(245,158,11,.45)`（琥珀）。此前同为 pink-500，拖元素贴近边距分不清"对齐了"还是"踩到不可打印区"。
    - **P2 效率三件套**：① 坐标 HUD（画布右上角显示选中元素 X/Y/尺寸，拖动实时更新）；② **元素图层面板**（左栏字段列表下方，列表点击选中/上下移动调 z 序=数组顺序/删除——重叠元素不再只能删了重加；标签类型隐藏）；③ **画布空白处框选（marquee）**多选。
    - **次要 7 项**：undo 保持选中（快照含 selectedIds，恢复时过滤已删元素 id）；文本输入合并 undo（label 首次击键 snapshot 一次，onBlur 结束，一次编辑=一个 undo）；LabelPreviewOverlay useMemo 失效修复（layout 字面量拆分传 elements+尺寸，依赖稳定）；拖动/缩放 window blur 兜底（Alt-Tab 不残留监听器）；10-11px 微字提升 12px；PageHeader 加「返回列表」按钮+描述文案去 ZPL 黑话；PAPER_MM/PAPER_SIZES 双写不动（跨文件共享耦合风险大于收益，评审已说明）。
    - **附带发现并修复**：**`.dark` 主题变量块在编译产物中丢失**（B 实证：dev 注入与 dist 均无 `.dark{`，加 class 不变色）。根因：Tailwind 3.4 purge/jit 剔除 `@layer base` 内「无 class 语义」的纯变量声明。修复：`:root`/`.dark` 变量块移到 `@tailwind base` 指令之前（顶层规则恒保留），@layer base 只留带 @apply 的规则。已验证 `npx tailwindcss` 提取产物含 `.dark` 块（暗色背景值在内）——**暗色主题此前从未生效过，修复后如未来开 dark 模式才可用**（全站仍无主题切换入口）。
    - 验证：tsc 0、前端 lint 0（5 存量）/后端 lint 0、test:label + test:print + test:permissions 184/184、smoke:mainline 49/49；浏览器实测——类型切换 confirm+undo 回退、dirty guard 注册/保存清除、label 前缀预览一致、图层面板/aria-label/HUD/marquee 就位、标签模板字段面板无 image + 图层隐藏、测试污染已还原（模板 #1 title x=25）。
    - 备注：375px 窄屏仍不可用（属性面板被裁出视口，评审 B 实测 496px 内容 vs 293px 容器）——ERP 主要桌面使用，窄屏适配未排期；dark 修复为「未来可用」非「当前生效」。
37. **2026-08-25 打印表格序号列显隐 + 列顺序可编辑（未提交，工作区）**：
    - 需求：用户要求打印模板表格「序号支持显示/隐藏」+「表格显示顺序可编辑」。
    - **设计**：`tableColumns` 只存业务列（不含序号）；新增 `showIndex?: boolean`（**缺省 true 兼容旧模板**——不写即显示序号，老模板无需数据迁移）。序号列以符号列名 `'#'` 与业务列统一进列宽逻辑（均分/显式宽）。
    - **实现**（纯前端 3 文件）：
      - `types/print-template.ts`：`TemplateElement` 加 `showIndex?`；
      - `TemplateRenderer.tsx` FlowTable：`allCols = showIndex ? ['#', ...cols] : cols`，表头/行/合计 colspan 均按 showIndex 动态（**colspan = (showIndex?1:0) + amount 之前列数**；合计行若 amount 列不存在时 colspan=showIndex+cols.length 也会正确）；
      - `editor.tsx`：① ElementNode 表格预览同口径处理序号列；② 属性面板表格区块重构为三段——「显示序号列」switch、**「表格列（打印顺序）」已选列列表（↑↓ 调序、勾选移除、列宽 mm）**、「添加列」可勾选追加（替代旧的"常量序 checkbox 列表"——旧 UI 勾选顺序决定打印列序但按固定序展示，用户无从知道）。
    - 验证：tsc 0、前端 lint 0（5 存量）；浏览器实测——序号隐藏后表头=「商品编码/商品名称/单位/数量」无序号列、名次调序「商品名称」上移后预览列序=商品名称→商品编码（渲染端与面板同步）；测试数据已还原（模板 #1 删 showIndex、列顺序回种子 [code,name,unit,qty,price,amount]）。
    - 兼容性：老布局 `tableColumns` 无 `#`、无 `showIndex` → 序号默认显示（行为不变）；只剩 UI 从"常量序勾选"改"打印顺序列表"，模板数据零改动。
38. **2026-08-25 打印模板编辑器画布自适应缩放（修复「属性面板挡住画布」，未提交，工作区）**：
    - 用户反馈：窄视口（~1179px）下编辑 A4 模板时，图纸 1050px 装不进画布列（~649px），macOS 滚动条隐藏看不到横向滚动，右侧表格（金额列）被裁 —— 表现为「属性面板挡住画布」。
    - **根因**：画布列 `flex-1` 被挤压（属性面板 w-60 + 字段面板 w-52 固定），图纸 `mx-auto` 在宽内容超出时左对齐，超出部分被 `overflow` 裁掉且无滚动提示。
    - **修复**（editor.tsx）：
      - **自动 fit**：ResizeObserver + window resize 兜底监听画布列宽，未手动缩放时把 `editorZoom` 双向对齐 fitZoom（A4 @100% 1050px 装不下则缩到整图可见；装得下且此前被压小则恢复 100%）。
      - **手动缩放优先**：缩放 ±/重置按钮设 `manualZoomRef=true`，后续窗口变化不干预手动态；「适应」（新增按钮）重置 manual 并重新 fit。
      - 副作用验证：画布内元素坐标（mm）不受 zoom 影响（zoom 只是显示换算），拖拽/吸附/参考线/HUD 全部随 canvasScale 正确联动（沿用原 zoom 语义）。
    - 验证：1179px 截图整 A4（标题+明细表+合计）完整可见；1000px 自动 40%；1600px 自动 97%（双向 fit）；手动 zoom 后 resize 不干预（107% 保持）；「适应」一键恢复。tsc 0 / lint 0（5 存量）。
39. **2026-08-25 打印表格列宽画布拖拽（未提交，工作区）**：
    - 需求：用户要求「表格支持按列编辑，可手动拖动列宽」。
    - **实现**（editor.tsx，纯前端）：
      - 选中表格元素时，表头每个列分隔线渲染拖拽手柄（`cursor-col-resize`，hover 高亮，aria-label「调整列宽」）；
      - 拖动换算：`dxPx / canvasScale` → mm，写入 `tableColumnWidths[colKey]`（3mm 下限、不超表总宽），与属性面板数字输入、打印端 FlowTable 同一口径（显式宽优先、未知列均分剩余）；
      - 复用既有拖拽模式：snapshot（拖动首移一次 undo）、window blur 兜底清理监听器。
    - 验证：模拟拖动商品编码 +50px → 列宽写入 8mm 且属性面板同步显示；预览表头宽度 商品编码 189px / 商品名称 87px / 其余 137px（均分）；序号列含在内。测试数据已还原（清除 tableColumnWidths）。
    - 说明：列宽 0/空 = 均分（沿用既有语义）；删除显式列宽回均分在属性面板输入框清空即可。

40. **2026-08-26 系统品牌与公司 Logo 双区分工（未提交，工作区）**：
    - 需求：用户指出昨天（第 34 节）上传 Logo 后「分不清是系统本身的 Logo 还是使用者公司的 Logo」——一个公司 Logo 会把登录页/顶栏上的极序品牌整个替换掉。经确认采用**双区品牌**：产品门面位恒为系统品牌（极序 Flow），客户内场位显示公司 Logo。
    - **品牌位归属**：
      | 品牌位 | 系统品牌（极序） | 公司 Logo（上传） |
      |--------|------------------|-------------------|
      | ERP 登录页 | ✓（固定） | — |
      | PDA 登录页/首页 | ✓（固定） | — |
      | ERP 顶栏 | 回退文字 | ✓（优先） |
      | 打印单据模板（image 元素） | — | ✓ |
    - **实现**（纯前端）：
      - 新组件 `components/shared/SystemBrand.tsx`：内置「Layers 图标 + 品牌色圆角色块」回退同款，**零接口请求、零 React Query**（登录页未登录态不发任何请求）；props 与 BrandLogo 的 box/icon/hideFallbackIcon 同构。
      - 登录页两处（桌面品牌区 + 移动 Logo）、PDA 登录页（h-14 圆角盒）、PDA 首页（hideFallbackIcon 只留极序文字）4 处从 BrandLogo 换为 SystemBrand；AppLayout 顶栏仍用 BrandLogo（公司 Logo 优先，无则回退「极序 Flow」文字）——这是公司 Logo 唯一保留的 UI 品牌位，其余为打印模板 image 元素。
      - 设置页「品牌标识」卡拆两段：①系统品牌（极序 Flow，内置不可改，只读说明「不随公司 Logo 更换」）②公司 Logo（文案明确作用范围 = ERP 顶栏 + 打印单据模板，未上传时回退极序）。
    - **安全豁免不变**：`GET /api/settings/logo`/`/logo/image` 仍须公开——消费方全为 `<img src>`（ERP 顶栏、设置页预览、打印模板），无 Bearer 可带；「登录页要显示」的旧理由已不成立，routes 注释与第 12/18 节措辞已同步改为 `<img>` 场景理由。
    - **CORP 修复（2026-08-26，v0.6.0 已带 Logo 功能但桌面端不显示）**：Electron file:// 页面 origin=null，`<img>` 加载 https 生产 API 的 Logo 图片流被 Helmet 默认的 `Cross-Origin-Resource-Policy: same-origin` 拦截（浏览器同源页不受影响 =「浏览器显示、桌面端不显示」）。元数据接口走 fetch/axios 可靠 CORS 反射协商，图片 `<img>` 无协商余地。修复：routes 层对这两个公开路由 `res.removeHeader('Cross-Origin-Resource-Policy')`（已公开、只回图片字节，去 CORP 无安全损失）。file:// 实测：生产修复前 img naturalWidth=0 / 修复后本机 200 + naturalWidth=1。
    - 改动文件：`SystemBrand.tsx`（新）、`login/index.tsx`、`pda/login.tsx`、`pda/index.tsx`、`layouts/AppLayout.tsx`、`pages/settings/index.tsx`、`BrandLogo.tsx`（文件头注释）、`settings.routes.js`（注释）、CLAUDE.md。
    - 验证：前端 lint 0 error（5 warnings 存量 react-refresh）/tsc 0 错误。
    - 明确不做：系统 Logo 上传入口（产品方定制部署用，当前无此场景含 landing——landing 是极序对外官网，不属本产品品牌位）；迁移 219（无需变更数据库，纯前端分工）。

41. **2026-08-26 前端专业名词简化（作业类，未提交，工作区）**：
    - 需求：用户反馈「前端显示专业名词」难看懂，指明简化面向作业人员的文案。经确认采用**作业类全改**：仓库员工作业词换大白话，分拣/复核/调拨/上架等一线熟悉词保留，管理会计黑话（帕累托/ABC）也顺带简化。
    - **术语映射**（34 文件、199 处脚本替换 + ABC 页手改）：
      | 旧词 | 新词 | 范围 |
      |------|------|------|
      | 波次（拣货/效率/明细/详情…） | 批次 | picking-waves、wave-performance、barcode-print-query、warehouse-ops、landing、type/barcode 注释 |
      | 呆滞（库存/处置/商品/告警…） | 滞销 | disposal、inventory-aging、approvals、ListWidgets、landing、permission 标签 |
      | 请购（单/明细/数量/审批…） | 采购申请 | purchase-requisitions、replenishment、approvals、landing、permission 标签 |
      | 库龄（明细/平均） | 存放时长 | inventory-aging、InventoryAgingQueryDialog、profit-analysis 跳转、routeRegistry |
      | 覆盖率 / 盘点覆盖率 | 按期盘点率 | abc.tsx、types/stockcheck |
      | 循环盘（规则）/ 循环抽盘 / 抽盘 | 分批盘点（规则） | abc.tsx、stockcheck/index、permission 标签 |
      | ABC 分类 / ABC 类别 / 帕累托 | 商品分档 / 档位 / 按出库金额 | abc.tsx（含 ABC_HINT→「卖得快盘得勤」）、stockcheck/index |
    - **保留**：前端权限码、后端 permissions.js 的 code、查询键（abc-classes/cycle-rules）、类型字段（abcClass）、`picking-waves` 路由路径（改路径要动后端+数据库+门禁，收益低）——只改展示层文案，标识符零变动。
    - **同步**：`scripts/smoke-pages.node.js` 三处标题断言（批次效率/存放时长与滞销/批次拣货）——门禁断言的是页面标题，改文案必须同步，否则发布门禁卡死。
    - 验证：tsc 0 错误、前端 lint 0 error（5 存量）、test:permissions 184/184（label 不在比对范围，code 未动）、test:print 15 项通过；浏览器实测——ABC 页（标题/三 tab/筛选器全换）+ 批次拣货页（无「波次」残留）。
    - 明确不做：后端/数据库字段（avg_cost/comment 等注释里的旧词保留——那是开发文档不是用户文案）；landing 官网「波次拣货」已在映射内（landing 也是产品文案）。

42. **2026-08-26 打印模板表格「名称后附加信息」（已随 v0.7.1 发布）**：
    - 需求：A4 单据模板（销售/采购/出库/仓库任务单）表格中，把颜色/规格/单位/货号**拼接在商品名称后**（如「商品A [黑色] [500g/件] [件] [JH-1001]」），不再作为独立列。
    - **设计**：`TemplateElement` 新增 `nameAttrs?: string[]`（勾选的字段 key，顺序即拼接顺序）；仅当 `tableColumns` 含 `name` 时生效；旧模板缺省 = 不拼接（行为零变化，无需数据迁移）。layout_json 是 MySQL JSON 列原样存取，无字段过滤。
    - **实现**（纯前端 3 文件）：
      - `types/print-template.ts`：`TemplateElement.nameAttrs?: string[]`；
      - `TemplateRenderer.tsx`：`FlowTable` 名称列单元格改走 `nameValue(el, item)`（名称 + 勾选字段 `[值]` 拼接，空值跳过）；辅助 `nameAttrValue`（spec/color/unit/articleNo/code 取值，与 `colValue` 同口径）；
      - `editor.tsx`：属性面板表格区块加「名称后附加信息」chip 组（颜色/规格/单位/货号，`role="checkbox"`）；画布表格预览的数据行同口径拼接（`DOC_PREVIEW_ITEMS` 的 key 与 nameAttr 一致）。
    - **前置**：`orderPrintData.ts` 各单据映射已带 `articleNumber/spec/color/unit`（无需改动）；`printFieldDefs` 的 `TABLE_COLUMN_OPTIONS` 已有这四个列选项（chip 标签复用）。
    - 验证：tsc 0 错误、lint 0 error（5 存量）、test:print 15 项 + test:label 5 例通过；浏览器实测——选中销售订单模板表格元素 → 属性面板出现 chip 组 → 勾四项后画布预览「商品A [500g/件] [黑色] [件] [JH-1001]」→ 取消勾选还原（模板数据未改）。
    - 明确不做：标签模板（type 5-10，ZPL）不适用（表格只有单据画布类型）；nameAttrs 的 GUI 只保留颜色/规格/单位/货号四个常用字段（`articleNo` 对应货号；如需更多可扩展 chip 组，渲染器 `nameAttrValue` 已兜底任意 key）。
    - **标签订正（同日，用户点出「商品资料没有规格却缺型号」）**：全站 `spec` 字段语义统一是「型号」——商品资料页列/表单（「型号 *」必填）、商品选择器、销售/采购/调拨/改价/处置/ABC、后端 zod（`'型号不能为空'`）、089 迁移注释全是「型号」；唯独打印模板 3 处标签 + 079 种子模板误标「规格」（004 建表文本 COMMENT '规格' 是历史遗留，列语义以 089 后订正为准）。修复：`printFieldDefs.ts`/`TemplateRenderer.tsx`/`editor.tsx`/`nameAttrs` 注释 4 处「规格」→「型号」；**迁移 219**（`219_print_spec_label_rename.sql`）订正已入库 layout_json 中 `fieldKey='spec' AND label='规格'` 的元素（JSON_TABLE 保序重组 + JSON_SET 覆盖 label，幂等），本机实测 affectedRows=1 → 残留 0、元素顺序不变。

43. **2026-08-26 bump-version.sh 幂等性修复（已提交，随下次发版生效）**：
    - 背景：`skills/release-flowcube/scripts/bump-version.sh` 对 PDA `versionCode` 无条件 +1——v0.7.0 与 v0.7.1 **连续两次**因「写 notes 后按提示重跑脚本」导致 versionCode 重复递增（99→100→101），均需手工修正回正确值。风险：version.json 与 build.gradle 不一致、PDA 端跳过版本、CI 重复构建。
    - **修复**（bump-version.sh）：① 幂等核心——只有 `versionName` 真变化（新版本）才 `versionCode +1`，同版本重跑保持不动并打印提示；② `publishedAt` 只随真换版本刷新（同版本重跑不虚更新日期）；③ 正则锚定 `defaultConfig` 块（防误匹配块外同名字段）；④ 版本/编号合法性校验（缺失即报错，不再静默）。
    - 测试两场景全过：同版本重跑 ×2 → versionCode 与 publishedAt 均不变；真换版本 0.7.1→0.7.2 → versionCode 100→101、publishedAt 刷新、三端 package.json 一致。
    - SKILL.md 已同步：写明「脚本幂等；推荐先写 notes 再 bump，顺序颠倒重跑也安全」。
    - **2026-08-27 发版实测又修一个静默漏改**：`replaceInDefault` 用最初读取的 `defaultConfig` 快照做两次替换——第一次替换 versionCode 改变文件内容后，第二次拿旧快照 replace versionName 找不到匹配、**静默返回原文本**（versionName 停在旧版、versionCode 已 +1，无任何报错；v0.7.2 bump 时初版脚本正是这样漏改了 build.gradle 的 versionName）。修复：每次替换**重新锚定** defaultConfig 块；`after === before` 是正常幂等路径（同版本重跑的恒等替换）不抛错，真正的「未匹配」由锚定正则 null 捕获；写盘前对「发生了替换的字段」做落盘校验。**再改这个脚本时记住：任何对文件内容的二次操作都不能基于第一次读取的快照。**

44. **2026-08-27 PDA 绑定页相机扫码修复（`BarcodeScanner.scan()` → `startScan()`，已随 v0.7.2 发布，提交 `f035853`）**：
    - 背景：用户反馈「绑定密钥点击扫描还是无法调用系统摄像头」。上一版（第 14 节，v0.7.0 引入）用 `BarcodeScanner.scan()`，8.1.0 里该 API 路由到 **GMS Code Scanner 一键式界面**：要求设备有 Google Play Services 且预装 GMS 扫码模块，模块不可用直接 reject —— 工业 PDA 大多无 Play Services，且与项目声明的 ML Kit 本地模型（unbundled `barcode_ui`）形态不对接（`deployment` 是 16.1.0 的 docs 老路径，8.x 的 16.1.2 AAR 就不内置模型了，17.3.0 才带 `assets/mlkit_barcode_models/*.tflite`——本项目解析的正是 17.3.0，AAR 内容已实测：内置 3 个 tflite 模型）。`isSupported()` 只查硬件特性，真机无前置相机也会失败（后端 16/17 摄像头另有 8.x 弃用但本机有）。
    - **修复**（`useCameraScanner.ts` + `pages/pda/bind.tsx` + `layouts/PdaLayout.tsx` + `index.css`，全前端）：
      - hook 改调**插件自带 CameraX 连续扫描 `startScan({ formats: [QrCode] })`**（ML Kit 本地解码，无 GMS 依赖），`barcodesScanned` 事件驱动 → 调 `onResult`；扫描保持打开（补扫不重开相机），调用方 `close()` 停止。
      - 取景机制：插件把原生预览塞进 WebView 底层的兄弟视图，靠 WebView 背景透明透出 —— 而页面上 body/PdaLayout 根/绑定页主内容全都是不透明背景，原生画面即使开了也被整个盖住（「点了按钮什么也没发生」的第二层原因）。修复：**扫描期间绑定页整体让位**（`open` 时只渲染透明根 `CameraOverlay` 浮层，主内容全退出），CSS 加 `body.barcode-scanner-active`（`background: transparent !important` 作用于 body 与 `.pda-root`），PdaLayout 根容器补 `pda-root` 类。
      - CameraOverlay 是 JSX 组件，放 `.ts` 的 hook 文件会解析错误，移到 `bind.tsx` 本地组件（本项目 react-refresh warning 存量原因即组件+函数同文件，照此惯例）。
    - 验证：前端 lint 0 error（5 存量 warning）、tsc 0 错误、`build:pda` 生产构建通过、Android 依赖树解析正常（`com.google.mlkit:barcode-scanning:17.3.0` 已含）。**需重新构建 APK 并安装才能生效**（`Capacitor.isNativePlatform()` 为假则 hook 恒不可用，浏览器 dev 无法验证——这是纯原生行为，验证方式=真机装新 APK 点「相机扫码」）。
    - 边界（未做）：`scan()` 的 GMS 路径与 `isGoogleBarcodeScannerModuleAvailable`/模块安装没做（工业 PDA 无 Play Services，走不上）；`startScan` 无「扫到即停」语义，一次扫码即回调但相机保持开——绑定完成后 `close()` 已停；权限：系统弹窗拒绝后需去设置手动开（浮层文案已提示）。**下次把这个功能挂到 PDA 其它作业页（如收货）时，记得也要处理取景期背景透明的整页让位，并给相机加权限引导。**

45. **2026-08-27 系统时间强制北京时间（前后端全链固化，已随 v0.7.2 发布，提交 `f035853`）**：
    - 需求：用户要求「把系统时间改为北京时间」——不是显示层改一改，而是全系统业务时间唯一权威时区 == +08:00，任何环节（DB 默认值、服务进程、前端设备时区）都不再影响业务日期/时间的正确性。范围=**业务时间**（日期流水、账款到期日、报表口径、显示），不强制物理时间戳格式。
    - **根因清单**（5 类）：
      - ① MySQL 官方镜像默认 UTC：`NOW()`/`CURRENT_TIMESTAMP` 生成的 created_at 与连接池 `timezone=+08:00` 差 8 小时；
      - ② mysql2 连接池 timezone **读写均生效**：写把 Date 序列化成北京字面量；读把 DATETIME 拼 +08:00 解析（时间轴正确）、把 DATE 解析成「北京午夜」——**`toISOString().slice(0,10)` 在 +08 下回退一天**（dashboard/报表/reports.metrics 的 daily 序列/payment-aging/hr/procurement 6+ 处同类 bug）；
      - ③ 后端进程 `TZ` 未显式设置：Node 的 `getFullYear/getHours` 依赖宿主时区，本地开发无影响但容器/CI 不可控；
      - ④ 前端 `formatDisplayDateTime/formatDisplayDate/todayYmd` 用宿主本地字段：用户设备改时区（出差、PDA 设置恶意篡改）即显示错位；
      - ⑤ 无时区后缀日期字符串（'YYYY-MM-DD HH:mm:ss'）被 V8 原生 parse 按**宿主时区**解释。
    - **修复**：
      - **MySQL**（docker/my.cnf）：`default-time-zone = '+08:00'`——偏移量格式不查 time_zone 表，任何 MySQL 都支持；`NOW()`/`CURRENT_TIMESTAMP` 默认值直接生成北京时间字面量（本机实测）。docker-compose.yml 给 mysql 服务加 `TZ: Asia/Shanghai`（system_time_zone 与日志显示）。
      - **server-update.sh**：`docker compose up -d --build backend frontend` 之后、migrate 之前追加 `docker compose up -d --no-build mysql`——mysql 容器不在重建列表里，但 my.cnf 挂载/TZ 变更要重建容器进程才生效；数据卷不动、只重启进程，无停机迁移。
      - **后端**（Dockerfile.backend + compose）：容器 `ENV TZ=Asia/Shanghai` 并安装 tzdata；新增 `utils/backendTime.js`（`beijingTodayYmd` / `beijingYmdAddDays`，+8h 偏移 + UTC 字段法，纯 Offset 无 TZ 依赖）。后端「今天/当前月」计算全部改走它：dashboard、payment-aging、reports.query（pda-performance、warehouse-ops、KPI 3 处默认期间）、inventory.procurement、hr.payPayroll、scheduler（循环盘/钉钉预警/库存漂移 3 个 worker 的去重日期）、codeGenerator.generateDailyCode（单号日期流水）、pda-devices.generateDeviceCode（设备码日期）、accounting.period（当前期间）、finance-accounts/expense-claims/refund-orders（happenedAt 默认今天）、finance-dashboard（近 6 月区间）、excelExport（打印日期）、export.service（文件名日期戳）、settings（logo 缓存时间戳）、logger（日志时间戳）。
      - **前端**（`lib/dateTime.ts` 重写）：`toDate` 三种输入统一——Date 原样、数字毫秒、**无时区字符串按 +08:00 显式解析（−8h 得绝对时刻，不再交给宿主时区 parse）**、带 Z/±HH:MM 自含偏移原样 parse；`formatDisplayDateTime/formatDisplayDate/todayYmd` 与新增 `beijingHour()` 全部走 `beijingFields`（+8h 偏移 + getUTC* 字段）。PDA 首页问候语（`pages/pda/index.tsx`）改用 `beijingHour()`（此前 `new Date().getHours()` 依赖设备时区）。
    - **验证**：
      - 边界模拟：`TZ=UTC/America-Los_Angeles/Asia/Shanghai` 三种宿主下跑前端工具 11 用例全过（UTC 16:30 = 北京次日 00:30、无时区字符串 18:30:00 → 18:30、带 +05:00/−07:00 偏移、仅日期 → 北京零点、非法回退）；`TZ=UTC` 下 backendTime 输出 2026-08-27（+7 天 09-03）与上海时区一致；logger 时间戳在 TZ=UTC 与 Asia/Shanghai 下输出完全一致。
      - 实测：smoke:mainline 49、smoke:finance 103、smoke:accounting 11、smoke:accounting-period 14、smoke:refund-orders 14、smoke:reports 11 项全绿、test:integration 96、test:permissions 184/184；两端 lint 0 error（前端 5 存量 warning）、前端 tsc 0 错误、`build:pda` 通过；浏览器实测 PDA 首页问候语与时钟（本机 +08 下 18:11 /「晚上好」与 Node 计算的北京时间一致）。
    - **边界**：①「存库格式」不变——DATETIME 列存的仍是北京字面量（与连接池读写字面量一致），无迁移、无数据改写；② mysql 容器重建只发生在下次 server-update 部署——**本次改动需发版生效**，发版时该行会滚动重建 mysql（唯一一次容器重启，数据卷不动）；③ 物理时间戳（`toISOString`/epoch）语义不变，只改「按本地字段取日期」的地方；④ 前端「无时区字符串按北京解析」要求后端输出与解析互为逆映射——已有后端全链 +08:00 背书；⑤ landing 官网不属业务时间，未动。

46. **2026-08-28 钉钉经营预警「查看」链接无效（已随 v0.7.3 发布，提交 `4092fc1`/`a1e580e`）**：
    - 需求：用户反馈预警推送（1 笔应付逾期/4 笔应收逾期/100 项呆滞）点「查看」——电脑端无反应、手机端打开网页显示无法连接。
    - **根因**：`scheduler.js` 的 dingtalk-alert worker 把 `notifications.service.buildNotifications` 的 `t.path`（相对路径，如 `/payments/payable`）直接写进钉钉 markdown 链接（`[查看](${t.path})`）。钉钉客户端只认绝对 http(s) URL，相对路径被解析到钉钉自己域下成为死链。且前端是 **HashRouter**，即使拼域也要 `/#` 前缀（`https://jixuflow.com/#/payments/payable` 才可点）。
    - **修复**（仅 `backend/src/scheduler.js`）：本地拼 `alertLink(path)`——`APP_PUBLIC_URL`（生产必填，config/env.js 校验）+ `/#` + path；未配置时降级为原相对路径（本地 dev 不影响）。**注意哈：钉钉/短信等站外链接一律要拼绝对 URL + HashRouter 前缀，不要再直接写相对 path。**
    - 验证：node 直测 7 例（含带查询串/尾斜杠/空 path）+ mainline 49/49 + 后端 lint 0。
    - 说明：桌面端/PDA 此版无功能变化，仅随版本号同步（三端 0.7.3，PDA versionCode 102）。
47. **2026-08-29 销售占库改为「按产品/按数量」+ 新增「部分占库」状态 + 占库期改单（已随 v0.7.5 发布，提交 `a87514b`/`9185a6c`）**：
    - **按产品/按数量占库（迁移 220）**：`sale_order_items` 新增 `reserved_qty`（已占）、`dispatched_qty`（已派发），取代布尔 `dispatched`（列保留兼容）。占库弹窗支持勾选产品 + 填本次占库数量（需求 100 可占 60）；`reserveStock` 不传 items = 占满未占余量（向后兼容）。占完统计全满→`已占库(2)`、否则→新增状态 **6「部分占库」**。发货只发 `reserved_qty - dispatched_qty` 差额，一行可多次「补占→发货」。释放支持按产品/数量（`releaseStock(items:[{id,qty}])`）或整单。授信在途敞口纳入状态 6。`StockShortageDialog` 移除「按可用量改单并重新占库」一键操作（改为引导回占库弹窗调数量）。
    - **占库期改单**：`requestAdjustment` 无 `task_id`（状态 2/6）时走新分支 `adjustReservedWithinTransaction`——保留已占量（改数量时夹到新数量、删商品释放预占、加商品占 0），重建明细后重算状态 2/6。状态 3（有任务）仍走原执行期改单。多仓、已发货订单明细仍锁定。
    - **回款状态改造（本轮先做）**：列表「回款状态」列独立于订单状态，读应收快照 + 结算方式（未出库回退客户主数据）。决策表：已付清绿/部分付蓝/未付未逾期（现结灰「未付」、月结蓝「月结」）/逾期（月结红「逾期」、现结红「未付」）。逾期边界统一为「到期日 < 北京今天」（当天不算逾期），对账页 `isOverdue` 与后端 `receivableOverdue` 同步改（后端此前 `new Date(due_date).getTime() < Date.now()` 会把当天从凌晨误判逾期）。
    - **发现的脏数据**：生产库与本地库均有孤儿 `payment_records`（`order_id` 错配到新订单、`order_no` 指向不存在的旧单号，如生产 `SO20260827001` 草稿单被 `order_no=SO20260314002` 的应收记录污染显示「逾期」）。**待清理**（零 `payment_entries` 分录，删除无副作用，属删数据操作需用户确认）。
    - 验证：tsc 0、两端 lint 0 error、迁移 220 本机实跑回填正确、smoke mainline 49/concurrency 83/p0 41/p1 44/adjust 57/integration 96 全绿；真实 API 闭环——部分占6→状态6、补占→状态2、按产品释放3→状态6、整单释放→状态1、发货只发已占(需求10占6发货→任务 required_qty=6)、占库期改单（数量减少夹已占量/删商品释放/加商品占0）全通过。

48. **2026-08-30 交付前审查修复（未提交，工作区）**：5 路多智能体扫描（安全/库存财务正确性/前端质量/依赖部署）交付前排查，发现并修复以下问题：
    - **P0-1 占库/释放/发货幂等键缺失（高危，已修复）**：v0.7.5 改「按数量占库」后 `reserved_qty = reserved_qty + ?` 是累加语义，但 `reserveStock`/`releaseStock`/`ship` 三接口均未接 `beginOperationRequest`（对比 `sale.create`/`sale.adjust` 有）。断网重试/连点会二次累加 reserved_qty（需求 100 占 50，重试再占 50→100）。修复：三 service 补 `beginOperationRequest`（action `sale.reserve`/`sale.release`/`sale.ship`），controller 传 `requestKey:extractRequestKey(req)`，前端 `useSale.ts` 三个 hook 加 `keyRef` 稳定幂等键（成功后轮换）、`api/sale.ts` 三接口带 `withRequestKeyHeaders`。
    - **P0-2 改单缺重复行校验（中高，已修复）**：`requestAdjustment` 两个分支都未调 `assertNoDuplicateSaleItemLines`（create/update 有），重复商品行（同 product+warehouse）会让 `adjustReservedWithinTransaction` 逐行 INSERT 各 `min(旧占,新数量)` 合计放大 reserved_qty、与 `stock_reservations` 失配。修复：`requestAdjustment` 入口统一补一行校验。
    - **P0-3 释放接口无参数校验 + items 重复 id 绕过数量校验（中，已修复）**：release 路由连 `validateBody` 都没有；reserve/release 循环用 `itemById` 快照读 reserved_qty，items 含重复 id 时校验被绕过超占/超释。修复：新增 `releaseSchema`（id 正整 + qty 正数）+ 路由挂 `validateBody`；reserve/release 循环内加 `processedById` 累计已占/已释量，逐项校验。
    - **P0-4 取消部分发货结案未收缩新列（中，已修复）**：cancel 的「已发部分保留」分支只 `UPDATE quantity,amount`，迁移 220 新增的 `reserved_qty`/`dispatched_qty` 未同步收缩，结案单残留 `reserved_qty=100 > quantity=60`。修复：UPDATE 补 `reserved_qty=?, dispatched_qty=?`（= shipped）。
    - **P1-1 refresh token「一次性轮换」（高危，已彻底修复）**：此前 `refreshVersion` 字段写入后从未被读取校验，旧 refresh 在 30 天有效期内可无限续期。**修复（迁移 221）**：新增 `refresh_token_sessions` 表（jti/user_id/expires_at/revoked_at）；login 与 refresh 签发 refresh 时携带 `jti`（`crypto.randomUUID`）并落库；`refreshAccessToken` 在事务内先 `UPDATE ... SET revoked_at=NOW() WHERE jti=? AND revoked_at IS NULL`（affectedRows=0 即重放 → 拒 `AUTH_REFRESH_REPLAY`）再签发新 jti——**每端独立 jti，不互踢多端**（token_version 仍是三端共享，改密码/禁用才递增）。新增 `POST /api/auth/logout` 作废当前 refresh；前端 `performSessionLogout` fire-and-forget 调 logout；scheduler 加 `refresh-session-cleanup` worker 清理过期/已作废会话。**存量无 jti 的 refresh token**（迁移前签发）：`decoded.jti` 为空时跳过作废、直接放行并补录新会话，升级无感（旧 token 到期后自然淘汰）。验证：端到端实测「首次刷新成功 → 旧 refresh 重放被拒 AUTH_REFRESH_REPLAY → 新旧 jti 不同」，users-roles 8 全绿、mainline 49、integration 96 全绿。
    - **P1-2 前端时区残留（中，已修复）**：9 处 `new Date().toISOString().slice(0,10)` 当「今天」默认值（财务日期口径，北京凌晨 0-8 点/非 +08 设备会回退一天），与第 45 节「全链固化」矛盾。修复：统一改 `todayYmd()`（ReceiptFormDialog/usePaymentActions/invoices/vouchers/fixed-assets/refunds），`pda/inventory-query.tsx` 自造 `formatDate` 改 `formatDisplayDate`。`ReconciliationView.tsx:56` 那处本来就是注释、已用 `todayYmd()` 正确比较。
    - **P1-3 Excel 导出公式注入（假阳性，未改）**：实测 exceljs 把 `=SUM(1,1)`/`+cmd`/`-2+3`/`@import` 存为 `<t>` 共享字符串（`cell.type===3`、`cell.formula` undefined），xlsx 中无 `<f>` 公式节点——Excel 打开显示纯文本不求值。公式注入是 CSV 纯文本的特有风险，本项目导出全部走 exceljs 生成结构化 xlsx，无 CSV 导出路径（CSV 仅用于 import 读取）。**不需要修复**。
    - **P1-4 CI 安全扫描不拦 main 部署（中，已修复）**：`security-scan.yml` 的「Fail on high+critical」步骤带 `if: github.event_name == 'pull_request'`，push main 只写 summary 不 fail。修复：去掉 PR 限制，但**只拦 `isDirect===true` 的高危**（后端有 exceljs→glob→brace-expansion 不可达的传递依赖 high，若全量拦会每次卡死部署）。
    - **Node 20 EOL（高危，已修复）**：Node 20 LTS 已于 2026-04-30 停止安全维护。修复：`Dockerfile.backend`/`Dockerfile.frontend` 与 4 个 workflow（test/security-scan/build-pda-apk/build-desktop）的 `node-version` 全部 20→22。
    - **依赖滞后（2026-08-30 复核，结论修正：实际不落后）**：先前扫描见 22 个 dependabot 分支便报「滞后」，经核对三个 lock 文件实际锁定版本，后端 express 已锁 4.22.2、mysql2 3.18.2、helmet 8.1.0、dotenv 16.6.1——生产 `npm ci`（读 lock）装的就是这些新版本，`package.json` 声明（`^4.21.2` 等）落后只是「声明没跟上 lock」，不影响部署。**真正有 audit 告警的只有前端 react-router 2 条 moderate（6→7 修复，`react-router-dom@7.18.3`，isSemVerMajor）**。其余 dependabot 分支（zod 4、vite 8、eslint 10、bcryptjs 3、electron-builder 26、capacitor 8.3）均为版本更新而非安全修复，且无 audit 告警。**结论：依赖无紧急项，breaking 升级（react-router 7 + 上述）整体留交付后单独排期**；不强行改 package.json 声明版本（改了会导致 `npm ci` 因声明与 lock 不同步而失败，需重跑 npm install 引入依赖树漂移，收益为零）。
    - **财务导出仓库 scope（2026-08-30 已确认：公司级可见，不收紧）**：用户明确「限仓」语义 = 只在该仓库作业、财务是公司级可见。故账款/收付款/对账/账龄导出**保持现状**（`payment_records` 表本就无 warehouse_id，列表接口也不做仓库 scope，导出与列表同口径）。唯一越权是**波次导出**（picking-waves 列表做了 warehouse scope、导出漏传 scopeWarehouseIds），已修复。
    - **低危项（2026-08-30 续修，已修复）**：`usePdaFeedback` 的 timerRef 补 unmount cleanup（flash 期间卸载残留 setTimeout 会触发已卸载组件 setState）；`WarehouseScopeDialog` 的 `pageSize: 999` 收敛为 500（与全站 finder 上限一致）。`printers/index.tsx` 5 处 `onError: (e: any)` 与 `labelGeometry.ts` 5 处 `layout: any` 属风格问题、功能正确，按「风格问题两边都不管」跳过未改。
    - 验证：后端 lint 0、前端 lint 0 error（5 存量 warning）/tsc 0、test:permissions 184/184、smoke mainline 49/sale-adjustment 57/concurrency 83/p0 41/p1 44/integration 96 全绿。

49. **2026-08-30 第二轮深度审计（7 维度并行，发现并修复 ~30 项，未提交）**：用户指出首轮扫描过快，本轮按 7 个维度深度扫描（并发事务/财务会计/安全/数据完整性/前端PDA/SQL性能/业务规则），逐条读代码验证，产出远超首轮的实质问题。修复清单：
    - **P0 工资发放凭证借贷不平（已修复）**：`hr.service.js` 发放凭证借方 221101 误用 `gross`，个人社保已在③转出，借贷差 = sp，有社保账套下 `assertBalanced` 抛错工资发不了。修复：借方改 `net + tax`。
    - **高危**：
      - 多账套建账复制科目 `parent_id` 未重映射（`companies.service.js`）：新账套子科目指向主账套 id，科目树平铺、试算平衡一级科目恒 0。修复：复制后按「主账套父科目 code → 新账套同 code 科目」UPDATE 重定向。
      - 销售列表「继续发货」读废弃布尔列 `dispatched`（`sale.service.js:518` 用 `dispatched=0`，与 findById 的 `dispatched_qty<reserved_qty` 不一致）。修复：对齐数量口径。
      - `avg_cost` 跨仓并发丢失更新（`inbound-tasks.putaway.js`）：`globalQty` 无锁快照读且在商品行锁前，两仓同时上架同一商品成本算错。修复：商品行锁提前 + globalQty 用 FOR UPDATE 当前读。
      - warehouse-tasks 四接口 IDOR（`pickSuggestions`/`pickRoute`/`findEvents`/`debugSnapshot` 未传 scope，泄露库位/批次/容器）。修复：controller 传 scope + service 层 assertInScope。
      - 调拨 `scanIn` 锁顺序反了（先锁容器再 syncStock，与上架相反，ABBA 死锁）。修复：先 lockStockDimension 再锁容器。
    - **中危（财务会计）**：报税月末硬编码 `-31`（`accounting.tax.service.js`，2/4/6/9/11 月税数据为空）改复用 `periodRange`；无源销售退货成本断链（`voucher-engine.js` `LEFT JOIN product_items p ON p.id = soi.product_id` 改 `sri.product_id`，否则 `sale_item_id=null` 时成本不回冲虚增成本）。
    - **中危（安全）**：库位/货架/分拣格/打印机四模块单资源接口补 scope（locations/racks/sorting-bins/printers，全局打印机 warehouse_id NULL 放行）；库存初始化导入校验 warehouseIds（`import.service.js` 逐行 `assertInScope`）；价格表导入错误脱敏（`import.service.js:515` 改与其他导入一致的 AppError 判断）；手动出库 `changeStock` 补 `beginOperationRequest` 幂等（action `inventory.manual-out`）。
    - **中危（业务）**：调拨 scanOut 补数量上限校验（`qty ≤ item.quantity - deducted_qty`，防整箱多搬）；呆滞处置建议量减 `reserved`（`disposal.service.js` getSuggestions 减 inventory_stock.reserved，与 dispose 的 available 口径对齐）。
    - **中危（数据完整性）**：商品软删补 3 张新表引用检查（price_change_requests/demand_forecasts/product_price_history）；pda_error_logs/pda_undo_logs 加 TTL 清理 worker；迁移 222（payment_entries.payment_date 索引 + price_change_requests.request_no 唯一键，information_schema 护栏）。
    - **中危（前端）**：审批通过/驳回补 invalidate `approval-pending`/`dash-pending-approvals`（useInvalidate 的 purchase_approve/reject）；退款执行补 invalidate payments/reconciliation/finance-accounts/finance-dashboard（useRefund）；landing 3 处动画 cleanup（rAF/interval/timeout）；returns/transfer 列表 mutation 补 `.catch` 防 unhandledrejection；PDA pending 登出清理 localStorage。
    - **中危（SQL 性能）**：13 处 `DATE(col)` 废索引改半开区间（payments/reconciliation/transfer/returns×2/finance/inbound-tasks/export×3 + reports 的 scan_logs/pda_error_logs/pda_undo_logs/todayInbound）；warehouse-tasks/inbound-tasks 列表接 normalizePagination（pageSize 无 clamp）。
    - **低危**：固定资产最后一期折旧漏提（`accum + monthly >= totalDepr - 0.01` 提前停 → 改 `accum >= totalDepr - 1e-6` 且最后一期差额计提）；软删补 `AND deleted_at IS NULL`（sale/plastic-boxes/carriers）；refresh 密钥轮换兜底（`refreshAccessToken` 补 JWT_SECRET_PREVIOUS）；CORS 注释补安全提示；DataTable 拖拽补 window blur 兜底。
    - **未改（记录为交付后）**：① 跨月分批发货/收货凭证期间归属——需按「订单+结算批次」拆分 source_id（架构级，仓促改 updated_at 会把首批收入挪到末月）；② `buildNotifications` 串行 25 条 COUNT 改 Promise.all、N+1 循环合并、findMyTaskSkuSummary/findPdaTasks 无 LIMIT——「数据量上来才慢」的优化项，重构风险高于收益；③ 迁移 212 非幂等——已成功执行，按「禁止改已执行迁移」硬约束不改，仅记录；④ JWT 加 aud/iss、勾稽账套维度标注、system_health_logs 死表、useInvalidate 11 死事件——防御性/清理性质，风险收益不划算。
    - 验证：后端 lint 0、前端 lint 0 error / tsc 0、test:permissions 184/184、smoke mainline 49/sale-adjustment 57/concurrency 83/p0 41/finance 103/accounting 11/disposal 27/warehouse-scope 41/integration 96 全绿。

50. **2026-09-01 上线后审查修复（a90348b 提交的 P0 财务账套隔离实际未生效 + 半截改动，已修复）**：
    - **背景**：v0.7.6 发布后的 a90348b 声称"P0 财务账套隔离"，但 5 路多智能体审查（见 audit-post-release）发现：**业务事实表（采购单/销售单/资金流水/账款/退货/盘点/调拨）全部无 company_id——当前系统实际是公司级单账套架构**，只有 acct_* 会计表带账套。在此数据基础上，a90348b 的部分改动要么空转、要么反而破坏勾稽。
    - **P0-1 发票账套隔离未生效（已修）**：迁移 223 给 fin_invoices 加 company_id，但写入端 invoiceCreate/invoiceUpdate 未落该列 → 所有发票恒 NULL；loadTaxMaps 用 `(company_id=? OR company_id IS NULL)`，IS NULL 恒命中 → 过滤退化为全量 → 每个账套重复计税（报税重复计数）。修复：① invoiceCreate 落 company_id（controller 传 companyOf(req)，service 接收 companyId）；② loadTaxMaps 改严格 `company_id = ?`（去 OR IS NULL）；③ **迁移 225** 回填历史 NULL 发票到主账套 1（业务单无账套维度，历史票只能归主账套）。
    - **P0-2 勾稽 fundT 半截改动（已修）**：a90348b 只把 fundT 单边改成按 fa.company_id 过滤，但凭证生成侧 buildFundVouchers 读全量流水、业务表无账套维度 → 账套≠1 时 fundV（含全量流水凭证）与 fundT（过滤后≈0）必不平，且与 getCashFlow/finance-dashboard 全账套口径相悖。修复：撤销 fundT 的账套过滤，恢复公司级全量口径（与凭证生成来源一致）。
    - **P1 前端库存导入 errors 类型不符（已修）**：`ImportStockResult.errors` 声明为 `{row,message}[]`，后端实返 string[] → 页面 map(e=>e.row) 取 undefined 显示"第undefined行"（tsc/lint 不报错，静默错）。修复：改类型为 string[]，页面直接取；importStockApi 补 `skipGlobalError: true` 防拦截器+页面双重 toast。
    - **P2 approvals.service（非本次引入，已顺手加固）**：listPending 的 N+1 优化行为等价（按 biz_type 分组批量查，仅 purchase_requisition 有元数据，其余仍空——与改动前一致）；getBizApproval 加事务正确（引擎不嵌套事务，纯读无死锁）；顺手清理 `applicantCol` 死字段 + `!got` 分支 rollback 改 commit 防双重 rollback。
    - **未改（遵循硬约束）**：迁移 223/224 已应用，按"禁止改已执行迁移"不改正文（224 头注释"finance_account_transactions 添加 company_id"夸大，但正文只给 finance_accounts 加列——已在 225 记录说明，未动 224 正文）；223/224 非幂等已在 225 改用幂等 UPDATE。
    - **验证**：后端 lint 0、前端 lint 0 error / tsc 0、test:accounting 7/7、smoke:accounting 11/11、smoke:finance 103/103、smoke:mainline 49/49、test:permissions 184/184、迁移 225 本机实跑成功。
    - **遗留（架构级，未做）**：真正的按账套隔离需给业务表（payment_records/finance_account_transactions 等）加 company_id + 回填，并给 buildFundVouchers/getCashFlow/finance-dashboard 同步过滤——独立工程。当前以「公司级单账套」为准，勾稽/发票/报税按此口径。

51. **2026-09-01 商品资料「货号」改「供应商型号」+ 取消自动生成（已实现）**：
    - **需求**：原商品资料的「货号」字段（product_items.article_number）只在留空时自动生成 6 位随机数（products.service.create 的 `String(Math.floor(100000+Math.random()*900000))`），无业务含义。真实需求是**系统型号（spec）可能与供应商型号不一致，需单独记录「供应商型号」**。故把 article_number 语义改为「供应商型号」，并取消自动生成（供应商型号由供应商给定、人工填写）。
    - **改动**（不动列名/字段结构，仅改语义 + 展示标签）：
      - 前端展示标签「货号」→「供应商型号」：商品资料表单（form.tsx）、列表（index.tsx）、商品选择器弹窗（ProductFinderModal.tsx）、容器抽屉（ContainerDrawer.tsx）、打印模板字段定义（printFieldDefs.ts 的 articleNo label，key 不变不破坏旧模板）。
      - 后端取消自动生成：products.service.create 的 `generatedArticle = articleNumber || null`（不再随机生成）；import.service 商品导入删「补齐6位/自动生成5开头6位」整段，改 `String(articleNumber||'').trim() || null`，模板表头「货号」→「供应商型号」。
      - **迁移 226**：product_items.article_number COMMENT 改为「供应商型号」。
    - **关键约束**：article_number 被 7 张业务表快照引用（迁移 092/093/095/096/097/099/114）且有历史数据，**列名保持 article_number**（改列名=改全部引用，风险大、收益低）；7 张业务表快照列注释不随动，语义跟随主档。前端类型字段名 articleNumber 不变。
    - **验证**：后端 lint 0、前端 lint 0 error（5 条既有 warning）/tsc 0、test:permissions 184/184、smoke:mainline 49/49、迁移 226 本机实跑成功。

52. **2026-09-01 独立「资金流水」页 + 用户级「允许自行审批」（迁移 227，未提交）**：
    - **背景**：用户反馈「财务报销没有可以选择账户的地方」「没有专用的账户流水页面」。查证：
      ① 报销的付款账户选择器**本来就有**（付款弹窗），但入口是行操作下拉里的「付款」，只在 `status=3(已批准)` 且有 `FINANCE_EXPENSE_PAY` 权限时渲染；而 `expense-claims.service.approve/reject` 硬性禁止「审批自己提交的单」**且无超管豁免** ⇒ 单账号场景下报销单永远卡在待审批，走不到付款，账户选择器永远不出现 —— 这就是「没有看到」。
      ② 账户流水后端能力齐全（`GET /finance/accounts/transactions` 支持全账户 + bizType/direction/日期筛选 + 分页汇总），但前端只有账户管理页的单账户弹窗（写死 `pageSize:200`、无筛选无分页），无独立页面与菜单入口。
      用户确认：**报销页 UI 不动**，改为让流程能走通；后续追加要求——豁免放在**用户管理编辑页**（不是系统设置）且覆盖**全部审批**。
    - **资金流水页 `/finance/transactions`**（财务 → 资金，order 57）：跨账户查询 + 账户/业务类型/收支方向/日期区间/关键字（单号·往来方）筛选 + 分页（PAGE_SIZE 50）+ 收入/支出/净额汇总卡 + 导出。**复用 `FINANCE_ACCOUNT_VIEW` 权限码**（后端该接口本就用它），故未动 permissions.js / permission-codes.ts / seed 迁移（仍是 184 个）。
      - 后端 `findTransactions` 接 `normalizePagination`（此前 pageSize 无 clamp，传 99999 即全表拉取；实测现夹到 500）并新增 `keyword` 过滤。`happened_at` 是 **DATE** 列，起止日期用闭区间即可 —— **别照搬别处的半开区间改造**。
      - 导出 `/export/finance-transactions` 直接写 SQL 而非复用列表 service：后者被 clamp 到 500，导出要 `EXPORT_MAX_ROWS`(10000) 上限（由 `buildExportPayload` 统一截断告警）。
      - **不做仓库 scope**：与账款/收付款/对账同口径（财务公司级可见，见第 48 条），且该表无 warehouse_id。
    - **用户级「允许自行审批」`sys_users.allow_self_approve`（默认 0）**：全仓原有 **5 处**各写一遍的自批内控，现统一收敛到 `utils/selfApprove.js` 的 `assertNotSelfApproval()` / `canSelfApprove()`：
      | 位置 | 原行为 |
      |---|---|
      | `expense-claims.service` approve/reject | 硬拒 |
      | `purchase.service` approve/reject | 硬拒 |
      | `purchase-requisitions.service` approve/reject | 硬拒 |
      | `credit-overrides.service` approve/reject | 硬拒 |
      | `approvalEngine.startApproval` | 提交时把申请人剔出审批人名单，名单空则 400 —— **卡在提交环节，比其他四处更早** |
      - **为什么是用户属性而不是全局开关**（用户决策）：谁能自批是人的属性（老板/单人记账员），不是系统的属性；逐人授予也留下「谁被豁免了内控」的记录。
      - **只有超管能授予**：`users.service.assertCanGrantSelfApprove`（照 `assertCanAssignRole` 先例）——否则持 `user.update` 权限者可自我豁免。**不传该字段 = 保持原值**，普通管理员照常编辑姓名/部门不会被 403 挡住；前端 `UserFormDialog` 也只对超管渲染该开关。
      - 不加缓存：审批是低频动作，且缓存会让「刚收回某人的自批权」延迟生效——内控收紧必须立即生效。
      - 用户列表新增「自行审批」列，只对已开启的账号标 `warning` 徽章。
    - **测试**：`tests/finance.smoke.test.js` 原有两条 ★ 断言（不能自批/自驳，期望 403）因默认关闭而继续成立，未改；末尾新增 5 条覆盖「授予 → 自批成功 → 状态=已批准 → **收回** → 重新被拒」，用 try/finally 保证不污染后续运行，且 realName 动态读回而非硬编码。**改这段时务必保留 finally 的还原**。
    - **验证**：迁移实跑 + 幂等重跑；两端 lint 0 error / tsc 0 / 生产 build 通过；smoke **finance 108**（原 103 + 新 5）/ mainline 49 / accounting 11 / disposal 27 / refund 14 / approval-flow 30 / credit-override 11 / purchase-approval 6 / users-roles 8 / p0 41 / p1 44 / concurrency 83 / integration 96 / permissions 184 全绿。
      - API 实测（资金流水）：全账户 592 条分页正确、pageSize 99999 被夹到 500、bizType=3 筛出 65 条全为报销支出、bizType=5 退货退款 20 条（前端 `AccountTransaction.bizType` 类型此前漏了 5，已补）、关键字搜单号命中、导出 xlsx 65 行与接口 total 一致、**流水页与账户页弹窗两入口同账户数据完全一致**。
      - API 实测（自批）：非超管给自己开开关被拒 `SELF_APPROVE_GRANT_DENIED` 且不影响其普通编辑；报销全链路「授予 → 自批 → 已批准 → **付款选账户** → 出账 → 落入资金流水」跑通；approvalEngine 用「指定审批人=申请人本人」的临时审批流验证——未授予时提交被拒（400 没有可用审批人）、授予后可提交并自己批完（价格生效）。测试数据已清理。
    - **顺带发现的既有缺陷（未修，已挂待办）**：`price-change.service.js:125` 在 `approvalEngine.startApproval` 返回 null（无匹配审批流，引擎的既定语义）时直接读 `inst.instanceId` → 500。与本次改动无关，本机没配 `product_price` 审批流时必现。

53. **2026-09-02 采购订单预计量纳入销售占库（ATP）+ 取消/短装「先解绑」拦截（迁移 228，未提交）**：
    - **需求**：用户要求「采购单提交后，其商品也要能被销售单占用」。现状销售占库只认「已上架实物」（`可用 = ACTIVE 容器合计 − reserved`），采购单提交后仍是预计到货、占不进来。
    - **语义（用户三轮确认）**：① 数值把「在途预计量」算进销售占库可用（**ATP**，到货后按库存现状发，不自动匹配销售单）；② **不自动改销售单**——采购单取消/短装时不静默释放，而是**先解绑拦截**（列出占用它的销售单由人工处理）；③ 粒度——整单取消解绑全部、短装只释放未到货那部分。
    - **实现**：
      - **在途投影**（不缓存，决策时现算）：新 `utils/expectedStock.js` → `getExpectedStock(conn, pairs)`。口径 = 采购单 `status IN (2已提交, 5待审批)` 的明细 `quantity` − 已收（`inbound_task_items.putaway_qty` 且任务已审计未取消）− 已绑定给销售单的未释放量。排除 status=3/4。独立成 util 因 containerEngine 不能被 purchase 反向 require（会循环）。
      - **`containerEngine.getStockProjection` 加 `includeExpected`**：`true` 时 `available = quantity + expected − reserved`；默认 false ⇒ 出库/调拨/超收闸门/盘点维持「现货 − reserved」口径不变。
      - **`inventory.getAvailabilityByProducts` 加 `includeExpected` + `expected` 字段**（占库预览）。
      - **`reservationEngine.reserve` 加 `includeExpected` + `expectedItems` + `refItemId`**：物理预占逻辑不变（reserved/stock_reservations），但**超出「现货 − 已预占」的部分**按 `expectedItems` FIFO 分摊记录绑定。
      - **新表 `sale_order_expected_bindings`**（迁移 228，information_schema 护栏建表）：`sale_order_id/item_id, purchase_order_id/item_id, product_id, warehouse_id, qty, released_at`。释放（销售单取消 `releaseByRef` / 改单减量 `partialReleaseByProduct`）时置 `released_at`。
      - **采购单取消/短装**：`purchase.service.cancel` / `closeRemaining` 加 `assertNoActiveSaleBinding` ——查到未释放绑定即 `409 BINDING_SALE_DEPENDENCY`，列出被占用销售单单号与量，提示先去销售单解除绑定。**不自动释放**。
    - **前端**：占库弹窗 `ReserveAllocationDialog` 每个仓库「可用量」旁标「在途 +N」（`ReserveWarehouseOption` 加 `expected?`）。
    - **测试**：新 `tests/sale-atp.smoke.test.js`（`npm run smoke:atp`，8 项断言）——全新商品现货 0 → 建采购单提交 → 销售单占库用上在途成功 → 绑定记录 → 采购单取消被 409 拦截且列出销售单 → 释放后绑定作废 → 解除后采购单可取消。用 `code LIKE 'ATP%'` 定位测后清理。
    - **验证**：迁移实跑；后端 lint 0、前端 lint 0 error / tsc 0、生产 build 通过；回归 mainline 49 / sale-adjustment 57 / concurrency 83 / integration 96 / p0 41 / p1 44 / finance 108 / warehouse-scope 41 / permissions 184 全绿；`smoke:atp` 8/8；API 实测——现货 0 商品占库 5 成功、绑定归到对应采购单（FIFO 按 expected_date 近的先）、取消被拦截 409、释放后绑定清零。
    - **已知行为（语义正确，非 bug）**：占库成功但实物未到时，仓库任务/拣货会提示实物不足（到货后按库存现状补发）；在途是软投影，多张销售单可对同一预计池超配，靠采购单取消/短装的时间点拦截兜底。这是「现货 + 在途」ATP 模型的固有属性，用户已确认。

54. **2026-09-02 权限管理三页重构 + 角色增删 + 死权限清理 + 未保存提示推广（随 v0.9.0 发布）**：
    - **部门管理页**（`pages/departments/index.tsx`）：手写递归树 div 列表 → 标准 `DataTable`（名称列按 depth 缩进 + 展开/收起箭头），行操作 `TableActionsMenu`；负责人候选改用 `useUserOptions`（替换全量 `useUsers({pageSize:500})`，避免截断/`user.view` 权限卡住/更轻）；新增/编辑/删除按钮按 `DEPARTMENT_CREATE/UPDATE/DELETE` 显隐；部门下拉/负责人下拉换 shadcn `Select`；补 `QueryErrorState`；编辑弹窗递归排除子孙部门（防环，后端本就挡）。
    - **用户管理页**（`pages/users/index.tsx` + `components/UserFormDialog.tsx`）：新增/编辑/仓库范围/重置密码/删除按钮按 `USER_CREATE/UPDATE/DELETE/RESET_PASSWORD` 显隐（`usePermission` + `TableActionsMenu` 重组）；补 `QueryErrorState`；`UserFormDialog` 部门下拉原生 `<select>` → shadcn `Select`（value="0" 哨兵表未分配）；创建表单补前端校验（账号≥2/密码≥6/姓名非空，与 `ResetPasswordDialog` 对齐）。
    - **权限管理页**（`pages/permissions/index.tsx`）：改为**左角色列表 + 右权限配置**分栏（`items-start` 不拉伸、顶部按钮按 `ROLE_ASSIGN` 仅超管）；权限项精致化胶囊（选中 `bg-primary/10+border-primary+text-primary` 淡蓝，替代原来一片实心蓝）；左栏 `+` 新增角色、角色项 hover 复制/删除图标；搜索框/「已选 N 项」随迭代移除。
    - **角色增删（后端新接口）**：`POST /roles`（create）、`DELETE /roles/:id`（remove）——沿用 roles 模块既有「仅超管」硬校验（`ROLE_ASSIGN` + `roleId===1`），**未新增权限码/迁移**；remove 护栏：`is_system=1` 系统内置 400、有 `sys_users` 引用 409；事务清 `sys_role_permissions`+删角色。前端 `api/settings.ts` + `hooks/usePermissions.ts` 加 create/delete；`getRolesApi` 返回 `is_system`。
    - **权限分组补全（`PERMISSION_GROUPS`）**：扫描发现后端 184 个权限码只显示 134 个（50 个未显示可配置）——全部归位补齐（主数据各实体增删改 + 打印标签、取消收货单、库存追溯/删销售单、仓库作业分拣/复核完成/打包完成/取消/优先级/调试、删除用户/重试打印/客户端回执）；新增「资金与报销」组（资金账户+费用报销）；**三个真实接口死权限**（`system.health.view`/`autofix`、`sale.credit.manage`）彻底清理——前后端常量删除 + **迁移 229** 清 `sys_role_permissions` 记录，权限码 184→181。
    - **期初导入置顶**：新增「期初导入」组（导入商品/导入库存初始化）置顶；**隐藏运维权限**（`warehouse.task.debug`、`print.client.consume`、`audit.log.clear`，仅配置页不显示，权限码/接口仍在）；「重试打印」按用户选择保留显示。
    - **未保存退出提示推广**：销售单 `useDirtyGuard` 模式推广到 4 个页面级可编辑表单——采购申请单（`purchase-requisitions/form`）、分批盘点规则（`stockcheck/abc`）、系统设置（`settings`）、仪表盘布局（`dashboard`）；采购计划详情（`procurement/detail`）为自动保存型跳过；其余页面新建/编辑均在页内 Dialog，无需接入。`useDirtyGuard` 只在关标签/刷新/退出拦截，切标签因 keepAlive 不触发。
    - **验证**：前后端 lint 0 error、前端 tsc 0、`test:permissions` 181/181、死权限扫描 0、差集 3（隐藏运维）；浏览器实测部门/用户/权限三页 + 角色增删 + 权限分组显示 + 采购申请页正常。**注意：老版本 CLAUDE.md 各处「184 个」为历史快照，当前权限码 = 181**。
