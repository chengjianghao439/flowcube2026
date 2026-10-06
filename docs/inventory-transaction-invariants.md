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

### 采购持续收货的任务锁与完结（C4，2026-10-01）

`receive` / `putaway` / `closeReceiving` 先锁本任务行、核当前用户仓库范围，再处理原键回执；其中 PDA 收货/上架还核设备仓，`closeReceiving` 仍是 ERP 主管操作，不新增 PDA 执行入口。重放在业务阶段闸门之前，已完成单的原键仍返回原结果；撤权/换仓不能绕过执行校验。任务→原上架库存维度→容器锁序不变，实物只来自 ACTIVE 的 remaining_qty，成本/库存流水/缓存仍走原函数。

`tryFinishTask` 的调用方持有任务行锁，并在同 conn 读取当前任务阶段（FOR UPDATE），仅阶段 3 评估全部实收/全部上架。原因：资源幂等 legacy 查询的普通读可能先建立 RR 快照；若在此后等待任务锁，另一个结案事务刚提交的 2→3 会被普通快照读误读为旧2，末箱已上架却不结算。锁任务放在幂等读取前，完结阶段当前读，真实 receive/putaway/close 并发测试同时断言最终4/audit1/实收应付，而非只核 SQL 文本。

收满和短装结束都在同事务调用单一完结函数；关闭回执 action=`inbound.closeReceiving.<taskId>`，保存最终 `{taskId,status}`，同键重放不新增事件、库存流水、成本或应付。已有采购全量应付重算、已付余额、首次账期/到期日与已执行采购退货扣减保持；开放收货不audit，不逐箱AP。预计供应仍为开放采购总量减所有非取消任务的 putaway_qty，20实物+80预计=100，上架兑现绑定不扣销售预占。无迁移、历史状态/成本回填或生产操作。

### 分拣格补分配与释放（2026-09-24）

创建销售仓库任务时没有空闲分拣格，任务可继续创建；后续主管补分配先锁 `warehouse_tasks` 行，再锁同仓 `sorting_bins` 空闲格，双向绑定、`SORTING_BIN_ASSIGNED` 事件与幂等回执同事务。与任务取消、打包释放保持任务→分拣格锁序。强制释放先读取占用任务 ID，事务内先锁任务再锁格，并复查当前绑定；期间换绑则回滚重试，不按事务外陈旧任务 ID 清空新绑定。格位释放不代表容器、实物或扫码进度已经安全归位；PDA 仍按原商品码→格码扫码闭环作业。

### 2026-09-23 审计确认修复

- 盘点提交先按库存维度锁定全单，扫码路径预计算未锁容器的实际损失，普通路径读取负差异；全部行通过现货预占校验后才写库存。`reserved` 扣除有效预计绑定后才是须由实物支撑的预占。不足时 `STOCKCHECK_RESERVED_SHORTAGE`，保留已保存的实盘数，先通过销售调整/释放处理，不能静默挑订单取消。
- 容器扣减只接受正数，零或负数不再转绝对值。
- 手动出库以 `inventory.manual-out.v2` 加完整载荷指纹保存回执（商品、仓库、数量及日志字段）。相同载荷重试重放；旧回执缺少仓库，返回 `LEGACY_STOCK_REQUEST_REVIEW_REQUIRED` 要求核对流水，避免误报成功或重复扣减。回放前仍校验当前仓库权限。

## 2026-09-29 批 A：塑料盒作业流（放货 / 同商品混批 / 还原整件）

- **守恒**：放货（整件 → 盒）与还原整件（盒 → 若干整件码）都只改变「货在哪只容器里」，`inventory_stock` 的 ACTIVE 合计恒不变；`smoke:plastic-box-batch-a` 逐笔断言汇总守恒。
- **混合标识不得冒充单一批次**：`is_mixed_batch=1` 的盒/码必须清掉 `batch_no` / `mfg_date` / `exp_date`（那些值已不代表整盒）。传递规则：空盒承接来源身份（来源为混合 ⇒ 三项全空并置 1，否则承接来源三项并置 0）；非空目标只要本次真混批、或来源/目标任一侧本就是混合，就置 1 且**不得被清回 0**；混合盒还原出的码仍是混合来源（两跳继承）。
- **混批放行只认到期事实**：放行闸看 `exp_date`，**不看** `batch_no` / `mfg_date`（那是批次信息，不是保质期依据）。本作业流不管理保质期，但任一侧携带真实 `exp_date` 时仍拒绝并入——盒上那个到期日一旦不再代表整盒，出库 FEFO 排序与效期告警都会读错。
- **空盒必须完整重置批次/日期**：`repack` 把盒清空时只改 `remaining_qty` / `status`，**不重写** `batch_no` / `mfg_date` / `exp_date`（那是「货走了」而非「盒换了身份」）。因此**再往空盒装货时**必须由 `splitContainer` 的空盒分支**覆盖**这三项，否则「曾装过带效期货的空盒」会残留旧效期并被后续误读。
- **幂等按目标容器绑定**：`fill` / `repack` 的资源级幂等 action 形如 `plastic_box.<动作>.<盒 id>`，同键重放返回原回执（不重复建码、不重复建打印任务）。**范围（仓库）校验必须先于重放判断**——否则同键重放可绕过权限拿到结果。
- **设备仓只在 PDA 分支生效**（`pdaSessionOptional`，判据以代码为准）：**带 `X-Client: pda` 或携带 `X-PDA-Session`，任一成立即走完整设备闸**（校验票据有效、未吊销、未过期、设备未停用、未换仓、与当前账号一致）；**带 PDA 标记却缺票必须拒绝**（不能当 PC 放行）；**两者都没有才是纯 PC 路径**（走权限 + 仓库数据范围，`req.pda = null`）。走设备闸时业务层还须把**设备绑定仓**与目标盒所属仓比对。
  > 注：该闸只保证「票有效」，**不自动核对目标任务仓**——跨仓比对必须在业务服务层显式做。
- **打印失败降级不回滚库存**：标签入队失败（无可用打印机 / 渲染失败）只产生 `status=3` 的失败记录供补打，业务事务照常提交；两种原因**分开计数**（`noPrinterCount` / `renderFailedCount`），界面不得说错原因。

## 2026-10-04 R7：普通拆分原回执

`inventory.container.split.<来源ID>` 使用原资源幂等工具，库存、标签任务及来源余量/新码/目标别名/打印结果快照同事务提交。范围和设备仓先于重放；锁顺序仍维度→容器，锁后核当前维度未变化。PDA 仅部分量、旧 PC 合法全量的差异保持；目标等于来源在引擎第一处写入之前拒绝，不能先扣再往同一行加。数量、个体、任务锁、效期、混批及缓存同步规则不变。历史查询核原流水仓，不以调拨后的当前仓否定历史；本轮只有离线边界证据，真实 MySQL 锁等待/回滚/重放并发和打印仍待验收。

