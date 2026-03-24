# FlowCube 性能审计报告

**审计日期**：2025-03-05  
**范围**：backend/、frontend/、database/

---

## 一、数据库分析

### 1.1 N+1 查询

| 位置 | 问题 | 影响 |
|------|------|------|
| **picking-waves.service.findAll** | 列表每页 N 条波次，每条单独 `SELECT ... FROM picking_wave_items WHERE wave_id=?` | 列表 20 条 → 1 + 20 = 21 次查询 |
| **warehouse-tasks.service.getPickSuggestions** | 每个 task item 单独查询容器 | 任务 5 个商品 → 1 + 5 = 6 次查询 |
| **warehouse-tasks.service.getPickRoute** | 同上，每个 item 一次 `SELECT ... FROM inventory_containers` | 同上 |
| **picking-waves.service.getPickRoute** | 每个 wave item 单独查容器 | 波次 10 个商品 → 1 + 10 = 11 次查询 |
| **picking-waves.service.generateAndCacheRoute** | 同上，且写入 picking_wave_routes 时逐行 INSERT | 读 N+1 + 写 O(steps) |

### 1.2 缺失索引

| 表 | 建议索引 | 依据 |
|----|----------|------|
| **sale_order_items** | `KEY idx_order_id (order_id)` | 按订单查明细，当前无索引 |
| **purchase_order_items** | `KEY idx_order_id (order_id)` | 同上 |
| **inventory_check_items** | `KEY idx_check_id (check_id)` | 按盘点单查明细 |
| **inventory_stock** | `UNIQUE KEY uk_product_wh (product_id, warehouse_id)` | ON DUPLICATE KEY UPDATE 依赖，若缺失则每次 INSERT 为新行 |
| **inventory_logs** | `KEY idx_created_at (created_at)` | getRecentTrend 按日期范围 GROUP BY |
| **inventory_logs** | `KEY idx_ref (ref_type, ref_id)` | 单据追溯查询 |
| **inventory_logs** | `KEY idx_product_wh_created (product_id, warehouse_id, created_at)` | 流水按商品+仓库+时间筛选 |
| **warehouse_tasks** | `KEY idx_warehouse_status (warehouse_id, status)` | 列表按仓库+状态筛选 |
| **picking_wave_items** | `KEY idx_wave_id (wave_id)` | 列表 N+1 优化后可批量查 wave_id IN (...) |

### 1.3 全表扫描风险

| 场景 | 说明 |
|------|------|
| **inventory_stock** | 无 (product_id, warehouse_id) 唯一/索引时，syncStockFromContainers 的 SELECT/INSERT 可能低效 |
| **inventory_logs** | getRecentTrend 按 created_at 范围扫描，数据量大时需索引 |
| **dashboard.getSummary** | 5 条独立查询，其中 `COUNT(*) FROM inventory_stock`、`SUM(...)` 全表聚合，数据量>10万时明显变慢 |

### 1.4 JOIN 与分页

- **分页**：列表均使用 `LIMIT ? OFFSET ?`，正确。
- **JOIN**：products.findForFinder、inventory.getStock 等使用 LEFT JOIN，合理。dashboard 多条独立 COUNT/SUM 可合并为单条查询减少往返。

---

## 二、后端分析

### 2.1 重复查询

| 位置 | 问题 |
|------|------|
| **warehouse-tasks.getOp** | 每次 ship 调用 `SELECT ... FROM sys_users WHERE id=?`，可考虑请求级缓存或从 token 获取 |
| **products.findForFinder** | 每次请求都 `SELECT * FROM product_categories` 全表拉取，用于 buildPath、catIds 展开 |
| **inventory.getStockByCategory** | 同样拉取全部分类再 filter，与 findForFinder 逻辑重复 |

### 2.2 大事务

