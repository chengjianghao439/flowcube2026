-- 同事务业务差异，不从请求摘要重建历史。旧行保持 NULL。
SET @change_column_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND COLUMN_NAME='payload_version');
SET @change_column_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND COLUMN_NAME='payload_version' AND DATA_TYPE='tinyint' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='' AND COLUMN_TYPE='tinyint unsigned');
SET @change_column_sql := IF(@change_column_exists=0, 'ALTER TABLE document_operation_events ADD COLUMN payload_version TINYINT UNSIGNED DEFAULT NULL', IF(@change_column_shape=1, 'SELECT 1', 'SELECT * FROM __document_change_audit_286_shape_mismatch__'));
PREPARE change_column_stmt FROM @change_column_sql;
EXECUTE change_column_stmt;
DEALLOCATE PREPARE change_column_stmt;

SET @change_column_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND COLUMN_NAME='payload_json');
SET @change_column_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND COLUMN_NAME='payload_json' AND DATA_TYPE='json' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='' );
SET @change_column_sql := IF(@change_column_exists=0, 'ALTER TABLE document_operation_events ADD COLUMN payload_json JSON DEFAULT NULL', IF(@change_column_shape=1, 'SELECT 1', 'SELECT * FROM __document_change_audit_286_shape_mismatch__'));
PREPARE change_column_stmt FROM @change_column_sql;
EXECUTE change_column_stmt;
DEALLOCATE PREPARE change_column_stmt;

SET @change_column_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND COLUMN_NAME='business_event_key');
SET @change_column_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND COLUMN_NAME='business_event_key' AND DATA_TYPE='varchar' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='' AND CHARACTER_MAXIMUM_LENGTH=160);
SET @change_column_sql := IF(@change_column_exists=0, 'ALTER TABLE document_operation_events ADD COLUMN business_event_key VARCHAR(160) DEFAULT NULL', IF(@change_column_shape=1, 'SELECT 1', 'SELECT * FROM __document_change_audit_286_shape_mismatch__'));
PREPARE change_column_stmt FROM @change_column_sql;
EXECUTE change_column_stmt;
DEALLOCATE PREPARE change_column_stmt;

SET @change_index_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND INDEX_NAME='uk_document_business_event');
SET @change_index_shape := (SELECT COUNT(*) FROM (SELECT NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols,COUNT(*) AS column_count,SUM(SUB_PART IS NOT NULL) AS prefix_count,SUM(INDEX_TYPE<>'BTREE' OR IS_VISIBLE<>'YES' OR COLLATION<>'A') AS invalid_count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND INDEX_NAME='uk_document_business_event' GROUP BY NON_UNIQUE) s WHERE NON_UNIQUE=0 AND cols='document_type,document_id,business_event_key' AND column_count=3 AND prefix_count=0 AND invalid_count=0);
SET @change_index_sql := IF(@change_index_exists=0, 'ALTER TABLE document_operation_events ADD UNIQUE KEY uk_document_business_event (document_type,document_id,business_event_key)', IF(@change_index_shape=1, 'SELECT 1', 'SELECT * FROM __document_change_audit_286_index_mismatch__'));
PREPARE change_index_stmt FROM @change_index_sql;
EXECUTE change_index_stmt;
DEALLOCATE PREPARE change_index_stmt;

-- 指纹沿既有 creationFingerprint 的 16 位协议；旧回执仍为未知，不伪造正文。
SET @change_request_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operation_requests' AND COLUMN_NAME='request_fingerprint');
SET @change_request_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operation_requests' AND COLUMN_NAME='request_fingerprint' AND DATA_TYPE='char' AND CHARACTER_MAXIMUM_LENGTH=16 AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @change_request_sql := IF(@change_request_exists=0, 'ALTER TABLE operation_requests ADD COLUMN request_fingerprint CHAR(16) DEFAULT NULL', IF(@change_request_shape=1, 'SELECT 1', 'SELECT * FROM __document_change_audit_286_request_mismatch__'));
PREPARE change_request_stmt FROM @change_request_sql;
EXECUTE change_request_stmt;
DEALLOCATE PREPARE change_request_stmt;


-- 明确受业务审计处理的请求（含回放）保留技术日志，但不再作为旧兼容修改记录投影。NULL 表示旧记录未知。
SET @change_log_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operation_logs' AND COLUMN_NAME='document_change_handled');
SET @change_log_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operation_logs' AND COLUMN_NAME='document_change_handled' AND DATA_TYPE='tinyint' AND COLUMN_TYPE='tinyint unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @change_log_sql := IF(@change_log_exists=0, 'ALTER TABLE operation_logs ADD COLUMN document_change_handled TINYINT UNSIGNED DEFAULT NULL', IF(@change_log_shape=1, 'SELECT 1', 'SELECT * FROM __document_change_audit_286_log_mismatch__'));
PREPARE change_log_stmt FROM @change_log_sql;
EXECUTE change_log_stmt;
DEALLOCATE PREPARE change_log_stmt;
