-- FlowCube ERP - Migration 220
-- 销售订单「按产品/按数量」占库：明细行从「布尔已派发」升级为「数量已占 / 已派发」。
--
-- 背景：此前占库是整单原子（要么全占要么全不占），sale_order_items 用布尔 dispatched
-- 标记「这一行是否已派发到仓库任务」。按数量占库后，一行可以只占一部分（如需求 100 占 60），
-- 也可以多次「补占 → 发货」，因此需要一个数量语义的已占列 + 已派发列。
--
--   reserved_qty  该行已占数量（reserve/release 维护，<= quantity）
--   dispatched_qty 该行已派发到仓库任务的数量（替代布尔 dispatched；只发已占部分）
--
-- dispatched 布尔列保留不删（历史语义兼容），但业务代码一律改读 dispatched_qty。

ALTER TABLE `sale_order_items`
  ADD COLUMN `reserved_qty` DECIMAL(14,4) NOT NULL DEFAULT 0
    COMMENT '已占数量（按数量占库，<= quantity）' AFTER `shipped_qty`,
  ADD COLUMN `dispatched_qty` DECIMAL(14,4) NOT NULL DEFAULT 0
    COMMENT '已派发到仓库任务的数量（替代 dispatched 布尔）' AFTER `reserved_qty`;

-- 存量回填：历史订单在「数量占库」之前要么整单占满、要么没占，一次性对账。
--   reserved_qty：status IN (2,3,4) 的订单曾整单占满 → 回填为 quantity。
--   dispatched_qty：dispatched=1 的行曾整行派发 → 回填为 quantity。
UPDATE `sale_order_items` soi
  JOIN `sale_orders` so ON so.id = soi.order_id
  SET soi.reserved_qty = soi.quantity
  WHERE so.status IN (2, 3, 4);

UPDATE `sale_order_items` soi
  SET soi.dispatched_qty = soi.quantity
  WHERE soi.dispatched = 1;
