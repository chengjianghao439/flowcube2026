# FlowCube 业务逻辑风险报告

> 历史快照说明：本文是 **2025-03-05** 的阶段性风险审计结果。  
> 文中部分“双路径”“状态机缺口”与库存/任务联动问题，后续已有过多轮修复与重构，**不应直接视为当前系统现状**；当前流程口径以 [系统未来蓝图（现实修订版）](./03-系统未来蓝图（现实修订版）.md) 为准。

**审计日期**：2025-03-05  
**范围**：ERP + WMS 核心流程（销售、采购、仓库）

---

## 一、核心流程状态机梳理

### 1.1 销售流程

```
草稿(1) ──占库──► 已占库(2) ──发起出库──► 拣货中(3) ──任务出库──► 已出库(4)
   │                  │                     │
   └──取消──► 已取消(5)  └──取消占库──► 草稿(1)   │
                                                    │
                                              任务取消时 ???
```

**仓库任务状态**：待分配(1) → 备货中(2) → 待出库(3) → 已出库(4) / 已取消(5)

### 1.2 采购流程

```
草稿(1) ──确认──► 已确认(2) ──收货/上架完成──► 已收货(3)
   │                  │
   └──取消──► 已取消(4)  │
                        └──取消时 ???
```

**入库任务状态**：待收货(1) → 收货中(2) → 待上架(3) → 已完成(4) / 已取消(5)

### 1.3 采购双路径

- **路径 A**：`purchase.confirm` → 创建 inbound 任务 → `inbound.receive` → `inbound.putaway` → 上架完成时更新 purchase.status=3
- **路径 B**：`purchase.confirm` → 创建 inbound 任务 → 直接调用 `purchase.receive` → 直接创建容器、更新 purchase.status=3

两路径并存，路径 B 完全绕过 inbound 任务，易产生业务混乱。

---

## 二、状态机完整性

### 2.1 销售状态机缺口

| 缺口 | 说明 |
|------|------|
| **status=3 无法回退** | 销售单进入「拣货中」后，仅能通过仓库任务出库完成，无「撤销出库」「回到已占库」的入口 |
| **任务取消后销售单未同步** | 仓库任务取消时，销售单仍为 status=3、task_id 指向已取消任务，无法再次发起出库 |

### 2.2 采购状态机缺口

| 缺口 | 说明 |
|------|------|
| **status=2 取消不联动** | 采购单 status=2 取消时，未同步取消 inbound 任务，入库任务仍可执行并产生库存 |
| **双路径并存** | purchase.receive 与 inbound putaway 均可创建库存，存在重复或交叉操作风险 |

---

## 三、状态不一致风险

### 3.1 高危：任务取消导致销售单与预占泄漏

**位置**：`warehouse-tasks.service.js` cancel()

**现象**：
1. 任务取消时：`unlockContainersByTask` 释放容器锁
2. 销售单：未更新，仍为 status=3、task_id 指向已取消任务
3. 预占：`releaseByRef` 未调用，`stock_reservations` 仍为 status=1，`inventory_stock.reserved` 未减少

**后果**：
- 预占永久泄漏，可用库存持续偏少
- 销售单卡在「拣货中」，无法再次发起出库
- 需人工改库或修数据才能恢复

**建议**：任务取消时在事务内调用 `releaseByRef('sale_order', saleOrderId)`，并将销售单回退为 status=2，清空 task_id/task_no。

---

### 3.2 高危：采购取消后入库任务仍可完成

**位置**：`purchase.service.js` cancel()、`inbound-tasks.service.js` putaway()

**现象**：
1. 采购单 status=2 时取消，仅更新 `purchase_orders.status=4`
2. 入库任务未被取消，仍可 receive + putaway
3. putaway 完成时：`UPDATE purchase_orders SET status=3 WHERE id=? AND status=2`，因已为 4 不生效，但容器与库存已创建

**后果**：
- 已取消采购单对应入库任务继续产生库存，业务上不合理
- 应付账款可能由 putaway 的 INSERT IGNORE 创建，与采购单状态不一致

**建议**：采购取消时，同步取消其关联的 inbound 任务（status=5）；putaway 完成时校验采购单未取消再更新状态与生成应付。

---

### 3.3 中危：波次取消后任务与销售单未回滚

**位置**：`picking-waves.service.js` cancel()

**现象**：波次取消仅更新 `picking_waves.status=5`，未处理：
- picking_wave_tasks、picking_wave_items
- warehouse_tasks 状态
- 销售单状态与预占

若任务已开始拣货或部分完成，逻辑上应明确「取消后任务回退到何状态」。

---

## 四、库存负数风险

### 4.1 容器路径防护

- `containerEngine.deductFromContainers`：扣减前校验 `totalAvailable < absQty` 则抛错
- `assertNonNegativeQty`：扣减后校验 remaining_qty ≥ 0
- 正常出库、调拨、盘点路径不会产生负数容器

### 4.2 存在负数风险的路径

| 路径 | 说明 |
|------|------|
| **import.routes 库存导入** | 直接 `INSERT/UPDATE inventory_stock`，`+qty \|\| 0` 在 qty 为负时仍会写入负数 |
| **inventory_stock 与容器不同步** | import 直接写 quantity，与 `SUM(containers.remaining_qty)` 不一致，预占与可用量计算会出错 |

