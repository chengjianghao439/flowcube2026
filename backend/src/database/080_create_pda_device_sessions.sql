-- 080: PDA device session foundation
-- 第一阶段仅新增能力与可观测性，不改变现有 PDA 作业鉴权链。

CREATE TABLE IF NOT EXISTS pda_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_code VARCHAR(64) NOT NULL COMMENT 'PDA 设备编号，现场唯一',
  device_name VARCHAR(128) NULL COMMENT '设备名称',
  warehouse_id BIGINT UNSIGNED NULL COMMENT '绑定仓库，可为空',
  status ENUM('active','disabled','retired') NOT NULL DEFAULT 'active' COMMENT '设备状态',
  secret_hash VARCHAR(255) NOT NULL COMMENT '设备密钥 hash，不存明文',
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pda_devices_device_code (device_code),
  KEY idx_pda_devices_status (status),
  KEY idx_pda_devices_warehouse (warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pda_device_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  session_token_hash CHAR(64) NOT NULL COMMENT 'sha256(session_token)，明文只返回一次',
  scopes JSON NOT NULL COMMENT 'PDA 会话 scope 列表',
  warehouse_id BIGINT UNSIGNED NULL COMMENT '会话继承设备绑定仓库',
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pda_sessions_token_hash (session_token_hash),
  KEY idx_pda_sessions_device_active (device_id, revoked_at, expires_at),
  KEY idx_pda_sessions_user_active (user_id, revoked_at, expires_at),
  KEY idx_pda_sessions_warehouse (warehouse_id),
  CONSTRAINT fk_pda_sessions_device
    FOREIGN KEY (device_id) REFERENCES pda_devices(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
