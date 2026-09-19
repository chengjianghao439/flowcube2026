# 库存 / 事务 / 幂等不变量

> **来源**：本文件由 `AGENTS.md` 的 §6 迁出（2026-09-19 文档体系重构，原文见 `docs/agents-md-archive-2026-09-19.md`），内容为无损搬运。
> **何时必须读**：改动 inventory/容器/预占/引擎/状态机/幂等回执，或任何会影响库存与账款一致性的代码时。
> **约定**：能机器验证的规则一律以 `tests/` 守卫为准；本文件写「为什么」与「边界」，与守卫冲突时先核实代码，再同步两者。

---


1. **库存唯一事实源是 ACTIVE 容器的 `inventory_containers.remaining_qty`；`inventory_stock.quantity` 只是缓存。** 唯一合法缓存写入口是 `containerEngine.syncStockFromContainers()`，禁止业务代码直接 UPDATE quantity。`npm run test:stock-cache-write` 机械守住两件事：`quantity` 只允许 `containerEngine` 写、`reserved` 只允许 `reservationEngine`/`inventoryEngine` 写（只认 `UPDATE ... SET` 与 `INSERT ... ON DUPLICATE KEY UPDATE` 两种真实语句形态，且**先剥注释**——第一版没剥，把引擎里的文档注释算成了写入）；以及**每个改 `remaining_qty` 的函数必须同函数内刷缓存，或命中豁免表并写明「为什么这次改动不改变该维度的 ACTIVE 合计」**（现有豁免：`deductFromContainers`/`deductFromTaskLockedContainers` 由调用方刷新、`splitTaskLockedContainerForReturn` 拆分守恒、`allocateQaContainers` 只动不计入 ACTIVE 的质检状态）。
2. `reserved` 只能经 `reservationEngine` 或 `inventoryEngine` 的合法入口变更；`stock_reservations` 与库存预占账必须一致。
3. 实物可用量通过 `containerEngine.getAvailableStockForDecision()` 等现有投影入口判定，不自写 SUM。销售 ATP 可显式纳入预计量，见第 7 节，不能把预计量当实物出库。
4. 待上架/待质检容器不计 ACTIVE 实物；建容器只经 `createContainer`。只有既定 transfer/container_split 来源可直接 ACTIVE，其他来源先待上架再 promote。
5. 销售出库只扣本任务锁定容器 `deductFromTaskLockedContainers`，禁止退回全局 FIFO；不允许负实物库存。
6. 库存与账款多表动作必须在调用方开启的同一事务连接 `conn` 中完成，引擎不自行嵌套事务。`npm run test:engine-transaction` 机械守住：`backend/src/engine/**` 内不得出现 `beginTransaction`/`getConnection`/`.commit(`/`.rollback(`/`.release(`；**含写语句的引擎函数首参必须是 `conn`**（只读查询允许用 `pool`——不参与写事务，无需调用方连接；现有两处：`approvalEngine` 的 `countPendingTasks`/`listPendingTasks`）。引擎自己取连接会让多表动作脱离调用方事务，异常路径下出现半更新，且**只在并发或异常路径显形**。
7. 上架先锁 `lockStockDimension(productId, warehouseId)` 再锁容器；多商品操作按 product_id、warehouse_id 的统一顺序加锁，防死锁和缓存丢失更新。
8. 状态变更先 `lockStatusRow()`，经 `assertStatusAction` / `assertWarehouseTaskAction` 校验并使用 `compareAndSetStatus()`；CAS 冲突返回 409。既有财务内联状态机保留等效的事务行锁校验，不退化成裸 UPDATE。
9. 数量为 DECIMAL，销售等单据输入最多 4 位小数，单位折算后若小于 0.0001 必须拒绝，不能舍入成零；比较/累加防浮点误差，打包沿用 `toQtyUnits/fromQtyUnits`。
10. 不恢复已关闭的手动入库/手动库存调整入口；入库走收货，调整走盘点。初始化导入等专用流程遵守其既有校验，不扩展通用后门。
11. 写操作考虑连点与断网重试：前端稳定 `X-Request-Key`，后端 `beginOperationRequest/completeOperationRequest`，结合唯一键和 CAS。资源级写操作的 action 必须绑定单据 ID，避免同一请求键跨单据误重放；重放返回原回执，不能重复加库存、推进状态或入账。公共操作幂等在重复 INSERT 后以 `FOR SHARE` 当前读检查既有回执，避免两个重放事务将唯一键共享锁升级为排他锁而死锁；不能改成可能漏掉新提交回执的快照读。确定性并发专项已接入 `smoke:concurrency-guards`，验证与全模块覆盖见 `docs/all-module-regression-2026-09-12.md`。
12. 事务内禁止外部 HTTP 或物理打印。打印只在数据库入队，实际动作异步；补打不建容器、不加库存、不改账款。
13. 缓存漂移先只读检查；需要修复时走既有 resync/引擎入口，不能手改数据库。不要为了“验证”擅自跑会修复数据的命令。
14. 改引擎或状态机前读完整调用链与历史事故注释；副作用变化同步 `WT_ON_ENTER_ACTIONS` / `WT_ON_EXIT_ACTIONS` 及相关测试。
