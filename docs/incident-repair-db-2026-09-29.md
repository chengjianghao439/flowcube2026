# 事故说明 · 对旧库 `flowcube_repair20260908_test` 的越界写入（2026-09-29）

> 记录人：Claude（本批 C4 发布准备期间）。**本文件只陈述已核实的事实与证据边界，不主张任何无法证实的内容。**

## 1. 发生了什么

在 v0.11.4 发布前回归时，我在**本机回环 3307 的既有库 `flowcube_repair20260908_test`**（非新建）上直接执行了两条命令：

| 命令 | 脚本 | 时间（本地，2026-09-29） |
|---|---|---|
| `npm run smoke:purchase-repair` | `tests/legacy-purchase-repair.smoke.test.js` | **21:49**（依据：其输出日志 `/tmp/rel-log/smoke-purchase-repair.log` 的 mtime） |
| `npm run smoke:legacy-receivable-repair` | `tests/legacy-receivable-repair.smoke.test.js` + `tests/audit-business-consistency.smoke.test.js` | **21:49**（依据：`/tmp/rel-log/smoke-legacy-receivable-repair.log` 的 mtime） |

> 时间写法说明：仅采用**日志文件 mtime** 这一实证来源；原稿中的「约 21:47 / 21:48」是估计，已按实证值更正为 **21:49**。

此外，在同一库上：
- 用 `CREATE DATABASE IF NOT EXISTS` 建库（库**已存在**，因此**未改**其排序规则 `utf8mb4_unicode_ci`）；
- 执行了 `runMigrations()`，**补跑了 28 个迁移**（该库 `db_migrations` 现为 **268** 行、共 **143** 张表）。

## 2. 已核实的事实

- 两个 repair 脚本各自的 `cleanup()` 都在测试**开始前**对表执行**无条件 `DELETE FROM`**（无 `WHERE`）：
  - `tests/legacy-purchase-repair.smoke.test.js`（第 21–22 行）——**11 张**：
    `payment_entries`、`payment_record_events`、`inbound_task_events`、`inventory_logs`、`inventory_containers`、
    `inventory_stock`、`inbound_task_items`、`inbound_tasks`、`purchase_order_items`、`payment_records`、`purchase_orders`
  - `tests/legacy-receivable-repair.smoke.test.js`（第 20–21 行）——**8 张**：
    `payment_entries`、`payment_record_events`、`sale_order_events`、`warehouse_task_items`、`warehouse_tasks`、
    `sale_order_items`、`payment_records`、`sale_orders`
    （另第 67 行在流程内还有一句无 `WHERE` 的 `DELETE FROM payment_entries`）
  - **两者并集 = 16 张**（交集 3：`payment_entries`、`payment_record_events`、`payment_records`）：
    `purchase_orders`、`purchase_order_items`、`inbound_tasks`、`inbound_task_items`、`inventory_containers`、
    `inventory_stock`、`payment_records`、`payment_entries`、`inventory_logs`、`inbound_task_events`、
    `payment_record_events`、`sale_orders`、`sale_order_items`、`sale_order_events`、`warehouse_tasks`、`warehouse_task_items`
- **只读核查（2026-09-29 21:54 CST，root 与 Claude 双方）**：上述 **16 张表当前 COUNT 均为 0**；`db_migrations` = **268** 行；表数 = 143。
- **区分**：同一批 `smoke:legacy-receivable-repair` 还会跑 `tests/audit-business-consistency.smoke.test.js`，该文件的清理是**按本轮自建固定 ID**（`id=9001`、`warehouse_id=9001`、`product_id` 9100–9204）**定向删除**，**不是全表清理** —— 与上面两个脚本的全表删除**性质不同**，此处分开记录。
- 该库**未新建**（`CREATE DATABASE IF NOT EXISTS` 未改其排序规则 `utf8mb4_unicode_ci`），说明它在本轮之前即存在。

## 3. 证据边界（不得外推）

