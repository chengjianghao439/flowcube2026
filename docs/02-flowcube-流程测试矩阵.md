# 极序 Flow 业务流程测试矩阵

> 说明：本文档保留历史测试矩阵结构，但在实施测试前，需优先对照当前版本的流程口径、状态命名与收货/打印/条码术语。若与 [系统未来蓝图（现实修订版）](./03-系统未来蓝图（现实修订版）.md) 冲突，以修订版蓝图和当前代码为准。

> 版本：v2.1（含库存预占机制）
> 适用范围：后端接口测试、集成测试、手动回归测试
> 阅读对象：测试工程师、开发工程师、质量负责人

---

## 文档说明

本文档描述 FlowCube ERP 系统的**完整业务流程测试设计**，以场景为单位，覆盖正常路径、边界路径与异常路径。

每个测试场景包含以下字段：

| 字段 | 说明 |
|------|------|
| **场景编号** | 唯一标识，格式 `模块代码-序号` |
| **场景描述** | 一句话概括 |
| **初始数据状态** | 执行操作前数据库各关键字段的值 |
| **操作步骤** | 按顺序描述的 API 调用或用户操作 |
| **预期数据库变化** | 操作后各表字段的预期值 |
| **预期日志变化** | `inventory_logs` / `operation_logs` / `stock_reservations` 预期记录 |
| **是否应抛出错误** | 是 / 否，若是则说明错误信息关键字 |
| **风险说明** | 若未按预期执行，可能造成的数据危害 |

---

## 第一章：销售确认与库存预占

### SC-01 正常确认：单品种可用库存充足

**场景描述**：确认一张含单个商品明细的销售单，可用库存充足。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| inventory_stock | quantity (on_hand) | 100 |
| inventory_stock | reserved | 0 |
| sale_orders | status | 1（草稿） |
| sale_order_items | quantity | 30 |

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/confirm`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock | reserved | 30 |
| inventory_stock | quantity | 100（不变） |
| sale_orders | status | 2（已确认） |
| sale_orders | task_no | 非空（已生成仓库任务编号） |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| stock_reservations | 新增 1 条，status=1，qty=30 |
| warehouse_tasks | 新增 1 条，status=1 |

**是否应抛出错误**：否

**风险说明**：若 reserved 未正确写入，后续重复销售同一批货物将不受限，导致超卖。

---

### SC-02 正常确认：多品种可用库存均充足

**场景描述**：确认包含 3 个商品明细的销售单，每个商品可用库存均充足。

**初始数据状态**

| 商品 | on_hand | reserved | 销售单需求 |
|------|---------|----------|-----------|
| 商品A | 50 | 10 | 20 |
| 商品B | 30 | 0 | 30 |
| 商品C | 100 | 60 | 35 |

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/confirm`

**预期数据库变化**

| 商品 | reserved 预期值 | quantity 预期值 |
|------|----------------|----------------|
| 商品A | 30（10+20） | 50（不变） |
| 商品B | 30（0+30） | 30（不变） |
| 商品C | 95（60+35） | 100（不变） |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| stock_reservations | 新增 3 条，status=1 |

**是否应抛出错误**：否

**风险说明**：多商品预占必须全部成功或全部失败（事务原子性），若部分成功将导致数据不一致。

---

### SC-03 确认失败：可用库存不足（精确边界）

**场景描述**：确认时恰好一个商品的可用库存不足 1 件。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| inventory_stock（商品A） | quantity | 20 |
| inventory_stock（商品A） | reserved | 11 |
| sale_order_items | quantity（商品A） | 10 |

> available = 20 - 11 = 9，需要 10，差 1 件。

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/confirm`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock | reserved | 11（不变，事务回滚） |
| inventory_stock | quantity | 20（不变） |
| sale_orders | status | 1（不变，仍为草稿） |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| stock_reservations | 无新增记录 |
| warehouse_tasks | 无新增记录 |

**是否应抛出错误**：**是**

> 错误信息应包含：`可用库存不足`、商品名称、当前可用数量、所需数量

**风险说明**：若错误未被事务保护，可能出现部分商品已预占、销售单未更新状态的中间态。

---

### SC-04 确认失败：商品在该仓库无库存记录

**场景描述**：仓库中从未存过该商品，inventory_stock 中无对应行。

**初始数据状态**

- `inventory_stock` 中不存在 `product_id=X, warehouse_id=Y` 的记录
- `sale_order_items` 中有 `product_id=X, quantity=1`

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/confirm`

