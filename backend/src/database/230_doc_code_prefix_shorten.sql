-- 单据/编号前缀统一为两位英文（业务单号/编号生成的默认前缀；历史单据不变，只影响新生成）
-- 单据：销售 SO→SL、采购 PO→PC、收货 IT→IN、调拨 TR→TF（仓库任务 WT 已是两位，保持）
-- 编号：客户 CUS-→CU、供应商 SUP-→SU、商品 PRD-→PR
UPDATE `sys_settings` SET `value`='SL' WHERE `key_name`='code_prefix_so' AND `value`='SO';
UPDATE `sys_settings` SET `value`='PC' WHERE `key_name`='code_prefix_po' AND `value`='PO';
UPDATE `sys_settings` SET `value`='IN' WHERE `key_name`='code_prefix_it' AND `value`='IT';
UPDATE `sys_settings` SET `value`='TF' WHERE `key_name`='code_prefix_tr' AND `value`='TR';
UPDATE `sys_settings` SET `value`='CU' WHERE `key_name`='code_prefix_customer' AND `value`='CUS-';
UPDATE `sys_settings` SET `value`='SU' WHERE `key_name`='code_prefix_supplier' AND `value`='SUP-';
UPDATE `sys_settings` SET `value`='PR' WHERE `key_name`='code_prefix_product' AND `value`='PRD-';
