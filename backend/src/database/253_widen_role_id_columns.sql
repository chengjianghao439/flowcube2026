-- 角色 ID 列容量对齐（2026-09-18）
--
-- 问题：`sys_roles.id` 是 BIGINT UNSIGNED，但 `sys_users.role_id` 与
-- `sys_role_permissions.role_id` 是 TINYINT UNSIGNED（上限 255），而且**没有外键**——
-- 因此角色数超过 255 时不会提前报错，而是在「把用户挂到新角色」或「给新角色分配权限」时
-- 抛 `ER_WARN_DATA_OUT_OF_RANGE: Out of range value for column 'role_id'`。
--
-- 已实际咬人：本机测试库的 `sys_roles.AUTO_INCREMENT` 被 round2-transfer 累积的
-- `R2FT*` 角色顶到 257 后，该套件的 fixture 阶段直接失败（15/15 not ok），
-- 表现得像一次代码回归；生产角色数远小于 255 尚未触发，但属同一类「等有数据才炸」的缺陷。
--
-- 处置：把两列与 `sys_roles.id` 对齐为 BIGINT UNSIGNED。两张表都很小
-- （sys_users 数十行、sys_role_permissions 数百行），DDL 瞬时完成；无外键需要先删除。
-- 本迁移是幂等的（重复执行只在类型已一致时做无操作重建）。

ALTER TABLE `sys_users`
  MODIFY COLUMN `role_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '角色 ID（1=管理员 2=普通用户）';

ALTER TABLE `sys_role_permissions`
  MODIFY COLUMN `role_id` BIGINT UNSIGNED NOT NULL COMMENT '角色 ID，对应 sys_users.role_id';
