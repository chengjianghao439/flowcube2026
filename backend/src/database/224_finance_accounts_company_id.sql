-- FlowCube ERP - Migration 224
-- finance_accounts / finance_account_transactions 添加 company_id（审计 2026-08-31）
--
-- 背景：
-- - 勾稽对账 reconciliation() 中，fundT（资金流水）无法按账套过滤，
--   因为 finance_account_transactions 没有 company_id。
-- - 多账套场景下，不同账套的资金账户需要隔离。
--
-- 设计：
-- - finance_accounts.company_id：账户所属账套
-- - finance_account_transactions 通过 account_id JOIN 继承账套
-- - 迁移前：所有账户和流水 company_id=1（主账套）
-- - payment_records 保持公司级（不添加 company_id）：账款记录是往来口径，
--   按供应商/客户维度共享，多账套下账款不拆分

-- 1. finance_accounts 添加 company_id
ALTER TABLE `finance_accounts`
  ADD COLUMN `company_id` BIGINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '所属账套（多账套：不同账套的资金账户隔离）'
    AFTER `id`;

ALTER TABLE `finance_accounts`
  DROP INDEX `uk_finance_accounts_code`,
  ADD UNIQUE KEY `uk_finance_accounts_code_company` (`company_id`, `code`);

-- 2. 给现有账户设置 company_id=1（主账套）
-- 不需要 UPDATE，因为 DEFAULT 就是 1

-- 3. 更新 data integrity patch（222）中的检查
-- 如果未来需要按账套过滤资金流水，可通过 JOIN finance_accounts 实现：
-- WHERE fa.company_id = ?
