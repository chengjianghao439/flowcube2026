-- 设置项文案与真实前缀对齐（2026-09-17 验收修复）
--
-- 迁移 230 把单号前缀统一成两位英文（销售 SO→SL、采购 PO→PC、收货 IT→IN、调拨 TR→TF…）
-- 只改了 value，remark 里仍写着旧默认值与旧示例，设置页于是出现
-- 「销售单前缀 SL」+「默认 SO，如 SO20260822001」这种自相矛盾的展示。
-- 逐项改成「当前值 + 真实示例 + 留空回退的程序默认值」。
UPDATE `sys_settings` SET `remark`='销售单号前缀（当前 SL，如 SL20260917001）。留空回退程序默认 SO' WHERE `key_name`='code_prefix_so';
UPDATE `sys_settings` SET `remark`='采购单号前缀（当前 PC，如 PC20260917001）。留空回退程序默认 PO' WHERE `key_name`='code_prefix_po';
UPDATE `sys_settings` SET `remark`='收货订单单号前缀（当前 IN，如 IN20260917001）。留空回退程序默认 IT' WHERE `key_name`='code_prefix_it';
UPDATE `sys_settings` SET `remark`='调拨单单号前缀（当前 TF，如 TF20260917001）。留空回退程序默认 TR' WHERE `key_name`='code_prefix_tr';

-- 编号位数 code_digits 从未被 codeGenerator 读取（主数据编码固定 6 位、单据流水固定 3 位），
-- 开发库里该值曾被写成非数字（'FlowCube ERP'）。该键已从设置页隐藏，这里把脏值纠正为默认 4。
UPDATE `sys_settings` SET `value`='4' WHERE `key_name`='code_digits' AND `value` NOT REGEXP '^[0-9]+$';
