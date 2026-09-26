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
9. 数量为两位 DECIMAL，用户原值与未取整的单位折算结果都最多两位有效小数；超过精度直接拒绝，不能依赖数据库分别舍入造成库存增减不等。整数商品须逐箱/逐项校验。原值校验后，比较、分配、累加和扣空状态判定统一按百分位执行（`roundQty` 或 `toQtyUnits/fromQtyUnits`），不因 `0.1+0.2` 尾差误拒或留下数量零但仍 ACTIVE 的条码。金额和换算率不改变精度。
10. 不恢复已关闭的手动入库/手动库存调整入口；入库走收货，调整走盘点。初始化导入等专用流程遵守其既有校验，不扩展通用后门。
11. 写操作考虑连点与断网重试：前端稳定 `X-Request-Key`，后端 `beginOperationRequest/completeOperationRequest`，结合唯一键和 CAS。资源级写操作的 action 必须绑定单据 ID，避免同一请求键跨单据误重放；重放返回原回执，不能重复加库存、推进状态或入账。公共操作幂等在重复 INSERT 后以 `FOR SHARE` 当前读检查既有回执，避免两个重放事务将唯一键共享锁升级为排他锁而死锁；不能改成可能漏掉新提交回执的快照读。确定性并发专项已接入 `smoke:concurrency-guards`，验证与全模块覆盖见 `docs/all-module-regression-2026-09-12.md`。
12. 事务内禁止外部 HTTP 或物理打印。打印只在数据库入队，实际动作异步；补打不建容器、不加库存、不改账款。
13. 缓存漂移先只读检查；需要修复时走既有 resync/引擎入口，不能手改数据库。不要为了“验证”擅自跑会修复数据的命令。
14. 改引擎或状态机前读完整调用链与历史事故注释；副作用变化同步 `WT_ON_ENTER_ACTIONS` / `WT_ON_EXIT_ACTIONS` 及相关测试。

### 分拣格补分配与释放（2026-09-24）

创建销售仓库任务时没有空闲分拣格，任务可继续创建；后续主管补分配先锁 `warehouse_tasks` 行，再锁同仓 `sorting_bins` 空闲格，双向绑定、`SORTING_BIN_ASSIGNED` 事件与幂等回执同事务。与任务取消、打包释放保持任务→分拣格锁序。强制释放先读取占用任务 ID，事务内先锁任务再锁格，并复查当前绑定；期间换绑则回滚重试，不按事务外陈旧任务 ID 清空新绑定。格位释放不代表容器、实物或扫码进度已经安全归位；PDA 仍按原商品码→格码扫码闭环作业。

### 2026-09-23 审计确认修复

- 盘点提交先按库存维度锁定全单，扫码路径预计算未锁容器的实际损失，普通路径读取负差异；全部行通过现货预占校验后才写库存。`reserved` 扣除有效预计绑定后才是须由实物支撑的预占。不足时 `STOCKCHECK_RESERVED_SHORTAGE`，保留已保存的实盘数，先通过销售调整/释放处理，不能静默挑订单取消。
- 容器扣减只接受正数，零或负数不再转绝对值。
- 手动出库以 `inventory.manual-out.v2` 加完整载荷指纹保存回执（商品、仓库、数量及日志字段）。相同载荷重试重放；旧回执缺少仓库，返回 `LEGACY_STOCK_REQUEST_REVIEW_REQUIRED` 要求核对流水，避免误报成功或重复扣减。回放前仍校验当前仓库权限。

### 2026-09-26 容器拆分纳入资源级幂等（任务 4 续）

容器拆分（`POST /api/inventory/containers/:id/split`）是真实库存写——扣减源容器余量、新建塑料盒、写库存流水——但一直是同域里唯一**没有稳定请求键、也没有幂等回执**的写入口（同域的移库/出库早已带上）。PDA 在弱网下连点或自动重试，同一个拆分请求会真的执行两次：源容器被扣两次、凭空多出一个盒子，而现场只看到「拆分成功」。

