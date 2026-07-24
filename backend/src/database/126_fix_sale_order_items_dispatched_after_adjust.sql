-- FlowCube ERP - Migration 126
-- 修复历史数据：执行期改单（sale.service.requestAdjustment）重建 sale_order_items 时
-- 没有带 dispatched 字段，导致明细行被误重置为「未派发」（dispatched=0）——
-- 即便该商品其实已经被订单关联的在跑仓库任务（sale_orders.task_id）覆盖着
-- （能在 warehouse_task_items 里查到同任务同产品的行）。
--
-- 后果：hasUndispatchedItems 被误判为 true，「继续发货」入口对已在仓库任务里
-- 的商品重复出现，误点会为同一批货重复建任务。代码修复见 sale.service.js
-- requestAdjustment 的 INSERT 语句（补上 dispatched=1）；本迁移回填历史脏数据。
--
-- 只回填能在 warehouse_task_items 里找到匹配行的：这才是被改单误重置的情形；
-- 真正从未派发过的行（如"取消剩余未发、以实发结案"的订单）保持 dispatched=0 不变。

UPDATE sale_order_items soi
  JOIN sale_orders so ON so.id = soi.order_id
  JOIN warehouse_task_items wti ON wti.task_id = so.task_id AND wti.product_id = soi.product_id
  SET soi.dispatched = 1
  WHERE soi.dispatched = 0
    AND so.status IN (3, 4)
    AND so.task_id IS NOT NULL;