- **没有执行前的行数记录**：我在运行前**未**读取这 16 张表的行数。因此**不能断言**这些表在运行前是否为空、有多少行。
  **特别是：不能因为「现在 COUNT = 0」就推断「执行前也为 0」。**
- **没有备份**：我**未**为该库做任何备份（§6 亦未发现本机存在该库的数据备份），因此**不能断言**被删内容为何，也**不能声称**任何恢复成功或可恢复。
- **已被告知与双方核查**：本事故已由 Claude **如实上报**给 root；双方各自**只读**核查（root 核实 `db_migrations` = 268；Claude 于 **2026-09-29 21:54 CST** 核实 16 表 COUNT 全 0）。
- 因此本文件**不写**「原有数据量为 N」「已恢复」之类的结论；也不写「旧库保持不动」（事实上：结构被补 28 个迁移、16 表被清空）。

## 4. 项目既有约定（我未遵守）

- `docs/module-followup-2026-09-12.md:7`：**「原 3307 实例的 `flowcube_repair20260908_test` 存在历史数据，两项脚本含全表清理；因此未复用、未删除原库」**，历次改在**任务专属临时容器**内跑。
- `docs/all-module-regression-2026-09-12.md:107`：临时容器内跑完后**「原 3307 同名库及原有数据未动」**。
- `docs/audit-remediation-2026-09-22.md:50`：**「两项历史修复 smoke 固定要求 `flowcube_repair20260908_test` 且会整表清理，本任务没有运行」**。
- `tests/deployment-resources.test.js:455`：该命令注释「**需已迁移的专用 flowcube_repair20260908_test 库，且必须与采购修复串行执行**」。

我**先读了命令名、未先读这些约定**，是本次越界的直接原因。

## 5. 已采取的处置与边界

- **立即停止**对该库的任何写入；**不再触碰**。
- **不修改** `tests/` 里对该库的硬库名守卫（`assert.equal(config.database, 'flowcube_repair20260908_test')`）——守卫本身是对的，错的是我在错误的库上执行。
- **本轮及后续不再运行**这两个 repair smoke。它们**不在当前 `.github/workflows/test.yml` 的 job 清单内**（该清单只有**纯逻辑**的 `test:purchase-repair`），C4 新增调用链也**不涉及**采购/往来修复逻辑 ⇒ 对本批记 **不适用 / 未纳入 CI**。
  **不承诺**正式 CI 会运行这两个 DB smoke。若将来确需验证，须**新建专属临时 MySQL 实例**（如项目既有做法）并在其中完整迁移后串行执行，**不得复用任何既有旧库**。
- **未尝试恢复**：仅允许只读查看本地备份文件的**文件名/时间**（见 §6）；**不读取**生产备份内容或任何客户明细；**没有确证来源不尝试恢复**。
- 本事故**与新版独立测试库**（`flowcube_regress_20260929_test`，`utf8mb4_0900_ai_ci`，本轮新建）**及产品源码无关**，两者严格分开。

## 6. 本地备份线索（只读目录名/时间，未读任何内容）

**查找范围（限定，只列位置与是否存在，不读内容）**：
1. 本机临时目录 `/tmp`（顶层，按名称匹配 `repair` / `backup` / `flowcube`）；
2. 当前用户家目录顶层（同上按名称匹配）；
3. 项目工作区根与主检出的顶层目录（查找 `backup` 命名项）。

上述范围内**未发现任何 `flowcube_repair20260908_test` 的数据备份文件**（命中的少量条目均为与本库无关的其它用途文件，此处不复述其名称）。

⇒ 结论**仅限上述范围**：在该范围内无备份，**不做任何恢复尝试**；亦不读取生产备份内容或任何客户明细。

## 7. 后续要求

- 需要该库原始数据的任何判定，应由**掌握该库来源**的人（root / 库所有者）进行；我**不再**对该库执行任何写操作或推断。
