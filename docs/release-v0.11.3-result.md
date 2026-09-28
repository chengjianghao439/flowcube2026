# v0.11.3 发布准备与验证结果（2026-09-29）

> 状态：**发版前准备完成，停在 push 前**。**正式发布字段（push / tag / 桌面构建 / PDA 发布 / 线上核验）均为「未执行」**，待授权后由唯一入口 `npm run release:prod` 执行。
> 脚本日志留在本机 `/tmp/rel*.log`，未纳入仓库。

## 1. 版本与候选

- 起始：本轮发版准备自 **2026-09-29 01:16** 前后开始（基线 `main`/`origin main` = `29f223e`，工作树 `claude/happy-mahavira-0a2b4b`）。
- 版本：**0.11.3**（三端 `package.json`/`package-lock.json` 同步；PDA `versionName 0.11.3`、**`versionCode 146 → 147`**、`backend/apk/version.json` 同步）。
- 发布范围：`main...HEAD` 共 **89 提交 / 91 文件**（**24 fix + 2 feat** + docs/test），含迁移 **263**（`fin_invoices.revision`）与 **264**（`product_items.revision`）——**不只最近 3 处修复**。
- 候选演进（本工作树分支）：
  1. `17e1a0c` — 版本与说明（release notes + 官网摘要 + 三端/PDA 版本）
  2. `72c6604` — CI 接线（孤儿套件 `smoke:product-price-history-integrity`）+ 转采购文案末句收紧
  3. `8eefff4` — 用户可见文案一致性修复（库存条码 / 出库时记录的成本）+ 同语义测试同步
  4. **本文件所在提交** — 发布说明术语同步 + 本结果文档

## 2. 首次失败 → 定位 → 修复（分别记录，均保留首次失败）

| 项 | 首次结果 | 根因（证伪） | 处置 | 复验 |
|---|---|---|---|---|
| `test:copy-conventions` | **exit 1，8 处违规** | 本批 `0f4198e`/`f01ad51`（报表「快照」）、`5f6ede9`（「容器」）引入**内部术语外露** | 只改用户可见中文值：容器条码→**库存条码**、未出纸（容器已作废）→**未出纸（库存条码已作废）**、出库成本快照→**出库时记录的成本**；**前后端 + 导出 + 界面 + 同语义测试**统一；注释/内部枚举未动 | **exit 0** |
| `test:audit-client` | **exit 1，9 项** | 9 项全为 `MODULE_NOT_FOUND: semver`（本机 `desktop/node_modules` 未装），**非产品行为失败** | 按 CI 步骤 `npm --prefix desktop ci --ignore-scripts --omit=dev`（不下载 Electron） | **33 pass / 0 fail**（证书/摘要守卫未弱化） |
| `smoke:price-change-history`（新库首跑） | **8 passed / 2 failed** | 「需要至少一个商品分类」——**新库缺基础种子**（`prepareSmokeContext` 不建分类） | 补最小分类（本轮验收数据） | **10 passed / 0 failed** |
| `test:status-rules-integrity`（我用错入口） | **exit 1** | 该名**不是 npm script**（CI 写作 `node tests/status-rules-integrity.test.js`）⇒ 命令错误，非产品失败 | 改用 CI 写法 | **pass 1 / fail 0** |
| `smoke:nginx-headers` | **exit 1** | `docker` 默认 socket 不可达（本机 daemon 不在 `/var/run/docker.sock`） | 用 `DOCKER_CONTEXT=colima-flowcube`（共享 MySQL 所在 context；脚本用具名容器 + `finally` 只清自己的资源，未停共享 MySQL） | **pass 1 / fail 0** |
| `test:dirty-navigation` | **exit 1（超时 25s）**，重跑**仍失败** | **最小诊断 v3**（临时 fixture 副本注入阶段标记 + `tab list`/`console`/`errors` + **open 后立即读**与 3s 后比较 + **基线 `29f223e` fixture 对照**；会话 finally 关闭） | **不改脚本/超时/断言** | **未通过**（首轮与重跑超时均保留） |

