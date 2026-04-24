INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'system.health.view'),
  (2, 'system.health.autofix'),
  (2, 'warehouse.task.sort'),
  (2, 'warehouse.task.check_done'),
  (2, 'warehouse.task.pack_done'),
  (2, 'warehouse.task.cancel'),
  (2, 'warehouse.task.priority'),
  (2, 'print.client.consume'),
  (3, 'print.client.consume');
