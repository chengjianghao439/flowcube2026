-- 统一 printers.source 列定义，消除新旧库 schema 漂移。
--
-- 052 建列时声明为 `VARCHAR(32) DEFAULT NULL`（可空），但历史库经早期 migrate.js 运行时补丁
-- 收口成了 `VARCHAR(20) NOT NULL DEFAULT 'manual'`；那些运行时补丁后来已整体退场，
-- 于是全新库与既有库在这一列上行为不同：
--   既有库：service 传 NULL → 违反 NOT NULL → 创建打印机 500（桌面端「从本机添加」直接不可用）
--   全新库：同样的调用却能成功
-- 以更严格的既有库形态为准（来源始终已知），让两边一致。代码侧已同步兜底为 'manual'。
UPDATE `printers` SET `source` = 'manual' WHERE `source` IS NULL OR TRIM(`source`) = '';

ALTER TABLE `printers`
  MODIFY COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'manual' COMMENT 'manual/client/local_desktop';
