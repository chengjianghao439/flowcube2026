-- 打印工作站权限：桌面打印客户端登录账号所属角色需包含 print:client（或由超级管理员 role_id=1 绕过校验）
-- 若库中尚无权限表，本文件会先建表再种入权限

CREATE TABLE IF NOT EXISTS `sys_role_permissions` (
  `role_id`    TINYINT UNSIGNED NOT NULL COMMENT '角色 ID，对应 sys_users.role_id',
  `permission` VARCHAR(100)     NOT NULL COMMENT '权限码，如 print:client',
  PRIMARY KEY (`role_id`, `permission`),
  KEY `idx_sys_role_permissions_perm` (`permission`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色-权限';

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (1, 'print:client');
