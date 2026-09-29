# v0.11.4 本地发布候选（准备记录）

> 状态：**本地候选，未发布**。本记录说明候选范围与验证边界；**未 push / 未打 tag / 未部署 / 未连生产 / 未读生产配置**。

## 1. 候选范围（相对 v0.11.3）

窄范围修复，只涉及资金类入口「提交结果查询」的显示与恢复：

- 手工应付：查询成功时不再把**当前输入框改动过的单号**显示成「已创建」的单号。
- **收付款登记、继续核销已有收付款单、退款执行**：查询按**本次实际提交的那一张单据**定位。
- 换到另一笔单据后再查上一笔：成功后**不关闭当前正在填写/查看的弹窗**。
- 提交结果未确定期间又发起新提交：**晚返回的旧查询不清掉后一次提交的「未确认」状态**。

**未改**：账务/库存/权限规则、结账期间闸门、账户余额与单据状态校验、公共 PDA 语义；**新建收付款单（创建类）的载荷指纹机制未改**——本版只调整**查询用哪个身份去核对**，不改变写入用的身份与后端回放。

## 2. 已验证（上一轮，对应产品源码 `241c2b5`）

均为**本地**结果，**不是**整套 GitHub CI / 生产部署 / 真实 GUI 的通过证据：

- 两端 lint、`tsc -p frontend/tsconfig.app.json`、**全前端 149 文件 / 695 用例**、`test.yml` 静态/纯规则 **61 个命令** —— 全 exit 0。
- **16 个相关 DB 回归** —— 全 exit 0，运行于三套独立新库（各 **264** 迁移，**未碰 GUI 库**）：
  `flowcube_release_gate_20260929_test`、`flowcube_release_gate_integration_20260929_test`、`flowcube_release_gate_audit_20260929_test`。
- **桌面 renderer build、PDA renderer build** exit 0。
- 逐项记录：`output/local-gate-20260929/results.json`（79 项 exit 0 + 1 项「不适用构建的拒绝」）。

## 3. 未验边界（集中记录，**不写进用户说明与官网文案**）

- **资金时序的完整界面链路未验**：A「事务未提交时查回执」只完成**真实 HTTP + 受控行锁**的接口级验证；其**在途 GUI**、`pending`、B「旧查询晚于新提交返回」均**未构成完整界面证据**（组件层有测试，不等同界面验收）。
- 核销 settle 的「改载荷后同键重提」反例未构造。
- 物理打印未验；未构建 Windows installer、未构建原生 APK、未做真机验收。
- **整套 GitHub CI 与生产发布未执行**。

## 4. 既定设计（不算回归）

- **纯 Web build** 尝试 exit 1 属既定设计：`frontend/vite.config.ts:99-103` 已有取消纯 Web ERP 的守卫，`8017df6` 基线同样存在；属验证计划选择错误。

## 5. 验证分列（**两轮，勿混用**）

**A. 上一轮：产品源码验证（对应 `241c2b5`）** —— 本地结果，非整套 GitHub CI / 生产 / 真实 GUI 证据：
- 两端 lint、`tsc -p frontend/tsconfig.app.json`、**全前端 149 文件 / 695 用例**、`test.yml` 静态/纯规则 **61 个命令**，全 exit 0。
- **16 个相关 DB 回归**，全 exit 0；运行于三套独立新库（各 **264** 迁移，未碰 GUI 库）：`flowcube_release_gate_20260929_test`、`flowcube_release_gate_integration_20260929_test`、`flowcube_release_gate_audit_20260929_test`。
- 桌面 renderer build、PDA renderer build exit 0。
- 逐项记录：`output/local-gate-20260929/results.json`（79 exit 0 + 1 项「不适用构建的拒绝」）。

