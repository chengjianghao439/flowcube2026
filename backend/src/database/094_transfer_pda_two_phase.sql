-- FlowCube ERP - Migration 094
-- 调拨改造为 PDA 两阶段（源仓扫出→在途→目标仓扫入）
--
-- 状态机变更：1草稿 2待出库(已派发) 3在途 4已完成 5已取消
-- （旧：1草稿 2已确认 3已执行 4已取消）

-- 派发到 PDA 的元数据（仿 inbound_tasks）
ALTER TABLE `transfer_orders`
  ADD COLUMN `submitted_at`      DATETIME     DEFAULT NULL COMMENT '派发到PDA时间' AFTER `remark`,
  ADD COLUMN `submitted_by`      BIGINT UNSIGNED DEFAULT NULL COMMENT '派发人ID' AFTER `submitted_at`,
  ADD COLUMN `submitted_by_name` VARCHAR(100) DEFAULT NULL COMMENT '派发人名称' AFTER `submitted_by`;

-- 明细进度：已扫出（源仓出库量）、已扫入（目标仓入库量）
ALTER TABLE `transfer_order_items`
  ADD COLUMN `deducted_qty` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '已扫出(源仓出库)数量' AFTER `quantity`,
  ADD COLUMN `received_qty` DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '已扫入(目标仓入库)数量' AFTER `deducted_qty`;

-- 容器→调拨单在途关联（仿 inbound_task_id）：源仓扫出时打标，目标仓扫入时据此查在途容器
ALTER TABLE `inventory_containers`
  ADD COLUMN `transfer_order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '在途调拨单ID（源仓扫出→目标仓扫入期间）' AFTER `inbound_task_id`,
  ADD INDEX `idx_containers_transfer_order` (`transfer_order_id`);

-- 历史数据状态重映射（顺序：先 4→5，再 3→4，避免碰撞）
UPDATE `transfer_orders` SET `status` = 5 WHERE `status` = 4;
UPDATE `transfer_orders` SET `status` = 4 WHERE `status` = 3;
