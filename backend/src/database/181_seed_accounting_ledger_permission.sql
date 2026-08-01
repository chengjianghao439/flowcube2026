-- FlowCube ERP - Migration 181
-- 会计总账权限 seed（文档 10 · Phase 2）。permissions.js / permission-codes.ts 注册 accounting.ledger.view。
-- 总账/明细账/试算平衡/三大报表查看，只授财务（role 4）。超管 role_id=1 硬编码豁免恒有。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (4, 'accounting.ledger.view');
