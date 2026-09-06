-- Procurement coverage is derived from active source documents, never a second stock ledger.
CREATE TABLE IF NOT EXISTS procurement_planning_lock (
  id TINYINT NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
INSERT IGNORE INTO procurement_planning_lock (id) VALUES (1);

CREATE TABLE IF NOT EXISTS supplier_product_purchase_policies (
  supplier_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  entry_unit VARCHAR(32) NOT NULL,
  pack_multiple DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT 'Packaging multiple in entry unit; zero means unrestricted',
  minimum_order_qty DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT 'MOQ in entry unit',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (supplier_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE procurement_plan_items
  ADD COLUMN supply_snapshot JSON NULL COMMENT 'Generation demand, coverage and packaging explanation; current conversion is revalidated';
