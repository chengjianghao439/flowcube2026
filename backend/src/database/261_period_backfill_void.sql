-- 跨期补录的「作废 / 退回重提」路径（2026-09-26 一致性审查 · 任务 7 第二期补丁）。
--
-- 背景：审批流是**异步**的——申请时校验过的那笔业务，到审批人点「批准」时可能已经不可执行了：
--   · 付款：账款在审批期间已被别人付清、或应付被财务打回重算、或余额被别的付款占掉；
--   · 核销：账款已被另一张收付款单结清、对账单被退回草稿、单子余额不够；
--   · 退款：这笔收款在审批期间又被另一张退款单冲掉了一部分。
-- 这时的状态是 status=1 已批准、executed_at 为空（执行失败停在「已批准 · 待执行」）。
-- 而 reject 又不接受已批准的单子（审批结论已经落定，不该被驳回改写），于是这张单**永久卡住**：
-- 执行不了、驳回不了、没人能处理，只能进数据库改——这是本次审查要消灭的那类死角。
--
-- 处置口径（业务确认 2026-09-26）：**作废，然后按新情况重新申请**。
--   · 作废不是「撤销一笔已发生的业务」，而是「这张申请单不再执行」——**一分钱不动**，
--     业务数据一行不写，比驳回更彻底：驳回可以把单子改回待审批再批，作废是这条路走不通了；
--   · 谁可以作废：持 finance.period.backfill.approve 的审批侧；status=0 待审批时**申请人本人**
--     也可以撤回自己的申请（还没被批过，撤回不涉及推翻谁的结论）；
--   · 已执行（executed_at 非空）的**不允许作废**：钱真的动了，只能走会计调整流程冲回，
--     让一张动过钱的单子从审批页消失，等于让账实不符藏起来。
--   · 留痕：void_reason 必填、voided_by / voided_by_name / voided_at 记谁在什么时候以什么
--     理由作废的。事后必须能回答「这张单为什么没执行」。
--
-- 作废后**释放不了请求键**（uk_fpb_request_key 是全生命周期唯一，见迁移 260 的长注释）：
-- 唯一索引上那行仍然占着这个键，所以**重新申请必须用新的请求键**。这不是缺陷，是刻意：
-- 同一个键再次提交会被读回那张已作废的单（并明确告知「这张申请已作废，请重新申请」），
-- 而不是悄悄当成一次新申请——否则客户端的超时重放就能凭空造出第二张单子。
--
-- status 取值扩展为：0待审批 1已批准 2已驳回 3历史遗留 4已作废。
--
-- 幂等：按本仓惯例（017/032/259/260）逐列条件式 DDL。status 的注释用 MODIFY 补全，
-- 且只在列已存在时执行（迁移 260 漏跑的环境不至于在这里报错中断）。

SET @dbname = DATABASE();
SET @tablename = 'finance_period_backfills';

SET @columnname = 'void_reason';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `void_reason` VARCHAR(300) DEFAULT NULL COMMENT ''作废/撤回原因（必填）：这张申请为什么不再执行'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'voided_by';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `voided_by` BIGINT UNSIGNED DEFAULT NULL COMMENT ''作废人（审批侧；待审批阶段为申请人本人撤回）'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'voided_by_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `voided_by_name` VARCHAR(50) DEFAULT NULL'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'voided_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `voided_at` DATETIME DEFAULT NULL'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- status 注释补上取值 4（仅当列已存在；不存在说明 260 未跑，不在这里代它建列）
SET @columnname = 'status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'ALTER TABLE `finance_period_backfills` MODIFY COLUMN `status` TINYINT NOT NULL DEFAULT 3 COMMENT ''0待审批 1已批准 2已驳回 3历史遗留（第一期同步补录，无审批环节，需人工核对） 4已作废（不执行、不动账，需重新申请）''',
  'SELECT 1'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;
