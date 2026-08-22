-- 213_product_price_history.sql
-- 价格变更历史（2026-08-22 功能：价格体系落地）。
-- 商品改价写历史表（before/after），配合审批流（approvalEngine bizType=product_price）追溯。

CREATE TABLE IF NOT EXISTS `product_price_history` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`    BIGINT UNSIGNED NOT NULL COMMENT '商品',
  `product_code`  VARCHAR(50)     DEFAULT NULL COMMENT '商品编码快照',
  `product_name`  VARCHAR(200)    DEFAULT NULL COMMENT '商品名称快照',
  `price_type`    VARCHAR(20)     NOT NULL COMMENT '价格类型：sale/cost/a/b/c/d',
  `old_price`     DECIMAL(14,4)   DEFAULT NULL COMMENT '改前价格',
  `new_price`     DECIMAL(14,4)   DEFAULT NULL COMMENT '改后价格',
  `change_source` VARCHAR(30)     NOT NULL DEFAULT 'manual' COMMENT '来源：manual=直接改价 approval=审批通过后生效',
  `approval_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '关联审批实例（approval 来源时）',
  `operator_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人',
  `operator_name` VARCHAR(50)     DEFAULT NULL COMMENT '操作人姓名',
  `remark`        VARCHAR(255)    DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pph_product` (`product_id`, `created_at`),
  KEY `idx_pph_approval` (`approval_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品价格变更历史';
