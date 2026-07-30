-- FlowCube ERP - Migration 154
-- 采购收货质检开关（文档 07 · 第一步安全增量）。给商品与供应商各加一个来料质检开关。
--
-- 背景：采购收货目前无任何质量检验环节，货一收进来扫码上架就成可售正式库存、并结算进应付，
-- 破损/错版/过期的来料无处拦截（钱照付货照卖）。本功能给收货补"先检后入"的闸门。
-- 本迁移只加开关列（默认关），不改任何流程——存量商品/供应商行为完全不变，功能纯增量、可灰度。
--
-- 取值规则（收货建单时按此求值一次、固化到 inbound_task_items.qa_required 快照，见迁移 155）：
--   需质检 = (supplier.qa_policy = 1)                                   -- 供应商强制质检，最高优先
--         OR (supplier.qa_policy <> 2 AND product.qa_required = 1)       -- 免检供应商(2)直接跳过
-- 即"供应商优先、商品兜底"：同一商品 A 供应商免检、B 供应商要检，符合采购现实。
-- 快照语义同 payment_records.settlement_type / cost_snapshot：在途单据按建单当时的配置决定，
-- 之后改开关不追溯已建单据（CLAUDE.md 第 7.1 节）。

ALTER TABLE `product_items`
  ADD COLUMN `qa_required` TINYINT NOT NULL DEFAULT 0
  COMMENT '1=采购收货需先质检（PENDING_QA）合格才可上架；默认0=免检走原路径' AFTER `batch_managed`;

ALTER TABLE `supply_suppliers`
  ADD COLUMN `qa_policy` TINYINT NOT NULL DEFAULT 0
  COMMENT '来料质检策略：0=按商品qa_required决定 1=该供应商强制质检 2=该供应商免检' AFTER `is_active`;