**`test:dirty-navigation` 的已确认事实（不写"从未运行"，也不写"环境限制"结论）**：

- **fixture 确实执行过**：`agent-browser console` 中可见注入的阶段标记 **`[FIXTURE_STAGE] bundle-start`**，且伴随 React DevTools 提示（React 已加载）⇒ 先前"fixture 从未运行"的判断**被推翻**。
- **采样时页面不在 fixture 页**：`agent-browser tab list` 与 `location.href` 均为 **`about:blank`**（**只有 t1 一个标签**，故**不是 CLI 选错 tab**）；`errors` 为空。
- **与本批改动无关**：**基线 `29f223e` 的 fixture 在同机同法下表现完全相同**（同样 `about:blank`、同样有 `bundle-start` 标记）⇒ 该现象**不是本版回归**。
- **仍不能确认的部分**：是 `file://` 下 HashRouter/`history` 操作把当前条目退到 `about:blank`，还是 agent-browser 的 `file://` 打开语义所致——**根因待查**，本轮**不据此改任何生产导航逻辑**。CI 有独立 job，**同 SHA 仍须通过**。

## 3. 已验证（本轮真实执行，非引用旧数字）

**静态 / 契约**：`test:landing-updates` OK｜backend lint、frontend lint（0 errors / 32 既有 warnings）、`tsc -p tsconfig.app.json` rc=0｜**前端全量单测 146 文件 / 685 例、18s、exit 0**｜`test:export-filters`、`test:print-barcode-void`、`test:copy-conventions`、`test:qty-precision-coverage`、`test:upload`、`test:export`、`test:acceptance-fixes`、`test:audit-tooling`、`test:audit-client`、`test:prelaunch-runtime`、`test:round2-runtime`、`test:release-tooling`、`test:mysql8-dev-script`、`test:warehouse-scan-closure`、`test:fulfillment`、`test:fulfillment-refresh`、`test:procurement-planning` 全 exit 0｜`test:deployment-resources` 26/0｜`test:route-permission-contract`、`test:api-route-contract`、`test:sql-identifier`、`test:sql-placeholder`、`test:logger-args-order`、`test:eslint-disable-rationale`、`node --test tests/status-rules-integrity.test.js` 1/0｜`release:check-downloads`、`schema-reconcile --strict`（7 个活跃唯一键列序正确）exit 0｜cors / pda-only-client-header / migration-trigger-bodies / restore-trigger-normalize / ops-monitor-restore 39/0｜search-scope / users-roles 2/0｜`actionlint` 无输出。

**后端（本轮新库 `flowcube_release20260929_test`，utf8mb4_0900_ai_ci，264 迁移）**：`price-list-bind-customer` 10/0｜`report-cost-basis` fail 0｜`price-change-history` 10/0（见上）｜**`product-price-history-integrity` 17/0**（本轮补接线后经真实命令入口）｜`invoice-quota` 55/0｜**`invoice-edit-concurrency` 13/0**｜**`product-price-version-guard` 20/0**｜`print-barcode-void` 11/0｜**`print-barcode-void-receipt` 12/0**｜`sale-adjustment` 72/0｜`atp` 8/0｜`mainline` 49/0｜`concurrency-guards` 121/0｜`p0-regression` 43/0｜`p1-regression` 45/0｜`finance` 118/0｜`accounting` 11/0｜`accounting-period` 20/0｜`accounting-sale-period` fail 0｜`fulfillment-credit` exit 0｜`warehouse-scope` 43/0｜`pda-device-session` 28/0｜`refund-orders` 14/0｜`disposal` 27/0｜`party-ledger`、`payments-default-scope`、`qty-precision`、`direct-express` 通过｜`audit-remediation-20260924`、`audit-inventory` 25/0、`audit-2026-09-18` 31/0、`audit-remediation`、`audit-finance-security` 17/0｜`label-render-degrade`、`dashboard-sales-v2`、`operation-request-concurrency` 8/0｜`print-queue` 14/0、`print-template-preview` 30/0｜`credit-outbound` 6/0、`credit-override` 11/0、`approval-flow` 30/0、`purchase-approval` 6/0、`user-account-management`、`auth-session-remediation`、`confirmed-audit`｜`reports-values` 60/0、`warehouse-ops` 39/0｜`print-purge` 4/0、`purchase-repair`、`product-finder`、`approval-list-batches`、`search-all-dates`、`pda-scan-focus`、`pda-list-refresh`、`sale-revenue-discount`、`hr-tax` 11/0、`document-activity`、`workbench`、`oplog`。

