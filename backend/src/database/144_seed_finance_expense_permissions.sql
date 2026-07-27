-- FlowCube ERP - Migration 144
-- 日常费用报销权限 seed。
--
-- 迁移 143 建了 expense_categories / expense_claims / expense_claim_items 并注册了
-- finance.expense.* 六个权限码，但没有任何 seed，导致除超管(role_id=1 硬编码豁免)外
-- 所有角色连 finance.expense.view 都没有——「费用报销」「费用类别」两个菜单
-- (routeRegistry 里都挂 FINANCE_EXPENSE_VIEW) 对全部业务角色不可见。本迁移补齐。
--
-- 授予口径参照 142(finance.account.*) 与 071(payment.*) 的分布：
--   view   : 2/3/4/5 全给。报销是全员级日常事务，只读用户(5)已有 payment.view，
--            同口径给查看权；view 同时覆盖 GET /expense-categories(报销单选类别要用)。
--   create : 2/3/4 给。该权限覆盖建单/改单/submit/withdraw/cancel，即「提自己的报销单」
--            这一整条自助链路；只读用户(5)不给，保持其只读语义。
--   update : 2/3/4 给，与 create 同角色集——能提单就得能改自己的草稿。
--
-- 刻意不 seed 的三个（保持现状，由产品在权限管理页按人开放）：
--   approve : 一级审批是报销唯一的内控点（服务层另有「不能审批自己提交的单」硬校验），
--             敏感度等同 payment.confirm，不随角色批量下发。
--   pay     : 付款出账，等同 payment.execute 之于往来账，且会写资金账户流水。
--   category.manage : 费用类别属主数据建档，与 142「建档/改档/删档留给超管」同口径。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (2, 'finance.expense.view'),
  (3, 'finance.expense.view'),
  (4, 'finance.expense.view'),
  (5, 'finance.expense.view'),
  (2, 'finance.expense.create'),
  (3, 'finance.expense.create'),
  (4, 'finance.expense.create'),
  (2, 'finance.expense.update'),
  (3, 'finance.expense.update'),
  (4, 'finance.expense.update');
