# v0.11.3 发布准备与验证结果（2026-09-29）

> 状态：**v0.11.3 已正式发布**（应用 SHA **`b5280a42bce92ad51eff3fa5caa04fe4b84b4351`**、tag `v0.11.3`、桌面/PDA/浏览器三端线上核对 **12/12**）。**首轮正式入口曾因 CI 未通过而自动中止**（未推 tag、未公开发布安装包），修复夹具分类依赖后第二次执行成功 —— **失败与恢复过程如实保留**（见 §7/§8）。
>
> **明确未验**：**生产 `information_schema` 的 `revision` 列元数据与 `db_migrations` 的 263/264 记录**（本机权限分类器拒绝生产库 SQL 读取，**未用本地列替代**）；**`test:dirty-navigation` 本地未通过**（同机基线 `29f223e` 同超时，**CI 同 SHA 已过**）；**Windows 真机安装/更新弹窗、PDA 真机、物理打印**。
> 脚本日志留在本机 `/tmp/rel*.log`，未纳入仓库。

## 1. 版本与候选

- 起始：本轮发版准备自 **2026-09-29 01:16** 前后开始（基线 `main`/`origin main` = `29f223e`，工作树 `claude/happy-mahavira-0a2b4b`）。
- 版本：**0.11.3**（三端 `package.json`/`package-lock.json` 同步；PDA `versionName 0.11.3`、**`versionCode 146 → 147`**、`backend/apk/version.json` 同步）。
- 发布范围（口径说明，避免混淆多组数字）：
  - **发版准备起始基线**（当时工作树 HEAD `dba7693`）相对 `main`：**89 提交 / 91 文件**（**24 fix + 2 feat** + docs/test）—— **开始发版准备时**的统计。
  - **历史候选 `82fde4f` 时**相对 `29f223e`：**93 提交 / 102 文件**（当时 `+8760/−360`）—— 该数字**只代表那个时点**，非最终。
  - **最终发布 SHA `b5280a4` 相对 `29f223e`：95 提交 / 102 文件（+8845 / −360）**（已按 `git rev-list --count` 与 `git diff --stat` 复核）。
  - 含迁移 **263**（`fin_invoices.revision`）与 **264**（`product_items.revision`）——**不只最近 3 处修复**。
- 候选演进（本工作树分支）：
  1. `17e1a0c` — 版本与说明（release notes + 官网摘要 + 三端/PDA 版本）
  2. `72c6604` — CI 接线（孤儿套件 `smoke:product-price-history-integrity`）+ 转采购文案末句收紧
  3. `8eefff4` — 用户可见文案一致性修复（库存条码 / 出库时记录的成本）+ 同语义测试同步
  4. `82fde4f` — 发布说明术语同步 + 本结果文档初版（**未被单独推送或发布**）
  5. `846c707` — 结果记录三处证据口径修正（**首轮正式入口推送的 SHA**；该轮因 CI 未通过而自动中止：Tests `36460483357` failure）
  6. `b5280a4` — **商品价格三套夹具自备分类种子**（修复阻断；**第二次正式入口发布、最终应用 SHA**）
  7. `724c61a` — 本结果文档的发布结果更新（**本地文档提交，未 push**）

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
- **与本批改动无关（真实基线验证）**：在主工作区 `/Users/chengjianghao/flowcube`（**干净 `main` = `29f223e`、frontend 依赖齐备、未迁移/未连 DB/未改 git/未装 root 依赖**）以 Node 22 直接执行 `npm run test:dirty-navigation` ⇒ **同样 `exit 1`、同样 `Wait timed out after 25000ms`**，脚本自身在 `finally` 关闭浏览器（`session list = []`）。
  > 说明：早前"基线对照"用例曾用 `29f223e` 的 **fixture 文件** + **当前 frontend** symlink，**不足以代表旧版本完整代码**；**上面这次主工作区完整基线才是有效证据**，结论相同 ⇒ 该超时**不是本版回归**。**不再继续分散诊断**，本地保留为待查项，由同 SHA 的 CI 门槛决定后续。
- **仍不能确认的部分**：是 `file://` 下 HashRouter/`history` 操作把当前条目退到 `about:blank`，还是 agent-browser 的 `file://` 打开语义所致——**根因待查**，本轮**不据此改任何生产导航逻辑**。CI 有独立 job，**同 SHA 仍须通过**。

## 3. 已验证（本轮真实执行，非引用旧数字）

