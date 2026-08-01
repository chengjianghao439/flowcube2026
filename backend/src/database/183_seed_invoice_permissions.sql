-- FlowCube ERP - Migration 183
-- 发票权限 seed（文档 10 · Phase 3）。permissions.js / permission-codes.ts 注册 invoice.view/manage。
-- 进项/销项发票池 + 认证抵扣，敏感只授财务（role 4）。超管 role_id=1 硬编码豁免恒有。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (4, 'invoice.view'),
  (4, 'invoice.manage');
