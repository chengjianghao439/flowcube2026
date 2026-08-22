-- 212_unique_guards_and_cleanup.sql
-- 数据库健康修复（2026-08-22 扫描，执行前已核对本地实际索引）：
--  1. carriers / warehouse_locations 裸唯一键 → active_unique_guard 模式（对照 075 模板）：
--     软删后同编码重建会撞唯一键。product_items / supply_suppliers 已是
--     (code, deleted_at) 复合唯一（NULL 不参与唯一），等效 guard，无需改。
--  2. sale_order_adjustments.adjustment_no 补唯一约束（防并发重复单号）。
--  3. 三张事件时间线表补 created_at 索引（TTL 清理 + 事件列表查询）。
--  4. 打印四表 COLLATE 统一 utf8mb4_unicode_ci（对照 086 的 CONVERT 写法）。

-- 1a. carriers
ALTER TABLE `carriers`
  ADD COLUMN `active_unique_guard` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '唯一键守卫：1=活跃 0=已软删（对照 sys_users 075 模式）' AFTER `deleted_at`;

UPDATE `carriers` SET `active_unique_guard` = 0 WHERE `deleted_at` IS NOT NULL;

ALTER TABLE `carriers`
  DROP INDEX `uk_carrier_code`,
  ADD UNIQUE KEY `uk_carrier_code` (`code`, `active_unique_guard`);

-- 1b. warehouse_locations
ALTER TABLE `warehouse_locations`
  ADD COLUMN `active_unique_guard` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '唯一键守卫：1=活跃 0=已软删（对照 sys_users 075 模式）' AFTER `deleted_at`;

UPDATE `warehouse_locations` SET `active_unique_guard` = 0 WHERE `deleted_at` IS NOT NULL;

ALTER TABLE `warehouse_locations`
  DROP INDEX `uk_location_code`,
  ADD UNIQUE KEY `uk_location_code` (`code`, `active_unique_guard`);

-- 2. sale_order_adjustments.adjustment_no 唯一（同批单据 disposal/refund 等都有 uk）
ALTER TABLE `sale_order_adjustments`
  ADD UNIQUE KEY `uk_sale_order_adjustments_no` (`adjustment_no`);

-- 3. 事件时间线表 created_at 索引（TTL 清理 + 列表查询）
ALTER TABLE `warehouse_task_events`
  ADD KEY `idx_wt_events_created_at` (`created_at`);
ALTER TABLE `sale_order_events`
  ADD KEY `idx_so_events_created_at` (`created_at`);
ALTER TABLE `inbound_task_events`
  ADD KEY `idx_it_events_created_at` (`created_at`);

-- 4. 打印四表 COLLATE 统一（对照 086 的 CONVERT 写法）
ALTER TABLE `printers` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `print_jobs` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `print_clients` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `printer_bindings` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