**B. 本候选：6 项受影响检查（Node 22.23.2，均自然 `exit 0`、`signal=null`）** —— 只覆盖本轮**版本 metadata 变化**：
1. **版本 metadata 断言**：三端 `package.json` / `package-lock.json` 均为 0.11.4，**只变版本、无依赖漂移**；PDA **0.11.4 / versionCode 148**；`publishedAt` 仍 `2026-09-29T04:09:05.536Z`；`releaseNote` 等于 `docs/release-notes/0.11.4.md` 的新首段；**业务源码未变**。
2. `test:landing-updates`：**36 条，最新 0.11.4**。
3. `frontend/src/pages/landing/updates.ts` **eslint**。
4. `tsc -p frontend/tsconfig.app.json --noEmit`。
5. **桌面 renderer build**。
6. **PDA renderer build**。

逐项日志：`output/release-candidate-0.11.4/results.json`（**未纳入版本库**）。

**仍未验**：**整套正式 CI / 安装包构建 / 生产发布**，以及 §3 列出的**资金时序 A/B 界面链路**、`pending`、settle 改载荷反例、物理打印、原生安装包/真机。

**远端未刷新**：本机 `main` 与 `origin/main` 缓存均为 `b5280a4`（v0.11.3 应用 SHA）；本轮**未 fetch**。

## 6. 正式发布（须**新的明确授权**，且走唯一入口）

发布**只能**通过项目既有唯一入口 `npm run release:prod`（`release-flowcube` 技能流程）执行，**不得手工绕入口打 tag**。获明确授权后依次：

1. **刷新 `origin/main` 与远端 tag**，核对版本冲突；把**已审候选**安全合入 `main`。
2. 由 `npm run release:prod` 触发正式入口。
3. **等待候选同 SHA 的门禁全部成功**：`Tests`（含本批未覆盖的 job）、`Security Scan`、桌面端验证、**实际 Deploy Browser App 与 PDA 构建/发布**；**数据库迁移在 `Deploy Browser App` 阶段完成并核对 `db_migrations` 记录**（不放在线上验收之后）。
4. **tag 指向同一 `main` 应用 SHA**。
5. 最终**实下载 EXE / APK 并比对摘要**，跑 `release:verify` 完成线上验收（三端版本一致、`/api/pda/version` 一致）。

**边界**：**本次候选准备未执行任何生产动作**；正式发布须**新的明确授权**；**生产凭据与客户账款明细不得进入模型上下文**。

---

## 7. 本轮准备（**v0.11.4 完整范围**；上文 §1–§6 为**历史分节**，勿与本轮结果混用）

> 本节取代「窄资金范围」的写法：v0.11.4 的**实际发布范围**是本轮全量审阅过的改动，见下。**§5A 的「79 项」与三套 `flowcube_release_gate_*` 库属旧轮，不作为本轮证据。**

### 7.1 基线与远端事实（本轮实测）

- **应用基线（本轮起点）**：`71313ee`（`fix(pack): guard completion replay and label receipts`）。
- **相对 `origin/main` `b5280a4`**：领先 **24** 提交、落后 **0** ⇒ 可 fast-forward。
- **远端最新正式 tag**：**v0.11.3**（PDA versionCode 147）⇒ 本版 **v0.11.4 / versionCode 148**，**无版本冲突**。
- 三端 `package.json` 均为 **0.11.4**；`bump-version.sh 0.11.4` 同版本重跑**未重复增号**（148 → 148）。

### 7.2 本轮发布范围（相对 `b5280a4` / v0.11.3）

- **塑料盒作业流（A / B / C1–C4）**：放货与混批、扫盒取货与独立取货标签、分拣复核、装箱配额、取消归还，以及 **C1**（移出/作废稳定键）、**C2**（完成箱子回执事务）、**C3**（换任务恢复只认原键回执）、**C4**（打包完成重放与箱贴补打的幂等/范围/领域回执校验）。
- **资金恢复**：手工应付、收付款登记/核销、退款执行与手工应付复制的回执查询定位（即 §1 的窄资金范围，**仍在本版内**）。
- 用户说明与官网摘要已按此范围改写（措辞不夸大未验项）。

### 7.3 本轮 4 个新增迁移（265–268）

