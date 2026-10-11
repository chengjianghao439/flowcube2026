-- 收货运输记录：寄付=发货方，到付=收货方，第三方付；NULL未记录。
-- 仅记录，不生成费用/应付/付款/库存成本。新增两位金额不修改其他金额列。
SET @inbound_freight_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inbound_tasks' AND COLUMN_NAME='freight_type');
SET @inbound_freight_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inbound_tasks' AND COLUMN_NAME='freight_type' AND DATA_TYPE='tinyint' AND COLUMN_TYPE IN ('tinyint','tinyint(4)') AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @inbound_freight_sql := IF(@inbound_freight_exists=0, 'ALTER TABLE inbound_tasks ADD COLUMN freight_type TINYINT NULL DEFAULT NULL COMMENT ''运输付款方式记录：1寄付 2到付 3第三方付''', IF(@inbound_freight_shape=1, 'SELECT 1', 'SELECT * FROM __inbound_freight_284_column_mismatch__'));
PREPARE inbound_freight_stmt FROM @inbound_freight_sql;
EXECUTE inbound_freight_stmt;
DEALLOCATE PREPARE inbound_freight_stmt;

SET @inbound_freight_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inbound_tasks' AND COLUMN_NAME='freight_amount');
SET @inbound_freight_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inbound_tasks' AND COLUMN_NAME='freight_amount' AND DATA_TYPE='decimal' AND COLUMN_TYPE='decimal(14,2)' AND NUMERIC_PRECISION=14 AND NUMERIC_SCALE=2 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @inbound_freight_sql := IF(@inbound_freight_exists=0, 'ALTER TABLE inbound_tasks ADD COLUMN freight_amount DECIMAL(14,2) NULL DEFAULT NULL COMMENT ''运输金额记录，非负两位，NULL未记录，0明确零金额''', IF(@inbound_freight_shape=1, 'SELECT 1', 'SELECT * FROM __inbound_freight_284_column_mismatch__'));
PREPARE inbound_freight_stmt FROM @inbound_freight_sql;
EXECUTE inbound_freight_stmt;
DEALLOCATE PREPARE inbound_freight_stmt;
