-- 048：多租户数据维护说明（无强制 UPDATE，执行等价于占位校验）
-- 047 已为存量行写入 tenant_id 默认值 0（共享/单租户）。
-- 需要按公司/仓划租户时，在业务低峰期自行执行（示例，请按实际 ID 修改）：
--
-- UPDATE sys_users SET tenant_id = 1001 WHERE username IN ('warehouse_a', 'print_station');
-- UPDATE printers SET tenant_id = 1001 WHERE id IN (1, 2);
--
-- 与业务 company_id 对齐时，若表上已有 company_id 列，可改为：
-- UPDATE sys_users u SET u.tenant_id = u.company_id WHERE u.company_id IS NOT NULL AND u.company_id > 0;

SELECT 1 AS migration_048_ok;
