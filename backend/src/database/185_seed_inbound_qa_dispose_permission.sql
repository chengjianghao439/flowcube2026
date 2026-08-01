-- FlowCube ERP - Migration 185
-- 来料质检拒收处置权限 seed（文档 07 · Phase 2）。permissions.js / permission-codes.ts 注册 inbound.qa.dispose。
-- 处置（退供应商/报废）是后台管理决策（决定拒收品去向），非 PDA 现场扫码作业，故走 ERP 侧权限。
-- 授予：仓库管理员(role 2，管物理仓与质量) + 采购员(role 3，对接供应商索赔)。超管 role_id=1 硬编码豁免恒有。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'inbound.qa.dispose'),
  (3, 'inbound.qa.dispose');
