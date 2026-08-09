-- FlowCube ERP - Migration 198
-- 销售折扣（P2-4）：整单折扣金额，应收按净额计。
--   discount_amount：整单优惠金额（如抹零、促销减让），建单时录入，应收 = 应收原值 − 折扣。
--   total_amount 仍存原始合计（不改既有口径），应收重算时按发货比例扣减折扣。
-- 迁移 136 的账款快照语义不变：折扣只影响本期应收，不回溯历史已出库账款。

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_orders' AND COLUMN_NAME = 'discount_amount');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE `sale_orders` ADD COLUMN `discount_amount` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT ''整单折扣金额（应收按净额=原值-折扣）'' AFTER `total_amount`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
