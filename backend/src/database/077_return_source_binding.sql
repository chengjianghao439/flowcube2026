SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE purchase_returns ADD COLUMN `purchase_order_id` BIGINT UNSIGNED DEFAULT NULL AFTER `warehouse_name`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_returns'
    AND COLUMN_NAME = 'purchase_order_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE purchase_return_items ADD COLUMN `purchase_item_id` BIGINT UNSIGNED DEFAULT NULL AFTER `return_id`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_return_items'
    AND COLUMN_NAME = 'purchase_item_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE sale_returns ADD COLUMN `sale_order_id` BIGINT UNSIGNED DEFAULT NULL AFTER `warehouse_name`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sale_returns'
    AND COLUMN_NAME = 'sale_order_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE sale_return_items ADD COLUMN `sale_item_id` BIGINT UNSIGNED DEFAULT NULL AFTER `return_id`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sale_return_items'
    AND COLUMN_NAME = 'sale_item_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE purchase_returns ADD KEY `idx_purchase_returns_purchase_order_id` (`purchase_order_id`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_returns'
    AND INDEX_NAME = 'idx_purchase_returns_purchase_order_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE purchase_return_items ADD KEY `idx_purchase_return_items_purchase_item_id` (`purchase_item_id`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_return_items'
    AND INDEX_NAME = 'idx_purchase_return_items_purchase_item_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE sale_returns ADD KEY `idx_sale_returns_sale_order_id` (`sale_order_id`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sale_returns'
    AND INDEX_NAME = 'idx_sale_returns_sale_order_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE sale_return_items ADD KEY `idx_sale_return_items_sale_item_id` (`sale_item_id`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sale_return_items'
    AND INDEX_NAME = 'idx_sale_return_items_sale_item_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE purchase_returns pr
LEFT JOIN purchase_orders po ON po.order_no = pr.purchase_order_no AND po.deleted_at IS NULL
SET pr.purchase_order_id = po.id
WHERE pr.purchase_order_id IS NULL
  AND pr.purchase_order_no IS NOT NULL
  AND pr.purchase_order_no <> '';

UPDATE sale_returns sr
LEFT JOIN sale_orders so ON so.order_no = sr.sale_order_no AND so.deleted_at IS NULL
SET sr.sale_order_id = so.id
WHERE sr.sale_order_id IS NULL
  AND sr.sale_order_no IS NOT NULL
  AND sr.sale_order_no <> '';
