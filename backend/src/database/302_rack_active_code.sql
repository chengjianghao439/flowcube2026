-- 同仓只能有一个活跃货架编码。保留历史软删行。
SET @rack_dup := EXISTS(SELECT 1 FROM warehouse_racks WHERE deleted_at IS NULL GROUP BY warehouse_id, code HAVING COUNT(*) > 1);
SET @stmt := IF(@rack_dup, 'SELECT * FROM __rack_302_duplicate_active_codes__', 'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @guard := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='warehouse_racks' AND column_name='active_unique_guard');
SET @stmt := IF(@guard=0, 'ALTER TABLE warehouse_racks ADD COLUMN active_unique_guard TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED', 'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 已有同名列也必须是预期的生成表达式，避免给普通可写列建唯一索引。
SET @valid := (SELECT COUNT(*)=1 FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='warehouse_racks' AND column_name='active_unique_guard'
    AND data_type='tinyint' AND is_nullable='YES' AND extra LIKE '%STORED GENERATED%'
    AND REGEXP_REPLACE(LOWER(generation_expression),'[[:space:]()`]+','')='casewhendeleted_atisnullthen1elsenullend');
SET @stmt := IF(@valid,'SELECT 1','SELECT * FROM __rack_302_unknown_guard_shape__');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CASE WHEN non_unique=0 AND sub_part IS NULL AND column_name IS NOT NULL THEN column_name ELSE '<unexpected>' END ORDER BY seq_in_index) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='warehouse_racks' AND index_name='uk_rack_code');
SET @stmt := CASE
  WHEN @cols='warehouse_id,code' THEN 'ALTER TABLE warehouse_racks DROP INDEX uk_rack_code, ADD UNIQUE KEY uk_rack_code (warehouse_id,code,active_unique_guard)'
  WHEN @cols='warehouse_id,code,active_unique_guard' THEN 'SELECT 1'
  WHEN @cols IS NULL THEN 'ALTER TABLE warehouse_racks ADD UNIQUE KEY uk_rack_code (warehouse_id,code,active_unique_guard)'
  ELSE 'SELECT * FROM __rack_302_unknown_index_shape__'
END;
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
