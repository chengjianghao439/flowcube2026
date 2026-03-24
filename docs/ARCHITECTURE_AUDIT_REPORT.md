# FlowCube ERP 架构级代码审计报告

**审计日期**：2025-03-05  
**扫描范围**：backend/、frontend/、database/  
**技术栈**：Node.js + Express + MySQL2 / React + Vite + React Query + Zustand

---

## 1. 系统整体架构评估

### 1.1 模块划分

后端按业务域划分在 `modules/` 下，约 30+ 个模块：auth、sale、purchase、warehouse-tasks、inbound-tasks、picking-waves、inventory、locations、scan-logs、returns、transfer、stockcheck、warehouses、suppliers、customers、carriers、products、categories、payments、reports、dashboard、settings 等。每个模块一般包含 service、routes，部分有 controller。模块划分按业务域清晰，边界可接受。

### 1.2 Service / Controller / Engine 分层

- **Service 层**：承载业务逻辑，调用 Engine 与数据库。
- **Controller 层**：部分模块有（auth、sale、purchase、inventory 等），部分无（warehouse-tasks、returns、transfer 等），routes 直接调用 service，整体不统一。
- **Engine 层**：3 个引擎职责明确：
  - `containerEngine`：容器库存（createContainer、deductFromContainers、syncStockFromContainers、transferContainers、adjustContainersForStockcheck 等）
  - `inventoryEngine`：出库引擎，仅处理 SALE_OUT、TASK_OUT，调用 deductFromContainers + sync
  - `reservationEngine`：库存预占（reserve、releaseByRef、markFulfilled）

Engine 只接收 conn，不开启事务，由 Service 控制事务边界，设计合理。

### 1.3 ERP 与 WMS 边界

| 域 | 模块 | 职责 |
|----|------|------|
| ERP | sale、purchase、returns、transfer、payments、customers、suppliers、carriers、products、categories、price-lists | 订单、主数据、财务 |
| WMS | warehouse-tasks、inbound-tasks、picking-waves、locations、scan-logs | 仓储执行 |
| 共享 | inventory、stockcheck | 库存管理 |

边界基本清晰，但存在**循环依赖**：sale.service ↔ warehouse-tasks.service 双向 require（通过函数内 require 规避加载期循环，但业务耦合明显）。

---

## 2. 后端架构分析

### 2.1 Express 路由结构

路由在 `app.js` 统一注册，按模块前缀挂载（如 /api/sale、/api/warehouse-tasks），结构清晰。无统一的 API 版本前缀，未来版本演进时需注意。

### 2.2 Service 层复杂度

- 事务使用：所有写操作均采用 `pool.getConnection()` + `beginTransaction` + `commit`/`rollback` + `conn.release()` 模式，事务边界明确。
- 涉及事务的模块：purchase、sale、warehouse-tasks、inbound-tasks、picking-waves、scan-logs、inventory、returns、stockcheck、transfer、price-lists（routes 内）。
- 复杂度较高的 Service：picking-waves（波次创建、拣货、完成）、inbound-tasks（收货、上架）、warehouse-tasks（出库链路），单文件 200–400 行，尚可维护。

### 2.3 Engine 设计

- **containerEngine**：设计合理，文档明确 remaining_qty 为唯一真实库存来源，inventory_stock 仅作缓存，必须通过 syncStockFromContainers 更新。FIFO 扣减、assertNonNegativeQty  guards 完整。
- **inventoryEngine**：仅处理 SALE_OUT、TASK_OUT，其他类型明确抛错，防止误用。
- **reservationEngine**：预占逻辑与库存、reserved 字段一致。

### 2.4 事务使用与锁

- 引擎内关键读均使用 `FOR UPDATE`：containerEngine（containers、inventory_stock）、reservationEngine、inventoryEngine。
- 事务粒度：以业务操作为单位（如销售单创建、出库、入库），粒度合理。
- 风险：多商品、多仓库时，锁顺序未统一约定，极端情况下存在死锁可能（见 6.2）。

### 2.5 循环依赖

- `sale.service` 在 ship() 中 require `warehouse-tasks.service`，用于 createForSaleOrder
- `warehouse-tasks.service` 在 ship() 中 require `sale.service`，用于 findById 与销售单状态更新
- 通过函数内 require 规避加载期循环，但业务耦合重，建议引入出库领域服务或事件解耦。

