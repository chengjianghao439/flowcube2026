# 本地开发库 `flowcube_dev8` 误迁移偏差与前向修复记录

> 本文记录**两件性质不同的事**，请分开看：
> - **① 误迁移（2026-09-26，事故）**：本该打到独立测试库的两条迁移 258、259 被**意外**打到本机开发库 `flowcube_dev8`；只做只读核对，**未回滚、未删数据**。
> - **② 前向修复（2026-09-27，有意操作）**：经业务方**明确授权**，先预检（确认 260–262 仅增量、可重入、不改既有业务数据），再把 dev8 的水位从 259 **主动**补齐到 262。这是本文唯一一次对 dev8 的写入。
>
> 误迁移的对象是 **258/259**；有意修复的对象是 **260/261/262**——**两者不是同一批迁移，性质相反**（一个是失控写入，一个是受控补齐）。
> 证据强度：**实测**（`information_schema` / `db_migrations` / `columns` 查询，命令见文末，可原样复现）。

## 一、一句话事实

2026-09-26 21:26:12，本该打到独立测试库的两条迁移 **258、259 被误打到本机开发库 `flowcube_dev8`**。
两条都是**纯增量 DDL**（建表 + 加可空列），**没有写入或修改任何业务数据行**。

## 二、事故经过与根因

- 一次性命令里写了 `source ~/.config/flowcube/operations20260912_env`——**该文件不存在**。
- `zsh` 在 `source` 失败后中止了**同一条命令行的剩余部分**，于是测试环境的 `*.env` 没被加载，进程环境为空。
- 随后 `backend/scripts/migrate.js` 的 dotenv 按默认路径回退到 **`backend/.env`**（它指向 `DB_NAME=flowcube_dev8`），
  迁移就落了开发库。
- 事后加了强制守卫 `/tmp/run-test.sh`：先断言 `DB_HOST=127.0.0.1`、`DB_PORT=3307`、`DB_NAME` 以 `_test` 结尾，
  并把 `DOTENV_CONFIG_PATH` 指向不存在的文件，**从根上断掉 dotenv 回退 `backend/.env` 的路径**。
  `/tmp/run-test-backfill.sh` 是独占测试库的同类入口。

## 三、误迁移后的 schema（2026-09-26 只读快照）

> ⚠ 本节是**修复前**的快照，用于固定事故当时的证据。dev8 的**当前**状态见 §三·补。

`flowcube_dev8.db_migrations` 的最高两条就是这次误入的：

| id | filename | executed_at |
|---|---|---|
| 262 | `258_finance_period_backfills.sql` | 2026-09-26 21:26:12 |
| 263 | `259_payment_debit_account.sql` | 2026-09-26 21:26:12 |

在它之前，dev8 的正常水位停在 **257 `257_seed_job_role_presets.sql`（2026-09-24 15:43:55）**。

**实际落进 dev8 的对象（实测存在）**：

| 迁移 | 落地的对象 | 形态 | 数据 |
|---|---|---|---|
| 258 | 新表 `finance_period_backfills` | 13 列（`id`…`created_at`），即 258 的原始定义 | **0 行** |
| 259 | `payment_records` 新增列 `debit_account_code VARCHAR(20) DEFAULT NULL` | 只加可空列 | 全表 1 行，该列**非空值 0 个** |

**没有落进 dev8 的对象（实测不存在）**：

- 260/261 给 `finance_period_backfills` 加的审批/作废列（`status`、`applicant_id`、`request_snapshot`、
  `approver_id`、`approved_at`、`executed_at`、`voided_*` 等）**都不存在**——该表停在 258 的 13 列。
- 262 给 `warehouse_task_items` 加的 `sale_return_item_id` 列与 `idx_wti_sale_return_item` 索引**都不存在**；
  `warehouse_tasks.task_type` 的列注释仍是旧版（只列 `sale_out` / `purchase_return`，不含 `sale_return_out`）。

即 **dev8 的迁移水位 = 259，落后于当前代码的 262**（此为**修复前**状态；修复后见 §三·补）。

## 三·补、前向修复（2026-09-27，经业务方授权）

**授权边界（业务方原话要点）**：核对 260–262 在 dev8 上**仅增量、可重入、不改既有业务数据**，
确认后把本机开发库前向迁移到 262；**绝不碰生产库或 3306**；若发现非增量风险**立即停下说明**。

### 1) 预检（迁移前，只读）

