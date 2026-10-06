-- 客户/供应商资料容量对齐。只扩展已知旧形状；已扩列重复执行不重建，
-- 更大容量或其他未知漂移保持原状，由 schema 对账另行核对。不更新历史快照。
SET @party_profile_sql = IF(EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_customers'
    AND COLUMN_NAME = 'phone' AND DATA_TYPE = 'varchar'
    AND CHARACTER_MAXIMUM_LENGTH = 20 AND IS_NULLABLE = 'YES'
), 'ALTER TABLE `sale_customers` MODIFY COLUMN `phone` VARCHAR(30) DEFAULT NULL', 'SELECT 1');
PREPARE party_profile_stmt FROM @party_profile_sql;
EXECUTE party_profile_stmt;
DEALLOCATE PREPARE party_profile_stmt;

SET @party_profile_sql = IF(EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supply_suppliers'
    AND COLUMN_NAME = 'phone' AND DATA_TYPE = 'varchar'
    AND CHARACTER_MAXIMUM_LENGTH = 20 AND IS_NULLABLE = 'YES'
), 'ALTER TABLE `supply_suppliers` MODIFY COLUMN `phone` VARCHAR(30) DEFAULT NULL COMMENT ''联系电话''', 'SELECT 1');
PREPARE party_profile_stmt FROM @party_profile_sql;
EXECUTE party_profile_stmt;
DEALLOCATE PREPARE party_profile_stmt;

SET @party_profile_sql = IF(EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_credit_overrides'
    AND COLUMN_NAME = 'customer_name' AND DATA_TYPE = 'varchar'
    AND CHARACTER_MAXIMUM_LENGTH = 80 AND IS_NULLABLE = 'NO'
), 'ALTER TABLE `sale_credit_overrides` MODIFY COLUMN `customer_name` VARCHAR(100) NOT NULL COMMENT ''客户名快照''', 'SELECT 1');
PREPARE party_profile_stmt FROM @party_profile_sql;
EXECUTE party_profile_stmt;
DEALLOCATE PREPARE party_profile_stmt;
