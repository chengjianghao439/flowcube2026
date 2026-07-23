-- FlowCube ERP - Migration 123
-- 销售单分仓发货 + 分批发货模型：
--  1. warehouse_id/warehouse_name：明细行级发货仓库（一个商品只从一个仓库发），
--     默认继承订单头 sale_orders.warehouse_id；订单头仓库降级为"默认仓库"。
--  2. shipped_qty：该行已发数量，分批出库时累加；全部行 shipped_qty>=quantity 即整单发完。
-- 存量行一律回填为订单头仓库，保证所有老单都是"单仓订单"，走完全不变的老路径（零回归）。

ALTER TABLE `sale_order_items`
  ADD COLUMN `warehouse_id` BIGINT UNSIGNED NULL COMMENT '行级发货仓库（默认继承订单头）' AFTER `order_id`,
  ADD COLUMN `warehouse_name` VARCHAR(100) NULL AFTER `warehouse_id`,
  ADD COLUMN `shipped_qty` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '已发数量（分批累加）' AFTER `quantity`;

UPDATE `sale_order_items` soi
  JOIN `sale_orders` so ON so.id = soi.order_id
  SET soi.warehouse_id = so.warehouse_id, soi.warehouse_name = so.warehouse_name
  WHERE soi.warehouse_id IS NULL;
