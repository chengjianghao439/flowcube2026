ALTER TABLE warehouse_locations
  ADD COLUMN barcode VARCHAR(32) NULL COMMENT '货架位条码 R+数字' AFTER code;

UPDATE warehouse_locations
SET barcode = CONCAT('R', LPAD(id, 6, '0'))
WHERE (barcode IS NULL OR barcode = '');

ALTER TABLE warehouse_locations
  ADD UNIQUE KEY uk_warehouse_locations_barcode (barcode);