**预期数据库变化**

无任何变化（事务回滚）。

**预期日志变化**

无新增记录。

**是否应抛出错误**：**是**

> 错误信息应包含：`可用库存不足`，当前可用 0，需要 1

**风险说明**：若未拦截，会允许销售一个仓库中根本不存在的商品。

---

### SC-05 确认失败：销售单已不是草稿状态

**场景描述**：对已确认（status=2）的销售单再次调用确认接口。

**初始数据状态**

- `sale_orders.status = 2`

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/confirm`

**预期数据库变化**

无变化。reserved 不会被再次叠加。

**是否应抛出错误**：**是**

> 错误信息应包含：`只有草稿状态可以确认`

**风险说明**：若未拦截，重复确认会导致 reserved 被叠加，可用库存虚减，造成无法出货。

---

## 第二章：任务生成与状态流转

### TK-01 自动生成任务：确认销售单触发任务创建

**场景描述**：销售单确认后，系统自动在同一事务中创建仓库任务。

**初始数据状态**

- `sale_orders.status = 1`
- `warehouse_tasks` 中无该销售单对应的任务

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/confirm`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| warehouse_tasks | status | 1（待分配） |
| warehouse_tasks | task_no | 格式 WT-YYYYMMDD-XXXX |
| warehouse_tasks | sale_order_id | 等于销售单 ID |
| sale_orders | task_no | 与 warehouse_tasks.task_no 一致 |
| sale_orders | task_id | 与 warehouse_tasks.id 一致 |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| warehouse_task_items | 明细条数与销售单明细条数相同 |

**是否应抛出错误**：否

**风险说明**：若任务创建失败而销售单已更新为 status=2，将出现已确认销售单但无任务的孤立状态。

---

### TK-02 任务状态流转：完整正常路径

**场景描述**：验证任务从创建到出库的完整状态流转。

**初始数据状态**

- `warehouse_tasks.status = 1`（待分配）

**操作步骤（顺序执行）**

1. 分配仓库操作员：`POST /api/warehouse-tasks/{id}/assign`
2. 开始备货：`POST /api/warehouse-tasks/{id}/start-picking`
3. 更新拣货数量：`PUT /api/warehouse-tasks/{id}/picked-qty`
4. 标记备货完成，等待出库：`POST /api/warehouse-tasks/{id}/ready-to-ship`
5. 执行出库：`POST /api/warehouse-tasks/{id}/ship`

**预期数据库变化（各步骤后）**

| 步骤 | warehouse_tasks.status | 预期值 |
|------|------------------------|--------|
| assign 后 | 2（备货中） | operator_id 已填写 |
| start-picking 后 | 2（备货中） | - |
| ready-to-ship 后 | 3（待出库） | - |
| ship 后 | 4（已出库） | shipped_at 非空 |
| ship 后 | sale_orders.status | 3（已出库） |

**是否应抛出错误**：否

**风险说明**：若状态跳跃未校验（如直接从 status=1 跳到 ship），可能绕过备货流程，导致实际未备货即完成出库记录。

---

### TK-03 任务状态流转：非法跳跃

**场景描述**：尝试对 status=1 的任务直接执行 ship。

**初始数据状态**

- `warehouse_tasks.status = 1`

**操作步骤**

1. 直接调用 `POST /api/warehouse-tasks/{id}/ship`

**预期数据库变化**

无变化。

**是否应抛出错误**：**是**

> 应拒绝出库，因为任务未处于待出库状态（status=3）

**风险说明**：若未校验，将跳过整个备货环节，出库记录无法反映真实拣货情况。

---

### TK-04 任务取消：取消后预占不释放

**场景描述**：取消一个 status=2 的任务，验证销售单预占保持不变。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| warehouse_tasks | status | 2（备货中） |
| inventory_stock | reserved | 30 |
| stock_reservations（sale_order） | status | 1 |

**操作步骤**

1. 调用 `POST /api/warehouse-tasks/{id}/cancel`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| warehouse_tasks | status | 5（已取消） |
| inventory_stock | reserved | 30（不变，预占仍属于销售单） |
| stock_reservations | status | 1（不变） |
| sale_orders | status | 2（不变） |

**是否应抛出错误**：否

**风险说明**：如果任务取消时误释放预占，而销售单仍是已确认状态，该批货物将对外呈现为"可用"，导致重复销售。

