# v0.11.4 发布 attempt 1 失败记录（2026-09-29）

> **结论：本次尝试未发布** —— 同 SHA 的 `test.yml` 未通过，`Deploy Browser App` 因门禁失败退出；
> **未打 tag、未部署**。原失败运行**保留、不取消**。应用 SHA 与各 run 链接如下，供独立复核。

## 1. 应用 SHA 与工作流

- 应用 SHA：**`cfd231d21c6e7eb2f8158ac35f37644a31ce51d3`**（`main` 已 push：`b5280a4..cfd231d`）
- 版本：`v0.11.4` / PDA `versionCode 148`

| Workflow | Run ID | 结果 |
|---|---|---|
| Tests | `36579261090` | **failure**（2 个 job 失败：`static` `109442817654`、`regression-plastic-box` `109442817650`） |
| Security Scan | `36579261089` | **success**（整体通过） |
| Browser（`Deploy Browser App`） | `36579260872` | **因门禁失败退出** |
| PDA | `36579261084` | **failure**（`preflight` / `build-pda` 为 success，**`wait-browser` failure**，`publish-pda` **skipped**） |
| Desktop（main 验证） | `36579261104` | 通过 |

> 记法说明：**PDA 该轮整体为 failure、并未发布 APK**（`publish-pda` 被跳过）——**不得**写成「PDA 通过」。
> 其余 job 的通过情况由 root 独立用 `gh` 核实。

## 2. 失败原因（两条，均非业务语义缺陷）

### 2.1 `static` / `copy-conventions`：11 处用户文案用了内部术语

`npm run test:copy-conventions` **真实 rc = 1**（`tests/copy-conventions.test.js:228` `process.exit(problems.length ? 1 : 0)`），
11 处违规（`快照`/`回执`/`容器`/`createContainer` 等实现词出现在**用户可见文案 / AppError 消息**）。

**已按最小方式仅改文字**（不改守卫、不改白名单、不改业务行为）：
`frontend/src/pages/pda/fill.tsx`、`pda/pack.tsx`、`pda/split.tsx`、`plastic-boxes/index.tsx`、
`backend/src/engine/containerEngine.js`、`backend/src/modules/packages/packages.receipt-guard.js`。
改后复跑 `test:copy-conventions` **rc=0 / 0 fail**。

### 2.2 `regression-plastic-box` / 第 12 步 `smoke:pick-cancel-return`（批 B4）

第 12 步第 5 案例 `PUT /api/packages/14/finish` → **409 `PRINT_BINDING_MISSING`**「未找到可用打印机」；
该套件 **4 pass / 1 fail**（A/B2/B3a/B3b 均通过，失败**不是**数量/库存反例）。

**根因**：C2 起 `finishPackage` 调 `printJobs.assertQueueReady({ jobType: 'package_label' })`，
`print-jobs.command.js` 对该用途用 `requireBinding=true, allowBindingFallback=false`：
`resolvePrinterForJob` **先查用途绑定**（`print-dispatch.js` 的 `fetchBindingCandidates` 命中
「**本仓** `b.warehouse_id = <任务仓>`」或「**公司级** `b.warehouse_id = 0`」的 `package_label` 绑定，本仓优先），
**没有候选时**才**拒绝回退**到未绑定的默认打印机。
⇒ 准确说法是「**缺少有效 `package_label` 用途绑定时拒绝回退到未绑定的默认打印机**」，
而**不是**「任何绑定命中之前就返回」或「全局打印机不满足」；**公司级有效绑定（`warehouse_id=0`）仍允许**。
（区分：**打印机自身**的 `printers.warehouse_id IS NULL` 与**绑定**的 `warehouse_id` 是两回事。）
B4 未自备该用途绑定，故 409。

**已修**：新增 `tests/helpers/ownedPrintFixture.js`（自建打印机 + 工作站 + 绑到本套仓库；
收尾按**当前 GET 归属**恢复原值/删除自身、**不覆盖他人指向**、停用后 GET 断言 `status=0`、
逐项尽力执行并聚合失败），并接入**三个**需要 `finish` 的专项：
`pick-cancel-return`、`pick-label-reprint-lifecycle`（其 S6 的 `claim-client`/`complete-client` 改用本套 `clientId`）、
`pack-finish-receipt-tx`。**未改** `finish` 业务闸门、未物理删历史。

## 3. 与「本地汇总」的偏差更正

- 本次准备早期我写的「**offline 39 项全部 exit 0**」**系误报，特此撤回**：该批输出当时我只看了 `tail -25`，
  **前段结果未逐一取证**。已确证至少 **`copy-conventions` 原为 rc=1**（见 §2.1）；
  `qty-precision` 当时**已发现**失败并修好夹具（`scan-qty-comparison.test.js` 补 helpers mock，现 81 pass）。
- 事后我按现行配置**逐项重跑 21 项**（`/tmp/rel-prod/static-rc.txt`）**全部 rc=0**，但这**只是部分重验**，
  **不等于**「39 项全绿」，**不用于凑数**；其余项以**本轮 CI 日志**为准（见 §1）。
- `/tmp/rel-prod/eslint-fixture.log` 是 **ESLint 10 找不到根配置**（检查方法失败），**不能据此说 lint 通过**；
  实际 lint 按各 package 已有配置执行：`npm --prefix backend run lint` 与 `npm --prefix frontend run lint`。

## 4. 夹具异常处理的验证边界（**不等于业务验收**）

`/tmp/rel-prod/owned-print-fixture.test.cjs`（**无 DB**、mock API）5/5 自然 exit 0，覆盖：
原绑定恢复、无绑定清除自身、**bind 已生效但响应丢失**、解绑失败仍停用、**并发他人新指向保留并报失败**。

> 该结果**只证明夹具的异常收尾逻辑**，**不代表**真实业务 API、真实打印或物理出纸验收。
> B4/C1/C2/C4 与 9 个专项的**真实结论由下一轮同 SHA 全量 CI（全新 MySQL 库）**给出。

## 5. 下一步

- 修复后**重新提交**并**再次经唯一入口** `npm run release:prod`（第二次 attempt 使用独立日志 `attempt2.log` 与退出码文件 `attempt2.exit`）。
- 正式门禁仍须**同完整 SHA**：`Tests`（含 9 专项）/ `Security` / `Browser` / `PDA` / `Desktop` 全部通过，再打 tag 并做 `release:verify` 实下载验摘要。
- **真机与物理打印未验**，单列。
