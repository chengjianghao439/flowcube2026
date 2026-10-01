-- Keep original commercial gross separate from actual four-place AR reduction.
SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND COLUMN_NAME='order_gross_basis'), 'SELECT 1', 'ALTER TABLE sale_dispatch_groups ADD COLUMN order_gross_basis DECIMAL(14,2) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND COLUMN_NAME='discount_basis'), 'SELECT 1', 'ALTER TABLE sale_dispatch_groups ADD COLUMN discount_basis DECIMAL(14,4) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND COLUMN_NAME='financial_amount'), 'SELECT 1', 'ALTER TABLE sale_commercial_refund_receipts ADD COLUMN financial_amount DECIMAL(14,4) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- The feature's HTTP write gate was closed through 272. Previously successful
-- execution receipts used gross as the actual helper reduction; preserve it.
UPDATE sale_commercial_refund_receipts SET financial_amount=refund_amount WHERE financial_amount IS NULL;
UPDATE sale_dispatch_groups d JOIN sale_orders so ON so.id=d.order_id SET d.order_gross_basis=so.total_amount,d.discount_basis=so.discount_amount WHERE d.confirmed_at IS NOT NULL AND d.order_gross_basis IS NULL;
