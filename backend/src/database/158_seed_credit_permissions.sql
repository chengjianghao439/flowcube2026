-- FlowCube ERP - Migration 158
-- 客户授信权限 seed（文档 05）。迁移 157 建额度列，permissions.js 注册 sale.credit.* 三个权限码。
--
-- 角色（066_seed_sys_roles）：2仓库经理 3采购与销售 4财务 5只读用户。授予口径：
--   view     : 2/3/4 —— 采购销售(3)看客户能不能赊、仓库经理(2)、财务(4)风控。
--   manage   : 4     —— 调整授信额度是财务风控职责（额度直接决定能赊多少钱）。
--   override : 3/4   —— 超额一次性放行：一线销售(3)现场放行 + 财务(4)。敏感动作，服务端校验权限。
-- 超管 role_id=1 硬编码豁免恒有全部权限。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'sale.credit.view'),
  (3, 'sale.credit.view'),
  (4, 'sale.credit.view'),
  (4, 'sale.credit.manage'),
  (3, 'sale.credit.override'),
  (4, 'sale.credit.override');
