# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

极序 Flow is an ERP/WMS system with three client surfaces: browser (React SPA), Windows desktop (Electron shell), and PDA (Android Capacitor app). Deployed via Docker Compose on Alibaba Cloud (`47.93.228.251`).

```
flowcube/
├── backend/          Express API (CommonJS, Node 20+)
├── frontend/         React 18 + Vite + Tailwind + shadcn/ui
├── desktop/          Electron shell (wraps frontend dist)
├── scripts/          CI/release utilities
├── docs/             Architecture spec, deploy guide, release notes
├── tests/            Smoke & integration tests
├── docker-compose.yml
└── Dockerfile.backend / Dockerfile.frontend
```

## Commands

```bash
# Root (monorepo-level)
npm run release:prod          # git push main → CI deploys browser + tags desktop
npm run release:gate          # run release-gate.sh checks
npm run generate:status       # regenerate status constants from DB
npm run smoke:pages           # page-level smoke test against prod

# Backend (cd backend)
npm run dev                   # nodemon, auto-restart
npm run migrate               # run database migrations explicitly
npm run bootstrap:admin       # create initial admin user
npm start                     # production start

# Frontend (cd frontend)
npm run dev                   # Vite dev (Electron target, port 5173)
npm run dev:pda               # Vite dev (PDA/Capacitor target)
npm run build                 # production build (Electron target)
npm run build:pda             # production build (PDA target)
npm run pda:sync              # build + cap sync android

# Desktop (cd desktop)
npm run dist                  # full Windows installer build (run from CI only)
npm start                     # launch Electron against built frontend
```

## 本地"开发者模式"（浏览器预览调试）

当用户说"开启/启动开发者模式""给我网址"时，指的是用 Browser 面板的 `preview_start` 工具（不是 Bash）按 `.claude/launch.json` 里的配置名启动本地开发服务器：

- `backend-dev`（端口 3000）
- `frontend-dev`（端口 5173，Electron target；`frontend-pda-dev` 是 PDA target，同端口）

两个都起完后，把地址 `http://localhost:5173` 告诉用户，并用下面这个本地测试账号登录：

```
账号：admin
密码：admin123
```

这是本机 MySQL（`backend/.env` 里 `DB_HOST=127.0.0.1`，真实数据库、非 mock）里已经存在的管理员测试账号，专门用于本地功能验证，不是生产账号。

后端重启后 JWT 会失效，之前登录过的页面会需要重新登录；前端热更新（HMR）一般不需要重新登录。

**重要**：验证完成后不要主动 `preview_stop` 停掉这两个服务——用户可能在自己的真实浏览器里也开着 `localhost:5173` 用着，把开发服务器停掉会导致用户那边"开发者模式掉了"。

## Architecture

### Backend: Express with strict layering

Every module follows `routes → controller → service → db`. **Never cross layers.**

```
POST /api/inventory/inbound
  → routes: JWT + Zod validation + requirePermission → ctrl.inbound
  → controller: extract req.body → service.inbound(params) → res.json(result)
  → service: business rules → SQL → return data
```

- **routes**: register paths, attach middleware, delegate to controller. No business logic.
- **controller**: parse params, call service, return `successResponse`/`errorResponse`. No SQL.
- **service**: all DB operations and business logic. No HTTP objects.
- All errors go to `next(err)`, caught by `middleware/errorHandler.js` which handles `AppError`, MySQL errors, Zod errors, and unknowns.
- **No ORM** — raw SQL via `mysql2/promise` connection pool. Database migrations are sequential `.sql` files in `backend/src/database/`.
- Auth: JWT (Bearer token), enforced by `middleware/auth.js`. Permissions are string codes like `"inventory.view"` defined in `backend/src/constants/permissions.js`. `requirePermission` loads role permissions on first check.

#### Backend modules (43 total, registered in `backend/src/app.js`)