写事务重放在已持维度和来源容器锁之后，以 `currentRead: true` 调用领域核验，原流水与容器身份使用 `FOR SHARE` 当前读。初始非锁维度读可能已建立 RR 快照，不能再用该旧快照核等锁期间另一请求提交的新流水和新容器；不为解决可见性提前锁来源容器，也不修改隔离级别。本人独立结果查询不传该选项，仍核原操作仓/身份且不加库存锁。离线夹具只模拟快照/等锁边界，实际 MySQL 并发仍待验。

## 2026-09-29 批 B3a：取货码下游链（分拣接入真实 sort-done / 复核真实 CHECK）

- **分拣进度只有两个事实源**：`warehouse_tasks.status` 与 `warehouse_task_items.sorted_qty`。新增的 `sorting_bin_items`（迁移 `267`）**只是作业记录与防重**（`UNIQUE(task_id, container_id)`、`qty DECIMAL(12,2)`），不改 `remaining_qty`、不参与 `syncStockFromContainers()`，也**不能**用来判定「分拣完成」。
- **取货码归属必须绑定当前任务的有效取货记录**：判定依据是「当前任务 + 该容器 + `scan_purpose=1` 且 **`source_container_id` 非空**的 PICK 行」。**不得**用容器上的 `source_ref_type='plastic_box_pick'` 反推——容器被取消/归还后可合法作为普通整件再给**下一个任务**拣，那时它仍是历史取货来源，却已不是新任务的取货标签。精确解析同样不得选到旧 task 的 PICK 行。
- **两个聚合严格区分、各自命名、不得混用**（`warehouse-tasks.sort.js`）：
  - **A = `pickLabelTotalQty()`**：该明细**全部有效盒取货量**，**含尚未分拣**的标签。
  - **C = `confirmedPickLabelQty()`**：**已确认分拣**的标签份额（`sorting_bin_items` 有效记录）。
  - 旧商品码**上限 = `picked − A`**（不是 `picked − C`）：标签份额在**拣货那一刻**就已归属，未扫任何标签时旧码也只能报 `picked − A`；**超限直接拒绝**，不得 `Math.min` 静默夹成满量。
  - 总进度 **`sorted_qty = 旧码份额 + C`**；`items=null`（整任务完成）同样写 `(picked − A) + C`——**不是恒等式**，标签没扫完就不推进。取货码分拣超量同样**拒绝**而非截断。
- **分拣幂等顺序**：`begin/replay` 判定**必须先于状态规则**（范围/设备仓、取消闸、改单闸仍在它之前）。分拣完成会把状态 CAS 成「待复核」，若状态规则挡在 replay 前面，原键重放永远查不回原回执。
- **锁序与归属**：任务 → **分拣格**（`FOR UPDATE`，复查 `current_task_id` / `status=2` / `warehouse_id` / `code`）→ **容器**。容器加锁前**先无锁 peek** 归属，明显不属于本任务的取货码立即拒绝，**不先锁住他任务的容器资源**；正式锁后再复查一次。
- **支持边界（第一期）**：单个 `sort-done` 请求**最多一张取货码**，多于一张由服务端**显式拒绝**（`PICK_CODE_MULTIPLE_NOT_SUPPORTED`），不依赖「PDA 一次只扫一张」的隐含假设；明细数上限 50。批量取货码需要事务内先聚合、再一次 `VALUES` 批量写 + 按最终明细集合批量 `UPDATE`，本期不做。
- **进度写回一次批量完成**：`sorted_qty` 在循环内**只算不写**，循环结束后按最终数量拼 **`CASE id WHEN ? THEN ? ... END`** 一次 `UPDATE ... WHERE task_id = ? AND id IN (?)` 写回（`items=null` 的整任务分支同样如此，空集直接跳过）。**不得**在循环里逐行 `UPDATE`——原整任务分支的一次 UPDATE 也一并收敛到这条路径。
- **旧商品码报量先校验精度再运算**：`assertQtyPrecision` 作用于**原始输入**（两位小数 + 整数商品整数约束），不得先 `roundQty` 再校验——静默舍入会让账面与实际分叉。
- **复核前置与锁后双校验**：`POST /scan-logs/check` 的**范围 / PDA 设备仓校验必须先于幂等 `begin`**（覆盖首次与重放），并在**行锁到手后再复查一次**；复核仍走「先真实扫码落 `scan_logs`(CHECK)、再 `checkDone`」的闭合链，**禁止**用作业记录伪造已复核。

## 2026-09-29 批 B3b：装箱配额按来源取货标签分行（含回收）

- **装箱行按来源粒度分**：`package_items.label_container_id`，`NULL` = 按**商品码**装的旧 SKU 份额，非空 = 来自某张**取货标签**。同一商品在同一个箱里**可以多行**（旧 SKU 一行 + 各取货标签各一行）——因此：
  - 任何按 `(package_id, product_id)` 取**单行**的消费方都必须改成 `SUM`。已核对的受影响点：`warehouse-tasks.adjust.js` 的 `candidatePackages` 标量子查询（已改 `COALESCE(SUM(qty),0)`）；`packages.service.js` 的"已有行累加"已按 `label_container_id` 分行匹配。其余 consumer（`EXISTS` / `LIMIT 1` / 按 `id` 取行 / 列其它商品）经 rg 核对无单行假设。
  - **界面不得把行数当"种数"**：种数按 `product_id` 去重；列表必须逐行显示**来源**（取货码 / 按商品码），否则移出时会挑错份额。
- **标签只消费自己的未装余量**：默认「扫一张标签 ⇒ 整份装入」（`qty` 省略即余量），显式给量不得超；余量 = 该容器在本任务的 **CHECK 合计 − 已按该标签装箱的量**（作废箱不计）。
- **旧 SKU 上限 = `checked − Σ标签的真实复核量`**：依据是标签**占住的份额**（尚未装的标签货也已占住），**不是**「已装的标签量」；超限拒绝（`PACKAGE_LEGACY_OVER_LIMIT`），**不用 `Math.min` 静默夹满**。合计仍守 `<= min(required, checked)`。
- **标签准入链**：`container_type=1`（塑料盒条码明确拒绝）→ **当前任务锁定** → 仓库一致 → **真实盒取货 PICK**（`scan_purpose=1` 且 `source_container_id` 非空，**不认容器历史 `source_ref_type`**）→ 唯一明细 → 商品一致 → **真实 CHECK 量**。装箱**不改变**箱子/任务状态，因此「上次到底成没成」只能靠**原键回执**定位（服务端 `getScopedOperationRequestStatus` 支持 base action 匹配唯一 scoped 行；传 scoped 时按 `resource_id` 过滤 ⇒ **只接受原箱**），**不得**凭「列表里已有该标签行」推断本次成功。
- **锁序统一（受影响路径）**：`add-item` / `remove-item` / `void` / `finish` 一律 **无锁 peek 所属任务 → 锁 task → 锁 pkg → 复查归属**。原因是取消流程走 `task → UPDATE packages`（锁箱行），先前 pkg→task 的写法与之交叉**会死锁**；`voidCompletedPackage`（既有改单受控流程）本批**未改**。
- **范围与改单闸**：`remove` / `void` / `finish` 原先**未传 `pdaWarehouseId`**、也**没有 `adjustment_requested_at` 闸**，本批补齐（与 `addItem` 口径一致）。`finish` 的 **scope-先于-replay** 与「历史回执在 controller 层、与 pkg 事务不同事务」两点**已由批 C2 覆盖**（同 conn 同事务 + 归属复查先于 begin/replay），见 `docs/plastic-box-batch-c2-handover-2026-09-29.md`。
- **幂等**：`add-item` 的 `beginResourceOperationRequest` 必须传 **base action `package.add`**——helper 会**无条件**再拼 `.resourceId`，写成 `package.add.<id>` 会变成 `package.add.<id>.<id>`；范围/设备仓校验**先于 `begin`**。

