-- FlowCube ERP - Migration 228
-- 采购订单预计量纳入销售占库（ATP）+ 取消/短装「先解绑」拦截（2026-09-02）
--
-- 背景：
--  销售单占库此前只认「已上架实物」（可用 = ACTIVE 容器合计 - reserved），采购单提交后
--  的预计到货占不进来。本迁移引入「在途预计量」参与销售占库判定，并记录
--  「哪张销售单占了哪张采购单的预计量」绑定关系——供采购单取消/短装时定位需先处理的销售单。
--
-- sale_order_expected_bindings：
--  占库时若本次占用量超出「现货」部分，把靠预计量支撑的量按采购单预计到货日期 FIFO 分摊，
--  逐条插绑定；released_at 非空表示已释放（销售单取消/改单释放后置位，用于「未绑定量」统计）。
--
-- 幂等：information_schema 护栏（照 205/218/222 范式）。

SET @has_binding_table := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sale_order_expected_bindings'
);
SET @sql := IF(@has_binding_table = 0,
  'CREATE TABLE `sale_order_expected_bindings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sale_order_id` BIGINT UNSIGNED NOT NULL,
    `sale_order_item_id` BIGINT UNSIGNED NOT NULL,
    `purchase_order_id` BIGINT UNSIGNED NOT NULL,
    `purchase_item_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `warehouse_id` BIGINT UNSIGNED NOT NULL,
    `qty` DECIMAL(16,4) NOT NULL DEFAULT 0,
    `released_at` DATETIME DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_seb_sale` (`sale_order_id`),
    KEY `idx_seb_purchase` (`purchase_order_id`),
    KEY `idx_seb_purchase_item` (`purchase_item_id`),
    KEY `idx_seb_product_wh` (`product_id`, `warehouse_id`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
