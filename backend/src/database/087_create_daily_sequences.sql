-- 087: 业务单据流水号原子递增表
-- 替代 generateDailyCode 中 COUNT(*) + 1 的竞态方案
-- 在事务内 INSERT ... ON DUPLICATE KEY UPDATE 保证原子性

CREATE TABLE IF NOT EXISTS daily_sequences (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seq_key    VARCHAR(120)    NOT NULL COMMENT '序号键，如 sale_orders:order_no:20260308',
  seq_value  INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '当前序号',
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_seq_key (seq_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务单据日期流水号';
