-- 确保 sys_settings 表存在（如已存在则忽略）
CREATE TABLE IF NOT EXISTS `sys_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key_name` VARCHAR(80) NOT NULL,
  `value` VARCHAR(200) NOT NULL DEFAULT '',
  `label` VARCHAR(100) NOT NULL DEFAULT '',
  `type` VARCHAR(20) NOT NULL DEFAULT 'text',
  `remark` VARCHAR(300) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入编号前缀配置（如已存在则忽略）
INSERT IGNORE INTO `sys_settings` (`key_name`, `value`, `label`, `type`, `remark`) VALUES
('code_prefix_customer', 'CUS-', '客户编号前缀', 'text', '客户编号自动生成前缀，如 CUS- 生成 CUS-0001'),
('code_prefix_supplier', 'SUP-', '供应商编号前缀', 'text', '供应商编号自动生成前缀，如 SUP- 生成 SUP-0001'),
('code_prefix_product',  'PRD-', '商品编号前缀',   'text', '商品编号自动生成前缀，如 PRD- 生成 PRD-0001'),
('code_digits', '4', '编号位数', 'number', '编号数字部分的位数，如 4 则生成 0001'),
('low_stock_threshold', '10', '库存预警阈值', 'number', '库存数量低于此值时发出预警');