| Module | Route | Purpose |
|--------|-------|---------|
| auth | `/api/auth` | Login, token refresh, password change |
| users | `/api/users` | User CRUD |
| roles | `/api/roles` | Role & permission management |
| warehouses | `/api/warehouses` | Warehouse CRUD |
| locations | `/api/locations` | Storage location CRUD |
| racks | `/api/racks` | Rack CRUD + label printing |
| suppliers | `/api/suppliers` | Supplier CRUD |
| customers | `/api/customers` | Customer CRUD |
| carriers | `/api/carriers` | Carrier CRUD |
| products | `/api/products` | Product CRUD + label printing |
| categories | `/api/categories` | Product category CRUD |
| inventory | `/api/inventory` | Stock query, container ops, trace |
| containers | `/api/containers` | Container split/move |
| plastic-boxes | `/api/plastic-boxes` | Reusable tote/box container query (subset of `inventory_containers`, barcode prefix `B`) |
| purchase | `/api/purchase` | Purchase orders (CRUD + confirm/cancel) |
| inbound-tasks | `/api/inbound-tasks` | Receiving orders (receive/putaway, auto-settles on putaway completion) |
| sale | `/api/sale` | Sales orders (CRUD + reserve/release/ship/cancel) |
| warehouse-tasks | `/api/warehouse-tasks` | Outbound task lifecycle (pick/sort/check/pack/ship) |
| picking-waves | `/api/picking-waves` | Multi-task pick wave management |
| sorting-bins | `/api/sorting-bins` | PUT-wall bin management |
| packages | `/api/packages` | Box/packaging CRUD + label printing |
| scan-logs | `/api/scan-logs` | PDA barcode scan records |
| stockcheck | `/api/stockcheck` | Stock counting |
| transfer | `/api/transfer` | Inter-warehouse transfers (two-phase PDA scan-out/scan-in) |
| returns | `/api/returns` | Purchase & sale returns (CRUD + confirm/cancel) |
| return-tasks | `/api/return-tasks` | Sale-return PDA execution (receive → check/QA → putaway) |
| payments | `/api/payments` | AR/AP payment records |
| price-lists | `/api/price-lists` | Customer-specific pricing |
| print-jobs | `/api/print-jobs` | Print queue: create, dispatch, ack, sweeper |
| printers | `/api/printers` | Printer registry + client heartbeat |
| printer-bindings | `/api/printer-bindings` | Map print types to printers |
| print-templates | `/api/print-templates` | ZPL/TSPL label template CRUD |
| dashboard | `/api/dashboard` | Homepage metrics |
| reports | `/api/reports` | Analytics & reports |
| export | `/api/export` | Excel export for all modules |
| import | `/api/import` | Bulk product/stock import |
| settings | `/api/settings` | System configuration |
| notifications | `/api/notifications` | User notifications |
| search | `/api/search` | Global search |
| oplogs | `/api/oplogs` | Audit/operation logs |
| admin | `/api/admin` | Admin utilities (putaway override, etc.) |
| pda | `/api/pda` | PDA device auth, version check, APK download |
| app-update | `/api/app-update` | Desktop auto-update manifests |

#### Engine layer (`backend/src/engine/`)

Three transaction-safe engines enforce stock consistency:

- **containerEngine.js**: Container lifecycle (create/split/move/deduct/FIFO). `getAvailableStockForDecision()` returns `{ quantity, reserved, available }` where `available = quantity - reserved`.
- **inventoryEngine.js**: High-level stock operations. `moveStock()` deducts containers and releases reservations atomically.
- **reservationEngine.js**: Stock reservation for sales orders. `reserve()` increases `inventory_stock.reserved`, `releaseByRef()` decreases it, `markFulfilled()` marks reservation as fulfilled on ship.

**Stock model**: `inventory_stock` has `quantity` (physical on-hand, synced from containers) and `reserved` (locked by sales orders). Available = quantity - reserved. Reserve increases reserved (reduces available), ship decreases both quantity and reserved.

### Frontend: React SPA with dual routing

