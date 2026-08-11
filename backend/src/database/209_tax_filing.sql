-- FlowCube ERP - Migration 209
-- 替代报税数据支持（文档10 完整会计准则 · 功能5）。
--
-- 从会计数据（科目发生额/余额）实时投影报税口径数据，产出增值税/所得税申报表要素。
-- 税会差异用手工调整项表：tax_type 1增值税 2所得税；amount 调增为正/调减为负。

CREATE TABLE IF NOT EXISTS `tax_filing_adjustments` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`    BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `period`        CHAR(6)         NOT NULL COMMENT '申报期间 YYYYMM',
  `tax_type`      TINYINT         NOT NULL COMMENT '1增值税 2所得税',
  `adjust_item`   VARCHAR(100)    NOT NULL COMMENT '调整项名称',
  `amount`        DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '调增为正/调减为负',
  `remark`        VARCHAR(300)    DEFAULT NULL,
  `created_by`    BIGINT UNSIGNED DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_taxadj` (`company_id`, `period`, `tax_type`, `adjust_item`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报税口径手工调整(税会差异)';
