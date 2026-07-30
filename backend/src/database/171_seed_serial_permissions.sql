-- FlowCube ERP - Migration 171
-- 序列号权限 seed（文档 04 · 8）。permissions.js / permission-codes.ts 注册 serial.* 两个权限码。
--
-- 角色（066_seed_sys_roles）：2仓库经理 3采购与销售 4财务 5只读用户。授予口径：
--   serial.view   : 2/3 —— 仓库经理看在库序列号台账、采购销售查客户设备归属/追溯。
--   serial.manage : 2   —— 一致性对账/修复类接口（配置类，给仓库经理）。
-- 逐台扫码（收货/上架/出库）不新增权限码，复用各自作业已有权限。超管 role_id=1 硬编码豁免恒有全部权限。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'serial.view'),
  (3, 'serial.view'),
  (2, 'serial.manage');
