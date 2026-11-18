-- One automatic cycle-count outcome per Beijing business day, warehouse and class.
-- The pending claim and its terminal outcome are in the same transaction.
CREATE TABLE IF NOT EXISTS inventory_cycle_runs (
  planned_date DATE NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  abc_class ENUM('A','B','C') NOT NULL,
  outcome ENUM('pending','created','no_candidates') NOT NULL,
  stockcheck_id BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (planned_date, warehouse_id, abc_class),
  UNIQUE KEY uk_inventory_cycle_runs_stockcheck (stockcheck_id),
  CONSTRAINT ck_inventory_cycle_runs_result CHECK ((outcome = 'created') = (stockcheck_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='循环盘计划日、仓库与类别完成记录';