| 检查项 | 实测结果 | 判定 |
|---|---|---|
| 水位 | `db_migrations` 260 行 / MAX(id)=263 / 最新 filename `259_payment_debit_account.sql` | 260/261/262 **未执行** |
| 三迁移是否已在册 | `filename IN (260,261,262)` 命中 **0** 行 | 未执行，确认 |
| 260 唯一键冲突面 | `finance_period_backfills` **0 行** | `uk_fpb_request_key` **零冲突** |
| 260 加列面 | `finance_account_transactions` **631 行**，无 `voucher_date_override`/`backfill_id` | 纯 ADD COLUMN（MySQL 8 INSTANT） |
| 262 加列面 | `warehouse_task_items` **1 行**，有 `purchase_return_item_id`、无 `sale_return_item_id` | 纯 ADD COLUMN + 新索引 |
| 262 类型面 | `warehouse_tasks.task_type` = `varchar(20) NOT NULL DEFAULT 'sale_out'` | 与 262 的 `MODIFY` 定义**逐字一致** → **只补注释、不改类型** |
| 迁移文件上限 | 目录内最高编号 = **262**，无 263+ | 执行范围与授权一致 |
| 服务器版本 | MySQL **8.0.46** | 支持 INSTANT ADD COLUMN |

**预检结论：三个迁移对 dev8 仅增量、可重入，且不含任何业务数据 `UPDATE`（260 文件内明文声明"本迁移不含任何 UPDATE"；
每列/索引均先查 `information_schema` 再动态执行）——未发现非增量风险，可以前向迁移。**

### 2) 执行

- **入口**：`/tmp/run-dev8-guard.sh` —— 针对本次授权的**具名白名单**（`DB_NAME` 必须恰为 `flowcube_dev8`），
  **不是**放宽 `run-test*.sh` 的"库名必须以 `_test` 结尾"这条默认拒绝规则；两者并存，默认仍拒非 `_test` 库。
- **绕过隐患入口**：调用 `/tmp/run-migrate.js`（只 `require` 迁移模块与 `config/db`，**全程不含 dotenv**），
  避开 `backend/scripts/migrate.js:2` 的裸 `dotenv.config()` —— 那正是 ① 事故回退到 `backend/.env` 的根因。
- **三道防线**：① 连接参数只取自本机测试环境文件；② 执行前断言 `DB_HOST=127.0.0.1` / `DB_PORT=3307` /
  `DB_NAME=flowcube_dev8`，任一不符 `exit 2`（注意 `config/env.js` 的默认值是 **`DB_PORT=3306`、`DB_NAME=flowcube`**，
  不显式给出就有连到生产库的风险，故必须钉死）；③ 执行时 cwd 置于 `/tmp` 断掉 `.env` 回退。
- 实跑输出：仅执行 `260` / `261` / `262` **三个文件**，无其他迁移被顺带触发。

### 3) 复查（迁移后，只读）

| 对象 | 迁移后实测 | 期望 | 判定 |
|---|---|---|---|
| 水位 | 263 行 / MAX(id)=266 / 最新 filename `262_warehouse_task_item_sale_return_link.sql` | 含 260/261/262 | ✓ #264/#265/#266 |
| `finance_period_backfills` | **31 列**，260/261 的 19 个目标列**全部就位**；`status` = `tinyint NOT NULL DEFAULT 3` | 就位 | ✓ |
| `finance_account_transactions` | 新增 `backfill_id bigint unsigned`、`voucher_date_override date` | 就位 | ✓ |
| `warehouse_task_items` | 新增 `sale_return_item_id bigint unsigned` | 就位 | ✓ |
| 新索引 | `idx_fpb_status`(普通, company_id/status/created_at)、`uk_fpb_request_key`(**唯一**, company_id/biz_type/request_key)、`idx_wti_sale_return_item`(普通, sale_return_item_id) | 3 个 | ✓ |
| `task_type` 注释 | `sale_out=销售出库, purchase_return=采购退货出库, sale_return_out=销售退货返货出库` | 含 `sale_return_out` | ✓ |
| **业务数据行数** | `finance_period_backfills=0`、`finance_account_transactions=631`、`warehouse_task_items=1`、`warehouse_tasks=1` | 与迁移前**逐项相同** | ✓ **未被改动** |
| 可重入 | 重跑同一入口 → "所有迁移均已执行，无需更新"，**零执行、无报错** | 幂等 | ✓ |

**即：dev8 的迁移水位已从 259 前向补齐到 262，既有业务数据行数与迁移前逐项一致，全程未连接 3306 或任何生产库。**

