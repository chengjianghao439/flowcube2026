# 数据库运行时补丁退场计划

## 背景

早期升级链路中，`backend/src/database/migrate.js` 不只负责执行编号 SQL 迁移，还承担了旧库兼容职责：启动时通过 `safeAlter`、`safeModify`、`CREATE TABLE IF NOT EXISTS` 和种子逻辑补齐缺失字段、索引、表和默认打印模板。

这种方式可以降低旧库升级失败率，但长期风险是 schema 真相分叉：一部分结构在编号 migration 里，一部分只存在于运行时补丁里。后续治理目标是将结构变更逐步显式化到 `db_migrations` 主线，让 `migrate.js` 回到“迁移执行器 + 临时兼容层”的定位。

## 全量 dynamic patch 覆盖矩阵

| migrate.js 逻辑块 | 修改类型 | 078/079 覆盖 | 更早 migration 覆盖 | 当前分类 | 是否仍需保留 |
| --- | --- | --- | --- | --- | --- |
| `CREATE TABLE IF NOT EXISTS db_migrations` | 迁移记录表 bootstrap | 不适用 | 不适用 | 必须继续保留 | 是，迁移执行器自身依赖 |
| `ensureLegacyTableCompatibility()` 补 `sys_roles.remark/is_system/created_at/updated_at` | 旧库兼容列补齐 | 未覆盖 | `065_create_sys_roles.sql` | 更早 migration 已覆盖 | 是，至少保留一个版本周期 |
| 第一次 `CREATE TABLE IF NOT EXISTS warehouse_racks` | 货架表兼容建表 | 未覆盖 | `051_warehouse_racks_barcode.sql` | 更早 migration 已覆盖 | 是，至少保留一个版本周期 |
| `sale_customers.price_list_id/price_list_name` | 新增列 | 已覆盖 | `060_product_price_levels.sql` 也覆盖相关能力 | 已完全显式化 | 暂保留，待退场条件满足 |
| `sale_orders.task_id/task_no/carrier/carrier_id/freight_type/receiver_*` | 新增列 | 已覆盖 | 部分字段在历史建表/迁移中存在 | 已完全显式化 | 暂保留，待退场条件满足 |
| `inventory_stock.reserved/updated_at` | 新增列 | 已覆盖 | 无需依赖 | 已完全显式化 | 暂保留，待退场条件满足 |
| `inventory_logs.move_type/ref_type/ref_id/ref_no` | 新增列 | 已覆盖 | `054_add_inventory_logs_move_type.sql` 覆盖 `move_type` | 已完全显式化 | 暂保留，待退场条件满足 |
| `product_categories` 树结构字段 | 新增列 | 已覆盖 | 无需依赖 | 已完全显式化 | 暂保留，待退场条件满足 |
| `carriers.type` | 新增列 | 已覆盖 | 无需依赖 | 已完全显式化 | 暂保留，待退场条件满足 |
| `inventory_containers.location_id/locked_by_task_id/locked_at` | 新增列 | 已覆盖 | 无需依赖 | 已完全显式化 | 暂保留，待退场条件满足 |
| `inventory_containers.idx_container_location/idx_container_locked` | 新增索引 | 已覆盖 | 无需依赖 | 已完全显式化 | 暂保留，待退场条件满足 |
| `RUN_SCHEMA_NORMALIZATION=1` 中 `safeModify` 字段长度收口 | 字段类型/长度修改 | 未覆盖 | 未覆盖 | 暂不迁移 | 是，人工离线操作，不能进默认迁移 |
| `RUN_SCHEMA_NORMALIZATION=1` 中 `product_items.cost_price` | 新增列 | 已覆盖 | `004` 新库 schema 和 `064_product_cost_price_compat.sql` | 部分显式化 | 字段已覆盖，但 normalization 块仍需保留 |
| 默认分支 `product_items.cost_price` | 新增列 | 已覆盖 | `004` 新库 schema 和 `064_product_cost_price_compat.sql` | 已完全显式化 | 暂保留，待退场条件满足 |
| `picking_waves.priority` | 新增列 | 已覆盖 | 无需依赖 | 已完全显式化 | 暂保留，待退场条件满足 |
| `warehouse_tasks.sorting_bin_id/sorting_bin_code` | 新增列 | 已覆盖 | `030` 支持相关能力但旧库仍需补齐 | 已完全显式化 | 暂保留，待退场条件满足 |
| 第二次 `CREATE TABLE IF NOT EXISTS warehouse_racks` | 货架表兼容建表 | 未覆盖 | `051_warehouse_racks_barcode.sql` | 更早 migration 已覆盖 | 是，至少保留一个版本周期 |
| `seedDefaultPrintTemplates(conn)` | 默认数据种子 | `079_seed_default_print_templates.sql` 已覆盖 | 无需依赖 | 已完全显式化 | 暂保留，待退场条件满足 |
| `safeAlter()` helper | 兼容执行器 helper | 不适用 | 不适用 | 必须继续保留 | 是，legacy patch 仍依赖 |
| `safeModify()` helper | 兼容执行器 helper | 不适用 | 不适用 | 必须继续保留 | 是，normalization 仍依赖 |

