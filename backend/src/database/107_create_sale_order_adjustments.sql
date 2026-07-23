-- FlowCube ERP - Migration 107
-- 销售单执行期改单：改单请求主表。一次 PUT /sale/:id/adjust 提交对应一行，
-- status=1 表示还有子项在等待 PDA 物理确认（拆箱/归还），全部确认完才转 2。

CREATE TABLE `sale_order_adjustments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sale_order_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_task_id` BIGINT UNSIGNED NOT NULL,
  `adjustment_no` VARCHAR(30) NOT NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1待确认 2已完成 3已作废',
  `requested_by` BIGINT UNSIGNED DEFAULT NULL,
  `requested_by_name` VARCHAR(50) DEFAULT NULL,
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_soa_sale_order` (`sale_order_id`),
  KEY `idx_soa_task` (`warehouse_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