| 文件 | 目标（`information_schema` 实测） |
|---|---|
| `265_inventory_containers_mixed_batch` | `inventory_containers.is_mixed_batch` `tinyint(1)` NOT NULL DEFAULT 0 |
| `266_scan_logs_source_container_id` | `scan_logs.source_container_id` `bigint unsigned` NULL + 索引 `idx_scan_logs_source_container(source_container_id)` |
| `267_sorting_bin_items` | 新表 `sorting_bin_items` + `uk_task_container(task_id,container_id)` **唯一** + `idx_bin(bin_id)` |
| `268_package_items_label_container_id` | `package_items.label_container_id` `bigint unsigned` NULL + 索引 `idx_pi_label(label_container_id)` |

- **新独立库**：`flowcube_regress_20260929_test`（**`utf8mb4_0900_ai_ci`**，建库时硬断言 `NODE_ENV=test` / `127.0.0.1:3307` / `flowcube_*_test`）。完整迁移 **268 文件**；**幂等重跑**输出「所有迁移均已执行，无需更新」。
- **4 个原 SQL 的真幂等证据**（按项目 `splitSqlStatements` 分句后**逐句重跑**，**未动 `db_migrations`**）：265 **5/5**、266 **10/10**、267 **11/11**、268 **10/10**，全成功 0 失败。

### 7.4 本轮门禁（当前工作区，日志与自然退出码）

- **offline 第一批 39 项** + **第二批 16 项**：全 `exit 0`；逐项日志 `/tmp/rel-log/*.log`。
- **direct-node guards**：`ops-monitor-restore`/`restore-trigger-normalize`/`migration-trigger-bodies`/`cors-policy`/`pda-only-client-header` **39 pass / 0 fail**（`/tmp/rel-log/static-guards-extra.log`）；`deployment-resources` **26/26**（`/tmp/rel-deploy-guard.log`，**真实重验**，非 C4 旧轮 25/26）。
- **前端**：lint 0、`tsc -p tsconfig.app.json` 0、**全单测 151 文件 / 730 用例**（`/tmp/rel-fe-lint.log`、`rel-fe-tsc.log`、`rel-fe-test2.log`）；**后端 lint** 0（`be-lint.log`）。
- **构建**：frontend / PDA / desktop renderer 三者 `exit 0`（`build-fe.log`、`build-pda.log`、`build-desktop2.log`）。
- **DB 回归（新独立库）**：通用业务 8 项、打印/财务/报表 13 项、资金/价格/直营 7 项**全 exit 0**；`print-purge`、`integration` 亦 `exit 0`（`/tmp/rel-log/test-*.log`）。
- 本轮修复 3 处**过期夹具/断言**（均保留原失败记录）：`plastic-boxes/index.test.tsx` 补 `QueryClientProvider`；`scan-qty-comparison.test.js` 补 helpers mock；`print-template-preview.smoke.test.js` type 上界 10→11（越界值改 `12`）。

### 7.5 尚未执行的（留给**同 SHA 正式 CI**）

- `browser-smoke-runtime` / `dirty-navigation`（需真实浏览器）、`smoke:nginx-headers`（需 Docker daemon）。
- **塑料盒 9 专项**（CI `regression-plastic-box` 的全新 MySQL service）。
- **两个 repair DB smoke（`smoke:purchase-repair` / `smoke:legacy-receivable-repair`）不在当前 `test.yml` 的 job 清单内**（现清单只有纯逻辑 `test:purchase-repair`）⇒ 本批记 **不适用**；**不承诺**正式 CI 会运行它们。若将来需要验证，须**新建专属临时 MySQL 实例**，**不复用任何既有旧库**（见 `docs/incident-repair-db-2026-09-29.md`）。
- **整套正式 CI、安装包构建、生产部署、真实 GUI/真机/物理打印**均未执行。

### 7.6 授权状态

用户已**明确授权**本次 v0.11.4 的版本同步、合入 main、push、tag 与生产部署，并要求**唯一入口** `npm run release:prod`（禁止手工绕入口打 tag / 在生产编译）。**本轮准备阶段未执行任何生产动作。**
