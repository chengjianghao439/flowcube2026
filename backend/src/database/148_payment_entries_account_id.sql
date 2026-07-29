-- FlowCube ERP - Migration 148
-- 「按单登记」付款/收款补资金账户联动：payment_entries 增 account_id（可空）。
--
-- 背景：/payments/:id/pay(recordPayment) 此前只写 payment_records + payment_entries，
-- 完全不写 finance_account_transactions，导致按单登记的收付款不进资金账户流水、账户
-- current_balance 静默少记；而同页「核销」tab 走 receipts 路径是记账户的，同一笔现结
-- 收/付款走哪个 tab 决定账户准不准（深扫 2026-07-29 财务 P1）。
-- 本迁移给 entry 留存所用资金账户，历史 entry 无此信息故可空；recordPayment 同事务调
-- accountSvc.recordTransaction 写流水（与 receipts 路径对称）。不加外键：与 payment_receipts
-- .account_id 一致，账户走 deleted_at 逻辑删除，硬外键会在停用/删除账户时误伤历史分录。
ALTER TABLE payment_entries
  ADD COLUMN account_id BIGINT UNSIGNED NULL COMMENT '收/付款所用资金账户 finance_accounts.id，历史登记为空' AFTER method,
  ADD KEY idx_payment_entries_account_id (account_id);
