-- FlowCube ERP - Migration 136
-- 账款上固化结算方式快照。
--
-- 迁移 135 把 settlement_type 放在往来方主数据（supply_suppliers / sale_customers）上，
-- 账款页与对账页靠回溯 JOIN 判断某笔账属于现结还是月结。这有个业务错误：
-- 把一个客户从现结改成月结，他**已经生成的历史账款**会立刻整批从账款页搬到对账页——
-- 但那些账当初就是按现结条件结算的（到期日=下单当天），事后改主数据不该追溯改写历史。
--
-- 因此把结算方式在账款生成那一刻快照到 payment_records 上，与 due_date 同源：
-- 之后改往来方主数据只影响**新产生**的账款，老账款保持原样。
-- 同理参见 sale_order_items.cost_snapshot（出库时固化成本，不随商品均价漂移）。

ALTER TABLE `payment_records`
  ADD COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式快照 1现结 2月结 3预付定金 4货到付款（生成时固化，不随往来方主数据变更）'
    AFTER `confirm_status`;

-- 存量回填：历史账款没有留下当时的结算方式，只能按往来方**当前**的结算方式补写，
-- 这是唯一可得的信息。回填后即固定，后续主数据变更不再影响它们。
UPDATE `payment_records` pr
  LEFT JOIN `purchase_orders`  po  ON pr.type = 1 AND po.id = pr.order_id
  LEFT JOIN `supply_suppliers` sup ON sup.id = po.supplier_id
  LEFT JOIN `sale_orders`      so  ON pr.type = 2 AND so.id = pr.order_id
  LEFT JOIN `sale_customers`   cus ON cus.id = so.customer_id
   SET pr.settlement_type = COALESCE(sup.settlement_type, cus.settlement_type, 2);

-- 按结算方式筛账款是两个页面的主查询路径，且未来账款只增不减，加索引避免全表扫。
CREATE INDEX `idx_payment_records_settlement` ON `payment_records` (`type`, `settlement_type`, `status`);
