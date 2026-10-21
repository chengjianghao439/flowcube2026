# 正式岗位补丁的只读核对资料

附件要求在编写正式角色补丁前核对运维导出的正式角色与权限，并以认可的改前改后表为准。现有附件 `role-diff.json` 是测试库差量，不能替代此资料。本批未连接生产、未编写基于猜测的角色迁移，也未修改已执行的295。

运维可在其已认证的正式库会话中导出以下元数据；只包含角色和权限，不需要账号密码、用户列表、客户或账款数据。以下全部为只读SELECT；本任务未代为执行。

```sql
SELECT DATABASE() AS database_name, NOW() AS exported_at, @@version AS mysql_version;

SELECT id, code, name, remark, is_system
FROM sys_roles
ORDER BY id;

SELECT r.id AS role_id, r.code AS role_code, r.name AS role_name, p.permission
FROM sys_roles r
LEFT JOIN sys_role_permissions p ON p.role_id = r.id
ORDER BY r.id, BINARY p.permission;

SELECT revision_key, role_code, role_id, outcome, before_count, after_count, reason, recorded_at
FROM sys_role_default_revisions
WHERE revision_key = '20261019_minimum_duties_v1'
ORDER BY role_code, role_id;
```

收到导出后，逐角色列出原始完整权限、拟撤销、拟增加、保留项和最终完整权限，核对仓库岗位实际代码、只读实际名称、销售实际49项与已应用岗位状态。不能把“不像默认角色”静默跳过，也不能将所有49项重置成测试库30项。

目标差量参考现有 [默认岗位说明](role-defaults-approval-2026-10-19.md)，实际执行清单须按正式导出核准。超出已认可差量的销售报表、客户归属或财务查看范围另列出来，不由补丁猜测业务政策。

新补丁必须使用当前最大编号+1、精确身份和完整前置权限集合、角色行锁、原子差量及可核对修订回执；角色缺失/多重匹配/权限漂移明确失败。已应用后重跑应无变化，但人工后改不能被重复覆盖。先在专属测试库覆盖真实元数据形状、未知角色、集合漂移、事务失败与重放，再进入人工认可和发布环节。本任务不直接执行正式补丁。
