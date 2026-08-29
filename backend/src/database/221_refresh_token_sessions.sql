-- FlowCube ERP - Migration 221
-- refresh token 一次性轮换：为每个 refresh token 落一条会话记录（jti），刷新时作废旧 jti、
-- 签发新 jti，实现「被泄露的 refresh 重放即被拒」，同时不互踢多端（每端独立 jti）。
--
-- 背景：此前 refresh token 只做「签发新 token + token_version 校验」，旧 refresh 在其
-- 有效期内仍可反复续期（见 CLAUDE.md 第 20 节第 48 条 P1-1）。token_version 是 sys_users
-- 全局单值、三端（ERP 桌面端/PDA/浏览器）共享同一账号，若靠递增它作废会互踢多端。
-- 因此引入 per-session 的 jti 会话表：每个 refresh 一个独立 jti，作废只影响该 jti。

CREATE TABLE IF NOT EXISTS `refresh_token_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `jti` CHAR(36) NOT NULL COMMENT 'refresh token 的 jti（crypto.randomUUID），与 JWT payload.jti 对应',
  `user_id` BIGINT UNSIGNED NOT NULL,
  `expires_at` DATETIME NOT NULL COMMENT 'refresh token 过期时刻（与 JWT exp 对齐）',
  `revoked_at` DATETIME DEFAULT NULL COMMENT '作废时刻；非空 = 已作废（一次性轮换 / 登出 / 改密码）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_refresh_token_sessions_jti` (`jti`),
  KEY `idx_refresh_token_sessions_user` (`user_id`),
  KEY `idx_refresh_token_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='refresh token 会话（jti 一次性轮换）';
