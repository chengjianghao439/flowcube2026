-- 216_create_price_change_requests.sql
-- 商品改价申请（2026-08-22 价格体系落地·审批闭环）：
-- 申请改价 → approvalEngine 审批（bizType=product_price）→ 通过后自动更新商品价格并写历史。

CREATE TABLE IF NOT EXISTS `price_change_requests` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_no`     VARCHAR(30)     NOT NULL COMMENT '申请单号（PCR 前缀）',
  `product_id`     BIGINT UNSIGNED NOT NULL COMMENT '商品',
  `product_code`   VARCHAR(50)     DEFAULT NULL COMMENT '商品编码快照',
  `product_name`   VARCHAR(200)    DEFAULT NULL COMMENT '商品名称快照',
  `price_type`     VARCHAR(20)     NOT NULL DEFAULT 'sale' COMMENT '价格类型：sale/cost/a/b/c/d',
  `old_price`      DECIMAL(14,4)   DEFAULT NULL COMMENT '改前价格',
  `new_price`      DECIMAL(14,4)   NOT NULL COMMENT '申请改后价格',
  `reason`         VARCHAR(255)    DEFAULT NULL COMMENT '申请理由',
  `status`         TINYINT         NOT NULL DEFAULT 1 COMMENT '1待审批 2已通过 3已驳回 4已取消',
  `applicant_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '申请人',
  `applicant_name` VARCHAR(50)     DEFAULT NULL COMMENT '申请人姓名',
  `approval_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '审批实例 id',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pcr_product` (`product_id`, `created_at`),
  KEY `idx_pcr_applicant` (`applicant_id`),
  KEY `idx_pcr_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品改价申请';