## 078/079 覆盖范围

`078_formalize_runtime_additive_schema.sql` 已将 `migrate.js` 中的主要 additive schema patch 显式化：

| migrate.js patch | 覆盖文件 | 覆盖状态 | 说明 |
| --- | --- | --- | --- |
| `sale_customers.price_list_id` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 价格表绑定字段 |
| `sale_customers.price_list_name` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 价格表名称快照字段 |
| `sale_orders.task_id` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 销售单关联仓库任务 |
| `sale_orders.task_no` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 销售单关联仓库任务编号 |
| `sale_orders.carrier` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 承运商文本字段 |
| `sale_orders.carrier_id` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 承运商 ID |
| `sale_orders.freight_type` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 运费方式 |
| `sale_orders.receiver_name` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 收货人 |
| `sale_orders.receiver_phone` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 收货电话 |
| `sale_orders.receiver_address` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 收货地址 |
| `inventory_stock.reserved` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 预占投影字段 |
| `inventory_stock.updated_at` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 库存投影更新时间 |
| `inventory_logs.move_type` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 早期 `054` 也覆盖过，078 保证旧库补齐 |
| `inventory_logs.ref_type/ref_id/ref_no` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 业务引用追踪字段 |
| `product_categories` 树结构字段 | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | `parent_id/code/level/sort_order/status/path/remark/created_at/updated_at` |
| `carriers.type` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 承运商类型 |
| `inventory_containers.location_id` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 库位引用 |
| `inventory_containers.idx_container_location` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 库位查询索引 |
| `inventory_containers.locked_by_task_id` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 仓库任务锁定引用 |
| `inventory_containers.locked_at` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 锁定时间 |
| `inventory_containers.idx_container_locked` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 锁定查询索引 |
| `product_items.cost_price` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 新库和 `064` 已覆盖，078 保证旧库补齐 |
| `picking_waves.priority` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 波次优先级 |
| `warehouse_tasks.sorting_bin_id` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 分拣格 ID |
| `warehouse_tasks.sorting_bin_code` | `078_formalize_runtime_additive_schema.sql` | 已完全显式化 | 分拣格编号 |

`079_seed_default_print_templates.sql` 已将 `seedDefaultPrintTemplates(conn)` 的默认模板种子显式化：

| migrate.js patch | 覆盖文件 | 覆盖状态 | 说明 |
| --- | --- | --- | --- |
| 默认销售订单模板 `type=1` | `079_seed_default_print_templates.sql` | 已完全显式化 | 按 `(type, name)` 幂等插入 |
| 默认货架条码标签模板 `type=5` | `079_seed_default_print_templates.sql` | 已完全显式化 | 按 `(type, name)` 幂等插入 |
| 默认库存条码标签模板 `type=6` | `079_seed_default_print_templates.sql` | 已完全显式化 | 按 `(type, name)` 幂等插入 |
| 默认物流条码标签模板 `type=7` | `079_seed_default_print_templates.sql` | 已完全显式化 | 按 `(type, name)` 幂等插入 |
| 默认产品条码标签模板 `type=8` | `079_seed_default_print_templates.sql` | 已完全显式化 | 按 `(type, name)` 幂等插入 |
| 默认库存标签模板 `type=9` | `079_seed_default_print_templates.sql` | 已完全显式化 | 按 `(type, name)` 幂等插入 |

## 仍需保留的 dynamic patch

以下逻辑本轮不得删除：

| runtime patch | 分类 | 保留原因 |
| --- | --- | --- |
| `db_migrations` bootstrap table | 必须继续保留 | 迁移执行器自身依赖，不能由普通 migration 管理 |
| `ensureLegacyTableCompatibility` 中 `sys_roles.remark/is_system/created_at/updated_at` | 必须继续保留一个版本周期 | 已被 `065_create_sys_roles.sql` 覆盖，但旧库可能从更早版本直接升级，需要兼容层兜底 |
| `warehouse_racks CREATE TABLE IF NOT EXISTS` | 必须继续保留一个版本周期 | 已被 `051_warehouse_racks_barcode.sql` 覆盖，但旧库升级路径仍需兜底 |
| `RUN_SCHEMA_NORMALIZATION=1` 下的 `safeModify` 字段收口 | 暂不迁移 | 属于人工离线字段收口，存在数据截断风险，不应纳入默认迁移 |
| `safeAlter`/`safeModify` helper 本身 | 必须继续保留 | 仍被运行时兼容层调用 |

## legacy runtime patch 开关

为已被 078/079 显式化的 runtime patch 增加了退场开关：

```bash
FLOWCUBE_ENABLE_LEGACY_RUNTIME_PATCHES=true
```

默认值为 `true`，即旧行为保持不变：078/079 覆盖的 legacy patch 仍会在 SQL migration 执行后继续运行，并通过 `safeAlter`/幂等种子逻辑兜底旧库升级。

当设置为 `false` 时，只跳过已被 078/079 覆盖的 additive runtime patch：

