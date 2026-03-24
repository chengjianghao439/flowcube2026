-- 035: 打印客户端持久化表

CREATE TABLE IF NOT EXISTS `print_clients` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id`   VARCHAR(200)    NOT NULL COMMENT '客户端唯一ID（hostname-printerCode）',
  `hostname`    VARCHAR(200)    NOT NULL COMMENT '机器名称',
  `ip_address`  VARCHAR(50)     DEFAULT NULL COMMENT '客户端IP',
  `last_seen`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后心跳时间',
  `status`      TINYINT         NOT NULL DEFAULT 1 COMMENT '1=在线 0=离线',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_client_id` (`client_id`),
  KEY `idx_status_last_seen` (`status`, `last_seen`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
