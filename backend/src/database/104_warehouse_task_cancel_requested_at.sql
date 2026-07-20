-- FlowCube ERP - Migration 104
-- 销售单取消逆向归还流程：warehouse_tasks 新增 cancel_requested_at，标记"取消已发起、
-- 正在逐容器扫码归还收尾中"。非空时该任务对拣货/分拣等正向 PDA 流程不可见，
-- 直到所有已锁定容器归位完毕才真正推进为已取消(8)。

ALTER TABLE `warehouse_tasks`
  ADD COLUMN `cancel_requested_at` DATETIME DEFAULT NULL COMMENT '取消已发起、正在逆向归还收尾中的时间戳，非空时对正向PDA流程不可见' AFTER `shipped_at`,
  ADD KEY `idx_wt_cancel_requested_at` (`cancel_requested_at`);
