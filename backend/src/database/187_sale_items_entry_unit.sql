-- FlowCube ERP - Migration 187
-- 销售按辅助单位（箱/托）录入（文档03 · Phase 3）。与采购 Phase2（迁移186）同款方案A：
-- sale_order_items 加「录入口径快照」三列，既有 quantity/unit_price/amount 语义**恒为基本单位口径不变**，
-- 下游占库/出库/应收 SQL 一字不改；换算只在销售建单/改单折算落库时发生（后端权威）。
-- entry_* 三列**只用于回显/打印/审计，绝不参与库存/账款计算**。
-- unit_price 提精度 (12,4)→(18,8)：应收 Σ(picked_qty×unit_price) 用高精度单价，除不尽换算率下残差压到亿分位。
-- 存量行/未配辅助单位商品：entry_unit=unit、entry_qty=quantity、conversion_rate=1，语义完全等价、零行为变化。

ALTER TABLE `sale_order_items`
  ADD COLUMN `entry_unit`      VARCHAR(20)   NULL COMMENT '录入单位（快照，不参与计算，文档03 Phase3）' AFTER `unit`,
  ADD COLUMN `entry_qty`       DECIMAL(18,4) NULL COMMENT '录入单位下的数量（快照，不参与计算）'      AFTER `quantity`,
  ADD COLUMN `conversion_rate` DECIMAL(18,6) NOT NULL DEFAULT 1 COMMENT '下单时点 1录入单位=N基本单位（快照）' AFTER `entry_qty`,
  MODIFY COLUMN `unit_price`   DECIMAL(18,8) NOT NULL DEFAULT 0 COMMENT '每基本单位单价（提精度到亿分位，多单位折算残差可控，§5.4方案A）';

UPDATE `sale_order_items` SET `entry_unit` = `unit`, `entry_qty` = `quantity` WHERE `entry_unit` IS NULL;
