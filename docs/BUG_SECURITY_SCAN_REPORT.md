# FlowCube Bug 与安全风险扫描报告

**扫描日期**：2025-03-05  
**重点模块**：sale.service、warehouse-tasks.service、inbound-tasks.service、containerEngine、reservationEngine、picking-waves.service

---

## 1. 高危 Bug

### H1. 库存导入直接写 inventory_stock，破坏容器模型一致性

**位置**：`backend/src/modules/import/import.routes.js` 第 93-96 行

**问题**：库存初始化导入直接 `INSERT INTO inventory_stock ... ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)`，完全绕过 containerEngine。根据架构规则，inventory_stock.quantity 必须通过 syncStockFromContainers 从容器汇总更新，直接写会导致 quantity 与 inventory_containers 的 remaining_qty 总和不一致。

**影响**：数据不一致，预占/出库时以错误的 quantity 为基准，可能超卖或拒绝本可履约的订单。

**建议**：改为通过 containerEngine.createContainer 创建容器，再调用 syncStockFromContainers，或提供专门的「初始化库存」流程。

---

### H2. scan-logs 存在 IDOR，可操作任意任务的容器

**位置**：`backend/src/modules/scan-logs/scan-logs.routes.js` + `scan-logs.service.js`

**问题**：createScanLog 仅校验 taskId、itemId、containerId 格式，未校验：
1. itemId 是否属于 taskId；
2. containerId 的商品是否与 itemId 对应；
3. 当前用户是否有权操作该任务/仓库。

任何已登录用户可对任意任务发起扫码、锁定容器，造成越权操作和业务混乱。

**建议**：在 service 内校验 itemId ∈ task.items、container 的 product_id 与 item 一致；并增加仓库/任务级权限校验（如仅允许操作自己负责仓库的任务）。

---

### H3. picking-waves.updatePickedQty 允许 pickedQty 超过 totalQty

**位置**：`backend/src/modules/picking-waves/picking-waves.service.js` 第 216-263 行

**问题**：updatePickedQty 未校验 pickedQty ≤ totalQty。当传入 pickedQty > totalQty 时，仍会更新 picking_wave_items.picked_qty，且按任务分配时会使 warehouse_task_items.picked_qty 超过 required_qty，导致波次汇总与任务明细不一致。

**建议**：在更新前校验 `pickedQty <= waveItem.totalQty`，超出时抛出 AppError。

---

### H4. warehouse-tasks.updatePickedQty 未校验 pickedQty ≤ requiredQty

**位置**：`backend/src/modules/warehouse-tasks/warehouse-tasks.service.js` 第 106-110 行

**问题**：直接 `UPDATE warehouse_task_items SET picked_qty=?`，未校验 pickedQty ≤ requiredQty。可把已备数量设为大于需求数量，数据不符合业务规则。

**建议**：增加校验 `if (pickedQty > item.requiredQty) throw new AppError(...)`。

---

### H5. reservationEngine 预占存在竞态，reserved 可能暂时大于 quantity

**位置**：`backend/src/engine/reservationEngine.js` reserve()

**问题**：SELECT FOR UPDATE 在行不存在时不加锁。当 inventory_stock 无对应行时，两个并发 reserve 可能都通过「available >= qty」检查，然后都执行 INSERT/UPDATE，导致 reserved 超过 quantity。虽然后续 moveStock 有「安全收敛」步骤，但预占阶段会出现 reserved > quantity 的不合理状态。

**建议**：对「行不存在」场景使用 SELECT ... FOR UPDATE 加间隙锁，或采用 INSERT ... ON DUPLICATE 前先锁定/创建行，避免并发预占通过相同检查。

---

## 2. 中危 Bug

### M1. 敏感操作未使用 permissionMiddleware

**位置**：warehouse-tasks、inbound-tasks、picking-waves、sale、purchase 等 routes

**问题**：出库、取消任务、上架、确认销售等敏感操作仅使用 authMiddleware，未使用 permissionMiddleware 做权限校验。任何已登录用户均可执行这些操作，无法按角色/权限控制。

**建议**：对 ship、cancel、putaway、finish、reserve、confirm 等操作增加 permissionMiddleware('warehouse-tasks:ship') 等权限校验。

---

### M2. containerEngine.createContainer 不校验 productId/warehouseId 存在性

**位置**：`backend/src/engine/containerEngine.js` createContainer()

**问题**：未校验 productId、warehouseId 在 product_items、inventory_warehouses 中存在。若传入无效 ID，会插入指向不存在主数据的容器记录，产生脏数据。

**建议**：在 createContainer 内或调用方事务中，先校验 product 与 warehouse 存在后再插入。

---

### M3. inbound-tasks.putaway 未校验 locationId 属于当前仓库

**位置**：`backend/src/modules/inbound-tasks/inbound-tasks.service.js` putaway()

**问题**：locationId 为可选参数，但未校验其属于 task.warehouseId。若传入其他仓库的库位 ID，会把容器绑定到错误库位，造成拣货路径和库存分布错误。

**建议**：当 locationId 非空时，校验该库位属于 task.warehouseId。

---

### M4. warehouse-tasks.assign 未校验 userId 有效性

