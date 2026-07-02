-- 应付/应收记录：为 (type, order_id) 加唯一索引，让「一张单据一条账」真正靠约束保证，
-- 使结算处的 INSERT ... ON DUPLICATE KEY UPDATE / INSERT IGNORE 生效，杜绝重复应付。
-- MySQL 8.0 幂等：可重复执行。order_id 允许 NULL（多个 NULL 不冲突，兼容无关联单据的记录）。

-- 1) 去重历史冗余：同 (type, order_id) 有多条时，保留最早一条，删除其余「无收付款分录」的冗余行。
--    含分录的重复行不动（交人工核对），若仍存在会在第 2 步 ADD UNIQUE 时报错并暴露出来。
DELETE pr FROM payment_records pr
JOIN (
  SELECT `type`, order_id, MIN(id) AS keep_id
  FROM payment_records
  WHERE order_id IS NOT NULL
  GROUP BY `type`, order_id
  HAVING COUNT(*) > 1
) dup ON dup.`type` = pr.`type` AND dup.order_id = pr.order_id
WHERE pr.id <> dup.keep_id
  AND NOT EXISTS (SELECT 1 FROM payment_entries pe WHERE pe.record_id = pr.id);

-- 2) 幂等添加唯一索引
SET @has_uidx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payment_records'
    AND INDEX_NAME = 'uq_payment_records_type_order'
);
SET @sql := IF(@has_uidx = 0,
  'ALTER TABLE payment_records ADD UNIQUE KEY uq_payment_records_type_order (`type`, order_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
