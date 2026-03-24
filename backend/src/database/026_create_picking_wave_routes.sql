-- 波次拣货路线缓存（支持断点续拣）
CREATE TABLE IF NOT EXISTS picking_wave_routes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wave_id       BIGINT UNSIGNED NOT NULL,
  step          INT UNSIGNED    NOT NULL,
  location_code VARCHAR(50)     DEFAULT NULL,
  container_id  BIGINT UNSIGNED NOT NULL,
  barcode       VARCHAR(30)     NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  product_name  VARCHAR(100)    NOT NULL,
  product_code  VARCHAR(50)     DEFAULT NULL,
  unit          VARCHAR(20)     DEFAULT NULL,
  wave_item_id  BIGINT UNSIGNED NOT NULL,
  qty           DECIMAL(12,4)   NOT NULL DEFAULT 0,
  status        VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT 'pending / completed',
  completed_at  DATETIME        DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_wr_wave (wave_id),
  KEY idx_wr_wave_step (wave_id, step)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