Two separate route trees in `frontend/src/router/index.tsx`:
- **ERP** (`/*`): HashRouter → `ErpProtectedRoute` → `AppLayout` with sidebar + tab-based navigation
- **PDA** (`/pda/*`): HashRouter → `PdaProtectedRoute` → `PdaLayout` with bottom tabs
- `CrossClientNavigationGuard` prevents accidentally mixing ERP and PDA routes in the same session.

#### Navigation structure (`frontend/src/router/routeRegistry.ts`)

ERP sidebar menu groups:

| Group | Routes |
|-------|--------|
| 仪表盘 | `/dashboard` |
| 采购 | `/suppliers`, `/purchase`, `/inbound-tasks` |
| 销售 | `/customers`, `/carriers`, `/sale` |
| 往来 | `/returns`, `/payments` |
| 库存 | `/products`, `/categories`, `/warehouses`, `/locations`, `/racks`, `/inventory`, `/plastic-boxes`, `/stockcheck`, `/transfer` |
| 仓库任务 | `/picking-waves`, `/sorting-bins` |
| 数据 | `/reports`, `/reports/role-workbench`, `/reports/reconciliation`, `/reports/profit-analysis`, `/reports/approvals`, `/reports/wave-performance`, `/reports/pda-anomaly`, `/reports/warehouse-ops`, `/oplogs` |
| 系统 | `/users`, `/permissions`, `/settings`, `/settings/barcode-print-query`, `/settings/print-templates`, `/settings/printers` |

State management split:
- **Zustand**: session-scoped global state (auth token, user info, workspace tabs). Stored in `sessionStorage`, cleared on browser close.
- **React Query**: all server state (lists, details, mutations). 5-min stale time, 1 retry, no refetch on window focus.

API client (`frontend/src/api/client.ts`): Axios instance with interceptors for Bearer token injection, 401 auto-logout, network error fallback probing, and global toast on errors. Use `payloadClient.get/post/put/delete` to auto-unwrap `{ data: ... }` from the API envelope.

Vite builds **only** Electron or Capacitor targets — plain web build is blocked (`vite.config.ts`). `VITE_ELECTRON=1` or `VITE_CAPACITOR=1` is always required.

#### Key frontend libraries (`frontend/src/lib/`)

| File | Purpose |
|------|---------|
| `desktopLocalPrint.ts` | Desktop-side ZPL/TSPL raw printing via Electron IPC |
| `saleWorkflowStatus.ts` | Maps sale order + WT status to display label |
| `pdaCriticalState.ts` | Offline recovery state helpers for PDA critical actions |
| `permissions.ts` / `permission-codes.ts` | Permission check hooks and code constants |
| `requestKey.ts` | Idempotency key generation for mutation dedup |

### PDA (Android Capacitor) pages

PDA workbench (`/pda`) grid with 10 permission-gated entries (收货订单/扫码上架/拣货任务/订单分拣/复核任务/打包作业/容器拆分/出库确认/调拨执行/销售退货), each drilling into detail pages:

| Page | Route | Purpose |
|------|-------|---------|
| 收货订单 | `/pda/inbound` | List inbound tasks → enter receive or putaway |
| 收货执行 | `/pda/receive/:id` | Per-product multi-box receiving + print labels |
| 扫码上架 | `/pda/putaway/:id` | Two-step scan: container → shelf location |
| 拣货任务 | `/pda/picking` | Task list + SKU summary → start picking |
| 任务执行 | `/pda/task/:id` | Scan containers, pick suggestions, route guidance |
| 订单分拣 | `/pda/sort` | Scan product → see target bin → scan bin to confirm |
| 复核任务 | `/pda/check/:id` | Scan containers to verify picked quantities |
| 打包作业 | `/pda/pack/:id` | Create boxes, scan items, finish + print labels |
| 出库确认 | `/pda/ship/:id` | Scan box barcode → auto-validate + execute ship |
| 容器拆分 | `/pda/split` | Split containers |
| 调拨执行 | `/pda/transfer` | List transfer orders submitted for two-phase scan |
| 调拨出库 | `/pda/transfer-out/:id` | Source warehouse: scan containers out |
| 调拨入库 | `/pda/transfer-in/:id` | Destination warehouse: scan containers in, complete transfer |
| 销售退货 | `/pda/sale-return` | List sale-return tasks (`return_tasks`) awaiting receive/putaway |
| 退货收货 | `/pda/sale-return/:id/receive` | Scan-receive returned goods → creates PENDING_QA containers |
| 退货上架 | `/pda/sale-return/:id/putaway` | After QA passes (`check` API), scan container → shelf location |