## 2026-09-29 批 B4：取货码的取消 / 减量归还闭环

- **取消不回盒**：取消整份时货**留在新 `I` 上**（解锁、仍 ACTIVE），**不自动加回 `B`**；`inventory_stock` 守恒，`inventory_logs` 留痕。要回盒必须另行指定盒并人工确认。
- **减量不改写作业记录**：`sorting_bin_items` 是**历史**记录，减量**不收缩**它，**问题也不在它**——根因是「有效聚合」**没有受当前任务的当前有效 PICK 约束**。改的是**「已确认标签份额」的读法**：
  `confirmedPickLabelQty = Σ min(该容器历史作业量, 该容器在本任务的当前有效取货量)`，其中有效取货量必须**先按容器聚合再 JOIN**（同一容器多条 PICK 会让 `sbi` 被重复累计）。正常场景两者相等 ⇒ 与旧口径一致；减量后 `min(150, 100) = 100` ⇒ **不会拿历史份额挤掉后续补拣**。
  > 实测缺陷（修复前）：分拣 150 → 减量到 100（PICK 降、`sbi` 留 150）→ 增量回 150 → 补拣 50 ⇒ 真实 `sort-done` 报 `409 PICK_CODE_EXCEEDS_PICKED`（「已确认取货标签 150，本次 50」超过已拣 150）。
- **归属一律按「当前任务 + 当前有效 PICK」**：
  - 取消归还后的码被**下一任务**当**普通整件**拣时，其 PICK 行 `source_container_id` 为**空** ⇒ 它**不是**任何任务的盒取货标签，**取货码形态分拣会被拒**；**不得**按容器历史 `source_ref_type` 认领。
  - **补打**同理：先看容器**当前** `locked_by_task_id`，为空 ⇒ 明确拒绝（`PICK_LABEL_NOT_IN_TASK`）；再在**该任务**下找 `source_container_id` 非空的 PICK 行。**实测缺陷（修复前）**：取消归还后仍按容器历史来源打出「取货标签」。
- **同箱同 SKU 可多行**：两张标签装同一个箱是**两行**（`UNIQUE` 只在作业记录上，装箱行按 `label_container_id` 分行）；减量按 **FIFO** 从**最早**的拣货行扣减，所以「某张标签的剩余量」不一定是原值，任何断言都要取**当前实际值**。已完成箱在减量时进 `packageVoids` **受控拆箱**，归还进 `containerReturns`，两者都经 PDA 逐条确认后才生效。

## 2026-09-29 批 C1 / C2：装箱异常恢复与完成箱的回执事务

- **关键操作的「回执与业务」必须同一 conn、同一事务**。`package.finish` 修前是「**pool** 上 `beginResourceOperationRequest` + 业务在自己的事务提交 + 事后写回执」，且回执构建还在 **commit 之后**：于是 ① pool 上的 begin 让**重放先于**范围 / 设备仓校验命中；② 存在「业务已提交、回执未落」的窗口；③ 回执构建自身失败时业务已提交却拿不到结果。现统一为**同事务**：锁任务 → `assertTaskScope` **先于** begin → 锁箱复查归属 → begin/replay → 业务 → **同事务内**构建回执 → 落回执 → commit。
- **失败即整体回滚，不另开事务补失败回执**：未通过范围 / 设备校验的请求不该留下任何回执行；瞬时故障（读 / 回执写入）之后**用原键重试必须能成功** —— 补一条 failed 行会把这次重试**永久挡成 409**。与 `add / remove / void` 一致：**回滚即无行**。
- **幂等 `begin` 之前必须完成归属复查**：`peek` 是**无锁**读，锁箱后必须复查 `warehouse_task_id` 与本任务一致，否则会把**过时 / 越仓**的原回执回放出去。
- **事务内读「本事务刚写的行」必须用同一个 conn**：`print-jobs.query.findById` / `dispatch.getDispatchHintForJob` 增加**可选** `exec`（旧调用默认 pool，行为不变）。`findByIdWithExecutor` **缺行是抛 404**，不是返回 null —— 事务内误用 pool 读未提交行的后果是**整笔回滚**。
- **`remove-item` / `void` 的幂等边界**：范围 / 设备仓校验**先于** `begin`；**重放分支排在明细 / 状态检查之前**（整行已删、箱已作废都还能按原键取回原回执）；**新键仍是合法新操作**（第二次移出照常、新键对已作废箱仍 400）——**幂等只救「同一个操作」**。
- 触发点：`tests/pack-remove-void-replay.smoke.test.js`（7 项）、`tests/pack-finish-receipt-tx.smoke.test.js`（9 项，含 commit / 回执写入 / 回执构建读三种故障注入各自全量回滚并原键可重试）。

### 打包末尾两入口（2026-09-29 批 C4）

- **箱贴补打 `print-label` 同样必须同事务**：controller 原用 **pool** 做 begin（自动提交）、业务在另一条连接、`complete` 又在 pool —— 既有「队列已提交、回执未落」的半成功窗口，又有「失败留 `PENDING` 把原 key 永久挡住」。现下沉到 `packages.service.printPackageLabel`：**范围 / 设备仓校验先于 begin/replay** → 锁 task → 锁 package 复查归属 → begin/replay → 入队（`conn`）→ `dispatchHint`（**同一 conn**）→ `complete`（`conn`）→ commit；任一环失败**整体回滚**。
- **缺箱在 `begin` 之前明确 404**：不留回执行、不留队列行，**原 key 可直接重试**（不要为了「总是留痕」补一条 FAILED —— 那正是把重试永久挡死的写法）。
- **资源级幂等键必须绑资源**：箱贴的打印幂等键由 `package_label:<requestKey>` 改为 **`package_label:<packageId>:<requestKey>`** —— 只带 requestKey 时，同一 key 用到另一只箱上会命中前一箱的**活跃 job**（`createRecord` 见同 key + 同仓 + 同 jobType 即原样返回），后一只箱**根本没进队**而调用方拿到「已入队」和**别人的** job。**不做截断**（截断引入隐式碰撞），超长由 `createRecord` 明确 400 并整体回滚。
- **已确认回执在「写重放」与「查询回执」两个入口都要校验自洽**：`GET /api/system/request-status` 是前端恢复的实际入口，公共 hook 一看到 `status==='success'` 就清 pending 并当成功，之后再无校验点。`packages/packages.receipt-guard.js` 的 `assertPrintLabelReceiptConsistent` 对 `package.print-label` 的 `SUCCESS` 校验 `data.job` 的 `refType/refId` 与 `receipt.resourceId` 一致，不一致 **409 要求人工核对原打印**（**不自动补打**、**不改写历史行**）；`operationRequest` 的查询匹配语义不动。
- **`pack-done` 的状态规则必须排在幂等 `begin/replay` 之后**：原顺序下任务推进到 6 后**原 key 重放会被状态规则挡成 400**（与新 key 对旧状态**同一条文案**，合法重放拿不回原回执）。顺序固定为
  `锁任务 → 范围/设备仓 → 取消/改单闸 → begin/replay → 状态规则 → 打印闭环 → CAS`；**新 key 对已推进状态照旧 400**，两者必须**分别**断言。