---

## 五、容器与汇总库存不同步

### 5.1 设计原则

- `inventory_containers.remaining_qty` 为唯一真实来源
- `inventory_stock.quantity` 仅允许通过 `syncStockFromContainers` 更新

### 5.2 例外与风险

| 路径 | 风险 |
|------|------|
| **import.routes 库存初始化** | 直接写 `inventory_stock.quantity`，未创建容器、未调用 sync，与容器汇总长期不一致 |
| **并发 sync** | 多事务同时 sync 同一 product_id+warehouse_id 时，依赖 FOR UPDATE，设计上可接受 |

---

## 六、任务取消是否释放库存

### 6.1 销售出库任务取消

| 维度 | 当前行为 | 应补充 |
|------|----------|--------|
| 容器锁 | 已释放（unlockContainersByTask） | - |
| 预占 | 未释放 | 需调用 releaseByRef |
| 销售单 | 未回退 | 需回退 status=2 并清空 task_id |

### 6.2 入库任务取消

- 取消条件：仅 status &lt; 3（待上架前）
- 收货中(2) 取消：已更新 received_qty 但未上架，未创建容器，无库存影响
- 设计合理

### 6.3 波次取消

- 仅更新波次本身状态，未释放任务锁、未释放预占
- 若任务处于备货中且已锁定容器，波次取消后应释放这些锁定

---

## 七、PDA 扫描异常与库存

### 7.1 PDA 扫描职责

- `scan-logs.createScanLog`：写扫描记录 + `lockContainer`
- 不更新 `warehouse_task_items.picked_qty`
- 不参与库存扣减

### 7.2 出库扣减逻辑

- `warehouse-tasks.ship` 使用 `saleOrder.items`（销售单明细）扣减
- 扣减引擎 `deductFromContainers` 按 FIFO 选取容器，与 scan_log 无关
- 扫描主要用于：拣货路径、防重复整件扫描、容器锁定（避免其他任务使用）

### 7.3 PDA 异常场景

| 场景 | 库存影响 | 说明 |
|------|----------|------|
| 扫错条码/容器 | 无 | 扣减仍按 FIFO，不依赖扫描结果 |
| 扫错商品（itemId 与容器商品不符） | 无 | 同上，扣减不看 scan_log |
| 重复整件扫描 | 有防护 | 整件模式同一任务+同一容器只允许扫一次 |
| 扫错任务（越权） | 锁定错任务 | 可能锁错容器，但扣减仍按 FIFO，一般不直接导致库存错误；需配合权限与归属校验 |

结论：PDA 扫描异常不会直接导致库存扣减错误，但可能影响拣货准确性与容器锁定归属。

---

## 八、波次拣货是否重复扣库存

### 8.1 扣减时机

- 库存扣减仅在 `warehouse-tasks.ship` 时执行
- 波次流程：创建波次 → 开始拣货 → 更新 picked_qty → 完成拣货 → 完成分拣（回写各任务 picked_qty、任务状态→3）→ 各任务单独 ship

### 8.2 扣减来源

- ship 按 `saleOrder.items` 扣减，每个 sale_order 对应一个 task
- 波次内多个 task 对应多个 sale_order，每个只 ship 一次
- 不存在一次扣减被多次出库的情况

### 8.3 结论

波次拣货不会重复扣库存。每个任务 ship 时扣减其对应销售单的数量，逻辑正确。

---

## 九、其他业务风险

### 9.1 销售单占库后编辑

- 占库后（status=2）无编辑入口，只能取消占库再编辑
- 设计合理，避免占库与明细不一致

### 9.2 采购 confirm 与 receive 的关系

- confirm 创建 inbound 任务，但 purchase.receive 仍可直接创建容器并更新采购单
- 若同时存在「走入库任务」和「直接采购收货」两种操作，可能重复入库或状态错乱
- 建议：明确唯一主路径（推荐入库任务路径），废弃或禁用 purchase.receive 的直接收货逻辑

### 9.3 应付/应收生成时机

- 销售：ship 时 `INSERT IGNORE INTO payment_records` 生成应收
- 采购：purchase.receive 时生成应付；inbound putaway 完成时 also 生成应付（INSERT IGNORE）
- 双路径下可能重复尝试，INSERT IGNORE 可避免重复记录，但业务语义需统一

---

## 十、风险汇总与优先修复

### 10.1 必改（影响数据正确性）

1. **任务取消未释放预占、未回退销售单**：在 warehouse-tasks.cancel 内调用 releaseByRef，并回退销售单 status=2、清空 task_id/task_no
2. **采购取消未取消入库任务**：采购 cancel 时联带取消关联 inbound 任务；putaway 前校验采购单未取消

### 10.2 建议改（提升一致性）

3. **import 库存导入**：改为通过 createContainer + sync，或标记为「初始化专用」并禁止与容器模型混用
4. **采购双路径**：收敛为单一主路径，避免 purchase.receive 与 inbound 并行
5. **波次取消**：明确是否需释放任务锁定容器，若需要则补充 unlock 逻辑

### 10.3 状态机补全建议

- 销售：为 status=3 增加「撤销出库」→ 回退 status=2、取消任务、释放预占，或明确仅允许通过任务取消实现
- 采购：取消时级联取消 inbound 任务，并在后续操作中校验采购单状态

---

*报告完毕。*