PDA uses `useCriticalPdaAction` for offline-resilient mutation with idempotency keys (`operation_requests` table), allowing safe retry after network interruption.

### Desktop: Electron shell

- `main.js`: main process (window management, auto-update via `electron-updater`, local print, IPC)
- `preload.js`: exposes safe APIs to renderer (`flowcubeDesktop.printZpl`, etc.)
- `lib/localPrint.js`: ZPL/TSPL raw printing (Windows: PowerShell→WinSpool; Mac/Linux: `lp -o raw`)
- `lib/updateCheck.js`: polls `/api/app-update/latest`（后端读取顶层 `latest.json`）；下载安装包走同域 `/current/<filename>`，避免境内网络直连 GitHub
- Builds MUST run on GitHub Actions Windows runner (NSIS 3.0.4.1). Local Mac builds may produce broken installers.

### Database

MySQL 8.0, charset `utf8mb4_unicode_ci`. Tables use `[module]_[resource]` naming (e.g., `inventory_containers`, `sale_orders`). All tables have `created_at`/`updated_at` timestamps. Logical deletes via `deleted_at` column.

97 sequential migration files in `backend/src/database/` (001–097). Run `npm run migrate` in backend before deployment.

## Business flows

### Purchasing (采购) — ERP + PDA

```
ERP: 新建采购单(草稿1，可编辑) → 提交(已提交2)
  → 新建收货订单(待收货1) → 提交到PDA(已提交)

PDA: 收货(逐箱扫描+打印标签) → 全部收完(待上架3)
  → 扫码上架(扫容器→扫库位) → 全部上架完(收货订单已完成4)
     → 同一事务内系统自动结算，无需人工审核
       → 按实际上架量×采购单价（全量重算，幂等）生成/累加应付
       → 该采购单全部明细收齐 → 采购单自动完成(3)
       → 短装(少收) → 采购单不自动完成，需人工「关闭剩余」结案(POST /purchase/:id/close)
```

Purchase orders (`/purchase`) are planning documents only; drafts are editable (`PUT /purchase/:id`), create is idempotent (`X-Request-Key`). Receiving and putaway happen through inbound tasks (`/inbound-tasks`), submitted to PDA. ERP-side receiving is disabled — receive and putaway are PDA-only (enforced by `pdaOnly` middleware checking `X-Client: pda` header).

**采购结算（v0.4.22+）**：采购单「完成」+ 应付**在上架全部完成时**自动结算（不再有人工审核闸门），逻辑在 `inbound-tasks.putaway.js` 的 `tryFinishTask`（内部复用 `inbound-tasks.settle.js` 的 `settlePurchaseOnAudit`，同一事务内把 `inbound_tasks.audit_status` 置为已通过后立即结算）。应付按实收（上架）金额，依赖 `payment_records` 的 `UNIQUE(type, order_id)` 做幂等 upsert。此前 v0.4.13~v0.4.21 的人工审核/退回环节（`/inbound-tasks/:id/audit`）已整体移除，详见 memory `purchase-settlement-on-audit`。

### Sales (销售) — ERP + PDA

```
ERP: 新建销售单(草稿1) → 占用库存(已占库2) → 发货(拣货中3)

PDA: 拣货(扫容器条码) → 待分拣(3)
  → 分拣(扫产品→扫分拣格) → 待复核(4)
  → 复核(扫容器验证) → 待打包(5)
  → 打包(装箱+打印箱贴) → 待出库(6)
  → 出库确认(扫箱子条码) → 已出库(7)

销售单: 已出库(4)，自动生成应收记录
```

