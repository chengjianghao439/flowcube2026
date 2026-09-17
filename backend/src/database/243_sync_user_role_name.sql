-- 回填 sys_users.role_name 冗余列（2026-09-17 验收修复）
--
-- 背景：sys_users.role_name 是登录态与界面展示用的冗余列——JWT 之后 currentAuthUser 读它，
-- 前端 UserMenu 也显示它。角色表 sys_roles.name 变动时冗余列不会自动跟随。
-- 实测（开发库）：34 个活跃用户中 29 个与 sys_roles.name 不一致，
-- 例如 admin 的冗余列是「管理员」而角色表是「系统管理员」，界面因此显示过期角色名。
--
-- 为什么回填后不会再漂移：角色没有改名接口（roles 只有 create/duplicate/delete/replacePermissions），
-- 用户新建与编辑都走 users.service.resolveRoleName(roleId) 从 sys_roles 服务端解析，
-- 不接受客户端传入的名称。
--
-- updated_at 显式赋自身，避免这次文案修正把「用户最后更新时间」全部刷成今天。
UPDATE sys_users u
JOIN sys_roles r ON r.id = u.role_id
SET u.role_name = r.name,
    u.updated_at = u.updated_at
WHERE u.role_name <> r.name;
