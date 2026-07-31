-- FlowCube ERP - Migration 174
-- 采购计划权限 seed（文档 11 · 8）。permissions.js / permission-codes.ts 注册 procurement.plan.* 两码。
-- 角色（066_seed_sys_roles）：2仓库经理 3采购与销售 4财务 5只读用户。授予口径：
--   procurement.plan.view   : 2/3 —— 仓库经理与采购员查看采购计划。
--   procurement.plan.manage : 3   —— 采购员生成计划、编辑建议、忽略行、转采购。
-- 转采购动作本身复用采购创建权限 purchase.order.create（角色 3 已持有）。超管 role_id=1 硬编码豁免。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'procurement.plan.view'),
  (3, 'procurement.plan.view'),
  (3, 'procurement.plan.manage');
