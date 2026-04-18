INSERT IGNORE INTO `sys_roles` (`id`, `code`, `name`, `remark`, `is_system`) VALUES
  (1, 'admin', '管理员', '系统管理员', 1),
  (2, 'warehouse_manager', '仓库管理员', '仓储主管', 1),
  (3, 'purchaser', '采购员', '采购业务', 1),
  (4, 'sales', '销售员', '销售业务', 1),
  (5, 'viewer', '只读用户', '只读访问', 1);

UPDATE `sys_users` u
LEFT JOIN `sys_roles` r ON r.id = u.role_id
SET u.role_name = COALESCE(r.name, u.role_name)
WHERE u.deleted_at IS NULL;
