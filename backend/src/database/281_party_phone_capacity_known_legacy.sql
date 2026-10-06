-- 客户/供应商资料容量对齐的已知旧形状订正；278 已执行，不改其原 20→30 计划。
-- 仅处理本次结构只读核对证实的两列 nullable VARCHAR(11)、NULL 默认值普通列。
-- 沿原列保留 charset/collation/comment；30、更大容量与其他未知漂移不改，不更新历史快照。
SET @party_phone_281_sql = COALESCE((
  SELECT CONCAT(
    'ALTER TABLE `sale_customers` MODIFY COLUMN `phone` VARCHAR(30) CHARACTER SET `',
    CHARACTER_SET_NAME, '` COLLATE `', COLLATION_NAME, '` DEFAULT NULL COMMENT ',
    IF(FIND_IN_SET('NO_BACKSLASH_ESCAPES', @@SESSION.sql_mode) > 0,
      CONCAT(CHAR(39), REPLACE(COLUMN_COMMENT, CHAR(39), CONCAT(CHAR(39), CHAR(39))), CHAR(39)),
      QUOTE(COLUMN_COMMENT))
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_customers'
    AND COLUMN_NAME = 'phone' AND DATA_TYPE = 'varchar'
    AND CHARACTER_MAXIMUM_LENGTH = 11 AND IS_NULLABLE = 'YES'
    AND COLUMN_DEFAULT IS NULL AND EXTRA = '' AND GENERATION_EXPRESSION = ''
    AND CHARACTER_SET_NAME REGEXP '^[A-Za-z_][A-Za-z0-9_]*$'
    AND COLLATION_NAME REGEXP '^[A-Za-z_][A-Za-z0-9_]*$'
), 'SELECT 1');
PREPARE party_phone_281_stmt FROM @party_phone_281_sql;
EXECUTE party_phone_281_stmt;
DEALLOCATE PREPARE party_phone_281_stmt;

SET @party_phone_281_sql = COALESCE((
  SELECT CONCAT(
    'ALTER TABLE `supply_suppliers` MODIFY COLUMN `phone` VARCHAR(30) CHARACTER SET `',
    CHARACTER_SET_NAME, '` COLLATE `', COLLATION_NAME, '` DEFAULT NULL COMMENT ',
    IF(FIND_IN_SET('NO_BACKSLASH_ESCAPES', @@SESSION.sql_mode) > 0,
      CONCAT(CHAR(39), REPLACE(COLUMN_COMMENT, CHAR(39), CONCAT(CHAR(39), CHAR(39))), CHAR(39)),
      QUOTE(COLUMN_COMMENT))
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supply_suppliers'
    AND COLUMN_NAME = 'phone' AND DATA_TYPE = 'varchar'
    AND CHARACTER_MAXIMUM_LENGTH = 11 AND IS_NULLABLE = 'YES'
    AND COLUMN_DEFAULT IS NULL AND EXTRA = '' AND GENERATION_EXPRESSION = ''
    AND CHARACTER_SET_NAME REGEXP '^[A-Za-z_][A-Za-z0-9_]*$'
    AND COLLATION_NAME REGEXP '^[A-Za-z_][A-Za-z0-9_]*$'
), 'SELECT 1');
PREPARE party_phone_281_stmt FROM @party_phone_281_sql;
EXECUTE party_phone_281_stmt;
DEALLOCATE PREPARE party_phone_281_stmt;
