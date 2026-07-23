-- FlowCube ERP - Migration 113
-- sale_order_adjustment_container_returns 补充 original_container_id：
-- 容器部分归还场景下，实际拆出的是一个新容器（source_container_id），但物理上
-- 原容器（original_container_id）仍保留剩余数量并继续锁定于任务——归还确认时
-- 需要据此同步下调原容器的拣货扫码记录（scan_logs），否则复核阶段按旧的拣货
-- 扫码合计计算会与下调后的 picked_qty 不一致。整只容器归还的场景两者相同。

ALTER TABLE `sale_order_adjustment_container_returns`
  ADD COLUMN `original_container_id` BIGINT UNSIGNED DEFAULT NULL AFTER `source_container_id`;