- `sale_customers.price_list_id/price_list_name`
- `sale_orders.task_id/task_no/carrier/carrier_id/freight_type/receiver_*`
- `inventory_stock.reserved/updated_at`
- `inventory_logs.move_type/ref_type/ref_id/ref_no`
- `product_categories` 树结构字段
- `carriers.type`
- `inventory_containers.location_id/locked_by_task_id/locked_at`
- `inventory_containers.idx_container_location/idx_container_locked`
- 默认分支下的 `product_items.cost_price`
- `picking_waves.priority`
- `warehouse_tasks.sorting_bin_id/sorting_bin_code`
- `seedDefaultPrintTemplates(conn)`

以下逻辑不受 `FLOWCUBE_ENABLE_LEGACY_RUNTIME_PATCHES` 影响：

- `db_migrations` bootstrap table。
- `ensureLegacyTableCompatibility()` 的 `sys_roles` 兼容。
- 两处 `warehouse_racks CREATE TABLE IF NOT EXISTS` 兜底。
- `RUN_SCHEMA_NORMALIZATION=1` 下的人工字段长度收口。
- `safeAlter`/`safeModify` helper。

启用默认行为时，日志会输出：

```text
legacy runtime patch executed; covered by migration 078/079
```

关闭开关时，日志会输出跳过原因，便于 staging 验证是否已经完全依赖编号 migration 主线。

## 核对脚本

新增只读核对脚本：

```bash
mysql "$FLOWCUBE_DATABASE" < backend/src/database/checks/verify_078_079.sql
```

该脚本只做 `INFORMATION_SCHEMA`、`db_migrations` 和 `print_templates` 查询，不修改数据。执行后应确认所有结果行 `result = PASS`。

核对内容：

- 078 中所有显式化字段是否存在。
- 078 中所有显式化索引是否存在。
- `db_migrations` 是否包含 `078_formalize_runtime_additive_schema.sql` 和 `079_seed_default_print_templates.sql`。
- 079 中 6 个默认 `print_templates` 是否存在。

## dynamic patch 删除前置条件

删除或禁用 `migrate.js` 中已显式化 dynamic patch 前，必须同时满足：

1. 所有环境的 `db_migrations` 都包含 `078_formalize_runtime_additive_schema.sql` 和 `079_seed_default_print_templates.sql`。
2. 所有环境执行 `backend/src/database/checks/verify_078_079.sql` 后结果全部为 `PASS`。
3. staging、备份库、至少一个真实升级副本已验证从旧版本升级到包含 078/079 的版本。
4. 至少经过一个正式版本周期，确认没有依赖运行时补丁补字段或补模板的环境。
5. 已保留线上数据库备份和可回滚应用版本。

## 退场步骤

### 第一阶段：显式迁移已上线，兼容层继续保留

- 保持 `migrate.js` 中 dynamic patch 逻辑不变。
- 运行 078/079，建立 `db_migrations` 主线记录。
- 在 staging/线上执行 `verify_078_079.sql`，归档核对结果。

### 第二阶段：兼容层变成可观测 legacy patch

- 不删除 dynamic patch。
- 对已显式化的 `safeAlter` 和 `seedDefaultPrintTemplates` 增加 legacy warning 日志。
- 日志必须能区分“补丁实际执行”和“字段已存在跳过”。
- 观察一个版本周期，确认没有环境实际依赖 legacy patch 执行。

### 第三阶段：环境变量控制 legacy patch

- 使用 `FLOWCUBE_ENABLE_LEGACY_RUNTIME_PATCHES=false` 关闭已显式化 patch。
- 默认值必须保持 `true`，确保旧库升级路径不变。
- 在 staging 先关闭该变量，执行完整升级和回归。
- 关闭后 `verify_078_079.sql` 仍必须全部 `PASS`。

### 第四阶段：删除已显式化 patch

- 只删除已被 078/079 覆盖且经过上面条件验证的 patch。
- 保留 `db_migrations` bootstrap、必要 helper、`RUN_SCHEMA_NORMALIZATION` 人工收口逻辑，直到另有独立方案。
- 删除后再执行全量迁移、应用启动、核心业务回归和核对脚本。

## 回滚策略

如果退场过程中发现旧环境仍依赖 dynamic patch：

1. 立即回滚应用到保留 dynamic patch 的版本。
2. 不回滚 078/079；它们是幂等显式迁移，保留在 `db_migrations` 主线。
3. 对失败环境执行 `verify_078_079.sql`，定位缺失字段、索引或模板。
4. 若是 078/079 未执行，先修复迁移执行链，再重新发布。
5. 若是历史 schema 与预期差异过大，单独生成新的编号 migration，不允许重新把结构修复塞回 `migrate.js`。

## 下一步建议

1. 在 staging 运行 078/079 后执行 `verify_078_079.sql`。
2. 将核对输出归档到发布记录。
3. 下一个版本只加 legacy warning，不删除 dynamic patch。
4. 再下一个版本默认保持 `FLOWCUBE_ENABLE_LEGACY_RUNTIME_PATCHES=true`，并先在 staging 显式设置为 `false` 验证。
5. 最后再提交删除已显式化 patch 的 PR。
