-- 曾调拨事实不随 inventory_logs 的180天保留期清除。旧数据只按已知执行证据补齐，不猜历史。
SET @transfer_marker_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_containers' AND COLUMN_NAME='has_transfer_history');
SET @transfer_marker_shape := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_containers' AND COLUMN_NAME='has_transfer_history' AND DATA_TYPE='tinyint' AND COLUMN_TYPE='tinyint' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='0' AND EXTRA='' AND GENERATION_EXPRESSION='');
SET @transfer_marker_sql := IF(@transfer_marker_exists=0, 'ALTER TABLE inventory_containers ADD COLUMN has_transfer_history TINYINT NOT NULL DEFAULT 0 COMMENT ''曾执行调拨，永久事实，不随日志清理''', IF(@transfer_marker_shape=1, 'SELECT 1', 'SELECT * FROM __container_transfer_history_285_shape_mismatch__'));
PREPARE transfer_marker_stmt FROM @transfer_marker_sql;
EXECUTE transfer_marker_stmt;
DEALLOCATE PREPARE transfer_marker_stmt;

UPDATE inventory_containers c
LEFT JOIN (SELECT DISTINCT container_id FROM inventory_logs WHERE ref_type='transfer' AND container_id IS NOT NULL) l ON l.container_id=c.id
LEFT JOIN (SELECT DISTINCT CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.containerId')) AS UNSIGNED) AS container_id
           FROM transfer_order_events WHERE event_type IN ('TRANSFER_SCAN_OUT','TRANSFER_SCAN_IN')
           AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.containerId')) REGEXP '^[1-9][0-9]*$') e ON e.container_id=c.id
SET c.has_transfer_history=1
WHERE c.has_transfer_history=0 AND (c.transfer_order_id IS NOT NULL OR l.container_id IS NOT NULL OR e.container_id IS NOT NULL);
