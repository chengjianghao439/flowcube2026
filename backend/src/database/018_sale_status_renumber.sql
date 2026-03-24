-- 销售单状态扩展迁移
-- 新增 status=3（待出库/READY_TO_SHIP），原有编号顺延：
--   旧 3（已出库）→ 新 4
--   旧 4（已取消）→ 新 5
-- 注意：必须先迁移 4→5，再迁移 3→4，否则会产生级联冲突

UPDATE sale_orders SET status = 5 WHERE status = 4;
UPDATE sale_orders SET status = 4 WHERE status = 3;
