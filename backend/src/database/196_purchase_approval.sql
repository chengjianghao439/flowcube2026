-- FlowCube ERP - Migration 196
-- 采购审批环节（审计 4.7）：金额超阈值的采购单提交后需审批通过才能建收货订单。
--
-- 设计（复用请购单 purchaseRequisition 审批范式）：
--   · purchase_orders.need_approval：提交时按 sys_settings.purchase_approval_threshold 计算
--     （total_amount > 阈值 → 1），需审批单提交后停在待审批，approve 通过后才能建收货。
--   · 未超阈值单 need_approval=0，行为与现状完全一致（提交即可建收货）。
--   · approved_by / approved_at / reject_reason：审批留痕。
--   · sys_settings.purchase_approval_threshold：审批阈值（元），默认 0 = 关闭审批（全放行）。

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_orders' AND COLUMN_NAME = 'need_approval');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE `purchase_orders`
     ADD COLUMN `need_approval` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''提交时按阈值计算是否需审批（1=需审批，审批通过才能建收货）'' AFTER `total_amount`,
     ADD COLUMN `approved_by` BIGINT UNSIGNED DEFAULT NULL COMMENT ''审批人'' AFTER `need_approval`,
     ADD COLUMN `approved_by_name` VARCHAR(50) DEFAULT NULL COMMENT ''审批人姓名'' AFTER `approved_by`,
     ADD COLUMN `approved_at` DATETIME DEFAULT NULL COMMENT ''审批时间'' AFTER `approved_by_name`,
     ADD COLUMN `reject_reason` VARCHAR(500) DEFAULT NULL COMMENT ''驳回原因'' AFTER `approved_at`',
  'SELECT "purchase_orders approval cols exist" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 审批阈值（元）；默认 0 = 关闭（现有采购单全走原流程，行为不变）。
SET @has_setting := (SELECT COUNT(*) FROM sys_settings WHERE key_name = 'purchase_approval_threshold');
SET @sql := IF(@has_setting = 0,
  "INSERT INTO sys_settings (key_name, label, value, type, remark)
   VALUES ('purchase_approval_threshold', '采购审批金额阈值', '0', 'number', '采购单金额超过该值（元）须审批后才能建收货订单；0 表示不启用审批')",
  'SELECT "purchase_approval_threshold exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
