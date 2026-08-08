-- FlowCube ERP - Migration 195
-- P1 审计 4.4：无数据期补索引（修复计划 4.4）
--
-- 4 张热表的缺失索引，全部用 information_schema 幂等护栏（参照 131 迁移模板）：
--   printers.client_id            —— 桌面客户端每 60s 轮询 claim-client，是系统最高频查询之一，
--                                    此前无索引导致每轮全表扫描（客户端数×轮询频率）。
--   inventory_logs               —— 流水查询按 (product_id, warehouse_id, type, created_at) 组合过滤，
--                                    此前仅有 PRIMARY；另补 container_id 支撑「容器流转时间线」回溯。
--   warehouse_tasks              —— 列表按 status/created_at 排序（优先级 + 创建时间），此前无排序索引；
--                                    已有 (warehouse_id,status) 保留不动（它服务「按仓看任务」）。
--   sale_order_items             —— 分仓发货热路径：出库扣减按 (order_id, product_id, warehouse_id) 关联，
--                                    此前仅 idx_order_id 前缀，product_id/warehouse_id 过滤靠回表。

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'printers' AND index_name = 'idx_printers_client_id');
SET @sql := IF(@idx = 0,
  'ALTER TABLE `printers` ADD INDEX `idx_printers_client_id` (`client_id`)',
  'SELECT "printers.idx_printers_client_id exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'inventory_logs' AND index_name = 'idx_inv_logs_dim');
SET @sql := IF(@idx = 0,
  'ALTER TABLE `inventory_logs` ADD INDEX `idx_inv_logs_dim` (`product_id`, `warehouse_id`, `type`, `created_at`)',
  'SELECT "inventory_logs.idx_inv_logs_dim exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'inventory_logs' AND index_name = 'idx_inv_logs_container');
SET @sql := IF(@idx = 0,
  'ALTER TABLE `inventory_logs` ADD INDEX `idx_inv_logs_container` (`container_id`)',
  'SELECT "inventory_logs.idx_inv_logs_container exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'warehouse_tasks' AND index_name = 'idx_wt_status_created');
SET @sql := IF(@idx = 0,
  'ALTER TABLE `warehouse_tasks` ADD INDEX `idx_wt_status_created` (`status`, `created_at`)',
  'SELECT "warehouse_tasks.idx_wt_status_created exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'sale_order_items' AND index_name = 'idx_soi_order_product_wh');
SET @sql := IF(@idx = 0,
  'ALTER TABLE `sale_order_items` ADD INDEX `idx_soi_order_product_wh` (`order_id`, `product_id`, `warehouse_id`)',
  'SELECT "sale_order_items.idx_soi_order_product_wh exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