---

## 第三章：任务出库与库存扣减

### SH-01 正常出库：任务出库扣减 on_hand 与 reserved

**场景描述**：仓库任务执行出库，验证 on_hand 和 reserved 同步减少。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| inventory_stock | quantity（on_hand） | 100 |
| inventory_stock | reserved | 30 |
| warehouse_tasks | status | 3（待出库） |
| stock_reservations | status | 1，qty=30 |

**操作步骤**

1. 调用 `POST /api/warehouse-tasks/{id}/ship`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock | quantity | 70（100-30） |
| inventory_stock | reserved | 0（30-30） |
| warehouse_tasks | status | 4（已出库） |
| warehouse_tasks | shipped_at | 非空 |
| sale_orders | status | 3（已出库） |
| stock_reservations | status | 2（已履行） |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| inventory_logs | 新增 1 条，move_type=8（TASK_OUT），before_qty=100，after_qty=70 |
| inventory_logs | ref_type=warehouse_task，ref_id=任务ID |

**是否应抛出错误**：否

**风险说明**：若 reserved 未同步减少，可用库存公式将持续虚减，后续销售单无法正常确认。

---

### SH-02 出库后可用库存验证

**场景描述**：出库完成后，查询库存列表，验证三个数值的一致性。

**初始数据状态**（接 SH-01 执行后）

| quantity | reserved | available（期望） |
|----------|----------|-----------------|
| 70 | 0 | 70 |

**操作步骤**

1. 调用 `GET /api/inventory/stock`

**预期 API 响应**

```
quantity:  70
reserved:  0
available: 70
```

**是否应抛出错误**：否

**风险说明**：若 available 计算逻辑有误，前端展示将误导用户对库存充裕度的判断。

---

### SH-03 出库保护：on_hand 已不足时的安全阻断

**场景描述**：通过其他非预占途径（如盘点）on_hand 被减少至低于 reserved，此时任务出库应被阻断。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| inventory_stock | quantity | 25 |
| inventory_stock | reserved | 30（异常：on_hand < reserved） |
| warehouse_tasks | status | 3 |
| 仓库任务出库数量 | qty | 30 |

**操作步骤**

1. 调用 `POST /api/warehouse-tasks/{id}/ship`

**预期数据库变化**

无变化（事务回滚）。

**是否应抛出错误**：**是**

> 错误信息应包含：`库存不足`，当前 25，需要 30

**风险说明**：此场景反映预占与实际库存发生漂移，是系统可能存在 BUG 的信号，必须阻断并告警。

---

## 第四章：销售取消与预占释放

### CL-01 取消草稿状态销售单：无预占，直接取消

**场景描述**：取消一张 status=1 的草稿销售单，无预占记录，直接更新状态。

**初始数据状态**

- `sale_orders.status = 1`
- `inventory_stock.reserved` 无变化

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/cancel`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| sale_orders | status | 4（已取消） |
| inventory_stock | reserved | 不变 |

**预期日志变化**：无

**是否应抛出错误**：否

---

### CL-02 取消已确认销售单：释放所有预占

**场景描述**：取消 status=2 的销售单，需在事务中释放所有预占。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| inventory_stock（商品A） | quantity | 100 |
| inventory_stock（商品A） | reserved | 30 |
| inventory_stock（商品B） | quantity | 50 |
| inventory_stock（商品B） | reserved | 20 |
| sale_orders | status | 2 |
| stock_reservations（商品A） | qty | 30，status=1 |
| stock_reservations（商品B） | qty | 20，status=1 |

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/cancel`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock（商品A） | reserved | 0（30-30） |
| inventory_stock（商品B） | reserved | 0（20-20） |
| inventory_stock | quantity | 不变 |
| sale_orders | status | 4（已取消） |
| stock_reservations（商品A） | status | 3（已释放） |
| stock_reservations（商品B） | status | 3（已释放） |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| stock_reservations | 2 条记录均更新为 status=3 |

**是否应抛出错误**：否

**风险说明**：若释放逻辑未被事务包裹，可能出现 sale_orders 状态已更新为取消但 reserved 仍未释放，导致该批货物永久被锁定。

---

### CL-03 取消已出库销售单：应被阻断

**场景描述**：尝试取消 status=3（已出库）的销售单。

**初始数据状态**

