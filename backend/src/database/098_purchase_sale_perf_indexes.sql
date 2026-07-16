-- FlowCube ERP - Migration 098
-- 采购/收货/销售热路径缺索引补充：
--   inbound_task_items.purchase_order_id 是采购单列表/详情/取消/审核结算的高频关联字段，此前一直无索引；
--   purchase_orders / sale_orders 两张单据头表自 007 建表以来从未加过二级索引，status/供应商/客户/仓库过滤全部全表扫描；
--   warehouse_tasks 补充 (warehouse_id, status) 组合索引，支撑"按仓库看任务"的常见筛选。

ALTER TABLE `inbound_task_items` ADD INDEX `idx_purchase_order_id` (`purchase_order_id`);

ALTER TABLE `purchase_orders`
  ADD INDEX `idx_po_status_created` (`status`, `created_at`),
  ADD INDEX `idx_po_supplier` (`supplier_id`),
  ADD INDEX `idx_po_warehouse` (`warehouse_id`);

ALTER TABLE `sale_orders`
  ADD INDEX `idx_so_status_created` (`status`, `created_at`),
  ADD INDEX `idx_so_customer` (`customer_id`),
  ADD INDEX `idx_so_warehouse` (`warehouse_id`);

ALTER TABLE `warehouse_tasks` ADD INDEX `idx_wt_warehouse_status` (`warehouse_id`, `status`);
