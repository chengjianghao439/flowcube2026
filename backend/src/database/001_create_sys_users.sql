-- FlowCube ERP - Migration 001
-- 系统用户表

CREATE TABLE IF NOT EXISTS `sys_users` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`   VARCHAR(50)     NOT NULL COMMENT '登录账号',
  `password`   VARCHAR(255)    NOT NULL COMMENT 'bcrypt 哈希密码',
  `real_name`  VARCHAR(50)     NOT NULL COMMENT '真实姓名',
  `role_id`    TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '角色 ID（1=管理员 2=普通用户）',
  `role_name`  VARCHAR(30)     NOT NULL DEFAULT '普通用户' COMMENT '角色名称冗余',
  `is_active`  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '是否启用',
  `avatar`     VARCHAR(255)    DEFAULT NULL COMMENT '头像 URL',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME        DEFAULT NULL,
  `active_unique_guard` TINYINT GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN 1 ELSE NULL END) STORED COMMENT '活跃唯一性保护列：活跃=1，删除=NULL',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_users_username_active` (`username`, `active_unique_guard`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统用户表';

-- 初始管理员账号默认禁用，需通过 `backend/scripts/bootstrap-admin.js` 显式设置密码后再启用
INSERT INTO `sys_users` (`username`, `password`, `real_name`, `role_id`, `role_name`, `is_active`)
VALUES (
  'admin',
  '$2a$10$xxWx1WU1/mY7E.xrzJQMheHwhI58DQWvu4oj0v71V0k4VRJUWtjTi',
  '系统管理员',
  1,
  '管理员',
  0
);
