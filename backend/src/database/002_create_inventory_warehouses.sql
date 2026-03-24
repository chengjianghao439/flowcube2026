-- FlowCube ERP - Migration 002
-- 仓库档案表

CREATE TABLE IF NOT EXISTS `inventory_warehouses` (
  `id`           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `code`         VARCHAR(30)      NOT NULL COMMENT '仓库编码',
  `name`         VARCHAR(100)     NOT NULL COMMENT '仓库名称',
  `type`         TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '类型 1成品仓 2原料仓 3退货仓 4其他',
  `manager`      VARCHAR(50)      DEFAULT NULL COMMENT '负责人',
  `phone`        VARCHAR(20)      DEFAULT NULL COMMENT '联系电话',
  `address`      VARCHAR(200)     DEFAULT NULL COMMENT '仓库地址',
  `remark`       VARCHAR(500)     DEFAULT NULL COMMENT '备注',
  `is_active`    TINYINT(1)       NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_at`   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME         DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库档案表';
