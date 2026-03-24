-- 030_create_sorting_bins.sql
-- 分拣格（Put Wall / Sorting Bin）支持
--
-- sorting_bins: 分拣格定义，每格对应一个物理格位
-- warehouse_tasks.sorting_bin_id: 任务与分拣格的关联（字段通过 migrate.js safeAlter 添加）

CREATE TABLE IF NOT EXISTS `sorting_bins` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`             VARCHAR(20)     NOT NULL COMMENT '格位编号，如 A01、B03',
  `warehouse_id`     BIGINT UNSIGNED NOT NULL COMMENT '所属仓库',
  `status`           TINYINT UNSIGNED NOT NULL DEFAULT 1
                       COMMENT '1=空闲 2=占用',
  `current_task_id`  BIGINT UNSIGNED DEFAULT NULL COMMENT '当前占用的仓库任务ID',
  `remark`           VARCHAR(200)    DEFAULT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_warehouse_code` (`warehouse_id`, `code`),
  KEY `idx_warehouse_status` (`warehouse_id`, `status`),
  KEY `idx_task` (`current_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='分拣格（Put Wall）';


-- 预置示例数据（仓库 ID=1，A 区 5 格，B 区 5 格）
-- 实际使用时通过管理界面创建，此处仅供开发测试
-- INSERT INTO sorting_bins (code, warehouse_id) VALUES
--   ('A01',1),('A02',1),('A03',1),('A04',1),('A05',1),
--   ('B01',1),('B02',1),('B03',1),('B04',1),('B05',1);
