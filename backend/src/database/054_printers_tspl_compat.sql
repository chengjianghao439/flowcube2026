-- 每台打印机的 TSPL 兼容参数，避免依赖整机环境变量
ALTER TABLE `printers`
  ADD COLUMN `tspl_wire_encoding` VARCHAR(16) NOT NULL DEFAULT 'auto' COMMENT 'auto|utf8|gb18030' AFTER `label_raw_format`,
  ADD COLUMN `tspl_line_ending` VARCHAR(16) NOT NULL DEFAULT 'auto' COMMENT 'auto|native|crlf' AFTER `tspl_wire_encoding`,
  ADD COLUMN `tspl_codepage_policy` VARCHAR(16) NOT NULL DEFAULT 'auto' COMMENT 'auto|keep|omit' AFTER `tspl_line_ending`;
