-- FlowCube ERP - Migration 125
-- 分批发货：dispatched 标记该明细行是否已派发到仓库任务。
-- 分批 = 订单占库后分多次发货，每次只把选中的（且未派发的）行建成任务，其余留待下次。
-- 存量：status IN (3,4) 的订单在分批能力之前是一次性全派发的，回填 dispatched=1。

ALTER TABLE `sale_order_items`
  ADD COLUMN `dispatched` TINYINT NOT NULL DEFAULT 0 COMMENT '是否已派发到仓库任务（分批发货）' AFTER `shipped_qty`;

UPDATE `sale_order_items` soi
  JOIN `sale_orders` so ON so.id = soi.order_id
  SET soi.dispatched = 1
  WHERE so.status IN (3, 4);
