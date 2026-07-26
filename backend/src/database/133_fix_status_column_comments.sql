-- FlowCube ERP - Migration 133
-- 修正四个状态列的注释——它们与代码里的真实状态机严重不符，照注释改代码必然出错。
--
-- 注释是开发时唯一贴在数据上的说明，排查线上数据时第一眼看的就是它。
-- 这四处漂移里 warehouse_tasks.status 最危险：注释说 5=已取消，实际 5=待打包，
-- 按注释写一条「清理已取消任务」的 SQL，删掉的会是正在打包的活任务。
--
--   表.列                        旧注释（错）                          实际（代码为准）
--   sale_orders.status           1草稿 2已确认 3已出库 4已取消          1草稿 2已占库 3拣货中 4已出库 5已取消
--   warehouse_tasks.status       1待分配 2备货中 3待出库 4已出库 5已取消  2拣货中 3待分拣 4待复核 5待打包 6待出库 7已出库 8已取消
--   purchase_orders.status       1草稿 2已确认 3已收货 4已取消          1草稿 2已提交 3已完成 4已取消
--   inbound_tasks.audit_status   0待审核 1已审核 2已退回                0未结算 1已结算（v0.4.22 起人工审核环节已删除）
--
-- 权威定义：backend/src/constants/documentStatusRules.js 与 constants/warehouseTaskStatus.js。
-- 本迁移只改 COLUMN COMMENT，不动数据。
--
-- 注意：MySQL 的 MODIFY COLUMN 会用新定义整体替换旧定义，漏写 UNSIGNED 或写错 DEFAULT
-- 都会被静默接受并改掉列的实际行为。下面四行的类型/可空/默认值均按现网实际值原样复述
-- （tinyint unsigned NOT NULL；默认值 sale/warehouse_task/purchase 为 1、audit_status 为 0）。
-- warehouse_tasks.status 的默认值保持 1 不动：1 在状态机里已废弃，但改默认值是行为变更，
-- 不属于「修注释」该做的事。

ALTER TABLE `sale_orders`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1草稿 2已占库 3拣货中 4已出库 5已取消（见 documentStatusRules.sale）';

ALTER TABLE `warehouse_tasks`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '2拣货中 3待分拣 4待复核 5待打包 6待出库 7已出库 8已取消（见 warehouseTaskStatus.js；1 为历史默认值，状态机已不再使用）';

ALTER TABLE `purchase_orders`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1草稿 2已提交 3已完成 4已取消（见 documentStatusRules.purchase）';

ALTER TABLE `inbound_tasks`
  MODIFY COLUMN `audit_status` TINYINT UNSIGNED NOT NULL DEFAULT 0
  COMMENT '0未结算 1已结算：上架全部完成时在同一事务内自动置 1 并生成应付，v0.4.22 起无人工审核环节';
