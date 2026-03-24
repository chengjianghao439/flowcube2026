-- 波次拣货系统
CREATE TABLE IF NOT EXISTS picking_waves (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wave_no       VARCHAR(30)     NOT NULL,
  warehouse_id  BIGINT UNSIGNED NOT NULL,
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1待拣货 2拣货中 3待分拣 4已完成 5已取消',
  task_count    INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '包含任务数',
  operator_id   BIGINT UNSIGNED DEFAULT NULL,
  operator_name VARCHAR(50)     DEFAULT NULL,
  remark        VARCHAR(200)    DEFAULT NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wave_no (wave_no),
  KEY idx_wave_status (status),
  KEY idx_wave_warehouse (warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS picking_wave_tasks (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wave_id        BIGINT UNSIGNED NOT NULL,
  task_id        BIGINT UNSIGNED NOT NULL,
  sale_order_id  BIGINT UNSIGNED DEFAULT NULL,
  sale_order_no  VARCHAR(30)     DEFAULT NULL,
  customer_name  VARCHAR(100)    DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_wt_wave (wave_id),
  KEY idx_wt_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS picking_wave_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wave_id       BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  product_code  VARCHAR(50)     DEFAULT NULL,
  product_name  VARCHAR(100)    NOT NULL,
  unit          VARCHAR(20)     DEFAULT NULL,
  total_qty     DECIMAL(12,4)   NOT NULL DEFAULT 0,
  picked_qty    DECIMAL(12,4)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_wi_wave (wave_id),
  KEY idx_wi_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