- 触发点：`tests/pack-done-replay.smoke.test.js`（8 项）。

## 2026-10-01 A3：PC 塑料盒还原的跨刷新身份

本批只改变 PC 还原调用与恢复入口，不改容器、来源、成本、打印、库存汇总或后端回执事务。首发在 POST 前同步持久化账号/原盒/scoped action/原键/实际服务器端点/原数字参数；同盒未知结果不能被新输入覆盖。刷新仅恢复原身份，显式查询或同键同参数重试，`not_found` 不证明失败。

恢复成功必须核对原回执归属，更新或重读原盒；不能用当前正在查看的盒代替。业务已确认而本地清理失败时保留阻断，禁止换键再还原。查询/重试固定原端点并禁用本次候选服务器回退，另一服务器上的同账号 ID/盒 ID 不属于原操作。打印降级与业务成功分别说明，均不宣称物理打印完成。实现与权限/会话细则见 `docs/frontend-pda-conventions.md` 的 PC A3 段；原 `smoke:plastic-box-batch-a` 守恒专项及断言保持，本轮不跑数据库套件。

### C2 实发/退款锁序与唯一事实（2026-10-01）

kit 实发仍 SO→WT→成交当前行→库存维度→容器，金额以真实本批 WT7 同 commit 冻结。退款创建用 SO X 序列化原物料与来源申请上限，只锁选定 immutable source budget IDs，不以金额 JOIN 锁 WT/成交组。退款执行在质检全拒收与上架两入口均先锁来源预算（稳定ID顺序）→本 SR→RT→库存维度/容器→payment→退款证据 current-read/INSERT。执行不再取得 SO/组/WT 锁；不可变来源金额可普通 MVCC 读，永不更新的预算行仅作退款互斥。

QA数量从完整 RTI FOR UPDATE 当前读直接取得，不能先锁ID再用普通 JOIN 读旧RR快照。此前已完成退款 receipts 和其完成 RTI proof 当前读，核 checked−rejected=qualified=putaway；不去锁另一未完成 SR。不同来源退款与后批实发先锁 payment 再读/新增退款证据，防止等待前 RR 快照覆盖应收、证据范围锁与 payment 反锁。order current-money 查询只锁冗余 order_id 的证据主表，不锁 JOIN 的 g/wt，也不等 source budget mutex。

退款证据只保存本次真实 QA 执行量与 immutable 金额，不维护另一可写库存数量台账。源预算与派发数量不会因退货改写；库存唯一源仍 ACTIVE 容器，缓存仍仅 syncStockFromContainers。kit 取消已拣待归还预占留到正常 PDA 实物返库；客户端不能传 preserveReservation 选择此行为，服务层只据锁定 kit 身份决定。

C2规格复审补充：销售退货receive、QA完成与putaway完成三处门控必须按task锁之后，对完整RTI `ORDER BY id FOR UPDATE`当前读，再分别计算expected−received、received−checked、checked−rejected−putaway。不能用普通MVCC SUM，也不能只给聚合字面追加锁而假定所有事实已当前读。两位数量转百分整数差值，无浮点残量且不clamp真实剩量；source→SR→RT→库存维度→容器→payment既有执行锁序不改。普通销售RT采用同一当前读可靠性修正，采购退货不经过此销售RT链。
### C2 散件取消的预占归还事实（2026-10-01品质复审）

套单取消/逐容器归还读取本任务、本容器的当前有效PICK明细，`COALESCE(scan_purpose,1)=1`沿用历史NULL拣货口径，CHECK与CANCEL_RETURN不计入；合法改单会调整或删除原PICK记录，后续读其当前值。数量按百分整数累加，不新增数量台账。任务、明细、商品、仓库、容器锁归属及ACTIVE状态必须闭合；缺PICK或待归还量大于本单预占显式409，不用min/cap借用其他单份额。

同一conn持SO→WT，先stock dimension再container锁，当前PICK与自身预占行用`FOR UPDATE`直接读取，不用等待前RR快照的SUM。取消批量读取任务/WTI/容器/PICK/预占；归还在已持own WT与container锁后当前读取own WTI，WT排他锁已经阻止同任务拣货/改单/取消，因此不反向等待另一任务的WTI。归还必须先精确释放本容器PICK份额，再解锁容器、记录实际归还量和同事务回执；来源/预占故障回滚不解锁，原key可重试，成功重放不再释放。

此修正不改原扫码条码/箱拆解流程。2026-10-02归还权限复审进一步明确：kit PDA散件归还的SO X只协调同单预占，授权沿`assertTaskScope`按当前WT仓库与真实设备绑定仓库；不要求仓库员工同时具有销售单头仓范围。SO→WT锁序不变，任务`FOR UPDATE`当前读之后、begin/replay之前先核范围与设备，业务当前WT再次核验。成功key重放也须通过当前范围/设备检查。真实设备事实来自`req.pda.warehouseId`，不能来自body；内部service可选参数默认null保持原调用兼容，实际kit HTTP始终由设备会话中间件透传。

一个成交组仍只用单仓，订单可由不同仓的成交组组成；销售建改、占释、派发、取消、删除与来源退货继续按原整单头仓/保存物料范围授权。PDA不决定销售单取消，直接取消销售WT仍`SALE_ORDER_CANCEL_REQUIRED`。ordinary与box路径原政策不改。旧失败夹具曾留下的错误预占须另按精确来源核对恢复，更新helper不会自动修旧锁。


### C2 窄只读回执范围（2026-10-02）

系统本人回执查询沿原 auth + `(user_id,request_key,action)` 匹配，不新增业务写权限或 PDA 设备闸门。`getScopedOperationRequestStatus` 的可选内部 `receiptContext` 记录实际命中 operation row 的 `matchedAction`，不添加公开 DTO 字段，不改变 exact→legacy/唯一候选规则。仅当实际匹配 action 和请求 action 都严格为 `scan-log.cancel-return` 或 `.当前resourceId`，且真实资源为 `warehouse_task`、来源 SO 为 kit-v1、实际 WT 为 sale_out，`assertReceiptScope` 按当前 WT 仓授权本人原归还回执；每次重读仍核当前用户范围，撤销任务仓授权返回403。

请求宽 prefix、action 尾部与资源ID不符、cancel-return-box、其他 WT/SO/SR/RT 动作保持原完整套单范围。合法第二仓的归还成功后可查询本人原结果，但整单详情仍可能403。派发、归还详情的只读 DTO 契约见 `docs/business-semantics.md`：均从原 persisted facts 批量投影，不增加第二份数量账或业务写锁，归还/派发/退款写链未改。