Warehouse task status machine (7 active + 1 cancelled): PICKING(2) → SORTING(3) → CHECKING(4) → PACKING(5) → SHIPPING(6) → SHIPPED(7). Each transition validates closure (e.g., packDone requires all boxes finished + all items packed).

Stock reservation: `reserve()` increases `inventory_stock.reserved` (does NOT touch physical `quantity`). `ship()` deducts `quantity` via FIFO and releases `reserved`. Available stock = quantity - reserved.

### Print dispatch (打印派发)

Client-pull model (no push):

1. PDA receive → creates container → `enqueueContainerLabelJob()` → INSERT `print_jobs` (status=PENDING)
2. Printer resolution: `printer_bindings` table → env var `INBOUND_LABEL_PRINTER_CODE` → first enabled label printer
3. Desktop Electron client polls `POST /api/print-jobs/claim-client { clientId }` periodically
4. Matching: `print_jobs.printer_id → printers.id → printers.client_id = polling clientId`
5. Client prints ZPL/TSPL raw → calls `POST /print-jobs/:id/complete-local`
6. Expired jobs (30min TTL) swept by 60s interval sweeper

Key: dispatch is NOT user-account-based. A print job goes to whichever desktop client registered the bound printer.

### Returns (退货) — independent page since v0.4.16

Two types, both draft(1) → confirmed(2) → executed(3) → cancelled(4), but confirm triggers **different execution pipelines**:

```
采购退货 purchaseReturn (库存流出，走出库仓库任务):
  confirm(1→2) 自动创建 warehouse-task(拣货→出库)
  → PDA 按标准出库流程执行 → WT ship 完成
  → syncPurchaseReturnShipped 回调：冲减应付 + 退货单(2→3已执行)

销售退货 saleReturn (库存流入，走独立 return_tasks 表):
  confirm(1→2) 创建 return_tasks 行(状态见下) → submit 到 PDA
  PDA: receive(扫码收货，生成 status=PENDING_QA 容器)
    → check(质检确认，容器 PENDING_QA→PENDING_PUTAWAY)
    → putaway(扫容器→扫库位，容器上架)
  → return_tasks 全部上架完成 → syncSaleReturnCompleted 回调：
    冲减应收 + 退货单(2→3已执行)
```

`return_tasks` has its own sub-status machine (`return-tasks.service.js`): 1待收货 2收货中 3待质检 4待上架 5已完成 6已取消. PDA routes at `/api/return-tasks` require `X-Client: pda` (`pdaOnly`) except `submit` (ERP-only). Purchase returns do **not** use `return_tasks` — they reuse the normal outbound warehouse-task pipeline.

### Transfers (调拨) — two-phase PDA scan since v0.4.15

Inter-warehouse stock movement: draft(1) → 待出库/已派发(2) → 在途(3) → 已完成(4) → cancelled(5).

```
ERP: 新建调拨单(草稿1) → 确认派发(待出库2)
PDA: 源仓扫码出库 scan-out(2/3→3在途) → 目标仓扫码入库 scan-in(3→4已完成)
```

`scan-out`/`scan-in` are PDA-only (`pdaOnly` + `pdaSessionRequired`) at `/api/transfer/:id/scan-out` and `/scan-in`. Uses `containerEngine.transferContainers()` for FIFO source deduction + destination container creation. Cancel is blocked once in-transit (status 3) — must be resolved via stockcheck instead.

## Status machines

Defined in `backend/src/constants/documentStatusRules.js`:

