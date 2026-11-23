-- Batch preview evidence must change even when a correction is withdrawn or moved back in the same second.
SET @sql := IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operation_requests' AND COLUMN_NAME='batch_proof_revision'), 'SELECT 1', 'ALTER TABLE operation_requests ADD COLUMN batch_proof_revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_order_events' AND COLUMN_NAME='batch_proof_revision'), 'SELECT 1', 'ALTER TABLE sale_order_events ADD COLUMN batch_proof_revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_record_events' AND COLUMN_NAME='batch_proof_revision'), 'SELECT 1', 'ALTER TABLE payment_record_events ADD COLUMN batch_proof_revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TRIGGER IF NOT EXISTS trg_operation_requests_batch_proof
BEFORE UPDATE ON operation_requests FOR EACH ROW
SET NEW.batch_proof_revision = OLD.batch_proof_revision + IF(
  NEW.status <> OLD.status
  OR NOT (BINARY NEW.response_json <=> BINARY OLD.response_json)
  OR NOT (NEW.user_id <=> OLD.user_id)
  OR NOT (BINARY NEW.action <=> BINARY OLD.action)
  OR NOT (BINARY NEW.request_key <=> BINARY OLD.request_key)
  OR NOT (BINARY NEW.resource_type <=> BINARY OLD.resource_type)
  OR NOT (NEW.resource_id <=> OLD.resource_id), 1, 0);

CREATE TRIGGER IF NOT EXISTS trg_sale_order_events_batch_proof
BEFORE UPDATE ON sale_order_events FOR EACH ROW
SET NEW.batch_proof_revision = OLD.batch_proof_revision + IF(
  NEW.sale_order_id <> OLD.sale_order_id
  OR NOT (BINARY NEW.event_type <=> BINARY OLD.event_type)
  OR NOT (BINARY NEW.payload_json <=> BINARY OLD.payload_json)
  OR NOT (NEW.created_by <=> OLD.created_by), 1, 0);

CREATE TRIGGER IF NOT EXISTS trg_payment_record_events_batch_proof
BEFORE UPDATE ON payment_record_events FOR EACH ROW
SET NEW.batch_proof_revision = OLD.batch_proof_revision + IF(
  NEW.payment_record_id <> OLD.payment_record_id
  OR NOT (BINARY NEW.order_no <=> BINARY OLD.order_no)
  OR NOT (BINARY NEW.event_type <=> BINARY OLD.event_type)
  OR NOT (BINARY NEW.payload_json <=> BINARY OLD.payload_json)
  OR NOT (NEW.created_by <=> OLD.created_by), 1, 0);
