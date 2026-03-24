-- 029_fix_sale_order_status_sync.sql
-- 修复历史数据：将 sale_orders.status 与 warehouse_tasks.status 同步
--
-- 映射规则：
--   wt.status IN (1,2) → so.status = 2 (备货中/待分配 → 已确认/备货中)
--   wt.status = 3      → so.status = 3 (待出库)
--   wt.status = 4      → so.status = 4 (已出库)
--   wt.status = 5      → so.status = 5 (已取消)
--
-- 只修复存在关联 warehouse_task 且状态不一致的销售订单

UPDATE sale_orders so
JOIN warehouse_tasks wt ON wt.sale_order_id = so.id
  AND wt.deleted_at IS NULL
SET so.status =
  CASE
    WHEN wt.status IN (1, 2) THEN 2
    WHEN wt.status = 3       THEN 3
    WHEN wt.status = 4       THEN 4
    WHEN wt.status = 5       THEN 5
  END
WHERE so.status != CASE
    WHEN wt.status IN (1, 2) THEN 2
    WHEN wt.status = 3       THEN 3
    WHEN wt.status = 4       THEN 4
    WHEN wt.status = 5       THEN 5
  END;