| Machine | States | Key transitions |
|---------|--------|-----------------|
| purchase | 1草稿 2已提交 3已完成 4已取消 | edit(限1), confirm(1→2), cancel(1/2→4), complete(2→3, 收齐上架时自动), close(2→3, 短装人工关闭剩余) |
| sale | 1草稿 2已占库 3拣货中 4已出库 5已取消 | reserve(1→2), release(2→1), ship(2→3), completeShip(3→4), cancel(1/2/3→5) |
| inboundTask | 1待收货 2收货中 3待上架 4已完成 5已取消 | submit, receive, receiveComplete(2→3), putaway, finish(3→4, 同一事务内自动结算), cancel(1→5) |
| warehouseTask | 2拣货中 3待分拣 4待复核 5待打包 6待出库 7已出库 8已取消 | See `warehouseTaskStatus.js` for full transition table |
| transfer | 1草稿 2待出库 3在途 4已完成 5已取消 | confirm(1→2), scanOut(2/3→3, PDA), scanIn(3→4, PDA), cancel(1/2→5) |
| purchaseReturn / saleReturn | 1草稿 2已确认 3已执行 4已取消 | confirm(1→2), execute(2→3), cancel(1/2→4). execute 由回调触发：purchaseReturn 靠 WT ship，saleReturn 靠 return_tasks putaway |
| stockcheck | 1盘点中 2已完成 3已取消 | submit(1→2), cancel(1→3) |

Status transitions validated by `assertStatusAction(machine, action, currentStatus)` which throws `AppError` with appropriate Chinese messages.

`return_tasks` (sale-return PDA execution) is **not** in `documentStatusRules.js` — it has its own inline machine in `return-tasks.service.js`: 1待收货 2收货中 3待质检 4待上架 5已完成 6已取消, transitions validated via `RT_TRANSITIONS` + `compareAndSetStatus`.

## Key design constraints

- **Coding convention**: all user-facing text in Chinese; variable/function names in English.
- **API responses**: every endpoint returns `{ success: boolean, message: string, data: object|null }`. List endpoints include `data.pagination: { page, pageSize, total }`.
- **API paths**: lowercase, hyphen-separated, plural nouns. Max 2 levels of nesting.
- **No local desktop builds for production**: desktop installers must come from GitHub Actions. The local `makensis` may be too new and produce broken EXEs.
- **Database migrations are explicit**: run `npm run migrate` in backend before deployment. No auto-migration on startup.
- **Production changes must go through `main` branch**: `main` is the single source of truth. Push to main triggers browser deploy; `v*` tags trigger desktop build.
- **All inventory mutations use transactions**: engines take a `conn` parameter (pool connection with active transaction). Caller manages BEGIN/COMMIT/ROLLBACK.
- **PDA critical actions use idempotency keys**: `operation_requests` table tracks `requestKey` for dedup across network interruptions.
- **Print dispatch is client-pull**: no SSE/WebSocket push. Desktop clients poll `claimClientJobs`.
- **货号/型号/颜色 全链路（migrations 093–097）**: purchase, inbound-task, sale, transfer, and return order items all carry `article_number`/`spec`/`color` alongside `product_id`, so query/filter/print can work at the article-code level, not just the product level. New order-item tables should follow this pattern.

## Deploy & server

- Production server: `root@47.93.228.251`, project at `/opt/flowcube`
- SSH alias: `flowcube-prod` (key: `~/.ssh/flowcube_deploy_ed25519`)
- Browser deploy: push to `main` → GitHub Actions (`deploy-browser.yml`) → SSH → `git reset --hard` to commit SHA → `docker compose up -d --build backend frontend`
- Desktop update feed: `/var/www/flowcube-downloads/latest.json`（顶层，唯一权威入口，由 `scripts/release-desktop.js` 写入），桌面端通过后端 `/api/app-update/latest` 读取；`current/` 目录只放当前版本安装包的固定文件名（`FlowCube-Setup.exe`/`version.txt`），供同域下载用，不含 latest.json
- Emergency manual deploy: `ssh flowcube-prod 'cd /opt/flowcube && SKIP_RELEASE_GATE=1 bash scripts/server-update.sh'`

## Repository management

- This repo uses **git worktrees** for Claude Code sessions. The main repo is at `/Users/chengjianghao/flowcube`. Active worktrees are in `.claude/worktrees/`.
- Commit style: Chinese-language descriptions, conventional prefix (`fix:`, `feat:`, `refactor:`, `release:`, `chore:`, `ci:`, `docs:`, `security:`).
- Deploy config (`deploy/production.local.json`) is gitignored. Use `deploy/production.example.json` as reference.
- GitHub repo: `chengjianghao439/flowcube2026`.
