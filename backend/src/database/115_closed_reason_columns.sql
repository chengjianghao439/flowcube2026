-- FlowCube ERP - Migration 115
-- 短装/异常结案原因标注：closeReceiving / closeRemaining / forceCloseInTransit 复用了
-- 「已完成」状态码（避免牵动状态机与前端展示），代价是报表无法区分正常完成与异常结案。
-- 加 closed_reason 列补齐区分能力，不新增状态码。
-- 取值约定：NULL=正常完成；short_close=短装结案；force_close=在途强制了结。

ALTER TABLE `inbound_tasks`
  ADD COLUMN `closed_reason` VARCHAR(20) DEFAULT NULL COMMENT '结案原因：NULL正常/short_close短装结案' AFTER `status`;

ALTER TABLE `purchase_orders`
  ADD COLUMN `closed_reason` VARCHAR(20) DEFAULT NULL COMMENT '结案原因：NULL正常/short_close关闭剩余结案' AFTER `status`;

ALTER TABLE `transfer_orders`
  ADD COLUMN `closed_reason` VARCHAR(20) DEFAULT NULL COMMENT '结案原因：NULL正常/force_close在途强制了结' AFTER `status`;
