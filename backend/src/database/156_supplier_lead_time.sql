-- FlowCube ERP - Migration 156
-- 供应商采购提前期（文档 11 · 需求预测与采购计划）。
--
-- 采购计划预测要覆盖"下单到到货"的时间轴：毛需求 = 日均销量 × (提前期 + 覆盖周期)。
-- 提前期挂在供应商级（一个供应商一个提前期），未设(0)时计划计算回退到全局默认(默认7天)。
-- 仿账期 payment_terms_days 的处理路径。纯加列，不改任何流程。

ALTER TABLE `supply_suppliers`
  ADD COLUMN `lead_time_days` INT NOT NULL DEFAULT 0
    COMMENT '采购提前期（下单到到货天数），0=未设置，计划时回退到全局默认' AFTER `payment_terms_days`;