**静态 / 契约**：`test:landing-updates` OK｜backend lint、frontend lint（0 errors / 32 既有 warnings）、`tsc -p tsconfig.app.json` rc=0｜**前端全量单测 146 文件 / 685 例、18s、exit 0**｜`test:export-filters`、`test:print-barcode-void`、`test:copy-conventions`、`test:qty-precision-coverage`、`test:upload`、`test:export`、`test:acceptance-fixes`、`test:audit-tooling`、`test:audit-client`、`test:prelaunch-runtime`、`test:round2-runtime`、`test:release-tooling`、`test:mysql8-dev-script`、`test:warehouse-scan-closure`、`test:fulfillment`、`test:fulfillment-refresh`、`test:procurement-planning` 全 exit 0｜`test:deployment-resources` 26/0｜`test:route-permission-contract`、`test:api-route-contract`、`test:sql-identifier`、`test:sql-placeholder`、`test:logger-args-order`、`test:eslint-disable-rationale`、`node --test tests/status-rules-integrity.test.js` 1/0｜`release:check-downloads`、`schema-reconcile --strict`（7 个活跃唯一键列序正确）exit 0｜cors / pda-only-client-header / migration-trigger-bodies / restore-trigger-normalize / ops-monitor-restore 39/0｜search-scope / users-roles 2/0｜`actionlint` 无输出。

**后端（本轮新库 `flowcube_release20260929_test`，utf8mb4_0900_ai_ci，264 迁移）**：`price-list-bind-customer` 10/0｜`report-cost-basis` fail 0｜`price-change-history` 10/0（见上）｜**`product-price-history-integrity` 17/0**（本轮补接线后经真实命令入口）｜`invoice-quota` 55/0｜**`invoice-edit-concurrency` 13/0**｜**`product-price-version-guard` 20/0**｜`print-barcode-void` 11/0｜**`print-barcode-void-receipt` 12/0**｜`sale-adjustment` 72/0｜`atp` 8/0｜`mainline` 49/0｜`concurrency-guards` 121/0｜`p0-regression` 43/0｜`p1-regression` 45/0｜`finance` 118/0｜`accounting` 11/0｜`accounting-period` 20/0｜`accounting-sale-period` fail 0｜`fulfillment-credit` exit 0｜`warehouse-scope` 43/0｜`pda-device-session` 28/0｜`refund-orders` 14/0｜`disposal` 27/0｜`party-ledger`、`payments-default-scope`、`qty-precision`、`direct-express` 通过｜`audit-remediation-20260924`、`audit-inventory` 25/0、`audit-2026-09-18` 31/0、`audit-remediation`、`audit-finance-security` 17/0｜`label-render-degrade`、`dashboard-sales-v2`、`operation-request-concurrency` 8/0｜`print-queue` 14/0、`print-template-preview` 30/0｜`credit-outbound` 6/0、`credit-override` 11/0、`approval-flow` 30/0、`purchase-approval` 6/0、`user-account-management`、`auth-session-remediation`、`confirmed-audit`｜`reports-values` 60/0、`warehouse-ops` 39/0｜`print-purge` 4/0、`purchase-repair`、`product-finder`、`approval-list-batches`、`search-all-dates`、`pda-scan-focus`、`pda-list-refresh`、`sale-revenue-discount`、`hr-tax` 11/0、`document-activity`、`workbench`、`oplog`。

**prelaunch 矩阵（13 个 suite，按 **smoke** 语义执行）**：`prelaunch-finance` 15/0、`prelaunch-scope-export` 34/0、`prelaunch-hr`、`round2-transfer`、`round2-payroll`、`round2-runtime`、`fulfillment`、`procurement-planning`、`masterdata`（smoke，先前已过）、`masterdata-import`、`sorting-bin-recovery`、`warehouse-masterdata`、`warehouse-assets-waves` —— **13/13 覆盖**。
> 更正记录：首次 loop 误用 `test:round2-runtime` / `test:fulfillment` / `test:procurement-planning`（**与 smoke 是不同的文件/规模**）；已补跑三者的 **smoke** 版本，均 exit 0。**不得写成「test 版本已覆盖矩阵」。**

**prelaunch 专项**：`smoke:audit-20260926`（`payable-posting` + 8 个 `node --test` 专项）exit 0、12s。
关于其独占库 `flowcube_payable_test`（口径如实）：
- **本轮未手工 `DROP` 或清空整个库**；该套件脚本自身在运行中会**准备并清理自己的测试夹具**（`resetFixtureData` + `finally`），因此**不能说"未清理该库"**；
- 预检仅执行了**若干张表的 `COUNT`**（`payment_records` / `sale_orders` / `purchase_orders` / `inventory_containers` 为 0 行，`product_items` 1、`sys_users` 3 属测试种子），**不能由这几张计数断言"全库不含任何他人数据"**；
- 该库迁移记录为 **262**（**本轮未把它补迁到 264**）。

