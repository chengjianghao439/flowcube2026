-- FlowCube ERP - Migration 142
-- 资金账户权限 seed。
--
-- 授予口径参照现有 payment.* 的分布：
--   只读查看(5) 只给查看权；
--   仓库管理员(2) 与销售员(4) 已有 payment.execute（能登记收付款），
--   收付款时要选账户，因此必须能看到账户列表，给 view。
--   建档/改档/删档留给超管（role_id=1 硬编码豁免全部权限）。
--
-- finance.account.adjust 刻意不 seed 给任何角色：它能凭空补一笔差额流水改变账面资金，
-- 敏感度等同 payment.confirm，由产品在权限管理页手动开放给财务角色
-- （与 payment.confirm、transfer.order.force-close 同先例）。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'finance.account.view'),
  (4, 'finance.account.view'),
  (5, 'finance.account.view');
