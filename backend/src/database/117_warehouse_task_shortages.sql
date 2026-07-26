-- ⚠️ 现状注记（2026-07 审计）：本表与 warehouse_tasks.shortage_reported_at 建好后
-- 全仓零引用——没有任何 PDA 上报入口、没有 ERP 处理界面、拣货完成也没有据此拦截。
-- 也就是说下面描述的闭环目前并不存在，表是空跑的。保留不删（删表会丢掉将来实现的结构，
-- 且已执行过的迁移不应回改），但在功能真正落地前，不要把它当作已有能力来引用。
--
-- FlowCube ERP - Migration 117
-- 拣货缺货上报：仓库现场发现库位没货/拣不齐时，PDA 上报事实（缺多少），
-- 由 ERP 端决策处理（按实拣改单 / 线下补货后驳回）。任务存在未处理上报时
-- 禁止拣货完成推进，形成"仓库上报、ERP 决策"的闭环。

CREATE TABLE IF NOT EXISTS `warehouse_task_shortages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `task_no` VARCHAR(50) NOT NULL,
  `sale_order_id` INT DEFAULT NULL,
  `product_id` INT NOT NULL,
  `product_name` VARCHAR(200) DEFAULT NULL,
  `missing_qty` DECIMAL(12,2) NOT NULL COMMENT '缺口数量（required - 现场实际可拣）',
  `reason` VARCHAR(200) DEFAULT NULL COMMENT '现场备注（可选）',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1待处理 2已处理(改单已按实拣调整) 3已驳回(线下补货后继续拣)',
  `reported_by` INT DEFAULT NULL,
  `reported_by_name` VARCHAR(50) DEFAULT NULL,
  `resolved_by` INT DEFAULT NULL,
  `resolved_by_name` VARCHAR(50) DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_status` (`task_id`, `status`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='拣货缺货上报';

ALTER TABLE `warehouse_tasks`
  ADD COLUMN `shortage_reported_at` DATETIME DEFAULT NULL COMMENT '存在未处理缺货上报时置位，处理完清空' AFTER `adjustment_requested_at`;
