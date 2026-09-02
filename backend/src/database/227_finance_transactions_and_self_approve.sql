-- FlowCube ERP - Migration 227
-- 资金流水页 + 用户级「允许自行审批」（2026-09-01 用户反馈：「没有专用的账户流水页面」「报销没有可以选择账户的地方」）
--
-- 1. finance_account_transactions 补 happened_at 索引
--    新增的「资金流水」页默认查**全部账户**（ORDER BY happened_at DESC, id DESC），
--    而现有 idx_fat_account_time 的最左列是 account_id —— 不带 accountId 条件时用不上它，
--    会退化成全表扫 + filesort。补一条以 happened_at 打头的索引覆盖该主场景。
--
-- 2. sys_users 加 allow_self_approve（默认 0 关闭）
--    全仓有 5 处「申请人不得审批自己提交的单」内控（报销/采购单/采购申请/授信放行，
--    以及审批流引擎在提交时把申请人剔出审批人名单）。单人或小团队场景下这些单据会
--    卡在待审批永远走不完——报销卡在付款前（账户选择器不出现），改价申请更早，
--    提交那一刻就报「没有可用的审批人」。
--
--    该权限**按用户授予**而非全局开关：谁能自批是人的属性（老板/单人记账员），
--    不是系统的属性；逐人授予也留下了"谁被豁免了内控"的明确记录。
--    默认 0 = 全部用户维持原内控，升级无行为变化。
--    只有超管能改这个字段（users.service 层校验），否则持 user.update 权限者可自我豁免。
--
-- 幂等：索引与列都走 information_schema 护栏（对照 205/210/218/222 范式）。

-- 1. finance_account_transactions.happened_at 索引
SET @has_fat_happened_idx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'finance_account_transactions'
    AND INDEX_NAME = 'idx_fat_happened'
);
SET @sql := IF(@has_fat_happened_idx = 0,
  'ALTER TABLE `finance_account_transactions` ADD KEY `idx_fat_happened` (`happened_at`, `id`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. sys_users.allow_self_approve
SET @has_self_approve_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sys_users'
    AND COLUMN_NAME = 'allow_self_approve'
);
SET @sql := IF(@has_self_approve_col = 0,
  'ALTER TABLE `sys_users` ADD COLUMN `allow_self_approve` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''允许自行审批：本人可审批/驳回自己提交的单据（报销/采购单/采购申请/授信放行/审批流），默认关闭'' AFTER `is_active`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
