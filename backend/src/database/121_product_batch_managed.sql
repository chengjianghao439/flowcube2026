-- FlowCube ERP - Migration 121
-- 批次/效期管理启用：容器表的 batch_no/mfg_date/exp_date 字段一直存在但收货不采集。
-- 商品主数据加开关：batch_managed=1 的商品收货时强制录入批次与效期
-- （effDate 可由 mfgDate + shelf_life_days 自动推算），出库按 FEFO（先到期先出）。

ALTER TABLE `product_items`
  ADD COLUMN `batch_managed` TINYINT NOT NULL DEFAULT 0 COMMENT '1=收货强制录入批次/效期，出库FEFO' AFTER `avg_cost`,
  ADD COLUMN `shelf_life_days` INT DEFAULT NULL COMMENT '保质期天数（效期=生产日期+保质期）' AFTER `batch_managed`;
