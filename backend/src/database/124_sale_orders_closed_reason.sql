-- FlowCube ERP - Migration 124
-- 销售单结案原因（与迁移115给其他单据加的 closed_reason 一致）：
-- 分仓/分批发货下，部分已发的订单取消剩余时以"实发结案"复用状态4（已出库），
-- 用 closed_reason 区分"正常全部出库(NULL)"与"部分发货结案(partial_ship_close)"。

ALTER TABLE `sale_orders`
  ADD COLUMN `closed_reason` VARCHAR(20) DEFAULT NULL COMMENT 'NULL正常出库/partial_ship_close部分发货结案' AFTER `status`;
