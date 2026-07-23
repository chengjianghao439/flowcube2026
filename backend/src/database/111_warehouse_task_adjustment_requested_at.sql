-- FlowCube ERP - Migration 111
-- 销售单执行期改单：warehouse_tasks 新增 adjustment_requested_at，标记"改单已发起、
-- 正在等待PDA物理确认（归还/拆箱）收尾中"。非空时对推进性正向PDA流程（分拣/复核/
-- 打包/出库）不可见，与 cancel_requested_at 互斥，全部子项确认完才清空。

ALTER TABLE `warehouse_tasks`
  ADD COLUMN `adjustment_requested_at` DATETIME DEFAULT NULL COMMENT '改单已发起、正在等待PDA物理确认收尾的时间戳，非空时对正向PDA流程不可见' AFTER `cancel_requested_at`,
  ADD KEY `idx_wt_adjustment_requested_at` (`adjustment_requested_at`);
