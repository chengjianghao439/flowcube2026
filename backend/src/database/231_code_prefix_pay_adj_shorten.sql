-- 补剩余三位前缀改两位（code_prefix_* 统一两位英文；PAY=工资单、ADJ=销售改单）
-- 旧的 purchase_prefix/sale_prefix/stockcheck_prefix 业务已不用（codeGenerator 走 code_prefix_*），不动
UPDATE `sys_settings` SET `value`='PA' WHERE `key_name`='code_prefix_pay' AND `value`='PAY';
UPDATE `sys_settings` SET `value`='AD' WHERE `key_name`='code_prefix_adj' AND `value`='ADJ';
