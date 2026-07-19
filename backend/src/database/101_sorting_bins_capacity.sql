-- FlowCube ERP - Migration 101
-- 分拣格（PUT wall）容量阈值告警：sorting_bins 新增 capacity 字段，可空，NULL=不限容量。

ALTER TABLE `sorting_bins`
  ADD COLUMN `capacity` INT UNSIGNED DEFAULT NULL COMMENT '容量阈值（件），NULL=不限' AFTER `remark`;
