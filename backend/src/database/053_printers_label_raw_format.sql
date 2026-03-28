-- 打印机 RAW 指令集：zpl（斑马等）/ tspl（通用 TSPL 标签机）
ALTER TABLE `printers`
  ADD COLUMN `label_raw_format` VARCHAR(16) NOT NULL DEFAULT 'zpl' COMMENT 'zpl|tspl' AFTER `type`;
