-- FlowCube ERP - Migration 223
-- fin_invoices 表添加 company_id 字段（审计 2026-08-31）
--
-- 背景：报税时 loadTaxMaps 按发票汇总税额，但 fin_invoices 表原本没有 company_id，
-- 多账套场景下进项/销项税额会跨账套汇总，导致报税数据错误。
--
-- 本迁移：为 fin_invoices 添加 company_id 字段，并更新已有的凭证生成查询。
-- 注意：迁移前的老发票 company_id 为 NULL，表示"公司级"，所有账套共享这些发票。
-- 这是「发票弱关联业务单」设计决定的——发票先到、归属后定。

-- 1. 添加 company_id 字段（默认 NULL 表示公司级共享发票）
ALTER TABLE `fin_invoices`
  ADD COLUMN `company_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '所属账套；NULL=公司级共享发票（如采购先收票后才知道给哪个账套）'
    AFTER `tax_amount`;

-- 2. 为 company_id 添加索引（查询过滤需要）
ALTER TABLE `fin_invoices`
  ADD KEY `idx_fin_invoices_company` (`company_id`);

-- 3. 为已有发票设置默认值（NULL = 公司级共享）
-- 不更新任何数据，只确保 company_id 有明确语义
