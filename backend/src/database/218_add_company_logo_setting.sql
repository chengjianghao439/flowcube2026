-- 公司 Logo 设置（系统品牌位：ERP 顶栏/登录页、PDA 登录页/首页）
--
-- 存储设计：Logo 以 data URL（base64）存进 sys_settings.value，零部署改动、
-- 管理面（备份/恢复）天然覆盖。原列 VARCHAR(200)（TEXT）容不下 base64，
-- 需扩为 MEDIUMTEXT（16MB，cover 2MB 文件 → ≈2.8MB base64 + data URL 前缀）。
-- 只改本表列定义，不动数据；沿用 103 的 information_schema 判断 + 动态执行范式，幂等安全。
-- ⚠ 备注：本机库此列实测为 TEXT（64KB，与 011 建表文本的 VARCHAR(200) 漂移，见 CLAUDE.md 第 20 节第 8 条），
--   判断条件按「非 MEDIUMTEXT 就 ALTER」覆盖两种现状；TEXT 存不下 2MB logo，必须先扩列。
--   保留 NULL 可空（本机现状即 NULL），业务侧统一 `?? ''` 兜底。
--
-- 配套键：
--   company_logo            data URL（data:image/png;base64,...），空串 = 未上传
--   company_logo_updated_at 上传时间串（YYYYMMDDHHMMSS），前端拼进图片 URL 的 v= 参数破缓存

SET @col_ok := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_settings' AND COLUMN_NAME = 'value'
    AND DATA_TYPE = 'mediumtext'
);
SET @ddl := IF(@col_ok = 0,
  'ALTER TABLE `sys_settings` MODIFY COLUMN `value` MEDIUMTEXT NULL',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO `sys_settings` (`key_name`, `value`, `label`, `type`, `remark`) VALUES
('company_logo', '', '公司 Logo', 'image', '系统品牌位显示的 Logo（ERP 顶栏/登录页、PDA 登录页/首页）；在系统设置页上传，支持 PNG/JPEG/WebP/SVG，≤2MB'),
('company_logo_updated_at', '', 'Logo 更新时间', 'timestamp', 'Logo 上传时间（YYYYMMDDHHMMSS），用于图片 URL 缓存失效，请勿手工修改');
