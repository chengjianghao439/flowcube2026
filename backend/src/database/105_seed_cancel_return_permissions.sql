-- FlowCube ERP - Migration 105
-- 销售单取消逆向归还流程权限：授予仓库管理员角色（role_id=2），与 warehouse.task.cancel
-- 等既有仓库任务操作权限保持一致的授权口径（见 071_seed_role_permissions_v2.sql）。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'warehouse.task.cancel_return'),
  (2, 'warehouse.task.cancel_return.view');