**其它**：`test:integration` **96 passed / 0 failed**（另建独立库 `flowcube_integration_release20260929_test`，264 迁移）｜`test:browser-smoke` exit 0（32s，按 CI 锁文件装依赖 + 官方 Chromium）。

**构建**：ERP `build` 5s、PDA `build:pda` 11s（文案修复后各复跑一次，均 exit 0）。

## 4. 未跑 / 环境限制（如实，不称全量已过）

- **`test:dirty-navigation`**：本机 **未通过**（超时）。已确认：fixture **执行过**（console 有 `bundle-start`）、采样页为 `about:blank`（单标签，非选错 tab）、**基线 `29f223e` 同表现**；**根因待查**，见 §2。CI 同 SHA 仍须通过。
- `smoke:nginx-headers`：仅在 `DOCKER_CONTEXT=colima-flowcube` 下通过；默认 docker socket 不可达（本机）。

## 5. 独立未验（不可用本轮结果替代）

**Windows 真机安装与更新弹窗**、**PDA 真机安装与更新**、**物理打印**。
（**Windows 安装包已由 CI 构建并发布**、**生产部署与线上三端核对均已完成** —— 见 §8，不在此列。）

## 6. 资源收尾

`:3000` / `:3100` / `:5173` **无监听**；浏览器会话 `session list` **为空**（仅收尾自己创建的会话）；**共享 MySQL `127.0.0.1:3307` 保留**。本轮新建两个验收库保留（`flowcube_release20260929_test`、`flowcube_integration_release20260929_test`）。未触碰开发库 `flowcube_dev8`、`backend/.env` 真实口令、`deploy/production*.json`、真实客户账款。

## 7. CI 阻断与夹具修复（2026-09-29，正式入口首次尝试）

- **首次执行 `release:prod`**：preflight 通过、**main 已推送**（`29f223e..846c707`）；随后 `test.yml` 在同 SHA **failure** ⇒ 入口**自动 exit 1 并收尾**（EXIT 清 relay/caffeinate，已核实无残留）；**未推送 tag、未公开发布新安装包**（远端 `v0.11.3` 不存在；CI 侧可能已构建过 artifact，但**未对外发布**）。
- **失败 run / job / 步骤（保留原记录，未取消、未 rerun）**：Tests run **`36460483357`**（SHA `846c707`）→ 回归门禁 job **`109057476294`** → 步骤「**冒烟测试 — 商品价格列版本保护（依赖迁移 264）**」。
- **失败原因（CI 日志）**：`tests/product-price-version-guard.smoke.test.js:74` 抛 **「隔离库无商品分类」**；该套件只通过清理断言 1 项，**未跑到价格保护主断言**。
- **本地为何没暴露（如实）**：本批本地验证时，我**手工向库中插入了一条商品分类**补足种子，使该套件本地 20/0 —— **掩盖了「新库无分类」这一环境前提**。
- **性质**：测试夹具的环境依赖问题，**非生产逻辑缺陷**（三套均为 fixture 改动，**未改任何生产源码**）。
- **同类依赖**：`product-price-history-integrity` 的 `newProduct` 取首条分类；`price-change-history-oldprice` 两处「需要至少一个商品分类」。
- **修复**：三套改为**优先复用库中已有分类；零分类时自建一条并登记**，`finally` **按 ID 删除**（保留他人数据），并**断言自建分类残留为 0**（三套均纳入 passed/failed 统计；第三套原仅 `console.log`，已补断言，残留 >0 时进程非 0 退出）。
- **验证（新库 `flowcube_pricefix_20260929_test`，`utf8mb4_0900_ai_ci`、264 迁移、**迁移后 `product_categories = 0`**）**：按 CI 顺序 —— `smoke:product-price-version-guard` **21/0**、`smoke:price-change-history` **11/0**、`smoke:product-price-history-integrity` **18/0**；三套跑完**分类残留 0**。
- **不再有**「依赖库中已存在分类」的前提；**该修复已随第二次正式入口发布**（应用 SHA `b5280a4`），**同 SHA 的全部 CI 已自然通过**（Tests `36461598648`、Security `36461598413`、Deploy Browser `36461598451`、Build PDA APK `36461598493`、main 桌面验证 `36461598445`、tag 桌面包 `36462769682`）。

## 8. 正式发布结果（**已执行**，2026-09-29）

