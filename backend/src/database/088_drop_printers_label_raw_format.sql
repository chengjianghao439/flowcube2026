-- 移除 printers.label_raw_format 字段：系统统一使用 ZPL，不再需要区分 TSPL
ALTER TABLE `printers` DROP COLUMN IF EXISTS `label_raw_format`;
