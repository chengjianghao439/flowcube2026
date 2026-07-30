-- FlowCube ERP - Migration 163
-- 循环盘点 ABC 权限 seed（文档 08）。abc.view 复用 stockcheck.view 的角色（2仓库经理/3采购销售）；
-- abc.manage（重算ABC/维护频率规则）是配置类，给仓库经理(2)。超管 role_id=1 硬编码豁免恒有。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'stockcheck.abc.view'),
  (3, 'stockcheck.abc.view'),
  (2, 'stockcheck.abc.manage');
