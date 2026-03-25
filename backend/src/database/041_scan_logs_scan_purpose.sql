-- 扫描记录用途：1=拣货 2=复核（销售出库强闭环）
ALTER TABLE scan_logs
  ADD COLUMN scan_purpose TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1拣货 2复核' AFTER scan_mode;
