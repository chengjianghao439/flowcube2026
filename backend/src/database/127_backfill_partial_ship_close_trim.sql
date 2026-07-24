-- FlowCube ERP - Migration 127
-- 历史清理："部分发货结案"这个独立状态概念已取消——履约中的订单主动关闭剩余时，
-- 现在统一走"未发商品整行删除、已发商品数量降到实发量"的精简路径（见 sale.service.js
-- 的 cancel()），订单直接显示"已出库"，不再需要 closed_reason 标记区分。
-- 本迁移把该修复上线前遗留的 closed_reason='partial_ship_close' 历史订单按同样规则回填，
-- 让"部分发货结案"这个状态在数据库里也彻底不存在。

-- 1. 未发过的行（shipped_qty<=0）整行删除
DELETE soi FROM sale_order_items soi
  JOIN sale_orders so ON so.id = soi.order_id
  WHERE so.closed_reason = 'partial_ship_close' AND soi.shipped_qty <= 0;

-- 2. 发了一部分的行，数量降到实发数量、金额同步重算
UPDATE sale_order_items soi
  JOIN sale_orders so ON so.id = soi.order_id
  SET soi.amount = soi.shipped_qty * soi.unit_price,
      soi.quantity = soi.shipped_qty
  WHERE so.closed_reason = 'partial_ship_close' AND soi.shipped_qty > 0 AND soi.shipped_qty < soi.quantity;

-- 3. 订单总金额按精简后的明细重算，清空 closed_reason（不再是特殊状态，就是普通已出库）
UPDATE sale_orders so
  LEFT JOIN (
    SELECT order_id, COALESCE(SUM(amount), 0) AS total
    FROM sale_order_items GROUP BY order_id
  ) t ON t.order_id = so.id
  SET so.total_amount = COALESCE(t.total, 0), so.closed_reason = NULL
  WHERE so.closed_reason = 'partial_ship_close';
