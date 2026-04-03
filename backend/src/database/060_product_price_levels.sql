ALTER TABLE `product_items`
  ADD COLUMN `sale_price_a` DECIMAL(12,4) NULL DEFAULT NULL AFTER `sale_price`,
  ADD COLUMN `sale_price_b` DECIMAL(12,4) NULL DEFAULT NULL AFTER `sale_price_a`,
  ADD COLUMN `sale_price_c` DECIMAL(12,4) NULL DEFAULT NULL AFTER `sale_price_b`,
  ADD COLUMN `sale_price_d` DECIMAL(12,4) NULL DEFAULT NULL AFTER `sale_price_c`;

ALTER TABLE `sale_customers`
  ADD COLUMN `price_level` CHAR(1) NOT NULL DEFAULT 'A' AFTER `price_list_name`;

INSERT IGNORE INTO `sys_settings` (`key_name`, `value`, `label`, `type`, `remark`) VALUES
('price_rate_a', '10', '价格A加价率', 'number', '商品价格A = 进价 × (1 + 该百分比/100)'),
('price_rate_b', '20', '价格B加价率', 'number', '商品价格B = 进价 × (1 + 该百分比/100)'),
('price_rate_c', '30', '价格C加价率', 'number', '商品价格C = 进价 × (1 + 该百分比/100)'),
('price_rate_d', '40', '价格D加价率', 'number', '商品价格D = 进价 × (1 + 该百分比/100)');

UPDATE `product_items`
SET
  `sale_price_a` = CASE
    WHEN `sale_price_a` IS NOT NULL THEN `sale_price_a`
    WHEN COALESCE(`sale_price`, 0) > 0 THEN `sale_price`
    WHEN COALESCE(`cost_price`, 0) > 0 THEN ROUND(`cost_price` * 1.10, 4)
    ELSE 0
  END,
  `sale_price_b` = CASE
    WHEN `sale_price_b` IS NOT NULL THEN `sale_price_b`
    WHEN COALESCE(`cost_price`, 0) > 0 THEN ROUND(`cost_price` * 1.20, 4)
    ELSE COALESCE(`sale_price`, 0)
  END,
  `sale_price_c` = CASE
    WHEN `sale_price_c` IS NOT NULL THEN `sale_price_c`
    WHEN COALESCE(`cost_price`, 0) > 0 THEN ROUND(`cost_price` * 1.30, 4)
    ELSE COALESCE(`sale_price`, 0)
  END,
  `sale_price_d` = CASE
    WHEN `sale_price_d` IS NOT NULL THEN `sale_price_d`
    WHEN COALESCE(`cost_price`, 0) > 0 THEN ROUND(`cost_price` * 1.40, 4)
    ELSE COALESCE(`sale_price`, 0)
  END,
  `sale_price` = CASE
    WHEN `sale_price_a` IS NOT NULL THEN `sale_price_a`
    WHEN COALESCE(`sale_price`, 0) > 0 THEN `sale_price`
    WHEN COALESCE(`cost_price`, 0) > 0 THEN ROUND(`cost_price` * 1.10, 4)
    ELSE 0
  END;

UPDATE `sale_customers`
SET `price_level` = 'A'
WHERE `price_level` IS NULL OR `price_level` = '';