### 销售占库范围当前读与并发授信（2026-10-03）

`reserveStock` 的完整已保存物料范围查询使用 `FOR SHARE` 当前读，并固定走迁移086已有的 `idx_order_id(order_id)`，包含数量为零的历史行，普通单与套单均须在 `begin/replay` 之前校验头仓和全部物料仓。不能为了读范围在客户锁之前建立 RR 一致性快照：同客户第二单即使等待 `sale_customers FOR UPDATE`，旧快照仍会漏掉第一单刚提交的在途授信占用。顺序仍为销售单锁 → 物料范围当前读 → 回执 → revision/状态 → 客户锁 → 授信读取 → 旧履约维度 → 库存锁；不把客户锁移到销售单锁之前。

既有 `smoke:fulfillment-credit` 以两个真实 RR 连接控制交错，同客户两单各 10、额度 15，第一单持客户锁时第二单发起同客户锁查询，第一单提交后第二单必须 `409 CREDIT_LIMIT_EXCEEDED` 且保持草稿。此修正不改授信计算、超额放行政策、全局隔离级别、商品/仓库范围或回执/revision先后语义。真实测试库的本地红绿、窄兼容与锁序结果仅证明本地事务行为，生产状态及整批最终回归须独立核实。

只加当前读仍不足：优化器会为双仓物料范围选择迁移195的覆盖索引 `(order_id,product_id,warehouse_id)`。第二单持范围 gap S 等客户 X 时，前单的合法占库改仓需在这个可变仓索引上插入，形成真实死锁。`FORCE INDEX (idx_order_id)` 保留当前读与原锁序，同时避免范围锁落在改仓的索引插入路径；代价是该范围查询按稳定 order_id 索引回表读取仓库列。未把客户锁提前到范围/重放之前，也不捕获、重试或吞掉死锁。依赖已有086索引，本轮不新增迁移，不据本地 schema 核验声称生产索引已核。

`smoke:fulfillment-credit` 仍经现有 Tests CI 回归入口，顺序执行原字节 `fulfillment-credit-concurrency.smoke.test.js` 和新增 `fulfillment-credit-warehouse-concurrency.smoke.test.js`。新增真实 reserveStock 双连接用相邻普通单各10、额度15，首单一行合法改到第二仓，次单同商品两仓各5；用查询信号控制交错，无偶发 sleep，核第二单准确授信拒绝、当前真实查询 EXPLAIN 为 order-only 索引、首单实际行仓/预占写回、原键重放不重复执行、撤销目标仓范围后同键403。finally正常取消精确自有订单、核有效预占0、停用本轮主档并关闭pool，保留交易事实。新回归在原覆盖索引当前读自然红（ER_LOCK_DEADLOCK）后修绿；专属进程内去掉hint与退回普通SELECT两种来源变异分别真实暴露死锁和旧快照超授信，不把变异结果称产品新故障。

## PDA 退货、盘点与包裹授权顺序（2026-10-06）

退货收货、质检、上架，以及盘点扫码，先按既有业务锁顺序读取当前任务/盘点单，核当前用户仓库范围与非空设备仓，再 begin/replay 原操作回执；合法同键重放仍返回原结果，状态检查保持在回放之后。设备未绑定仓库不能退化为不限仓。退货 PDA 队列也核设备仓属于当前用户范围，并只查询该设备仓。

PDA 新建包裹必须同时满足用户范围和设备仓与任务仓相同。包裹任务列表和条码详情在查询商品与打印详情前核任务仓库范围；无明确归属仓的包裹任务不对限仓用户放行。没有改动数量、状态迁移、预占、资金与凭证政策。回归及设备/实物验证边界见 `docs/security-scope-remediation-2026-10-06.md`。


### 商品仓库预占的只读解释（2026-10-04，R2）

`inventory.reservations.listReservations` 只解释指定商品与仓库，不写库存、缓存、预占或绑定。先核仓库范围，再在同一连接显式开启 REPEATABLE READ 的只读一致性快照；真实角色权限、摘要、可见来源 count/page、精确绑定及采购汇总都在该快照内读取，失败回滚，完成释放连接。复用 `getStockProjection(lock:false)` 与 `getExpectedStock(lock:false)`，不请求业务行锁。

实物在库是未删 ACTIVE 容器的 remaining_qty 合计；查询不按库位过滤，因此页面说明不把 ACTIVE 等同于“全部已上架”。列表在库仍是 inventory_stock.quantity 缓存，已预占仍是该维度 reserved；列表可用仍为 max(0,缓存在库−reserved)。含预计可承诺为 max(0,ACTIVE余量＋totalExpected−reserved)，预计绑定不再重复扣除。预计采购沿状态2/5，扣除未删、未取消收货任务的已上架量。当前可拣参考沿同仓 ACTIVE、正余量且未被任务锁定的容器，不能解释为某张单可直接发货。

有效预占仅 status=1，有效预计绑定仅 released_at IS NULL；缓存/事实、reserved/有效预占、全部绑定/当前预计池绑定三个差额保留两位原值，不截零掩盖异常。expectedStock.items 只含可继续绑定的供给，不能当完整追溯来源；本接口另批量读原始有效绑定，覆盖已占满及异常采购来源。无行身份的预占只能按销售来源单汇总，精确销售行与采购行只取绑定的实际关联。

### R9 重复销售创建的原请求保护（2026-10-04）

来源读取是同连接只读 RR，不复制预占、预计绑定、库存或发货事实。重复开单仍用原 sale.create 载荷指纹动作和既有创建事务；本批未改库存/预占/资金写链，也没有迁移。来源草稿首次保存固定原body/key/account/endpoint，未知/network/5xx不轮换键或允许另一份payload；手动重试只认新鲜not_found、原完整载荷、7天TTL内及当前创建权。重挂仅持查询身份、超期或残缺只核结果/人工处理。正常ACK核安全新单ID，恢复核 sale_order/resourceId===data.id，不能把来源旧单或当前量当创建成功。窄opt-in未执行证据只在首发新事务业务4xx、成功rollback且提交未开始后附加；pending/回放冲突/提交阶段未知不得声明未执行。真实数据库并发、事务回滚与库存后续链仍待总验收。

本人普通 sale.create 成功回执按当前原单完整头/物料仓范围核对，动作/资源不匹配及缺原资源 failclosed；not_found/pending 不据当前库存推断成功。撤创建权后的独立本人核对页只查询原记录，不自动重试或读取来源，新建与库存写权限不扩大。

### 独立报废执行的资源回执（2026-10-04，R10第一段）

报废执行必须原稳定键，action为disposal.dispose.<原单ID>、resourceType为inventory_disposal；读取并锁原头、核当前仓范围后才beginResourceOperationRequest。成功原键在终态拒绝前重放原DTO，回放按同conn当前共享读核真实operation_requests资源metadata与原头，避免早期RR快照漏首笔提交；不据status4或当前金额造成功。初发核完整原明细当前读且全部3，先原头→按商品ID排序的stock维度→原引擎容器扣减。原库存日志、报废台账VALUES?非空批量、CAS、disposed_at和回执同conn一次commit，失败整笔rollback。仅本事务新建请求的业务4xx、尚未开始提交且rollback成功才附disposalNotExecuted；待处理中、回放冲突或提交/回滚未知均不声明未执行。