---

## 3. 前端架构分析

### 3.1 React Query 使用

- 业务 hooks（useSale、usePurchase、useProducts 等）封装 useQuery/useMutation，key 设计规范：列表用 params、详情用 id。
- `useInvalidate` 维护 INVALIDATION_MAP，支持 Keep-Alive 多 Tab 下跨模块缓存失效，设计合理。
- 部分页面（warehouse-tasks、payments、permissions、returns、transfer、reports、oplogs 等）在组件内直接使用 useQuery/useMutation，未抽到 hooks，存在重复逻辑。

### 3.2 Zustand

- authStore：token、user、isAuthenticated，persist 到 flowcube-auth
- workspaceStore：tabs、activeKey，persist 到 flowcube-workspace，PATH_TITLES、MAX_TABS=10
- dirtyGuardStore：dirtyTabs、pendingConfirm，不 persist
- 职责划分清晰，未发现过度集中或滥用。

### 3.3 页面组件规模

| 文件 | 行数 |
|------|------|
| sale/form/index.tsx | 974 |
| settings/print-templates/editor.tsx | 724 |
| pda/index.tsx | 708 |
| pda/wave.tsx | 497 |
| categories/index.tsx | 456 |
| purchase/form/index.tsx | 452 |
| picking-waves/index.tsx | 413 |
| warehouse-tasks/index.tsx | 331 |
| inventory/overview/index.tsx | 322 |
| inbound-tasks/index.tsx | 313 |

sale/form 近千行，建议拆分为 CreateView、DetailView、FormFields 等子组件。

### 3.4 Hooks 复用

- useWarehousesActive、useProducts、useCategories、useProductFinder 等被多处复用。
- useInvalidate 在 useSale、usePurchase、useInventory 等业务 hooks 中统一使用。
- 仍有约 10 个页面内联 React Query，建议抽到 hooks。

---

## 4. 数据库结构评估

### 4.1 表设计

- 主键均为自增 id，唯一键按业务需要设置（如 task_no、order_no、barcode）。
- 无 ORM，直接 mysql2 + pool.query 操作。

### 4.2 冗余字段

大量表存在冗余 name 字段：purchase_orders（supplier_name、warehouse_name）、sale_orders（customer_name、warehouse_name）、warehouse_tasks（sale_order_no、customer_name、warehouse_name）、warehouse_task_items（product_code、product_name）、picking_wave_tasks、inbound_tasks、price_list_items 等。冗余便于列表展示，但存在主从数据不一致风险，需要更新时同步维护。

### 4.3 外键

项目未使用数据库级 FOREIGN KEY，依赖业务层保证引用一致性。利于灵活迁移与性能，但无法在数据库层防止孤记录，需依赖代码与测试。

### 4.4 潜在风险

- 迁移 003–006 缺失：product_items、supply_suppliers、product_categories、inventory_stock、inventory_logs 等表可能无正式 CREATE TABLE，新环境可能无法自动建表。
- migrate.js 中有大量 ALTER，与 SQL 迁移混合，逻辑分散，版本与回滚管理难度较大。

---

## 5. ERP + WMS 业务架构评估

### 5.1 销售订单 → 出库任务 → PDA → 出库

- 销售单确认占库（reserveStock）→ reservationEngine.reserve
- 发起出库（ship）→ warehouse-tasks.createForSaleOrder，销售单 status=3（拣货中）
- PDA/波次：scan-logs 记录扫码、lockContainer；picking-waves 管理波次与拣货
- 出库执行：warehouse-tasks.ship() → inventoryEngine.moveStock(TASK_OUT) → deductFromContainers + sync + 更新销售单 + 生成应收账款

流程完整，状态机清晰。

### 5.2 采购订单 → 入库任务 → 上架

- 采购确认 → inbound-tasks.createForPurchaseOrder
- 收货：inbound-tasks.receive() → createContainer + syncStockFromContainers
- 上架：inbound-tasks.putaway() → 更新容器 location_id；完成后直接 UPDATE purchase_orders 和应付，未通过 purchase.service，存在跨模块直接写表。

