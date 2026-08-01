-- FlowCube ERP - Migration 180
-- 会计凭证权限 seed（文档 10 · Phase 1）。permissions.js / permission-codes.ts 注册 accounting.voucher.* 三码。
-- 角色（066_seed_sys_roles）：4财务。会计凭证敏感，只授财务：
--   accounting.voucher.view   : 4 —— 财务查看记账凭证。
--   accounting.voucher.manage : 4 —— 财务生成本期凭证 / 手工凭证 / 冲销。
--   accounting.voucher.export : 4 —— 财务导出凭证对接金蝶/用友。
-- 超管 role_id=1 硬编码豁免恒有。

INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (4, 'accounting.voucher.view'),
  (4, 'accounting.voucher.manage'),
  (4, 'accounting.voucher.export');