本人原回执查询只读核实际matchedAction、类型/原ID、完整DTO、原头存在与当前仓范围，不增加查看/执行权。宽请求前缀命中本域仍核领域；not_found/pending不读头或编造成功。写重试仍受当前执行权与范围，查询成功不授权写操作。此处仅离线代码/SQL边界模拟；MySQL真实锁、并发、回滚和查询性能待隔离验收。


### 采购退货/收货的原 PO 协调（2026-10-04，E1）

准确原 PO 是本批协调门：退货创建/关闭采购余量取 PO X；退货确认、取消、WT 实际出库按 PO S→PR X→WT→原维度/容器/账款；收货关闭沿 IT→准确 PO 升序 X→原库存，不改维度→容器规则。出库事务前只定位，事务内 WT 前仅当前头/明细锁读，锁后真实 WTI/PRI 才决定数量和原价。当前所有 WT 的已发/错归属异常会阻断取消；原物理归还未闭合只进入取消处理中，不能释放 PR 预算或宣称任务已终止。完成归还后员工再次确认取消，不自动重发。

真实无准确来源历史保持原入口，含 POI 却无准确 PO、跨 PO/商品来源待人工核对。原 ACTIVE remaining_qty、缓存同步、数量两位、原回执及一次同连接提交保持；没有新增库存账或供应商退款。离线 SQL stub 证明函数调用顺序/错误出口，不能证明数据库锁、死锁消除、实际实物或事务结果。

## 2026-10-05 H1：处理意图不是库存事实

不可变来源Q只表示员工确认的两位基本量处理意图，保存不读取onhand作可履约保证、不扣ACTIVE容器、不写缓存/预占/预计绑定，不产生目标或资金事实。基础预算严格 `Q−Σ(A−R)`；Q10/A6/E2且终结R4留下8，已执行2仍消耗来源。负量、缺量、串商品/仓/单位、E>A、R>A−E或总消耗>Q拒绝，不截0。ACTIVE link的最终E必须为空且R0；TERMINATED须有最终E及R=A−E。H1未接原业务实扣/归还证据，`actualExecutedQuantity=null`，有link仅“待核对”，不能按保存/审批/预占或目标状态说完成。

普通来源UUID与领域全局operation UUID永久保存完整身份/原响应；新建同事务一次提交，重放先核当前范围/启用主档/基本单位，仍返回原响应，不依赖operation_requests七天TTL。H1仅来源基础，不改变原库存引擎或无来源目标路径。277关联/转换/头marker只是未来结构，真实目标创建、解除与签认尚未接；离线SQL stub不证明MySQL并发/回滚/锁等待。

## 2026-10-05 H2：分配基本量与正常目标创建

来源关联只支持同商品、同仓的一条普通目标：意图1→普通销售、2→准确原 PO/POI 采购退货、3→报废。A 取原权威 hydrate/fold 后的基本量，两位数量和当前整数策略保持；客户录入箱数不直接记 A。新关联再核 active 商品/仓、当前基本单位，PR 原采购明细单位须与来源相同，原价及真实剩余可退量仍由原同 conn PO X/POI 校验决定。原无源 PR/报废不新增这些主档规则。来源 X 串行化本域分配，当前 link 预算严格 Q−Σ(A−R)，超额拒绝，不截零。

目标/link/头 marker/永久结果共原一次提交，销售沿原 commitFulfillment 与提交后通知；没有新增预占、容器扣量、预计绑定、发货、退款或会计事实。当前 E 仍未接 H3 原业务事实，保存/审批不能称实物完成。H3 行保护、H4 终结解除及 H5 签认尚待后续批次；本批不做这些行为。离线真实函数模拟和反向守卫不证明数据库并发或设备现场结果。


## 2026-10-05 H3：目标保护不引入来源锁

关联目标原写沿原头 X 后 link 主键 S，禁读/锁 source。特别是 reserve 客户 X 前不增加普通来源 SELECT，避免建立旧 RR 视图；锁序仍由原客户/库存维度/容器链负责。新 reserve/release/dispatch/ship 当前 sole 行必须准确历史 line/SKU/仓/基本单位且 quantity=A，同仓正常操作保留。partial cancel 结案合法缩行/删行保留，原 ACK 先于新实发当前行核对；不能将现行缺行当 E0。

linked ship 固定事务前任务身份，SO→WT 锁后重核同一 SO/task/link；新实发才当前读 SOI/WTI 并重建原库存动作上下文，源 Q 非库存承诺，原 moveStock/应收/回执/提交不增次数。删除门只作非锁保守归还事实检查，不新增 WT 反向锁，也不声称 RR 普通读是当前快照。实际 E 全历史任务/流水核对与终结解除留 H4，未由本批另算或按单头猜成功。

H3新 linked dispatch 在成功回放后、原余量选择前作完整 SOI 当前 S 读与固定身份/精确 A 校验，不能由 eligible 行集代替全明细。没有新增 source 读/锁或库存动作，非法额外行在新 WT/派发累加/commit 前拒绝；NULL marker 原路径不增加查询。

## 2026-10-05 H4：全历史执行证明与永久释放

执行 provider 在 caller conn 独立批读全历史 WT/WTI、库存日志、locked_by_task_id 容器（不限 ACTIVE/未删）与 packages，不新增 WT/WTI/容器/箱锁，也不调用原 pool 详情。日志候选是 typed warehouse_task/refId、typed sale_task/refId 或准确任务单号；不得裸数字跨域或先按正确 SKU/仓/move 过滤脏候选。候选再完整核 move8/type2/warehouse_task id/no/sale_task id/SKU/仓/正合法量，按 logID 去重且 sum=WT7 实发 picked；PR 同样沿 sale_task，准确 PRI→POI→PO。报废核 move13 与准确 disposal 台账。180天 TTL 缺证据待核对，本批未扩 retention。

解除自有下一 RC 事务沿 source X→适用的准确 PO S→目标头 X→link X，普通目标原写仍不反锁 source。原永久 ACK 先于新 revision/预算/现场事实；仅新操作共享 provider 证明终结与全归还，再 absolute R=A−E 与 revision CAS，同连接冻结 version1 完整身份/执行/归还证据和响应后一次提交。link/source/永久结果任一步失败全回滚。TERMINATED 从冻结字段重算，不因当前日志过期释放第二次，不把当前主档停用/删除/单位改变当历史 E0；当前范围和目标身份仍需合法。

原 return-out ready 在成功键回放之后，仅新 purchase_return/sale_return_out 允许2→6，6/7/8 等新键不能复活；终态原键仍返回最初 taskId/status。原普通 ready、实发、库存缓存同步与 picked 保留语义不变。此处只证明离线函数和事务模型，真实 MySQL RC/锁等待/并发、归还扫码和设备现场仍待隔离验收；277 未执行。