| 位置 | 说明 |
|------|------|
| **warehouse-tasks.ship** | 按 saleOrder.items 逐项 moveStock，每项内部 deductFromContainers + sync + log，商品多时事务时间长 |
| **purchase.service.receive** | 按 order.items 逐项 createContainer + sync，同上 |
| **transfer.service.execute** | 按 items 逐项 transferContainers，每项含双仓 sync |
| **picking-waves.updatePickedQty** | 事务内按 waveTasks 循环查询+更新 warehouse_task_items，任务多时锁持有久 |

### 2.3 O(n²) 或高复杂度

| 位置 | 问题 |
|------|------|
| **inbound-tasks.receive/putaway** | `task.items.find(i => i.id === itemId)` 在循环内，items 不多时影响小 |
| **picking-waves.updatePickedQty** | 双层循环：waveTasks × taskItems，且每个 taskItem 一次 SELECT + UPDATE |
| **categories/products 分类路径** | `catRows.forEach` + `path.split('/').includes` 可优化为 Map 预处理 |
| **containerEngine.transferContainers** | `for (const d of deducted)` 内逐次 createContainer，无法批量 |

### 2.4 可缓存

| 数据 | 特点 | 建议 |
|------|------|------|
| **product_categories 全量** | 变更少，多接口复用 | 服务端内存缓存 5–10 分钟，或 Redis |
| **inventory_warehouses 激活列表** | 变更少，下拉/筛选常用 | 同上 |
| **roles/permissions** | 登录后基本不变 | 已在前端 staleTime 延长，后端可加短期缓存 |
| **dashboard.getSummary** | 仪表盘首屏，可接受稍旧数据 | 60s 缓存，或用 refetchInterval 控制 |

---

## 三、前端分析

### 3.1 React Query 缓存策略

| 当前状态 | 建议 |
|----------|------|
| **main.tsx** 默认 staleTime: 5min | 合理 |
| **useSaleList** 无 staleTime | 使用默认，切换 Tab 会 refetch，可对列表加 staleTime: 30_000 减少请求 |
| **useDashboardSummary** refetchInterval: 60s | 合理 |
| **useLowStock、useTrend、useTopStock** 无 staleTime | 会频繁 refetch，建议 staleTime: 60_000 |
| **useCategories、useWarehousesActive** 已有 10min staleTime | 良好 |
| **warehouse-tasks 列表** | 多数无 staleTime，列表页切换即刷新 |

### 3.2 重复请求

| 场景 | 问题 |
|------|------|
| **多 Tab 同模块** | KeepAlive 下 Tab 不 unmount，同一 queryKey 不会重复请求，但 invalidate 会使多 Tab 同时 refetch |
| **sale 批量 reserve** | `for (const r of can) await reserveMutate.mutateAsync(r.id)` 串行 N 次请求，无批量接口 |
| **ProductFinderModal** | 每次打开若 query 已 stale 会重新请求，可接受 |

### 3.3 不必要 re-render

| 位置 | 问题 |
|------|------|
| **DataTable** | 未用 React.memo，父组件 state 变化（如 confirmState、selectedIds）会全表 re-render |
| **columns 内 render** | `col.render(key, row)` 每次渲染新建函数，若依赖外部变量可能触发子组件重渲染 |
| **sale/index batchReserve** | `setBatchLoading`、`setSelectedIds` 触发整页 re-render |
| **DataTable row** | `data.map` 中每行未拆成 memo 子组件，大数据量时渲染压力大 |

### 3.4 DataTable 渲染性能

| 现状 | 建议 |
|------|------|
| 无虚拟滚动 | 超过 100 行时考虑 react-window 或 @tanstack/react-virtual |
| 全量 map 渲染 | 行组件可用 React.memo + rowKey 稳定 |
| 无列宽拖拽 | 可选，非性能必需 |
| 操作列 sticky | 已做，合理 |

---

## 四、性能瓶颈 Top 10

