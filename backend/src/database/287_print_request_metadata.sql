-- 打印请求目的、请求人姓名快照与已知克隆来源。旧记录保留 NULL，不按派机/键/历史次数猜目的。
-- source_print_job_id 仅是实际已知来源的引用；不设外键、不改变打印任务保留与清理政策。

SET @print_metadata_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND COLUMN_NAME='request_purpose');
SET @print_metadata_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND COLUMN_NAME='request_purpose' AND DATA_TYPE='varchar' AND COLUMN_TYPE='varchar(16)' AND CHARACTER_MAXIMUM_LENGTH=16 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @print_metadata_sql := IF(@print_metadata_exists=0, 'ALTER TABLE print_jobs ADD COLUMN request_purpose VARCHAR(16) DEFAULT NULL', IF(@print_metadata_shape=1, 'SELECT 1', 'SELECT * FROM __print_request_metadata_287_shape_mismatch__'));
PREPARE print_metadata_stmt FROM @print_metadata_sql;
EXECUTE print_metadata_stmt;
DEALLOCATE PREPARE print_metadata_stmt;

SET @print_metadata_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND COLUMN_NAME='created_by_name');
SET @print_metadata_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND COLUMN_NAME='created_by_name' AND DATA_TYPE='varchar' AND COLUMN_TYPE='varchar(50)' AND CHARACTER_MAXIMUM_LENGTH=50 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @print_metadata_sql := IF(@print_metadata_exists=0, 'ALTER TABLE print_jobs ADD COLUMN created_by_name VARCHAR(50) DEFAULT NULL', IF(@print_metadata_shape=1, 'SELECT 1', 'SELECT * FROM __print_request_metadata_287_shape_mismatch__'));
PREPARE print_metadata_stmt FROM @print_metadata_sql;
EXECUTE print_metadata_stmt;
DEALLOCATE PREPARE print_metadata_stmt;

SET @print_metadata_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND COLUMN_NAME='source_print_job_id');
SET @print_metadata_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND COLUMN_NAME='source_print_job_id' AND DATA_TYPE='bigint' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @print_metadata_sql := IF(@print_metadata_exists=0, 'ALTER TABLE print_jobs ADD COLUMN source_print_job_id BIGINT UNSIGNED DEFAULT NULL', IF(@print_metadata_shape=1, 'SELECT 1', 'SELECT * FROM __print_request_metadata_287_shape_mismatch__'));
PREPARE print_metadata_stmt FROM @print_metadata_sql;
EXECUTE print_metadata_stmt;
DEALLOCATE PREPARE print_metadata_stmt;

SET @print_metadata_index_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND INDEX_NAME='idx_print_jobs_source_print_job');
SET @print_metadata_index_shape := (SELECT COUNT(*) FROM (SELECT NON_UNIQUE,INDEX_TYPE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols,COUNT(*) AS column_count,SUM(SUB_PART IS NOT NULL) AS prefix_count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND INDEX_NAME='idx_print_jobs_source_print_job' GROUP BY NON_UNIQUE,INDEX_TYPE) s WHERE NON_UNIQUE=1 AND INDEX_TYPE='BTREE' AND cols='source_print_job_id' AND column_count=1 AND prefix_count=0);
SET @print_metadata_index_sql := IF(@print_metadata_index_exists=0, 'ALTER TABLE print_jobs ADD KEY idx_print_jobs_source_print_job (source_print_job_id)', IF(@print_metadata_index_shape=1, 'SELECT 1', 'SELECT * FROM __print_request_metadata_287_index_mismatch__'));
PREPARE print_metadata_index_stmt FROM @print_metadata_index_sql;
EXECUTE print_metadata_index_stmt;
DEALLOCATE PREPARE print_metadata_index_stmt;
