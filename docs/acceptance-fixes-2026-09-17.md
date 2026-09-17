# 全系统验收问题修复记录（2026-09-17）

对应验收报告：[acceptance-2026-09-17.md](acceptance-2026-09-17.md)。
本记录只覆盖**已在本机开发环境修复并验证**的部分；需要用户决策或涉及历史数据改写的事项单列在文末。

## 1. 畸形 JSON 请求体返回 500（已修复）

- 现象：`curl -X POST -H 'Content-Type: application/json' -d '{}{}' /api/auth/login` 返回 500 `INTERNAL_ERROR`，日志记 `[Unhandled]` 并打完整堆栈。
- 根因：`backend/src/middleware/errorHandler.js` 未识别 body-parser 的错误类型，全部落到「未知错误」分支。
- 修复：在 errorHandler 增加 `entity.parse.failed → 400 BAD_REQUEST`、`entity.too.large → 413 PAYLOAD_TOO_LARGE` 两个分支，日志降级为 warn。
- 验证：实测畸形 JSON 返回 `400 {"code":"BAD_REQUEST","message":"请求体不是合法的 JSON"}`；回归 `tests/acceptance-fixes-2026-09-17.test.js` 断言 400/413/500 三种分支。

## 2. 单号前缀设置是死配置（已修复）

- 现象：系统设置页同时展示「销售单号前缀 SO（示例 SO20260917）」与「销售单前缀 SL」，实际生成 `SL20260917001`；采购同理（页面 PO / 实际 PC）。
- 根因：迁移 230/231 已把单号前缀统一交给 `code_prefix_*`（`codeGenerator.resolvePrefix`），旧键 `sale_prefix`/`purchase_prefix`/`stockcheck_prefix` 不再被任何代码读取；`code_digits` 同样无人读取（主数据固定 6 位、单据流水固定 3 位）；`code_prefix_customer/supplier/product` 也不生效——`generateMasterCode` 刻意不接入前缀覆盖，实测 `/api/customers/next-code` 返回 `CUS000001`、`/api/suppliers/next-code` 返回 `SUP000001`、`/api/products/next-code` 返回 `P000001`。
- 修复：
  - `settings.service.js` 登记 7 个废弃键（上述三组 + `code_digits`），**列表不返回、批量保存静默跳过**（不报错，兼容仍带这些字段的旧客户端；行本身保留，未删数据）。
  - 迁移 244 修正 `code_prefix_so/po/it/tr` 的 remark（改成「当前值 + 真实示例 + 程序默认值」），并把被写成 `'FlowCube ERP'` 的 `code_digits` 纠正回 `4`。
- 验证：`GET /api/settings` 返回 34 项，7 个废弃键全部不再出现，`code_prefix_so` 仍在；设置页示例变为 `SL20260917`。

## 3. 执行期取消订单后明细投影未清理（已修复）

- 现象：取消一张已占库并已发起出库的销售单后，`sale_order_items` 仍保留 `reserved_qty=2 / dispatched_qty=2`，而预占账已 `status=3` 释放、任务已取消。
- 根因：`sale.service.js` 的取消分支只在 `status ∈ {2,6}` 时清零 `reserved_qty`；`status=3`（执行期）分支释放预占与取消任务后没有回写明细。
- 修复：执行期取消且**没有任何已出库任务**（即没有实物移动）时，同事务执行 `UPDATE sale_order_items SET reserved_qty = 0, dispatched_qty = 0 WHERE order_id = ?`。部分已发的分支保持原逻辑（按实发精简明细），不受影响。
- 验证：端到端实测（建单 → 占库 → 发起出库 → 取消）后明细 `reserved_qty=0 / dispatched_qty=0`、订单 `status=5`、预占 `status=3`。

## 4. 角色名冗余列漂移（已修复）

- 现象：34 个活跃用户中 29 个 `sys_users.role_name` 与 `sys_roles.name` 不一致（admin 显示「管理员」、角色表为「系统管理员」），登录后界面展示的是过期名称。
- 根因：`sys_users.role_name` 是展示用冗余列，角色改名后不跟随；角色侧没有改名接口，用户新建/编辑都走 `resolveRoleName(roleId)` 服务端解析，因此只在历史数据里漂移。
- 修复：迁移 243 按 `role_id` 从 `sys_roles.name` 回填（`WHERE u.role_name <> r.name`，可重复执行；显式保留 `updated_at`，不刷新用户最后更新时间）。
- 验证：回填后不一致记录 0 条，admin 冗余列显示「系统管理员」。

## 5. PDA 设备绑定页显示原始仓库 ID（已修复）

- 现象：绑定成功后页面显示「所属仓库 #1」。
- 修复：`pda.sessions.service.js` 的建会话/续期查询 JOIN `inventory_warehouses` 返回 `warehouse_name`；`pda.routes.js` 响应新增 `warehouse_name`；前端 `PdaDeviceSession` 增加可选 `warehouseName`，绑定页优先显示名称、回退 `#id`（旧缓存会话不会崩）。
- 验证：浏览器实测绑定后显示「所属仓库 北京主仓」。

## 6. 一致性审计覆盖不足（已增强）

- 新增三项只读检查：`container_product_orphan`（容器指向不存在的商品且余量非零）、`container_warehouse_orphan`、`task_lock_leak`（已出库/已取消任务仍持有容器锁）。
- 验证：本地开发库运行后确认新增检查生效——孤儿商品容器 11 条、锁泄漏 3 条（与验收报告一致），检查项总数 38 → 41。

## 7. 回归与门禁

- 新增 `tests/acceptance-fixes-2026-09-17.test.js`（6 个用例，纯离线：错误码映射、废弃设置键、取消投影、审计覆盖、迁移存在性）。
- 新增 `npm run test:acceptance-fixes`，并接入 `.github/workflows/test.yml` 静态作业。
- 本地验证：`npm run test:acceptance-fixes` 6/6 通过；`npm run test:permissions` 通过；后端 ESLint 无输出；前端 ESLint 5 条既有 warning、0 error；`tsc -p frontend/tsconfig.app.json --noEmit` 无错误；后端 `npm run migrate` 执行 243/244 两个文件成功。

## 8. 尚未处理（需要用户决策或涉及历史数据）

| 事项 | 为什么没做 | 需要你决定 |
|---|---|---|
| 开发库测试数据清理（248 个测试仓、69 个测试客户、2,631 个测试商品、smoke/提权测试账号） | 属批量删除数据，必须先备份并取得授权 | 是否由我按备份 → 清理 → 复核的顺序执行；保留哪些账号 |
| 历史脏数据修复（11 个孤儿容器 5,003 单位、299 条孤儿预占、56 张已取消单的明细投影、分拣格 A01–A03） | 同上；且 A01–A03 需要先确认是否解除占用 | 是否授权逐项修复，以及 A01–A03 是否释放 |
| 僵尸任务超时巡检与分拣格回收 | 属新功能，需要定策略 | 阈值（如 24/48 小时）、只告警还是允许强制回收 |
| 列表虚拟滚动/分页回归（商品弹窗 2,638 行） | 影响面大，需专门排期 | 先做虚拟滚动，还是先降低取数上限 |
| 仪表盘 43 个请求（role-workbench 11 次） | 需要逐组件确认查询键合并的可行性 | 是否本轮一并优化 |
| 登录限流放宽（300 次/15 分钟/IP） | 属安全策略 | 是否收紧到如 20 次/15 分钟 |
