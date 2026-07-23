-- FlowCube ERP - Migration 120
-- 账期可配置：应付/应收 due_date 此前写死 30 天，改为按供应商/客户主数据的账期天数。

ALTER TABLE `supply_suppliers`
  ADD COLUMN `payment_terms_days` INT NOT NULL DEFAULT 30 COMMENT '应付账期天数' AFTER `remark`;

ALTER TABLE `sale_customers`
  ADD COLUMN `payment_terms_days` INT NOT NULL DEFAULT 30 COMMENT '应收账期天数' AFTER `remark`;
