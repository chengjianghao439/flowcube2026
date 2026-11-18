-- Durable stock import identity and row receipts. Existing import batches are retained unchanged.
CREATE TABLE IF NOT EXISTS inventory_stock_import_runs (
  user_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  body_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  warehouse_ids JSON NOT NULL,
  total_rows INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, request_key),
  UNIQUE KEY uk_stock_import_run_batch (batch_id),
  CONSTRAINT fk_stock_import_run_batch FOREIGN KEY (batch_id) REFERENCES inventory_import_batches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_stock_import_rows (
  batch_id BIGINT UNSIGNED NOT NULL,
  row_index INT UNSIGNED NOT NULL,
  applied TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  PRIMARY KEY (batch_id, row_index),
  CONSTRAINT fk_stock_import_row_batch FOREIGN KEY (batch_id) REFERENCES inventory_stock_import_runs (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
