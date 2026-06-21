-- inventory_logs.change_qty 是早期遗留列：现行代码统一写 quantity/before_qty/after_qty，
-- 不再写 change_qty。但该列 NOT NULL 且无默认值，在 MySQL 严格模式
-- （STRICT_TRANS_TABLES，MySQL 8.0 默认）下，INSERT 不提供该列会报
-- "Field 'change_qty' doesn't have a default value"，导致库存日志写入失败、上架/出库全挂。
-- 给遗留列一个默认值 0，使其不再阻塞写入（全新库 / 严格模式健壮性）。
ALTER TABLE `inventory_logs`
  MODIFY COLUMN `change_qty` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '变动数量（遗留列，现统一用 quantity）';