**位置**：`backend/src/modules/warehouse-tasks/warehouse-tasks.routes.js` assign、warehouse-tasks.service.assign

**问题**：assign 接收的 userId 来自请求体，未校验是否存在于 sys_users。可分配任务给不存在的用户，产生无效的 assigned_to。

**建议**：在 assign 内查询 sys_users，若用户不存在则抛出 AppError。

---

### M5. sale.service.create 未校验 customerId、warehouseId、productId 存在性

**位置**：`backend/src/modules/sale/sale.service.js` create()

**问题**：创建销售单时未校验 customerId、warehouseId 及 items 中 productId 是否存在。可插入关联无效主数据的订单，导致后续查询、统计出错。

**建议**：在事务开始后、插入前，校验客户、仓库、商品均存在且有效。

---

### M6. picking-waves.finish 未在事务内重新读取 wave.tasks

**位置**：`backend/src/modules/picking-waves/picking-waves.service.js` finish()

**问题**：finish 使用入参 wave（由 findById 在事务外获取），事务内未再次读取。若在「开始事务」与「读取 wave」之间波次结构被修改，可能基于过期数据回写 picked_qty。

**建议**：在 beginTransaction 之后，用 conn 重新 query 获取 wave 及其 tasks，再执行回写逻辑。

---

## 3. 低危问题

### L1. containerEngine.createContainer 允许 initialQty=0

**位置**：`backend/src/engine/containerEngine.js` createContainer()

**问题**：assertNonNegativeQty 允许 0，会创建 remaining_qty=0 的 ACTIVE 容器，语义上接近「空容器」，可能造成统计和 FIFO 逻辑上的混淆。

**建议**：若业务不允许 0 数量入库，可增加 `if (initialQty === 0) throw new AppError(...)`。

---

### L2. 部分 catch 仅 rollback 后 throw，未补充日志

**位置**：多处 service 的 try/catch（如 sale.service、warehouse-tasks.service）

**问题**：catch 中只做 rollback 并 throw，未记录错误日志，不利于线上排查和监控告警。

**建议**：在 rollback 前调用 logger.error 记录异常上下文，再 throw。

---

### L3. 列表接口 page、pageSize 未做上下界校验

**位置**：warehouse-tasks.findAll、sale.findAll、inbound-tasks.findAll 等

**问题**：page、pageSize 直接参与查询，未限制最大值。可传入 pageSize=999999 或 page 极大值，导致大查询、高负载。

**建议**：对 pageSize 做 clamp，如 `Math.min(Math.max(1, pageSize), 100)`；对 page 做上限或偏移量校验。

---

### L4. scan-logs 未校验 container 的 product_id 与 item 一致

**位置**：`backend/src/modules/scan-logs/scan-logs.service.js` createScanLog()

**问题**：请求可传入任意 containerId 与 productId，未校验该容器的 product_id 与任务明细中的 productId 一致，可能扫错容器、锁错商品。

**建议**：在 lockContainer 前，查询容器并校验 product_id 与 itemId 对应商品的 product_id 一致。

---

### L5. 导入库存时 qty 可为负数

**位置**：`backend/src/modules/import/import.routes.js` 第 88-96 行

**问题**：`+qty || 0` 在 qty 为负时不会变为 0，会直接把负数写入 quantity，导致负库存。

**建议**：校验 `qty >= 0`，或使用 `Math.max(0, +qty || 0)`。

---

## 4. 安全建议

### S1. SQL 注入

**结论**：当前未发现明显 SQL 注入。查询均使用参数化（? 占位符），keyword、条件等通过 params 传入。codeGenerator 中 table、codeField 来自调用方常量，非用户输入。

**建议**：继续保持参数化查询；若以后动态拼表名/字段名，需白名单校验。

---

### S2. 输入校验

**现状**：sale、inbound-tasks、warehouse-tasks、picking-waves 等主要写操作已使用 Zod 校验 body。部分接口（如 warehouse-tasks 的 ship、cancel、startPicking）无 body 校验，但依赖路径参数，风险较低。

**建议**：对 :id 类路径参数统一校验为有效正整数（如 `z.coerce.number().int().positive()`），避免 NaN 或非预期类型传入。

---

### S3. 权限与访问控制

**现状**：业务路由均使用 authMiddleware，但鲜少使用 permissionMiddleware，缺少细粒度权限控制。

**建议**：
1. 梳理各模块的操作权限码（如 warehouse-tasks:ship、sale:confirm）；
2. 在敏感路由上增加 permissionMiddleware；
3. 对跨租户/多仓库场景，增加「用户只能操作有权限仓库」的校验。

---

### S4. JWT 与环境变量

**建议**：确认 JWT_SECRET 足够强且仅存在于环境变量；生产环境禁用 JWT 调试信息；如有需要，考虑 token 刷新与黑名单机制。

---

### S5. 并发与事务

**现状**：库存相关操作已使用事务和 FOR UPDATE。reservation 在「行不存在」时有竞态，见 H5。

**建议**：除修复 H5 外，对涉及多表、多行加锁的流程，约定统一的加锁顺序（如按 warehouse_id、product_id 升序），降低死锁概率。

---

*报告完毕。*