H4 规格窄修的 SO4 终结还必须 E>0，不能用当前销售行或取消 WT8 的 picked 代替缺失实扣。legacy 管理验证在本源 X 后只批读整个转换的不可变来源身份/原响应及成功原操作，不对其他来源加 S/X，也不读其预算/当前 revision 作原1比较；未新增 WT/物理锁、库存扣减或 H5 写入。缺完整转换身份在永久解除占位前拒绝，失败保原额度。

H4 质量 PR 窄修把准确采购退货任务的显式 NULL 销售指针、取消头4的 E0 门同时用于 live facts 和冻结 evidence 的 evaluate；冻结 PR3 实发证明不能改成 PR4 后继续当合法 ACK。不会按当前 PRI 推 E、改 picked 或增事实锁，也不改变原 PR3 全量执行/R0 和正常无 WT 强证明。缺字段/串域/已发取消组合保原额度并待核对，真实 MySQL 与现场仍另验。

## 2026-10-05 H5：整单签认的原子意图边界

旧头 X 和全部原行 X 固定快照，当前范围及原 creator 自批门先于永久 UUID 回放；只有显式 allow_self_approve=1可自签，role1不自动豁免。来源批插、准确ID回读、转换及全来源原响应、永久 operation completeConversion 同一个签认自有 conn 一次 commit；任一步失败全 rollback，原头/行/批准/updated_at一字不写。UUID 全域 action/actor/key/full canonical payload/resource严格匹配，不依赖7天通用回执TTL、不据当前头状态猜success。原转换 DTO 每源revision固定1，后续预算/关联变化不改原ACK。

保存前有限父 S 仅准确 actor/warehouse/排序product，满足277真实 FK；不锁 WT/容器/箱、不新建库存账，不用当前 active/master unit 重解释历史基本量。只读 RR 本人核对使用普通同快照 SELECT；POST持旧头X的回放只核当前 head/conversion与不可变来源身份，不锁其他来源。原 dispose 成功 ACK 仍先行，新执行再检查已转换，拒绝进入 dimension/容器/流水。277未执行/未改；本域严格VM证明代码和事务边界，真实MySQL锁等待、隐式FK与并发仍待验收。

### 原采购退货与待收供应商退款门（F1）

原 PR confirm/cancel 在准确 PO S→PR X→PRI/POI 当前锁读后，以首个普通查询核本 PR 的 allocation；所有本域写同样持 PR X 到提交，所以该有限 RR 首读可读共同门内已提交状态。reserved 要求先收到或取消退款，不能先推进 PR/创建 WT/改账款；不加 allocation/peer RF 锁，不与 F1 的 AP→allocation 顺序反向。准确 PO 为 NULL 的原历史链跳过新域查询。

RF 草稿不阻断原 PR；已收历史允许原合法未发 PR 后续动作，原事件提示财务核对，不回退资金/AP、不替代原库存取消/实物归还门。F1 零库存、容器、预占、入账写。永久原结果与当前授权/来源证据同连接核对，不能凭当前 PR/RF 显示状态合成成功。离线锁/事务夹具只是代码证据，未验证真实 MySQL 等锁、隐式 FK 或资金/库存并发。


### 供应商退款 F2：回款原子边界与原 PR 后续

真实 IN、原 AP paid 减少、received allocation、对账/往来/专用事件和永久固定回执在同一个收到 conn 一次 commit；任何资金、余额、AP、allocation、statement、ledger、事件、RF 或 operation 写失败整笔 rollback。自有入口下一事务 RC；借用入口不管理事务，由外层提交后才尝试凭证边界。原 receipt/entry/OUT、stock/container/reservation、处理来源 E/R 不写；不得负付款、旧 REFUND 事件或据最近 ledger 猜金额。

F1 原 PR 门仍拒 reserved；received 后原合法未发 PR 可取消，原退款资金/AP 不撤销，保留财务核对提示。新回款准确 PO S→PR X→本 RF X 序列化原 PR/退款，不锁 peer RF，不 AP 后追锁另一付款账户。本人/内部原成功回放核真正唯一 IN 和固定原身份，不能用当前 RF3 或 UI 状态代替执行证明。离线 rollback/锁模型未证明真实 MySQL 事务、隐式 FK、等锁或实际回款。

### 供应商退款 F3 的事实边界

F3 来源证明与会计收尾不写库存、容器、预占、处理来源 E/R、原付款/receipt/OUT 或原 PR数量。收到后 accounting 批量只读证明用准确旧行价量、全分配、原 OUT/新 IN 和永久收到身份，不通过当前 PR草稿状态或 AP剩余额度重新解释已经发生的钱。新会计事务仅账套 X、原会计表与 RF核对 metadata；结账不增加 PR/RF/WT/物理锁，禁止反锁原执行链。

测试为严格同连接 SQL/事务模型，未执行 MySQL、DDL、仓库业务或真实回款；不能把模型 rollback/锁顺序断言写成真实数据库并发验收。

### F4 供应商退款补录的事务与幂等

仅新 supplier_refund：申请 INSERT/重复键核对在预核公司/用户锁释放后，业务执行锁序 application X→company X→当前 actor/role/scope→PO S→PR X→RF X，批准期关闭/撤写权拒绝在 PO 前。内部准确 locator/完整 RF snapshot 前置核对后借用 F2 同conn，无内层 SET/BEGIN/COMMIT/ROLLBACK/release；收到、AP、资金/往来/专用事件、永久操作和申请 executed 一次提交，任何失败整体回滚。后提交 F3 单笔证明/保存与申请 metadata 不持同一公司/申请反向锁。

完整 UUID/key/action/actor/body64hash/source proof 是永久身份，申请16位指纹为附加项。显式补录原因同原申请一致，普通同原键省略 controls 只能回查原申请，不能绕过 pending 去收到；unknown 本人 GET 只查不 POST。所有本申请 FAT 必须唯一，错误类型/其他 RF 不能由先滤 biz6 隐藏；有效 override与backfillID成对绑定原批准申请。已执行原ACK保持最初 DTO，后续闭期/零分/保存失败不重收资金。库存/容器/预占/处理 E/R 无任何新写，真实数据库锁与事务仍待隔离验证。

F4 共享来源与已执行回放均以全部申请资金集合核唯一，批读不逐申请查，不新增资金/物理锁或 source 写；错误类型或另一 RF 的额外资金保持待核对，禁止靠零分投影或已执行状态放过。专项只读/回放反例继续断言原资金、AP、凭证及期间不被误改。

F4 后提交凭证的种类读取与状态保存失败隔离在业务 commit/release 之后，只呈现 pending；不重收、重写现金/AP、永久 ACK 或执行痕迹，不改变库存或业务事务锁序。自动重试单笔失败不停止整轮，后续旧核销不生成新资金事实。此边界仅源码/有限离线事务模型证明，实际 MySQL 锁/FK/期间仍未验证。

### F5/F6 退款UI不改变库存事实

