SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sys_users'
    AND COLUMN_NAME = 'token_version'
);
SET @ddl_sql := IF(
  @column_exists = 0,
  'ALTER TABLE `sys_users` ADD COLUMN `token_version` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''会话版本，密码变更后递增以使旧 JWT 失效''',
  'SELECT 1'
);
PREPARE stmt FROM @ddl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
