-- 打包功能：packages（箱）+ package_items（箱内商品）

CREATE TABLE IF NOT EXISTS `packages` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `barcode`           VARCHAR(20)     NOT NULL COMMENT 'BOXxxxxxx',
  `warehouse_task_id` BIGINT UNSIGNED NOT NULL,
  `status`            TINYINT UNSIGNED NOT NULL DEFAULT 1
                        COMMENT '1=打包中 2=已完成',
  `remark`            VARCHAR(200)    DEFAULT NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_barcode` (`barcode`),
  KEY `idx_task_id`  (`warehouse_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `package_items` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `package_id`   BIGINT UNSIGNED NOT NULL,
  `product_id`   BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(50)  NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `unit`         VARCHAR(20)  NOT NULL,
  `qty`          DECIMAL(12,4) NOT NULL DEFAULT 0,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_package_id` (`package_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
