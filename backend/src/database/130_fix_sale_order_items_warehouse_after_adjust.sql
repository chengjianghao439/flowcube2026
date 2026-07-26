-- FlowCube ERP - Migration 130
-- 修复历史数据：执行期改单（sale.service.requestAdjustment）重建 sale_order_items 时
-- 漏填 warehouse_id / warehouse_name。
--
-- 自迁移 123 起，sale_order_items.warehouse_id 是「行级发货仓库」，同时充当三处定位键：
--   1. syncShippedByWarehouseTaskWithinTransaction 回写 shipped_qty 的 WHERE 条件
--   2. recomputeSaleReceivable 依赖 shipped_qty 汇总算应收
--   3. getShipContext 关联出库明细
-- 该字段为 NULL 时，`AND warehouse_id = ?` 恒不成立（NULL 比较永远不为真），后果是：
--   · shipped_qty 永远停在 0 → 订单永远卡在「履约中(3)」，进不了「已出库(4)」
--   · 应收 = SUM(shipped_qty × unit_price) = 0 → 货发出去了却没有应收账款
-- 且改单守卫 `COUNT(DISTINCT warehouse_id) > 1` 对全 NULL 的订单算出 0，不会拦截，
-- 所以同一张单可以反复改单、问题持续累积。
--
-- 迁移 126 修过同一条 INSERT 语句漏 dispatched 的问题，但没发现它同时还漏着仓库字段。
-- 代码修复见 sale.service.js requestAdjustment（补 warehouse_id/warehouse_name）。

-- 0. 先固定住受影响订单集合——第 1 步执行后 warehouse_id 就不再为 NULL，无法二次识别
CREATE TEMPORARY TABLE IF NOT EXISTS tmp_soi_wh_fix (order_id BIGINT UNSIGNED PRIMARY KEY);
INSERT IGNORE INTO tmp_soi_wh_fix (order_id)
  SELECT DISTINCT order_id FROM sale_order_items WHERE warehouse_id IS NULL;

-- 1. 优先按「该订单关联的仓库任务所在仓库」回填。
--    仓库任务是 ship() 按行仓库分组创建的，所以任务仓库就是这些明细行原本的仓库，
--    比订单头仓库更准确（占库时 itemOverrides 可能把行仓库改成过与订单头不同的值）。
--    只处理任务仓库唯一的订单；多仓任务的订单留给第 2 步兜底。
UPDATE sale_order_items soi
  JOIN (
    SELECT sale_order_id,
           MIN(warehouse_id)   AS wid,
           MIN(warehouse_name) AS wname
    FROM warehouse_tasks
    WHERE deleted_at IS NULL AND sale_order_id IS NOT NULL
    GROUP BY sale_order_id
    HAVING COUNT(DISTINCT warehouse_id) = 1
  ) t ON t.sale_order_id = soi.order_id
  SET soi.warehouse_id = t.wid, soi.warehouse_name = t.wname
  WHERE soi.warehouse_id IS NULL;

-- 2. 兜底：没有仓库任务、或任务跨多仓的订单，回填订单头仓库
UPDATE sale_order_items soi
  JOIN sale_orders so ON so.id = soi.order_id
  SET soi.warehouse_id = so.warehouse_id, soi.warehouse_name = so.warehouse_name
  WHERE soi.warehouse_id IS NULL;

-- 3. 补回被吞掉的实发量：对「已出库(7)的仓库任务」按实拣量回写 shipped_qty。
--    限定 shipped_qty = 0 才补，避免对已正常记账的行重复累加。
UPDATE sale_order_items soi
  JOIN (
    SELECT wt.sale_order_id, wt.warehouse_id, wti.product_id,
           SUM(wti.picked_qty) AS picked
    FROM warehouse_tasks wt
    JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status = 7 AND wt.deleted_at IS NULL
    GROUP BY wt.sale_order_id, wt.warehouse_id, wti.product_id
  ) s ON s.sale_order_id = soi.order_id
     AND s.product_id    = soi.product_id
     AND s.warehouse_id  = soi.warehouse_id
  JOIN tmp_soi_wh_fix f ON f.order_id = soi.order_id
  SET soi.shipped_qty = LEAST(soi.quantity, s.picked)
  WHERE soi.shipped_qty = 0 AND s.picked > 0;

-- 4. 按补回后的实发量重算应收（与 sale.service.recomputeSaleReceivable 同口径：
--    应收 = SUM(shipped_qty × unit_price)，全量覆盖而非累加，依赖 UNIQUE(type, order_id)）
INSERT INTO payment_records
  (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status, due_date)
SELECT 2, so.id, so.order_no, so.customer_name, agg.amt, 0, agg.amt, 1, 1,
       DATE_ADD(NOW(), INTERVAL COALESCE(cu.payment_terms_days, 30) DAY)
FROM sale_orders so
  JOIN tmp_soi_wh_fix f ON f.order_id = so.id
  JOIN (
    SELECT order_id, SUM(shipped_qty * unit_price) AS amt
    FROM sale_order_items GROUP BY order_id
  ) agg ON agg.order_id = so.id
  LEFT JOIN sale_customers cu ON cu.id = so.customer_id
WHERE agg.amt > 0
ON DUPLICATE KEY UPDATE
  total_amount = VALUES(total_amount),
  balance      = VALUES(total_amount) - paid_amount,
  status       = CASE WHEN paid_amount >= VALUES(total_amount) THEN 3
                      WHEN paid_amount > 0 THEN 2 ELSE 1 END;

-- 5. 已经全部发完却因为本 bug 卡在「履约中(3)」的订单，推进到「已出库(4)」。
--    与 syncShipped 的判定口径一致：所有明细行 shipped_qty >= quantity。
UPDATE sale_orders so
  JOIN tmp_soi_wh_fix f ON f.order_id = so.id
  JOIN (
    SELECT order_id,
           SUM(CASE WHEN shipped_qty < quantity THEN 1 ELSE 0 END) AS pending,
           SUM(shipped_qty) AS shipped
    FROM sale_order_items GROUP BY order_id
  ) agg ON agg.order_id = so.id
  SET so.status = 4
  WHERE so.status = 3 AND agg.pending = 0 AND agg.shipped > 0;

DROP TEMPORARY TABLE IF EXISTS tmp_soi_wh_fix;