RF确认仅冻结退款本体/精确付款分配，不出入库；实际receive现金/AP与实物采购退货分别沿原后端事务。前端POST必须先持久完整canonical请求并读回，用原UUID/key/method/path/action/date和准确来源，unknown不得重新发送、换key、改日期或从当前UI猜原body。收到成功最小ACK与当前凭证proof分开，前者先持久confirmed，刷新失败/owner活动变化/清理失败保原confirmed阻断；auth-only本人GET不加载库存、来源或价款。恢复仅说明原结果，不证明真实MySQL事务/资金/会计/实物验收。

### 2026-09-26 容器拆分纳入资源级幂等（任务 4 续）

容器拆分（`POST /api/inventory/containers/:id/split`）是真实库存写——扣减源容器余量、新建塑料盒、写库存流水——但一直是同域里唯一**没有稳定请求键、也没有幂等回执**的写入口（同域的移库/出库早已带上）。PDA 在弱网下连点或自动重试，同一个拆分请求会真的执行两次：源容器被扣两次、凭空多出一个盒子，而现场只看到「拆分成功」。

现按第 11 条的既有形态接入：前端复用 `frontend/src/lib/requestKey.ts` 的稳定键，后端 action 为 **`inventory.container.split.<源容器 id>`**、回执 `resource_type='inventory_container'` / `resource_id=源容器 id`，同键重放原样返回**同一份回执**（同一新盒条码与 ID），不再扣源容器、不再建盒、不再写流水；换新键照常执行（幂等是「同键去重」，不是「拆过一次就锁死」）；**电脑旧客户端不带键时 `enabled:false` 放行；PDA 必须稳定键并有有效绑定仓库**。回归 `tests/container-split-idempotency.smoke.test.js`（§A 首拆 / §B 同键重放 / §C 换键 / §D 无键 / §E 落库形态 / §F 范围撤销后的重放）。

注意该回归里「拆分前后库存总量不变」只守**守恒不变量**，不能当幂等证据：旧行为下它也照样通过（重复拆分只是把同一批货多切了一刀，总量仍守恒）；真正证伪旧行为的是源容器余量、子盒个数、流水条数与回执一致性那四条。

回放**先复核当前仓库范围**（2026-10-07 整合后的完整顺序）：`inventory.split.js` 先普通读探维度并核用户范围 → 锁商品/仓库维度 → `FOR UPDATE` 当前读源容器 → 核维度仍一致、当前用户范围与设备仓 → `beginResourceOperationRequest`。PDA 缺稳定键或非空正整数设备仓在事务前拒绝。先维度、后容器的锁序保持；等锁期间容器换仓不能继续沿用旧 RR 快照。命中成功回放后，`assertSplitReceipt` 用 `inventory_logs FOR SHARE` 当前读核原来源/目标、回执仓与当前用户范围/设备仓，再提交并返回原回执；不再次拆分或打印。本人独立回执 GET 使用普通读核原流水与回执仓，不继承写事务锁，也不依赖后来调拨的容器余量/状态。回执带新盒条码、容器 ID 与仓库，原键只能免去重复副作用，不能免去当前授权。回归 §F：范围内用户首拆 → 范围改为其它仓 → 同键回放 403 `WAREHOUSE_SCOPE_DENIED`，不含原新盒条码且库存/流水不变；离线 `tests/container-split-recovery.test.js` 另核 NULL 设备仓、锁后当前读与原回执恢复。

塑料盒放货/还原同样保留 PDA 身份：controller 透传 `isPda`，PDA 空/非法设备仓先拒绝，不能作为 PC 无设备上下文放行。`plastic-boxes.service.js` 在回放前先核目标盒范围；幂等锁等待后仅回放分支增加 `FOR SHARE` 当前读再核范围/设备仓。还原新请求复用维度锁之后已有的盒 `FOR UPDATE`，在任何库存写之前重新核范围/设备仓与已锁维度一致；变化即拒绝重扫，不追锁另一个维度。PC 原无设备上下文、正确 PDA、已完成原键回放均保留。离线反例与真实 HTTP/MySQL 验收边界见 `docs/security-scope-remediation-2026-10-06.md`。

塑料盒本人独立回执 GET 同样覆盖当前用户范围与 PDA 有效仓。精确/base action 在查询前核 PDA 票据，宽前缀实际命中 `plastic_box.fill/repack` 后补核；查询仍是本人 auth-only，不要求库存执行权限。`plastic-boxes.receipt.js` 只读核实际 action/resource、完整来源/目标 ID 与条码、商品及原双边 `container_split` 流水，还原目标另核新建来源、初始量与回执量；原操作仓由完整原流水确定，不能仅相信 response warehouse。当前用户范围与设备仓按原操作仓授权；之后容器调拨、清空或软删不否定原结果。不加库存锁、不写业务、不补打印；缺原身份或流水返回 409，保留原请求待人工核对。RF/disposal 等其它本人回执契约保持。

来源容器条码的回执身份按**来源 ID + 库中完整条码 + 原拆分流水**核对：PC 可合法拆分既有非数字条码，不能在首次成功后只因来源不匹配新造码格式而拒绝原键回放/本人查询。来源码必须非空且不超过 schema 64 字符；新目标 B 码格式、塑料盒 kind、资源 action、来源/目标分离、商品/原仓及两侧流水仍校验。此兼容只纠正显示码格式的过严假设，不免除身份、用户范围、设备仓或锁后当前读。

### 2026-09-27 在途异常了结后的撤回收货（任务 1 第三条路径）

`forceCloseInTransit`（`transfer.service.js`）把在途容器置 VOID 并清空 `transfer_order_id`，**不加库存、也不写 `inventory_logs`**——scanOut 时已从源仓扣减，货物按实际运输损耗核销。而撤回收货的候选集只查 ACTIVE/待上架/EMPTY 的容器，于是该容器同时脱离候选状态、摘掉在途标记，原有的在途 / 已不在任务仓 / 数量不等 / 任务锁四道守卫全部落空：撤回会把已核销的货当成「从未收货」作废并反冲采购应付，而源仓已扣、调拨单不会回退，账面既没有库存、也没有应付。

守卫改为按**该收货单名下全部未删除容器**（不只是撤回候选集）是否存在 `ref_type='transfer'` 流水判定，即上面的 ③ 号守卫（`inbound-tasks.void.js`）。判据取「流水」而不是「状态是不是 VOID」：普通作废（出库耗尽、人工核销）没有调拨流水，不会被误伤。该查询用 `FOR SHARE` 当前读，避免漏掉本事务快照建立后提交的新流水；候选集之外的容器本事务只共享锁其流水行、不再请求其容器行锁，与写方只构成单向等待，不成环。回归 `tests/inbound-void-transferred-container.smoke.test.js` §E（异常了结后撤回 409、应付/任务/流水均无副作用）/ §F（VOID 但无调拨流水 → 照常放行）。

同路径另修一处**阻塞缺陷**：`forceCloseInTransit` 的容器查询在 `SELECT` 列表里带了 `inventory_containers` 上并不存在的 `product_name` 列，任何调用都 500 `DB_COLUMN_MISMATCH`（scanOut/scanIn 用 `SELECT *`，取到 `undefined` 后靠 `|| ''` 兜成空串，所以一直没暴露）。该列在本函数内并未使用，已从 SELECT 移除。
