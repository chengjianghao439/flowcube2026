-- FlowCube ERP - Migration 178
-- 会计科目权限 seed（文档 10 · Phase 0）。permissions.js / permission-codes.ts 注册 accounting.account.* 两码。
-- 角色（066_seed_sys_roles）：2仓库经理 3采购与销售 4财务 5只读用户。会计核算属财务岗，授予口径：
--   accounting.account.view   : 4 —— 财务查看会计科目表。
--   accounting.account.manage : 4 —— 财务维护科目（新增/编辑/停用/删除非预置科目）。
-- 会计凭证是敏感数据（文档 10 · 8），不走「登录即可」例外，只授财务。超管 role_id=1 硬编码豁免恒有。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (4, 'accounting.account.view'),
  (4, 'accounting.account.manage');