现按第 11 条的既有形态接入：前端复用 `frontend/src/lib/requestKey.ts` 的稳定键，后端 action 为 **`container.split.<源容器 id>`**、回执 `resource_type='inventory_container'` / `resource_id=源容器 id`，同键重放原样返回**同一份回执**（同一新盒条码与 ID），不再扣源容器、不再建盒、不再写流水；换新键照常执行（幂等是「同键去重」，不是「拆过一次就锁死」）；**不带键时 `enabled:false` 放行**，老客户端不受影响。回归 `tests/container-split-idempotency.smoke.test.js`（§A 首拆 / §B 同键重放 / §C 换键 / §D 无键 / §E 落库形态 / §F 范围撤销后的重放）。

注意该回归里「拆分前后库存总量不变」只守**守恒不变量**，不能当幂等证据：旧行为下它也照样通过（重复拆分只是把同一批货多切了一刀，总量仍守恒）；真正证伪旧行为的是源容器余量、子盒个数、流水条数与回执一致性那四条。

回放**先复核当前仓库范围**（2026-09-27 二轮独立审阅补修）：范围校验（读容器 `warehouse_id` + `assertInScope`）排在幂等回执判定**之前**。回执里带着新盒条码、新容器 ID 与仓库，是真实库存信息；若先返回回执再校验范围，操作者的仓库范围之后被撤销，就仍能用旧请求键重放读到这些信息。幂等只应免掉「重复执行」的副作用，不免掉「现在还有没有权读」。这条查询不加锁（普通读），提前不改变锁顺序。回归 §F：范围内用户先正常拆一次 → 把其范围换到别的仓库 → 同键重放返回 403 `WAREHOUSE_SCOPE_DENIED`，且响应不含此前拆出的条码，源容器余量 / 子盒个数 / 流水条数均不变。

### 2026-09-27 在途异常了结后的撤回收货（任务 1 第三条路径）

`forceCloseInTransit`（`transfer.service.js`）把在途容器置 VOID 并清空 `transfer_order_id`，**不加库存、也不写 `inventory_logs`**——scanOut 时已从源仓扣减，货物按实际运输损耗核销。而撤回收货的候选集只查 ACTIVE/待上架/EMPTY 的容器，于是该容器同时脱离候选状态、摘掉在途标记，原有的在途 / 已不在任务仓 / 数量不等 / 任务锁四道守卫全部落空：撤回会把已核销的货当成「从未收货」作废并反冲采购应付，而源仓已扣、调拨单不会回退，账面既没有库存、也没有应付。

守卫改为按**该收货单名下全部未删除容器**（不只是撤回候选集）是否存在 `ref_type='transfer'` 流水判定，即上面的 ③ 号守卫（`inbound-tasks.void.js`）。判据取「流水」而不是「状态是不是 VOID」：普通作废（出库耗尽、人工核销）没有调拨流水，不会被误伤。该查询用 `FOR SHARE` 当前读，避免漏掉本事务快照建立后提交的新流水；候选集之外的容器本事务只共享锁其流水行、不再请求其容器行锁，与写方只构成单向等待，不成环。回归 `tests/inbound-void-transferred-container.smoke.test.js` §E（异常了结后撤回 409、应付/任务/流水均无副作用）/ §F（VOID 但无调拨流水 → 照常放行）。

同路径另修一处**阻塞缺陷**：`forceCloseInTransit` 的容器查询在 `SELECT` 列表里带了 `inventory_containers` 上并不存在的 `product_name` 列，任何调用都 500 `DB_COLUMN_MISMATCH`（scanOut/scanIn 用 `SELECT *`，取到 `undefined` 后靠 `|| ''` 兜成空串，所以一直没暴露）。该列在本函数内并未使用，已从 SELECT 移除。
