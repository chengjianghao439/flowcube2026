-- FlowCube ERP - Migration 122
-- 用户-仓库数据权限：功能权限码之外的行级隔离。
-- 无任何行 = 不限仓（存量用户零迁移成本，超管天然全量）；
-- 有行 = 该用户只能看到/操作 scope 内仓库的数据（列表过滤见 utils/warehouseScope.js）。

CREATE TABLE IF NOT EXISTS `user_warehouse_scope` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `warehouse_id` INT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_warehouse` (`user_id`, `warehouse_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户仓库数据权限（空=不限仓）';
