-- FlowCube ERP - Migration 118
-- 应付确认闸门：v0.4.22 起应付随上架完成自动结算（无人工审核），收货员操作直接
-- 形成对供应商的负债金额，缺财务复核。本迁移在"付款"前加一道确认闸——
-- 应付(type=1)须财务确认（confirm_status=1）后才允许登记付款；结算金额被重算
-- 改变时自动打回待确认（见 inbound-tasks.settle.js）。
-- 存量数据一次性置为已确认，避免堵死已在付的历史账款。

ALTER TABLE `payment_records`
  ADD COLUMN `confirm_status` TINYINT NOT NULL DEFAULT 0 COMMENT '0待财务确认 1已确认（应付type=1专用，应收/手工单默认已确认）' AFTER `status`,
  ADD COLUMN `confirmed_by` INT DEFAULT NULL AFTER `confirm_status`,
  ADD COLUMN `confirmed_by_name` VARCHAR(50) DEFAULT NULL AFTER `confirmed_by`,
  ADD COLUMN `confirmed_at` DATETIME DEFAULT NULL AFTER `confirmed_by_name`;

UPDATE `payment_records` SET `confirm_status` = 1;
