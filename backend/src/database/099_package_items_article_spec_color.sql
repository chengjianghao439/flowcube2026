-- FlowCube ERP - Migration 099
-- package_items（打包明细）补货号/型号/颜色快照字段，与其余订单行表
-- （purchase/sale/inbound-task/purchase-return/sale-return items，见 082/092/095/096/097）
-- 的"下单时快照"策略对齐；此前是查询时实时 JOIN product_items 现取，
-- 商品主档改了型号/颜色会导致历史包裹展示跟着变。

ALTER TABLE `package_items`
  ADD COLUMN `article_number` VARCHAR(50) DEFAULT NULL COMMENT '货号（装箱时从商品主档快照）' AFTER `unit`,
  ADD COLUMN `spec` VARCHAR(100) DEFAULT NULL COMMENT '型号' AFTER `article_number`,
  ADD COLUMN `color` VARCHAR(30) DEFAULT NULL COMMENT '颜色' AFTER `spec`;
