-- Missing provenance is deliberately not inferred from today's edited order head.
SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND COLUMN_NAME='basis_origin'), 'SELECT 1', 'ALTER TABLE sale_dispatch_groups ADD COLUMN basis_origin VARCHAR(30) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @shape := (SELECT CONCAT(COLUMN_TYPE,':',IS_NULLABLE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND COLUMN_NAME='basis_origin');
SET @sql := IF(@shape='varchar(30):YES', 'SELECT 1', 'SELECT * FROM __sale_commercial_275_column_mismatch__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- Previously confirmed records need an explicit review of original execution
-- evidence. No general backfill or guessed historical discount rule is allowed.
SET @unknown := (SELECT COUNT(*) FROM sale_dispatch_groups WHERE confirmed_at IS NOT NULL AND (basis_origin IS NULL OR basis_origin NOT IN ('real_confirmation','legacy_verified')));
SET @sql := IF(@unknown=0, 'SELECT 1', 'SELECT * FROM __sale_commercial_275_basis_requires_review__');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