### 5.3 容器库存模型

- inventory_containers.remaining_qty 为唯一真实库存来源
- inventory_stock.quantity 为缓存，必须通过 syncStockFromContainers 更新
- 任何入库通过 createContainer，出库通过 deductFromContainers（FIFO）
- **例外**：import.routes 直接 `INSERT INTO inventory_stock ... ON DUPLICATE KEY UPDATE quantity=...`，违背「禁止直接写 inventory_stock.quantity」的架构规则，与容器模型不一致。

---

## 6. 系统稳定性评估

### 6.1 并发

- 库存相关操作均在事务内使用 FOR UPDATE 行锁，可避免脏读与幻读。
- 高并发下同一商品+仓库的容器/库存锁会串行化，属预期行为。

### 6.2 数据一致性

- 容器与 inventory_stock 的同步依赖 syncStockFromContainers，规则明确。
- import 直接写 inventory_stock，会导致 quantity 与容器汇总不一致。
- 冗余 name 字段更新可能遗漏，存在主从不一致风险。

### 6.3 死锁

- 多表、多行加锁时未约定统一加锁顺序。
- 例如：同时扣减 A 仓商品 X 和 B 仓商品 Y，若不同事务加锁顺序相反，可能死锁。当前业务多为单订单单仓库，实际概率较低，但高并发多仓场景需注意。

---

## FlowCube 架构评分（0–100）

**综合评分：76**

| 维度 | 得分 | 说明 |
|------|------|------|
| 模块划分与边界 | 18/20 | 业务域清晰，ERP/WMS 边界基本明确，存在 sale↔warehouse-tasks 循环依赖 |
| 后端分层与事务 | 16/20 | Engine 设计好，事务使用规范，部分 Controller 缺失，import 违背容器规则 |
| 前端架构 | 14/18 | React Query + useInvalidate 设计好，大型页面未拆分，部分页面未用 hooks |
| 数据库设计 | 12/18 | 表结构可用，冗余多，无 FK，迁移不完整，import 直接写 stock |
| 业务链路 | 16/24 | 销售/采购/仓库流程完整，inbound 直接写采购表，容器模型有例外 |

---

## Top 10 架构改进建议

1. **修复 import 模块违背容器规则**：移除 import.routes 中直接写 inventory_stock 的逻辑，改为通过 containerEngine.createContainer 或专门的上架流程，保证 quantity 与容器一致。

2. **解耦 sale ↔ warehouse-tasks**：引入出库领域服务（如 OutboundDomainService）或领域事件，由 sale 发布「发起出库」事件，warehouse-tasks 订阅并创建任务，避免双向 require。

3. **拆分 sale/form 大型组件**：将 974 行的 SaleFormPage 拆为 CreateView、DetailView、FormFields、ItemsTable 等子组件，单文件控制在 200 行以内。

4. **统一 Controller 层**：为 warehouse-tasks、returns、transfer 等当前无 Controller 的模块增加 Controller，routes 只做参数校验与调用，保持分层一致。

5. **补全数据库迁移**：补写 003–006 迁移，为 product_items、supply_suppliers、product_categories、inventory_stock、inventory_logs 等表提供完整的 CREATE TABLE，保证新环境可一键建表。

6. **约定加锁顺序降低死锁风险**：在多表/多行加锁场景（如调拨、复杂出库）中，约定「按 warehouse_id 升序、product_id 升序」等统一顺序，降低死锁概率。

7. **将页面内联 React Query 抽到 hooks**：warehouse-tasks、payments、permissions、returns、transfer 等页面中的 useQuery/useMutation 抽到 useWarehouseTasks、usePayments 等 hooks，提升复用与测试性。

8. **inbound-tasks 上架完成后通过 purchase.service 更新**：上架完成时不再直接 UPDATE purchase_orders，改为调用 purchase.service 的 receive/complete 方法，保持模块边界清晰。

9. **建立冗余字段同步机制**：对 supplier_name、customer_name、product_name 等冗余字段，通过触发器或 Service 层统一更新逻辑，避免遗漏导致不一致。

10. **为 API 增加版本前缀**：在 app.js 中为路由增加 /api/v1 等版本前缀，便于后续兼容性演进与灰度发布。

---

*报告完毕。*
