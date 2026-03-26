-- 货架唯一条码 RCK + 6 位数字（与 id 对齐，存量回填）
ALTER TABLE warehouse_racks
  ADD COLUMN barcode VARCHAR(32) NULL COMMENT '货架条码 RCKxxxxxx' AFTER code;

UPDATE warehouse_racks
SET barcode = CONCAT('RCK', LPAD(id, 6, '0'))
WHERE deleted_at IS NULL AND (barcode IS NULL OR barcode = '');

ALTER TABLE warehouse_racks
  ADD UNIQUE KEY uk_rack_barcode (barcode);
