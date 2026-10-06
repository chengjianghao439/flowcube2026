-- Per-login families retain refresh ancestry and revoke current access without other devices.
-- Old tokens have no familyId and require one new login after this upgrade.
CREATE TABLE IF NOT EXISTS auth_session_families (
  family_id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  revoked_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (family_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @db = DATABASE();
SET @sql = IF(NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='refresh_token_sessions' AND COLUMN_NAME='family_id'
), 'ALTER TABLE refresh_token_sessions ADD COLUMN family_id CHAR(36) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(NOT EXISTS (
  SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='auth_session_families' AND INDEX_NAME='idx_auth_family_user'
), 'ALTER TABLE auth_session_families ADD INDEX idx_auth_family_user (user_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(NOT EXISTS (
  SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='refresh_token_sessions' AND INDEX_NAME='idx_refresh_family'
), 'ALTER TABLE refresh_token_sessions ADD INDEX idx_refresh_family (family_id,user_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
