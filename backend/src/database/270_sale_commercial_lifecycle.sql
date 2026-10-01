-- C2 commercial snapshots and immutable confirmed money. No second inventory ledger.

SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' AND COLUMN_NAME='commercial_model'), 'SELECT 1', 'ALTER TABLE sale_orders ADD COLUMN commercial_model VARCHAR(20) NULL');

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' AND COLUMN_NAME='commercial_revision'), 'SELECT 1', 'ALTER TABLE sale_orders ADD COLUMN commercial_revision BIGINT UNSIGNED NULL');

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND COLUMN_NAME='commercial_component_id'), 'SELECT 1', 'ALTER TABLE sale_return_items ADD COLUMN commercial_component_id BIGINT UNSIGNED NULL');

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND COLUMN_NAME='dispatch_component_id'), 'SELECT 1', 'ALTER TABLE sale_return_items ADD COLUMN dispatch_component_id BIGINT UNSIGNED NULL');

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS sale_commercial_groups (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 order_id BIGINT UNSIGNED NOT NULL,
 line_key VARCHAR(80) NOT NULL,
 snapshot_revision BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(20) NOT NULL,
 warehouse_id BIGINT UNSIGNED NOT NULL,
 kit_version_id BIGINT UNSIGNED NULL,
 kit_code VARCHAR(50) NULL,
 kit_name VARCHAR(150) NULL,
 original_qty DECIMAL(12,2) NOT NULL,
 target_qty DECIMAL(12,2) NOT NULL,
 unit_price DECIMAL(18,8) NOT NULL,
 price_source VARCHAR(30) NOT NULL,
 gross_amount DECIMAL(14,2) NOT NULL,
 metadata_json JSON NOT NULL,
 superseded TINYINT NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_commercial_components (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 group_id BIGINT UNSIGNED NOT NULL,
 sale_item_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NOT NULL,
 sort_no SMALLINT UNSIGNED NOT NULL,
 base_qty DECIMAL(12,2) NOT NULL,
 required_qty DECIMAL(12,2) NOT NULL,
 reference_price DECIMAL(12,4) NOT NULL,
 amount_weight DECIMAL(20,6) NOT NULL,
 allocated_amount DECIMAL(14,2) NOT NULL,
 product_code VARCHAR(50) NOT NULL,
 product_name VARCHAR(150) NOT NULL,
 unit VARCHAR(20) NOT NULL,
 article_number VARCHAR(100) NULL,
 spec VARCHAR(100) NULL,
 color VARCHAR(100) NULL,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_dispatch_groups (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 order_id BIGINT UNSIGNED NOT NULL,
 task_id BIGINT UNSIGNED NOT NULL,
 group_id BIGINT UNSIGNED NOT NULL,
 quantity DECIMAL(12,2) NOT NULL,
 active TINYINT NOT NULL DEFAULT 1,
 confirmed_gross DECIMAL(14,2) NULL,
 confirmed_at DATETIME NULL,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_dispatch_component_money (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 dispatch_group_id BIGINT UNSIGNED NOT NULL,
 component_id BIGINT UNSIGNED NOT NULL,
 source_qty DECIMAL(12,2) NOT NULL,
 confirmed_amount DECIMAL(14,2) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_commercial_refund_receipts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 order_id BIGINT UNSIGNED NOT NULL,
 dispatch_component_id BIGINT UNSIGNED NOT NULL,
 return_item_id BIGINT UNSIGNED NOT NULL,
 return_task_item_id BIGINT UNSIGNED NOT NULL,
 qualified_qty DECIMAL(12,2) NOT NULL,
 before_qualified_qty DECIMAL(12,2) NOT NULL,
 after_qualified_qty DECIMAL(12,2) NOT NULL,
 refund_amount DECIMAL(14,2) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND INDEX_NAME='uk_sale_commercial_revision');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND INDEX_NAME='uk_sale_commercial_revision');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_groups ADD UNIQUE KEY uk_sale_commercial_revision (order_id,line_key,snapshot_revision)', IF(@cols='order_id,line_key,snapshot_revision' AND @nu=0, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND INDEX_NAME='idx_sale_commercial_active');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND INDEX_NAME='idx_sale_commercial_active');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_groups ADD INDEX idx_sale_commercial_active (order_id,superseded,id)', IF(@cols='order_id,superseded,id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND INDEX_NAME='uk_sale_commercial_product');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND INDEX_NAME='uk_sale_commercial_product');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_components ADD UNIQUE KEY uk_sale_commercial_product (group_id,product_id)', IF(@cols='group_id,product_id' AND @nu=0, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND INDEX_NAME='idx_sale_commercial_physical');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND INDEX_NAME='idx_sale_commercial_physical');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_components ADD INDEX idx_sale_commercial_physical (sale_item_id)', IF(@cols='sale_item_id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND INDEX_NAME='uk_sale_dispatch_group');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND INDEX_NAME='uk_sale_dispatch_group');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_groups ADD UNIQUE KEY uk_sale_dispatch_group (task_id,group_id)', IF(@cols='task_id,group_id' AND @nu=0, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND INDEX_NAME='idx_sale_dispatch_source');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND INDEX_NAME='idx_sale_dispatch_source');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_groups ADD INDEX idx_sale_dispatch_source (group_id,task_id)', IF(@cols='group_id,task_id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND INDEX_NAME='uk_sale_dispatch_component');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND INDEX_NAME='uk_sale_dispatch_component');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_component_money ADD UNIQUE KEY uk_sale_dispatch_component (dispatch_group_id,component_id)', IF(@cols='dispatch_group_id,component_id' AND @nu=0, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND INDEX_NAME='uk_sale_refund_item');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND INDEX_NAME='uk_sale_refund_item');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_refund_receipts ADD UNIQUE KEY uk_sale_refund_item (return_item_id)', IF(@cols='return_item_id' AND @nu=0, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND INDEX_NAME='idx_sale_refund_source');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND INDEX_NAME='idx_sale_refund_source');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_refund_receipts ADD INDEX idx_sale_refund_source (dispatch_component_id,id)', IF(@cols='dispatch_component_id,id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND INDEX_NAME='idx_sale_return_dispatch_source');

SET @nu := (SELECT MAX(NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND INDEX_NAME='idx_sale_return_dispatch_source');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_return_items ADD INDEX idx_sale_return_dispatch_source (dispatch_component_id)', IF(@cols='dispatch_component_id' AND @nu=1, 'SELECT 1', 'SELECT * FROM __sale_commercial_270_index_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_0');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_groups ADD CONSTRAINT fk_sale_commercial_270_0 FOREIGN KEY (order_id) REFERENCES sale_orders (id)', IF(@cols='order_id:sale_orders:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_1');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_groups ADD CONSTRAINT fk_sale_commercial_270_1 FOREIGN KEY (kit_version_id) REFERENCES kit_definition_versions (id)', IF(@cols='kit_version_id:kit_definition_versions:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_2');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_groups ADD CONSTRAINT fk_sale_commercial_270_2 FOREIGN KEY (warehouse_id) REFERENCES inventory_warehouses (id)', IF(@cols='warehouse_id:inventory_warehouses:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_3');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_components ADD CONSTRAINT fk_sale_commercial_270_3 FOREIGN KEY (group_id) REFERENCES sale_commercial_groups (id)', IF(@cols='group_id:sale_commercial_groups:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_4');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_components ADD CONSTRAINT fk_sale_commercial_270_4 FOREIGN KEY (sale_item_id) REFERENCES sale_order_items (id)', IF(@cols='sale_item_id:sale_order_items:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_components' AND CONSTRAINT_NAME='fk_sale_commercial_270_5');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_components ADD CONSTRAINT fk_sale_commercial_270_5 FOREIGN KEY (product_id) REFERENCES product_items (id)', IF(@cols='product_id:product_items:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_6');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_groups ADD CONSTRAINT fk_sale_commercial_270_6 FOREIGN KEY (task_id) REFERENCES warehouse_tasks (id)', IF(@cols='task_id:warehouse_tasks:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_groups' AND CONSTRAINT_NAME='fk_sale_commercial_270_7');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_groups ADD CONSTRAINT fk_sale_commercial_270_7 FOREIGN KEY (group_id) REFERENCES sale_commercial_groups (id)', IF(@cols='group_id:sale_commercial_groups:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND CONSTRAINT_NAME='fk_sale_commercial_270_8');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_component_money ADD CONSTRAINT fk_sale_commercial_270_8 FOREIGN KEY (dispatch_group_id) REFERENCES sale_dispatch_groups (id)', IF(@cols='dispatch_group_id:sale_dispatch_groups:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_dispatch_component_money' AND CONSTRAINT_NAME='fk_sale_commercial_270_9');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_dispatch_component_money ADD CONSTRAINT fk_sale_commercial_270_9 FOREIGN KEY (component_id) REFERENCES sale_commercial_components (id)', IF(@cols='component_id:sale_commercial_components:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_11');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_refund_receipts ADD CONSTRAINT fk_sale_commercial_270_11 FOREIGN KEY (dispatch_component_id) REFERENCES sale_dispatch_component_money (id)', IF(@cols='dispatch_component_id:sale_dispatch_component_money:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_12');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_refund_receipts ADD CONSTRAINT fk_sale_commercial_270_12 FOREIGN KEY (return_item_id) REFERENCES sale_return_items (id)', IF(@cols='return_item_id:sale_return_items:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_commercial_refund_receipts' AND CONSTRAINT_NAME='fk_sale_commercial_270_13');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_commercial_refund_receipts ADD CONSTRAINT fk_sale_commercial_270_13 FOREIGN KEY (return_task_item_id) REFERENCES return_task_items (id)', IF(@cols='return_task_item_id:return_task_items:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND CONSTRAINT_NAME='fk_sale_commercial_270_14');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_return_items ADD CONSTRAINT fk_sale_commercial_270_14 FOREIGN KEY (commercial_component_id) REFERENCES sale_commercial_components (id)', IF(@cols='commercial_component_id:sale_commercial_components:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cols := (SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sale_return_items' AND CONSTRAINT_NAME='fk_sale_commercial_270_15');

SET @sql := IF(@cols IS NULL, 'ALTER TABLE sale_return_items ADD CONSTRAINT fk_sale_commercial_270_15 FOREIGN KEY (dispatch_component_id) REFERENCES sale_dispatch_component_money (id)', IF(@cols='dispatch_component_id:sale_dispatch_component_money:id', 'SELECT 1', 'SELECT * FROM __sale_commercial_270_fk_mismatch__'));

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
