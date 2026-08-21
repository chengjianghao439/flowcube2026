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
- **PDA**：Capacitor 8（CLI 7），Android `minSdk 22 / target 35 / compileSdk 35`，`@vitejs/plugin-legacy` 兼容 Android ≥5，构建目标 `es2015`。
- **数据库**：MySQL 8.0，`utf8mb4_unicode_ci`，连接池 `timezone=+08:00`。
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
│       ├── app.js                  中间件装配 + 59 条 /api 路由注册 + 静态目录 + 404 + errorHandler
│       ├── scheduler.js            仅启动 operation_requests TTL 清理
│       ├── config/                 db.js（连接池）、env.js（环境变量校验，生产缺项直接拒启动）
│       ├── constants/              documentStatusRules / warehouseTaskStatus / saleOrderStatus / settlementType / voucherSource / permissions
│       ├── database/               210 个 .sql 迁移 + migrate.js
│       ├── engine/                 containerEngine / inventoryEngine / reservationEngine / approvalEngine ← 库存唯一合法入口（approvalEngine 为多级审批流引擎，P2-7）
│       ├── middleware/             auth / errorHandler / loadRolePermissions / opLogger / pdaOnly / pdaSession / requestLogger / companyScope（多账套公司隔离，会计标准）
│       ├── modules/                58 个业务模块，统一 routes → controller → service
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
ERP  销售单(草稿1) → 占用库存(已占库2，只加 reserved，不动实物)
     → 发起出库：按明细行的发货仓库分组，每组建一个仓库任务；订单 2→3 拣货中
PDA  拣货(扫容器条码，scan-logs 累加 picked_qty) → 拣货完成(校验闭合) → 待分拣(3)
     → 分拣(扫商品 → 扫分拣格) → 待复核(4) → 复核(扫容器) → 待打包(5)
     → 打包(建箱、装箱、完成箱 → 打印箱贴) → 全部箱完成 ⇒ 待出库(6)
     → 出库确认(扫箱码) ⇒ FIFO 从"本任务锁定的容器"扣减 + 释放预占 + 写应收 + 成本快照 ⇒ 已出库(7)
