-- 单据编号前缀自定义（单号规则，见 codeGenerator.resolvePrefix）
-- 键名约定：code_prefix_<默认前缀小写>，值非空即覆盖默认前缀，留空回退默认。
-- 覆盖范围：所有走 generateDailyCode / generateMasterCode 的单据与主数据编码。
INSERT IGNORE INTO `sys_settings` (`key_name`, `value`, `label`, `type`, `remark`) VALUES
('code_prefix_so', 'SO', '销售单前缀', 'text', '销售单号前缀（默认 SO，如 SO20260822001）。留空恢复默认'),
('code_prefix_po', 'PO', '采购单前缀', 'text', '采购单号前缀（默认 PO，如 PO20260822001）。留空恢复默认'),
('code_prefix_wt', 'WT', '仓库任务前缀', 'text', '仓库任务单号前缀（默认 WT）。留空恢复默认'),
('code_prefix_it', 'IT', '收货订单前缀', 'text', '收货订单单号前缀（默认 IT）。留空恢复默认'),
('code_prefix_tr', 'TR', '调拨单前缀', 'text', '调拨单单号前缀（默认 TR）。留空恢复默认'),
('code_prefix_rt', 'RT', '退货任务前缀', 'text', '退货任务单号前缀（默认 RT）。留空恢复默认'),
('code_prefix_sc', 'SC', '盘点单前缀', 'text', '盘点单单号前缀（默认 SC）。留空恢复默认'),
('code_prefix_rf', 'RF', '退款单前缀', 'text', '退款单单号前缀（默认 RF）。留空恢复默认'),
('code_prefix_dp', 'DP', '呆滞处置单前缀', 'text', '呆滞处置单单号前缀（默认 DP）。留空恢复默认'),
('code_prefix_ex', 'EX', '费用报销单前缀', 'text', '费用报销单单号前缀（默认 EX）。留空恢复默认'),
('code_prefix_wb', 'WB', '物流运单前缀', 'text', '物流运单单号前缀（默认 WB）。留空恢复默认'),
('code_prefix_pay', 'PAY', '工资单前缀', 'text', '工资单单号前缀（默认 PAY）。留空恢复默认'),
('code_prefix_pr', 'PR', '采购请购单前缀', 'text', '采购请购单单号前缀（默认 PR）。留空恢复默认'),
('code_prefix_co', 'CO', '授信放行单前缀', 'text', '授信超额放行申请单号前缀（默认 CO）。留空恢复默认'),
('code_prefix_adj', 'ADJ', '销售改单前缀', 'text', '销售改单编号前缀（默认 ADJ）。留空恢复默认'),
('code_prefix_sp', 'SP', '供应商对账单前缀', 'text', '供应商汇总对账单号前缀（默认 SP）。留空恢复默认'),
('code_prefix_scstmt', 'SC', '客户对账单前缀', 'text', '客户汇总对账单号前缀（默认 SC）。留空恢复默认'),
('code_prefix_py', 'PY', '付款单前缀', 'text', '付款单（汇款）单号前缀（默认 PY）。留空恢复默认'),
('code_prefix_rc', 'RC', '收款单前缀', 'text', '收款单（汇款）单号前缀（默认 RC）。留空恢复默认'),
('code_prefix_fs', 'FS', '运费结算单前缀', 'text', '运费结算单号前缀（默认 FS）。留空恢复默认');
