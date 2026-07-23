-- FlowCube ERP - Migration 112
-- 销售单执行期改单权限：授予仓库管理员角色（role_id=2），与 warehouse.task.cancel_return
-- 等既有仓库任务操作权限保持一致的授权口径（见 105_seed_cancel_return_permissions.sql）。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'warehouse.task.adjust'),
  (2, 'warehouse.task.adjust.view');