1. **picking-waves 列表 N+1**：每页 20 条波次，每条额外 1 次 picking_wave_items 查询，共 21 次 DB 往返。
2. **warehouse-tasks getPickSuggestions / getPickRoute N+1**：每个任务商品单独查容器，5 商品 = 6 次查询。
3. **picking-waves getPickRoute / generateAndCacheRoute N+1**：每个波次商品单独查容器，10 商品 = 11 次以上。
4. **dashboard.getSummary 5 条独立全表聚合**：无缓存时每次 5 次全表 COUNT/SUM，数据量大时慢。
5. **products.findForFinder 每次全量拉取 product_categories**：分类树用于路径拼接，每次请求都查，可缓存。
6. **sale_order_items / purchase_order_items 无 order_id 索引**：按订单查明细可能全表扫描。
7. **inventory_logs 缺少 created_at、ref 索引**：流水查询和单据追溯无法高效利用索引。
8. **sale 批量操作串行 N 次 API**：批量占库/取消等无批量接口，串行等待。
9. **DataTable 无虚拟滚动**：500+ 行时 DOM 过多，滚动卡顿。
10. **列表类 useQuery 无 staleTime**：sale、purchase、warehouse-tasks 等切换 Tab 即 refetch，增加无效请求。

---

## 五、推荐索引

```sql
-- 订单明细
ALTER TABLE sale_order_items       ADD INDEX idx_order_id (order_id);
ALTER TABLE purchase_order_items   ADD INDEX idx_order_id (order_id);

-- 盘点明细
ALTER TABLE inventory_check_items  ADD INDEX idx_check_id (check_id);

-- 库存（若尚未存在）
ALTER TABLE inventory_stock
  ADD UNIQUE KEY uk_product_wh (product_id, warehouse_id);

-- 流水
ALTER TABLE inventory_logs
  ADD INDEX idx_created_at (created_at);
ALTER TABLE inventory_logs
  ADD INDEX idx_ref (ref_type, ref_id);
ALTER TABLE inventory_logs
  ADD INDEX idx_product_wh_created (product_id, warehouse_id, created_at);

-- 仓库任务
ALTER TABLE warehouse_tasks
  ADD INDEX idx_warehouse_status (warehouse_id, status);

-- 波次明细（配合 N+1 改造）
ALTER TABLE picking_wave_items
  ADD INDEX idx_wave_id (wave_id);
```

---

## 六、推荐缓存策略

### 6.1 后端缓存（内存或 Redis）

| 键 | 数据 | TTL |
|----|------|-----|
| `cats:all` | product_categories 全量 | 5 min |
| `warehouses:active` | 激活仓库列表 | 10 min |
| `dashboard:summary` | 仪表盘汇总 | 60 s |

### 6.2 前端 React Query

| queryKey | staleTime | 说明 |
|----------|-----------|------|
| `['sale', params]` | 30_000 | 列表 30s 内不 refetch |
| `['purchase', params]` | 30_000 | 同上 |
| `['warehouse-tasks', ...]` | 30_000 | 同上 |
| `['low-stock', threshold]` | 60_000 | 低库存 1min |
| `['trend', days]` | 60_000 | 趋势 1min |
| `['top-stock']` | 60_000 | 同上 |

### 6.3 N+1 改造示例

**picking-waves.findAll** — 批量查 picking_wave_items：

```javascript
// 原：for (const r of rows) { await pool.query('SELECT ... WHERE wave_id=?', [r.id]) }
// 改：
const waveIds = rows.map(r => r.id)
const [allItems] = await pool.query(
  `SELECT wave_id, COUNT(*) AS cnt, SUM(total_qty) AS totalQty, SUM(picked_qty) AS pickedQty
   FROM picking_wave_items WHERE wave_id IN (?)
   GROUP BY wave_id`,
  [waveIds]
)
const itemsMap = Object.fromEntries(allItems.map(i => [i.wave_id, i]))
for (const r of rows) {
  const agg = itemsMap[r.id] || { cnt: 0, totalQty: 0, pickedQty: 0 }
  r.itemCount = Number(agg.cnt)
  r.totalQty = Number(agg.totalQty || 0)
  r.pickedQty = Number(agg.pickedQty || 0)
}
```

---

*报告完毕。*
