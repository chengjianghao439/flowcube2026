CREATE TABLE IF NOT EXISTS `carriers` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(30)     NOT NULL                  COMMENT '承运商编码',
  `name`       VARCHAR(100)    NOT NULL                  COMMENT '承运商名称',
  `contact`    VARCHAR(50)     DEFAULT NULL              COMMENT '联系人',
  `phone`      VARCHAR(30)     DEFAULT NULL              COMMENT '联系电话',
  `remark`     VARCHAR(500)    DEFAULT NULL              COMMENT '备注',
  `is_active`  TINYINT(1)      NOT NULL DEFAULT 1        COMMENT '1=启用 0=停用',
  `deleted_at` DATETIME        DEFAULT NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_carrier_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='承运商';