> **仍未验**：本条只验证了 dev8 这一个本机开发库。260–262 在**独立测试库**上的 SQL 级重入（反复重建后重放）
> 属另一项待办，不在本节范围内。

## 四、影响边界

**范围内（受影响的）**：

- 只有**本机开发库 `flowcube_dev8`** 一个库。本机 MySQL 里除它以外的库**全部以 `_test` 结尾**（测试库），
  3306 主库与生产库**完全没碰**。
- dev8 的既有业务数据**没有被动过**：258 是 `CREATE TABLE`（新表，0 行），259 是加可空列（既有行该列全 NULL）。
  两条 DDL 都不含 `UPDATE` / `DELETE` / 数据回填，**不改变任何既有列的值**。

**范围外的（未受影响的）**：

- 生产库与 3306 主库：无任何连接、无任何写入。
- 代码与迁移文件本身：无改动，迁移脚本仍是原文。

**一个曾点名的连带缺口（2026-09-27 已解决）**：

dev8 **曾落后三条迁移**，而 `backend/.env` 恰恰指向 `flowcube_dev8`——
即**本地开发后端跑当前代码时，schema 与代码不匹配**：补录审批相关接口会读
`finance_period_backfills.status` / `approver_id` 等当时不存在列，落到 `Unknown column`；
返货出库按行取单价会读 `warehouse_task_items.sale_return_item_id`，同样不存在。
这不是数据被破坏，而是**开发库结构落后于代码**。

**该缺口已于 2026-09-27 经业务方授权前向修复（见 §三·补）：dev8 水位补齐到 262，上述列与索引均已就位，
既有业务数据行数逐项未变。** 本地开发后端现在可以直接跑当前代码。

## 五、处置决定

分**两条互不相同的线**（对应本文开头 ①/②）：

**① 误迁移（258/259，事故）——保持原状，不回滚**

- dev8 上那两条误入的表/列**不 DROP、不回滚**：它们是纯增量 DDL、无 DML，留着无害，
  回滚反而制造新的写入风险。
- 不写脚本去"复原" dev8 的历史。
- **防再犯**：后续所有测试一律经 `/tmp/run-test.sh` 或 `/tmp/run-test-backfill.sh` 进入，
  两者都带三重守卫（只加载测试 env + 执行前断言 `_test` + 断掉 dotenv 回退）。

**② 前向修复（260–262，授权操作）——已执行并核对**

- 经业务方明确授权，用**具名白名单守卫**（`/tmp/run-dev8-guard.sh`）把 dev8 水位从 259 **受控**补齐到 262。
- 执行前后均只读核对，证据见 §三·补；**未连接 3306 或任何生产库**。
- 该守卫是本次一次性授权的例外，**不改变** `run-test*.sh` 对非 `_test` 库的默认拒绝。

- 偏差**单列在本文**，不散落在其他文档。

## 六、复现核对（只读）

**不要把口令写进命令行的 `-p<password>`**——argv 对同机所有用户可见（`ps aux` 就能读到），
也会留在 shell 历史里。下面用容器内交互式登录，口令在 TTY 里输入：

```bash
export DOCKER_CONTEXT=colima-flowcube
docker exec -it flowcube-dev-mysql8 mysql -uroot -p flowcube_dev8
```

进入后粘贴以下**只读**查询（全部是 `SELECT`，不写任何数据）：

```sql
SELECT id, filename, executed_at FROM db_migrations ORDER BY id DESC LIMIT 5;
SELECT COUNT(*) AS backfill_rows FROM finance_period_backfills;
SELECT COUNT(*) AS total, SUM(debit_account_code IS NOT NULL) AS non_null FROM payment_records;
SELECT COUNT(*) AS has_262_col FROM information_schema.columns
 WHERE table_schema='flowcube_dev8' AND table_name='warehouse_task_items' AND column_name='sale_return_item_id';
```

**当前预期（2026-09-27 修复后）**：`db_migrations` 最新 filename 为 `262_warehouse_task_item_sale_return_link.sql`
（另可见 `#264/#265/#266` 即 260/261/262），`has_262_col=1`；`backfill_rows=0`、`non_null=0` **不变**
（证明修复只动了结构、没动业务数据）。

**修复前预期（2026-09-26 历史对照）**：水位最高为 259（id 263）、`has_262_col=0`。

> 脚本化场景若必须非交互，把口令放进**环境变量**（`MYSQL_PWD`）而不是 argv——环境变量
> 同样不该长期驻留，但至少不会出现在 `ps` 的进程参数里。**无论哪种方式，口令都不写入本文档、不入仓库。**