销售单：全部明细发完 ⇒ 已出库(4)；应收按 shipped_qty 全量重算（分批幂等）
```

必须知道的四件事（旧版文档均未覆盖）：
1. **分仓发货**：`sale_order_items.warehouse_id` 是行级发货仓库，一张销售单可以有多个仓库任务。任何按 `product_id` 关联 `sale_order_items` 的 SQL **必须带 warehouse_id 维度**，否则出库明细会被 JOIN 放大成 N 倍扣减（`warehouse-tasks.ship.js` 有 `assertNoShipItemFanout` 兜底）。
2. **分批发货**：`sale_order_items.dispatched` 标记该行是否已派发到仓库任务；`ship(id, { itemIds })` 只对未派发行建任务。`shipped_qty` 按批累加。
3. **执行期改单**：`PUT /sale/:id/adjust`（`sale.service.requestAdjustment` + `warehouse-tasks.adjust.js`）允许订单在已占库/拣货中改明细；增量把任务退回拣货中，减量若命中已打包/已复核则要 PDA 物理确认（拆箱作废 / 容器归还分拣格）后任务退回待复核。落表：`sale_order_adjustments*`。
4. **取消**：草稿直接取消；已占库释放预占；拣货中会逐个取消活跃仓库任务（走逆向归还，PDA `/pda/cancel-return` 确认归还库位），并整单兜底释放预占。若已有任务出库过，则**不是取消**——未发行整行删除、部分发的行数量降到实发量，订单直接结案为已出库(4)。

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
- 迁移：`backend/src/database/` 下 210 个 `.sql`，编号 001–210（**存在重复编号 057/064/089，缺 008/009/040**，靠文件名排序执行；db_migrations 有 211 条执行记录，含 1 条手工执行的迁移）。**后端进程启动时不会自动迁移**（本机改完 schema 需手动 `npm run migrate`）；生产部署由 `server-update.sh` 代跑，见第 16 节。
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
| `sale_orders/_items` | 销售 | 行级 `warehouse_id`、`shipped_qty`、`dispatched`、`cost_snapshot`(COGS) |
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
| `sale` | 1草稿 2已占库 3拣货中 4已出库 5已取消 | edit(1)、adjust(2/3)、reserve(1→2)、release(2→1)、ship(2→3，拣货中可继续分批)、completeShip(3→4)、cancel(1/2/3→5)、delete(5) |
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
- 权限码在 `backend/src/constants/permissions.js` 与 `frontend/src/lib/permission-codes.ts` **两份手工同步**的常量表（各 184 个，当前双向一致）；改动后跑 `npm run test:permissions` 校验（它做双向 diff + 命名合规检查，已进 CI）。角色权限存 `sys_role_permissions`，`requirePermission` 在校验前按角色现查。
- **roleId === 1 是超管，跳过所有权限校验**（前后端都是）。
- **数据范围**：`user_warehouse_scope`（迁移 122）→ `req.user.warehouseIds`（null=不限仓，超管恒 null，60s 缓存）→ 列表查询用 `scopeFilter()` 拼 SQL。新增涉仓列表接口应接入。
- 每个业务 routes 文件顶部都有 `router.use(authMiddleware)`。**唯一完全公开的模块是 `/api/app-update/latest`**，另外 `/api/pda/version`、`/api/pda/download`、`/api/auth/login`、`/health`、`/api/health` 免登录。
- 少数登录后免细粒度权限的低敏感接口：`/users/options`、`/products|suppliers|customers/next-code`。新增接口**不要**跟随这个例外，一律加 `requirePermission`。
- **PDA-only 接口**（`pdaOnly` 校验请求头 `X-Client: pda`）：收货、上架、调拨 scan-out/scan-in、退货 receive/check/putaway、扫码写入（`/scan-logs`、`/scan-logs/check`、`/scan-logs/cancel-return[/box]`；`/error`、`/undo` 不限）、仓库任务 start-picking/ready/sort-done/check-done/pack-done/ship、改单的两个 PDA 物理确认接口。**ERP 端不得绕过这些接口直接改任务状态。**
- **PDA 设备会话已强制启用**（`pda_device_sessions` + `middleware/pdaSession`）：前端 `api/client.ts` 会带上 `X-PDA-Session`（含自动续期），`pdaSessionRequired()` 已挂在调拨 scan-out/scan-in、退货 receive/check/putaway、`/scan-logs` 写入等关键作业接口上；设备需先在 `/pda/bind` 绑定。回归由 `npm run smoke:pda-device-session` 守着（设备未绑定即拒绝作业）。上架接口另用 `req.pda?.warehouseId` 做跨仓拦截。
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
- 数据库迁移**由部署链路自动执行，不需要手动补跑**：`scripts/server-update.sh` 在 `docker compose up -d --build` 之后、健康检查之前显式跑 `docker compose exec -T backend npm run migrate`（用新镜像里的迁移文件，失败即中断部署）。「后端进程启动时不自动迁移」说的是 `backend/index.js`，别把两者混为一谈——推 main 时迁移是跟着一起上的。只有绕开该脚本手动改动服务器时才需要自己跑一次。
- 桌面更新源：`/var/www/flowcube-downloads/latest.json`（顶层唯一权威入口，由 `scripts/release-desktop.js` 写入）；`current/` 只放固定文件名的当前安装包；`/downloads` 是**已废弃**的兼容别名（仅 GET/HEAD）。
- 应急手动部署：`ssh flowcube-prod 'cd /opt/flowcube && SKIP_RELEASE_GATE=1 bash scripts/server-update.sh'`。
- 其他运维脚本（2026-08-21 重构，容器名不再硬编码）：
  - `scripts/lib/ops-common.sh`：运维脚本公共库——`resolve_container()` 三级回退解析 compose 容器名（`docker compose ps -q` → 期望名 → 捞被 Docker 改名加 hash 前缀的容器，2026-08-21 事故的教训：容器被改名后硬编码名字会让备份静默失败 12 天）、`read_dingtalk_webhook()`、`dingtalk_send()`。
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
18. **审计确认的安全基线**（2026-08-21，可信）：全仓 SQL 参数化无注入点；所有业务 routes 挂 authMiddleware + requirePermission（唯一公开 app-update/latest）；opLogger 敏感字段脱敏；multer 无路径穿越；无硬编码密钥；前端 0 处 dangerouslySetInnerHTML；仅 3 处工具性裸 axios（不带 token）；库存引擎 9 条不变量与第 9 节描述完全一致。
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
