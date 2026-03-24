-- 仓库任务事件日志表
-- 记录任务生命周期中的所有关键状态变化和业务事件
CREATE TABLE IF NOT EXISTS `warehouse_task_events` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id`      BIGINT UNSIGNED NOT NULL         COMMENT '关联的仓库任务ID',
  `task_no`      VARCHAR(30)     NOT NULL         COMMENT '任务编号（冗余，方便查询）',
  `event_type`   VARCHAR(50)     NOT NULL         COMMENT '事件类型，见下方枚举',
  `from_status`  TINYINT UNSIGNED    DEFAULT NULL  COMMENT '变化前状态（非状态变更事件为NULL）',
  `to_status`    TINYINT UNSIGNED    DEFAULT NULL  COMMENT '变化后状态（非状态变更事件为NULL）',
  `operator_id`  BIGINT UNSIGNED     DEFAULT NULL  COMMENT '操作人ID',
  `operator_name` VARCHAR(50)    DEFAULT NULL     COMMENT '操作人姓名',
  `detail`       JSON            DEFAULT NULL     COMMENT '事件详情（如分拣进度、复核数量等）',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id`    (`task_id`),
  KEY `idx_task_no`    (`task_no`),
  KEY `idx_event_type` (`event_type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='仓库任务事件日志，记录任务生命周期中的所有关键事件';

-- 事件类型枚举说明（写在注释中供参考）
-- TASK_CREATED       任务创建
-- PICKING_STARTED    开始拣货
-- PICKING_DONE       拣货完成（→待分拣）
-- SORT_PROGRESS      分拣进度上报（未完成）
-- SORT_DONE          分拣完成（→待复核）
-- CHECK_PROGRESS     复核进度上报（未完成）
-- CHECK_DONE         复核完成（→待打包）
-- PACK_PROGRESS      单箱打包完成（任务未完成）
-- PACK_DONE          全部打包完成（→待出库）
-- SHIP_DONE          出库完成（→已出库）
-- TASK_CANCELLED     任务取消
-- SORTING_BIN_ASSIGNED  分拣格分配
-- SORTING_BIN_RELEASED  分拣格释放