- `sale_orders.status = 3`

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/cancel`

**预期数据库变化**：无

**是否应抛出错误**：**是**

> 错误信息应包含：`已出库的销售单不能取消`

---

### CL-04 取消销售单时关联任务未出库

**场景描述**：销售单已确认且已生成任务，任务仍在备货中，此时取消销售单。

**初始数据状态**

- `sale_orders.status = 2`
- `warehouse_tasks.status = 2`（备货中）
- 存在 status=1 的 stock_reservations

**操作步骤**

1. 调用 `POST /api/sale/orders/{id}/cancel`

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| sale_orders | status | 4（已取消） |
| inventory_stock | reserved | 减少（预占释放） |
| stock_reservations | status | 3（已释放） |
| warehouse_tasks | status | 2（不由此接口变更，需人工或单独接口处理） |

**是否应抛出错误**：否

**风险说明**：仓库任务变成"孤立任务"——销售单已取消但任务未取消。系统需在界面上提示该任务关联的销售单已取消，防止仓库人员继续备货出库。

---

## 第五章：盘点与预占冲突

### ST-01 盘点调减：调减后 on_hand < reserved（产生漂移）

**场景描述**：盘点发现商品A实际库存少于账面，盘点调减后导致 on_hand < reserved。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| inventory_stock | quantity | 50 |
| inventory_stock | reserved | 40 |
| 盘点单明细 | actual_qty | 30（账面 50，实际 30，差异 -20） |

**操作步骤**

1. 调用 `POST /api/stockcheck/{id}/submit` 提交盘点

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock | quantity | 30（50-20） |
| inventory_stock | reserved | 40（不变，盘点不影响预占） |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| inventory_logs | move_type=3（STOCKCHECK），before=50，after=30 |

**是否应抛出错误**：否（盘点本身允许执行）

> ⚠️ **警告**：执行后 available = 30 - 40 = **-10**（负可用库存），属于数据漂移状态。

**风险说明**：
- 系统当前不阻止此操作，盘点优先反映物理事实。
- 负可用库存状态下，后续销售单确认将被阻断（reserve 校验可用 >= 需求量）。
- **建议**：在盘点提交时增加警告提示：「调减后可用库存将为负，以下销售单预占存在风险」，并列出关联销售单。

---

### ST-02 盘点调增：不影响预占

**场景描述**：盘点发现实际库存多于账面，调增后各字段验证。

**初始数据状态**

| 表 | 字段 | 值 |
|----|------|----|
| inventory_stock | quantity | 50 |
| inventory_stock | reserved | 30 |
| 盘点差异 | diffQty | +20 |

**操作步骤**

1. 提交盘点

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock | quantity | 70（50+20） |
| inventory_stock | reserved | 30（不变） |
| available（计算值） | — | 40（70-30） |

**是否应抛出错误**：否

---

### ST-03 盘点归零：该仓库所有库存归零

**场景描述**：将某仓库某商品实盘为 0，而该商品有 30 件预占。

**初始数据状态**

| inventory_stock.quantity | inventory_stock.reserved |
|--------------------------|--------------------------|
| 30 | 30 |

**操作步骤**

1. 提交盘点，actual_qty = 0，diff = -30

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock | quantity | 0 |
| inventory_stock | reserved | 30（不变） |
| available（计算） | — | -30（严重漂移） |

**是否应抛出错误**：否（系统层面允许盘点至 0）

**风险说明**：此时已有已确认销售单无法履行，需业务人员手动处理（联系客户、重新采购或取消相关销售单）。这是业务现实问题，非系统 BUG。

---

## 第六章：调拨与预占冲突

### TR-01 正常调拨：源仓库存有预占时调拨可用部分

**场景描述**：从仓库 A 调拨商品到仓库 B，调拨数量不超过可用库存。

**初始数据状态**

| 仓库 | quantity | reserved | available |
|------|----------|----------|-----------|
| 仓库A | 100 | 30 | 70 |
| 仓库B | 20 | 0 | 20 |

调拨数量：50（≤ 70，可用充足）

**操作步骤**

1. 创建调拨单，from=仓库A，to=仓库B，qty=50
2. 执行调拨：`POST /api/transfer/{id}/execute`

**预期数据库变化**

| 仓库 | quantity | reserved | available（计算） |
|------|----------|----------|--------------------|
| 仓库A | 50 | 30 | 20 |
| 仓库B | 70 | 0 | 70 |

**预期日志变化**

| 表 | 预期记录 |
|----|---------|
| inventory_logs | TRANSFER_OUT，仓库A，before=100，after=50 |
| inventory_logs | TRANSFER_IN，仓库B，before=20，after=70 |

**是否应抛出错误**：否

**风险说明**：调拨当前**不校验可用库存**，仅校验 on_hand。如果调拨 80（超出可用 70），系统会允许，但调拨后仓库A的 available = -30，已确认销售单将无法出库。

---

### TR-02 调拨超出可用范围：系统允许但产生漂移

**场景描述**：从仓库 A 调拨 80 件，而可用库存仅 70 件（on_hand=100，reserved=30）。

**初始数据状态**

| inventory_stock（仓库A） | quantity | reserved |
|--------------------------|----------|----------|
| | 100 | 30 |

调拨数量：80

**操作步骤**

1. 执行调拨

**预期数据库变化**

| 仓库A | quantity | reserved | available（计算） |
|-------|----------|----------|--------------------|
| | 20 | 30 | -10 |

**是否应抛出错误**：否（当前系统不阻断）

> ⚠️ **已知风险**：调拨引擎当前不校验可用库存（仅校验 on_hand 不为负），调拨超出预占范围将产生负可用库存漂移。

**风险说明**：调拨后，与该仓库相关的已确认销售单将在出库时才被拦截（库存不足报错），造成用户体验损害。**建议后续迭代在调拨执行时增加可用库存校验。**

---

### TR-03 调拨超出 on_hand：应被阻断

**场景描述**：调拨数量超过 on_hand，应由 inventoryEngine 拦截。

**初始数据状态**

- 仓库A：quantity = 100，reserved = 30，调拨数量 = 110

**操作步骤**

1. 执行调拨

**预期数据库变化**：无变化（事务回滚）

**是否应抛出错误**：**是**

> 错误信息应包含：`库存不足`

---

## 第七章：并发场景

### CC-01 两个销售单同时确认：争抢同一批商品

**场景描述**：商品可用库存 50，两张销售单同时确认，各需 40 件，仅一个应成功。

**初始数据状态**

| inventory_stock | quantity | reserved |
|-----------------|----------|----------|
| 商品A | 50 | 0 |

销售单1：需要商品A 40件
销售单2：需要商品A 40件

**操作步骤**

1. 同时发起两个 `POST /api/sale/orders/{id1}/confirm` 和 `POST /api/sale/orders/{id2}/confirm`

**预期结果**

| 结果 | 销售单1 | 销售单2 |
|------|---------|---------|
| 预期（仅1成功） | status=2，reserved+40 | status=1，报错 |

**预期数据库变化**

- inventory_stock.reserved = 40（不是 80）
- inventory_stock.quantity = 50（不变）

**是否应抛出错误**：其中一个请求应返回错误

> 数据库层的 `SELECT ... FOR UPDATE` 行锁保证互斥。

**风险说明**：若 `reserve()` 未使用 `FOR UPDATE` 加锁，两个事务可能同时读到 reserved=0，各自判断 available=50 充足，导致双重预占 80 件，超卖 30 件。

---

### CC-02 销售确认与盘点并发：行锁争用

**场景描述**：销售确认（reserve）和盘点提交（moveStock STOCKCHECK）同时对同一库存行操作。

**并发操作**

| 事务1（销售确认） | 事务2（盘点提交） |
|-----------------|-----------------|
| BEGIN | BEGIN |
| SELECT ... FOR UPDATE（锁定行） | SELECT ... FOR UPDATE（等待锁释放） |
| reserve 预占 30 | （阻塞） |
| COMMIT | 获得锁，读到最新 on_hand，执行盘点 |

**预期结果**

- 两个事务串行执行，不会脏读
- 最终 on_hand 和 reserved 各自正确

**是否应抛出错误**：否（正常串行化执行）

**风险说明**：高并发下行锁会产生等待，需关注锁超时配置（`innodb_lock_wait_timeout`），建议不低于 10 秒。

---

### CC-03 同一销售单被两次确认：幂等保护

**场景描述**：前端重复提交或网络重试导致同一销售单被确认两次。

**初始数据状态**

- `sale_orders.status = 1`

**操作步骤**

1. 发起 `confirm`，正常返回
2. 立即再次发起 `confirm`（第2次请求）

**预期结果**

- 第1次成功，reserved 正确增加，任务生成
- 第2次失败，返回错误（`只有草稿状态可以确认`）
- reserved 不被叠加

**是否应抛出错误**：第2次应返回错误

**风险说明**：若缺少状态前置校验，重复确认会导致同一销售单生成多个仓库任务，reserved 被叠加。

---

### CC-04 销售取消与任务出库并发

**场景描述**：销售单正在被取消（事务进行中），同时仓库任务执行出库。

**并发操作**

| 事务1（取消销售单） | 事务2（任务出库） |
|--------------------|--------------------|
| BEGIN | BEGIN |
| releaseByRef → 锁定 stock_reservations | SELECT warehouse_tasks / sale_orders → 读取销售单 status=2 |
| UPDATE sale_orders status=4（等待行锁） | 锁定 inventory_stock FOR UPDATE |
| （等待） | deduct on_hand, deduct reserved |
| （等待） | UPDATE sale_orders status=3 → **与事务1冲突** |

**预期结果**

- 两个事务其中一个回滚
- 最终状态：要么销售单已取消（预占释放），要么销售单已出库（库存已扣减）

**是否应抛出错误**：回滚的那个事务返回错误，调用方应重试或提示用户

**风险说明**：这是最危险的并发场景，必须确保数据库事务隔离级别不低于 `REPEATABLE READ`（MySQL InnoDB 默认），且所有操作均在事务内执行。

---

## 第八章：极端异常场景

### EX-01 reserved 字段值异常：大于 on_hand

**场景描述**：数据库中某商品的 reserved > quantity（数据漂移状态），此时新销售单尝试确认。

**初始数据状态**

| quantity | reserved | available（计算） |
|----------|----------|-------------------|
| 20 | 30 | -10 |

新销售单需要该商品 1 件。

**操作步骤**

1. 尝试确认销售单

**预期数据库变化**：无

**是否应抛出错误**：**是**

> 报错：`可用库存不足，当前可用 -10，需要 1`

**风险说明**：负可用库存属于系统异常状态，应触发告警通知库管人员。建议增加定期巡检任务检测此类异常。

---

### EX-02 销售单明细为空时确认

**场景描述**：销售单明细条数为 0，调用确认接口。

**初始数据状态**

- `sale_orders.status = 1`
- `sale_order_items` 中该销售单无明细

**操作步骤**

1. 调用 confirm

**预期数据库变化**：无

**是否应抛出错误**：**是**

> 错误信息应包含：`销售单无明细，无法确认`

---

### EX-03 数据库连接中断：事务回滚保护

**场景描述**：在 confirm 事务执行到一半时（reserve 已完成，任务尚未创建）数据库连接中断。

**预期行为**

- 事务自动回滚（MySQL 连接断开时，未提交事务自动回滚）
- reserved 恢复到事务前的值
- sale_orders.status 不变（仍为 1）

**验证方式**

- 查询 inventory_stock.reserved：应等于操作前的值
- 查询 sale_orders.status：应等于 1
- 查询 stock_reservations：应无新增记录

**是否应抛出错误**：调用方收到连接错误，系统内部数据一致

**风险说明**：事务完整性由 MySQL InnoDB 保障，无需额外处理。关键是确保所有步骤在同一个 `conn`（连接对象）中执行，而非混用 `pool.query` 和 `conn.query`。

---

### EX-04 reserved 减至负数的边界保护

**场景描述**：releaseByRef 尝试释放的 qty 超过 reserved 当前值（数据漂移导致）。

**初始数据状态**

- `inventory_stock.reserved = 5`
- `stock_reservations.qty = 30`（数据异常）

**操作步骤**

1. 调用 cancel 触发 releaseByRef

**预期数据库变化**

| 表 | 字段 | 预期值 |
|----|------|----|
| inventory_stock | reserved | 0（GREATEST(0, 5-30) = 0，不变为负） |

**是否应抛出错误**：否（GREATEST 兜底，静默修正为 0）

**风险说明**：GREATEST(0, x) 是最后一道防线，正常流程不应触发。若此保护频繁触发，说明预占逻辑存在 BUG，应记录异常日志供排查。

---

### EX-05 出库后再次出库（任务重复 ship）

**场景描述**：对 status=4（已出库）的任务再次调用 ship 接口。

**初始数据状态**

- `warehouse_tasks.status = 4`

**操作步骤**

1. 再次调用 `POST /api/warehouse-tasks/{id}/ship`

**预期数据库变化**：无

**是否应抛出错误**：**是**

> 应被状态校验拦截，阻止重复出库

**风险说明**：若未拦截，on_hand 将被重复扣减，reserved 被重复减少（可能为负），造成严重库存数据损坏。

---

### EX-06 仓库任务所关联的销售单已被取消后执行出库

**场景描述**：销售单被取消（预占已释放），但关联的仓库任务仍被操作出库。

**初始数据状态**

| sale_orders.status | 4（已取消） |
| warehouse_tasks.status | 3（待出库） |
| inventory_stock.reserved | 0（预占已释放） |

**操作步骤**

1. 调用 `POST /api/warehouse-tasks/{id}/ship`

**当前预期行为**

- inventoryEngine 扣减 on_hand
- reserved 尝试减少（GREATEST 保护，维持在 0）
- 仓库任务标记为已出库
- 销售单已是 status=4，不会被再次修改

**是否应抛出错误**：当前系统不阻断此操作

> ⚠️ **已知缺口**：系统未校验销售单是否已取消即允许任务出库，会产生"货已出库但销售单已取消"的逻辑矛盾。

**建议修复**：在任务 ship 时增加前置校验：若关联销售单 status=4，则禁止出库并返回明确错误。

---

## 附录 A：字段状态速查

### sale_orders.status

| 值 | 含义 |
|----|------|
| 1 | 草稿 |
| 2 | 已确认（存在预占） |
| 3 | 已出库（预占已履行） |
| 4 | 已取消（预占已释放） |

### warehouse_tasks.status

| 值 | 含义 |
|----|------|
| 1 | 待分配 |
| 2 | 备货中 |
| 3 | 待出库 |
| 4 | 已出库 |
| 5 | 已取消 |

### stock_reservations.status

| 值 | 含义 |
|----|------|
| 1 | 预占中（活跃） |
| 2 | 已履行（出库完成） |
| 3 | 已释放（取消/撤回） |

### inventory_logs.move_type

| 值 | 含义 | 影响 reserved |
|----|------|--------------|
| 1 | 采购入库 | 否 |
| 2 | 销售出库 | 是（减少） |
| 3 | 盘点调整 | 否 |
| 4 | 调拨出 | 否 |
| 5 | 调拨入 | 否 |
| 6 | 采购退货出库 | 否 |
| 7 | 销售退货入库 | 否 |
| 8 | 仓库任务出库 | 是（减少） |

---

## 附录 B：测试优先级矩阵

| 场景编号 | 优先级 | 类型 | 是否已知风险点 |
|---------|--------|------|----------------|
| SC-01 | P0 | 正常路径 | 否 |
| SC-03 | P0 | 边界 | 否 |
| SC-05 | P0 | 幂等 | 否 |
| SH-01 | P0 | 正常路径 | 否 |
| CL-02 | P0 | 正常路径 | 否 |
| CC-01 | P0 | 并发 | **是（超卖风险）** |
| CC-04 | P0 | 并发 | **是（状态冲突风险）** |
| EX-03 | P0 | 异常 | 否 |
| TR-02 | P1 | 已知缺口 | **是（漂移风险）** |
| EX-06 | P1 | 已知缺口 | **是（逻辑矛盾）** |
| ST-01 | P1 | 边界 | **是（盘点漂移）** |
| TK-04 | P1 | 边界 | 否 |
| SH-02 | P1 | 数据一致性 | 否 |
| TK-02 | P1 | 正常路径 | 否 |
| CC-02 | P2 | 并发 | 否 |
| CC-03 | P2 | 幂等 | 否 |
| EX-04 | P2 | 防御性 | 否 |
| EX-05 | P2 | 幂等 | 否 |

---

## 附录 C：已知系统缺口（待后续迭代）

| 编号 | 描述 | 对应场景 | 建议优先级 |
|------|------|---------|-----------|
| GAP-01 | 调拨不校验可用库存，允许超出预占部分调拨 | TR-02 | P1 |
| GAP-02 | 销售单取消后，关联仓库任务未自动取消 | CL-04 | P1 |
| GAP-03 | 任务出库未校验关联销售单是否已取消 | EX-06 | P1 |
| GAP-04 | 盘点导致负可用库存时无告警 | ST-01、ST-03 | P2 |
| GAP-05 | 无定期巡检机制检测 on_hand < reserved 的异常状态 | EX-01 | P2 |
