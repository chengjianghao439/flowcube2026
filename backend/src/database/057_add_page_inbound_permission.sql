-- 收货订单页面权限（与前端 page:inbound 一致；权限管理页保存角色时也可勾选）
INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'page:inbound'),
  (3, 'page:inbound'),
  (5, 'page:inbound');
