-- 打印机来源：manual / client / local_desktop（历史 client 来自已移除的独立打印客户端；桌面端添加为 local_desktop）
-- 若库中已有 `source` 列，执行本文件会报错，请跳过或注释本 ALTER。
ALTER TABLE `printers`
  ADD COLUMN `source` VARCHAR(32) DEFAULT NULL COMMENT 'manual/client/local_desktop' AFTER `description`;
