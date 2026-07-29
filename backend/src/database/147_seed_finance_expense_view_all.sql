-- FlowCube ERP - Migration 147
-- 费用报销可见范围收紧：新增 finance.expense.view.all 权限码 seed。
--
-- 背景：此前 expense-claims.findAll 无申请人过滤，凡有 finance.expense.view 的角色
-- （迁移 144 给了 2/3/4/5）都能看到全部人的报销单。业务决策(2026-07-29)：列表收紧到
-- 「只看自己」——仅拥有 finance.expense.view.all 者可见全部；超管(role_id=1)走 roleId
-- 豁免恒可见。controller 对无此权限者强制按当前登录用户覆盖 applicant_id（不信前端传值，
-- 否则普通用户传别人的 id 即可越权查看）。
--
-- seed 口径（与 144 对 approve/pay 的处理一致——敏感/管理性权限不批量下发给业务角色，
-- 收紧本意就是默认只看自己）：
--   * 不给业务角色 2/3/4/5 批量下发 → 上线后它们自动收敛为只看自己；
--   * 唯一 seed 规则「能审批报销的角色，理应能看到全部报销单」：给已持
--     finance.expense.approve 的角色补 view.all。当前生产业务角色(2/3/4/5)均无 approve，
--     故一律收敛为只看自己；将来产品在权限管理页给某角色开 approve 时，可一并开 view.all。
--   * 需要「看全部报销」的财务主管由产品在权限管理页按人开放。
INSERT IGNORE INTO sys_role_permissions (role_id, permission)
SELECT DISTINCT role_id, 'finance.expense.view.all'
  FROM sys_role_permissions
 WHERE permission = 'finance.expense.approve';
