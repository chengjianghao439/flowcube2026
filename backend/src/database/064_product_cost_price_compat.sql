SET @has_cost_price := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product_items'
    AND COLUMN_NAME = 'cost_price'
);

SET @sql := IF(
  @has_cost_price = 0,
  'ALTER TABLE `product_items` ADD COLUMN `cost_price` DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT ''成本价'' AFTER `barcode`',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `product_items`
SET `cost_price` = `sale_price`
WHERE COALESCE(`cost_price`, 0) = 0
  AND COALESCE(`sale_price`, 0) > 0;
