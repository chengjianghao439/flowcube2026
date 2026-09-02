-- 清理死权限：后端代码无任何接口引用的权限码，从角色权限授予记录中移除
-- 对应权限码已同步从 backend/src/constants/permissions.js 与 frontend/src/lib/permission-codes.ts 删除
-- （system.health.view / system.health.autofix 无系统自检功能；sale.credit.manage 授信已改走超额放行审批流）
DELETE FROM `sys_role_permissions` WHERE `permission` IN ('system.health.view','system.health.autofix','sale.credit.manage');
