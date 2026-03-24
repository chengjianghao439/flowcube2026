-- 033: 打印机管理 + 打印任务队列

-- 打印机表
CREATE TABLE IF NOT EXISTS `printers` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(100)    NOT NULL COMMENT '打印机名称',
  `code`         VARCHAR(50)     NOT NULL UNIQUE COMMENT '打印机编码（唯一标识）',
  `type`         TINYINT         NOT NULL DEFAULT 1 COMMENT '类型：1=标签 2=面单 3=A4',
  `description`  VARCHAR(200)    DEFAULT NULL,
  `status`       TINYINT         NOT NULL DEFAULT 1 COMMENT '1=在线 0=离线',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 打印任务队列表
CREATE TABLE IF NOT EXISTS `print_jobs` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `printer_id`     BIGINT UNSIGNED NOT NULL COMMENT '目标打印机',
  `template_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '打印模板（可选）',
  `title`          VARCHAR(200)    NOT NULL COMMENT '任务标题',
  `content_type`   VARCHAR(50)     NOT NULL DEFAULT 'html' COMMENT 'html/zpl/pdf',
  `content`        LONGTEXT        NOT NULL COMMENT '打印内容',
  `copies`         TINYINT         NOT NULL DEFAULT 1 COMMENT '份数',
  `status`         TINYINT         NOT NULL DEFAULT 0 COMMENT '0=待打印 1=打印中 2=已完成 3=失败',
  `retry_count`    TINYINT         NOT NULL DEFAULT 0,
  `error_message`  VARCHAR(500)    DEFAULT NULL,
  `created_by`     BIGINT UNSIGNED DEFAULT NULL,
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_printer_status` (`printer_id`, `status`),
  KEY `idx_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
