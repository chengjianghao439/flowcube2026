-- FlowCube ERP - Migration 153
-- 采购请购权限 seed。迁移 152 建表并在 permissions.js 注册 purchase.requisition.* 四个权限码，
-- 本迁移把 view/create/convert 发给相应角色；approve 刻意留白（见下）。
--
-- 角色（066_seed_sys_roles）：2仓库经理 3采购与销售 4财务 5只读用户。
-- 授予口径参照 144(finance.expense.*) 与 071(purchase.order.*)：
--   view    : 2/3/5 —— 采购(3)本职、仓库经理(2)发起补货需求、只读(5)可查看。
--   create  : 2/3   —— 覆盖建单/改单/submit/withdraw/cancel 整条自助链路；一线补货(2)+采购(3)可发起。
--   convert : 3     —— 把请购变采购单是采购(3)本职（生成对外承诺，敏感）。
--
-- 刻意不 seed 的（由产品在权限管理页按人开放，超管 role_id=1 硬编码豁免恒有）：
--   approve : 一级审批是请购唯一内控点，服务层另有「审批人≠申请人」硬校验，敏感度等同
--             finance.expense.approve / payment.confirm，不随角色批量下发。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'purchase.requisition.view'),
  (3, 'purchase.requisition.view'),
  (5, 'purchase.requisition.view'),
  (2, 'purchase.requisition.create'),
  (3, 'purchase.requisition.create'),
  (3, 'purchase.requisition.convert');
