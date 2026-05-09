# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

FlowCube (极序 Flow) is an ERP/WMS system with three client surfaces: browser (React SPA), Windows desktop (Electron shell), and PDA (Android Capacitor app). Deployed via Docker Compose on Alibaba Cloud (`47.93.228.251`).

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
- Inventory uses three engine files (`engine/containerEngine.js`, `engine/inventoryEngine.js`, `engine/reservationEngine.js`) that enforce stock consistency rules.

### Frontend: React SPA with dual routing

Two separate route trees in `frontend/src/router/index.tsx`:
- **ERP** (`/*`): HashRouter → `ErpProtectedRoute` → `AppLayout` with sidebar navigation
- **PDA** (`/pda/*`): HashRouter → `PdaProtectedRoute` → `PdaLayout` with bottom tabs
- `CrossClientNavigationGuard` prevents accidentally mixing ERP and PDA routes in the same session.

State management split:
- **Zustand**: session-scoped global state (auth token, user info). Stored in `sessionStorage`, cleared on browser close.
- **React Query**: all server state (lists, details, mutations). 5-min stale time, 1 retry, no refetch on window focus.

API client (`frontend/src/api/client.ts`): Axios instance with interceptors for Bearer token injection, 401 auto-logout, network error fallback probing, and global toast on errors. Use `payloadClient.get/post/put/delete` to auto-unwrap `{ data: ... }` from the API envelope.

Vite builds **only** Electron or Capacitor targets — plain web build is blocked (`vite.config.ts`). `VITE_ELECTRON=1` or `VITE_CAPACITOR=1` is always required.

### Desktop: Electron shell

- `main.js`: main process (window management, auto-update via `electron-updater`, local print, IPC)
- `preload.js`: exposes safe APIs to renderer
- `lib/update.js`: checks `/latest.json` on server, compares with `desktop/package.json` version
- Builds MUST run on GitHub Actions Windows runner (NSIS 3.0.4.1). Local Mac builds may produce broken installers.

### Database

MySQL 8.0, charset `utf8mb4_unicode_ci`. Tables use `[module]_[resource]` naming (e.g., `inventory_containers`, `sale_orders`). All tables have `created_at`/`updated_at` timestamps. Logical deletes via `deleted_at` column.

## Key design constraints

- **Coding convention**: all user-facing text in Chinese; variable/function names in English.
- **API responses**: every endpoint returns `{ success: boolean, message: string, data: object|null }`. List endpoints include `data.pagination: { page, pageSize, total }`.
- **API paths**: lowercase, hyphen-separated, plural nouns. Max 2 levels of nesting.
- **No local desktop builds for production**: desktop installers must come from GitHub Actions. The local `makensis` may be too new and produce broken EXEs.
- **Database migrations are explicit**: run `npm run migrate` in backend before deployment. No auto-migration on startup.
- **Production changes must go through `main` branch**: `main` is the single source of truth. Push to main triggers browser deploy; `v*` tags trigger desktop build.

## Deploy & server

- Production server: `root@47.93.228.251`, project at `/opt/flowcube`
- SSH alias: `flowcube-prod` (key: `~/.ssh/flowcube_deploy_ed25519`)
- Browser deploy: push to `main` → GitHub Actions (`deploy-browser.yml`) → SSH → `git reset --hard` to commit SHA → `docker compose up -d --build backend frontend`
- Desktop update feed: `/var/www/flowcube-downloads/latest.json` served by nginx
- Emergency manual deploy: `ssh flowcube-prod 'cd /opt/flowcube && SKIP_RELEASE_GATE=1 bash scripts/server-update.sh'`

## Repository management

- This repo uses **git worktrees** for Claude Code sessions. The main repo is at `/Users/chengjianghao/flowcube`. Active worktrees are in `.claude/worktrees/`.
- Commit style: Chinese-language descriptions, conventional prefix (`fix:`, `feat:`, `refactor:`, `release:`, `chore:`, `ci:`, `docs:`, `security:`).
- Deploy config (`deploy/production.local.json`) is gitignored. Use `deploy/production.example.json` as reference.
- GitHub repo: `chengjianghao439/flowcube2026`.