**prelaunch 矩阵（13 个 suite，按 **smoke** 语义执行）**：`prelaunch-finance` 15/0、`prelaunch-scope-export` 34/0、`prelaunch-hr`、`round2-transfer`、`round2-payroll`、`round2-runtime`、`fulfillment`、`procurement-planning`、`masterdata`（smoke，先前已过）、`masterdata-import`、`sorting-bin-recovery`、`warehouse-masterdata`、`warehouse-assets-waves` —— **13/13 覆盖**。
> 更正记录：首次 loop 误用 `test:round2-runtime` / `test:fulfillment` / `test:procurement-planning`（**与 smoke 是不同的文件/规模**）；已补跑三者的 **smoke** 版本，均 exit 0。**不得写成「test 版本已覆盖矩阵」。**

**prelaunch 专项**：`smoke:audit-20260926`（`payable-posting` + 8 个 `node --test` 专项）exit 0、12s。`flowcube_payable_test` 只读核对：142 表 / 262 迁移，业务表仅测试种子（`payment_records` 0、`sale_orders` 0、`product_items` 1、`sys_users` 3）⇒ **无他人数据**，未清理该库。

**其它**：`test:integration` **96 passed / 0 failed**（另建独立库 `flowcube_integration_release20260929_test`，264 迁移）｜`test:browser-smoke` exit 0（32s，按 CI 锁文件装依赖 + 官方 Chromium）。

**构建**：ERP `build` 5s、PDA `build:pda` 11s（文案修复后各复跑一次，均 exit 0）。

## 4. 未跑 / 环境限制（如实，不称全量已过）

- **`test:dirty-navigation`**：本机 **未通过**（超时）。已确认：fixture **执行过**（console 有 `bundle-start`）、采样页为 `about:blank`（单标签，非选错 tab）、**基线 `29f223e` 同表现**；**根因待查**，见 §2。CI 同 SHA 仍须通过。
- `smoke:nginx-headers`：仅在 `DOCKER_CONTEXT=colima-flowcube` 下通过；默认 docker socket 不可达（本机）。
- 未逐条执行的少数组件（如 `smoke:audit-remediation` 之外的个别 prelaunch matrix 变体）**由 CI 在正式候选同 SHA 完整验证**。

## 5. 独立未验（不可用本轮结果替代）

**Windows 安装包**（由 CI Windows runner 构建）、**PDA 真机安装与更新**、**物理打印**、**生产部署与线上三端核对**。

## 6. 资源收尾

`:3000` / `:3100` / `:5173` **无监听**；浏览器会话 `session list` **为空**（仅收尾自己创建的会话）；**共享 MySQL `127.0.0.1:3307` 保留**。本轮新建两个验收库保留（`flowcube_release20260929_test`、`flowcube_integration_release20260929_test`）。未触碰开发库 `flowcube_dev8`、`backend/.env` 真实口令、`deploy/production*.json`、真实客户账款。

## 7. 正式发布字段（**未执行**）

| 字段 | 值 |
|---|---|
| push main | **未执行** |
| tag `v0.11.3` | **未执行** |
| 桌面安装包构建 | **未执行** |
| PDA 发布 | **未执行** |
| 线上三端核验（`release:verify`） | **未执行** |
| 完整应用 SHA | 见提交后 `git rev-parse HEAD` |
