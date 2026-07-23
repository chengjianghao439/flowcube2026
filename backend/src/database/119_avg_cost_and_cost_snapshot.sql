-- FlowCube ERP - Migration 119
-- 移动加权成本：
--  1. product_items.avg_cost 移动加权平均成本，收货上架时按
--     (在库量×旧均价 + 上架量×采购价)/(在库量+上架量) 更新（inbound-tasks.putaway.js）；
--     初始化为当前 cost_price。退货/撤回不反冲均价（只随入库正向移动，业界通行简化）。
--  2. sale_order_items.cost_snapshot 出库时点成本快照（warehouse-tasks.ship.js 写入），
--     利润分析优先用快照，历史单回退当前 cost_price 口径——解决"改进价导致历史毛利漂移"。

ALTER TABLE `product_items`
  ADD COLUMN `avg_cost` DECIMAL(12,4) DEFAULT NULL COMMENT '移动加权平均成本（上架时更新）' AFTER `cost_price`;

UPDATE `product_items` SET `avg_cost` = `cost_price` WHERE `cost_price` IS NOT NULL AND `cost_price` > 0;

ALTER TABLE `sale_order_items`
  ADD COLUMN `cost_snapshot` DECIMAL(12,4) DEFAULT NULL COMMENT '出库时点单位成本快照（COGS）' AFTER `unit_price`;