**发布应用 SHA（固定）：`b5280a42bce92ad51eff3fa5caa04fe4b84b4351`**。
（本结果文档**自身**的版本以 `git log -1 -- docs/release-v0.11.3-result.md` 为准；文档为**本地提交、未 push**，其最终 SHA 由工具在提交后回报，**本文不自引用**。）

| 步骤 | 状态 | 证据 |
|---|---|---|
| push main | **已执行** | 首次 `29f223e..846c707`（后被 CI 阻断）；修复后 `846c707..b5280a4` |
| tag `v0.11.3` | **已推送** | 指向 `b5280a4` |
| Windows 正式包 | **已构建并发布** | tag run **`36462769682`**；产物 `Jixu-Flow-Setup-0.11.3.exe`（112,401,506 字节） |
| GitHub Release | **已转正**（非草稿/非预发布） | 附件 `Jixu-Flow-Setup-0.11.3.exe` = 112,401,506 字节 |
| PDA 发布 | **已发布** | 线上 `/api/pda/version` = **0.11.3 / versionCode 147**、可下载 |
| 线上三端核验 | **12/12 一致** | 桌面 0.11.3、PDA 0.11.3/147、`/api/health=ok`；**实下载**桌面 **112,401,506 字节**、PDA **15,088,641 字节**，摘要均一致（`release:verify` 自然 exit 0，Codex 独立复跑一致） |
| **文件 SHA256（完整）** | — | **EXE** `dfbabf3bd36c001b2d8c9ac94cb9496dd1ccc773d045823945fdcb77e5f7c031`；**APK** `a4ecf6ff8a0a0e16956323d407d8e36b896eede7003c9e0b10039617febc24c5`；**GitHub Release asset digest 与线上 EXE 相同** |
| 镜像 revision | **= `b5280a4`** | 生产 `flowcube-backend` 镜像 label `org.opencontainers.image.revision` |
| 生产迁移 | **263/264 已执行** | Deploy Browser 日志：`✓ 263_…`、`✓ 264_…`，「共执行 2 个迁移文件」，其后幂等跳过 |
| 计时 | **分列如下（不换起点）** | 见下 |

**计时分列（不换起点、不抹掉失败）**：
- 发版准备开始：**01:16** 前后（本批工作起点，近似）
- **第一次**正式触发：**01:46:14**（GH run `36460483357` createdAt）→ 因 CI 未通过**自动中止**
- **修复后第二次**正式触发：**01:55:42**（GH run `36461598648`）
- Codex 最终核验记录时点：**02:12:52**（UTC 18:12:52）
- ⇒ 准备起点 → 最终核验：**约 56 分 52 秒**（起点近似）
- ⇒ **首次正式触发 → 最终核验：26 分 38 秒**
- ⇒ **第二次入口自报耗时：893 秒**（含检查、部署与下载验收）

**同 SHA 的门禁 run（全部 success）**：Tests `36461598648`（17 jobs）、Security `36461598413`、Deploy Browser `36461598451`、Build PDA APK `36461598493`、main 桌面验证 `36461598445`。
**首次阻断 run（保留，未取消、未 rerun）**：Tests `36460483357`、失败 job `109057476294`（商品价格列版本保护）。
**修复轮**：工作树 `8eefff4`→`846c707`→**`b5280a4`**；期间发现并修复三套夹具的分类依赖（含**首轮修复漏改 `cat` 变量导致的 1 项失败**，复验后 21/0、11/0、18/0）。

**未验（明确限制，不用本地替代生产）**：
- **生产 `information_schema` 的 `revision` 列元数据**（`fin_invoices`/`product_items` 的列名 / `int` / `NOT NULL` / `default 1`）与**生产 `db_migrations` 的 263/264 记录**：本机 **auto 权限分类器两次拒绝**生产库 SQL 读取（`Containment Escape`、`Production Reads`）⇒ **未取得**。**迁移已执行**这一事实由部署日志证实；**未验的只是生产库现状的直接读取**。
- **`test:dirty-navigation` 本地未通过**（同机基线 `29f223e` 同样超时；根因待查）；**同 SHA 的 CI `browser-smoke-runtime` 通过**。
- **Windows 真机安装/更新弹窗、PDA 真机、物理打印**：独立未验。

**资源收尾**：入口 relay/caffeinate **已随 EXIT 收尾**（复核无残留）；主工作区停在 **`codex/release-v0.11.3`**（HEAD `b5280a4`、clean，**main 已释放**）；Claude 工作树仍在 `claude/happy-mahavira-0a2b4b`；`/private/tmp/fc-head`（prunable）与共享 MySQL **非本任务资源、未动**。
