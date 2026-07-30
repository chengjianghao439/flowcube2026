-- FlowCube ERP - Migration 167
-- 物流运单权限 seed（文档 06）。permissions.js / permission-codes.ts 注册 logistics.* 三个权限码。
--
-- 角色（066_seed_sys_roles）：2仓库经理 3采购与销售 4财务 5只读用户。授予口径：
--   logistics.view              : 2/3/4 —— 仓库经理看发货运单、采购销售看客户物流轨迹、财务对账前置查看。
--   logistics.manage            : 2/3   —— 手工录单号/重试取号/作废运单，属发货运营职责（仓库经理+销售）。
--   logistics.freight.reconcile : 4     —— 运费对账、生成承运商应付，直接产生应付=钱，财务专属。
-- 超管 role_id=1 硬编码豁免恒有全部权限。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'logistics.view'),
  (3, 'logistics.view'),
  (4, 'logistics.view'),
  (2, 'logistics.manage'),
  (3, 'logistics.manage'),
  (4, 'logistics.freight.reconcile');
