-- 211_perf_indexes.sql
-- 性能索引组（2026-08-22 性能扫描修复）：
--  1. print_jobs ref 索引：059 建的 idx_print_jobs_ref_lookup/idx_print_jobs_ref_code 含 tenant_id，
--     068 删 tenant_id 时被 MySQL 连带删除；此后已重建（当前存在 lookup/ref_code 二键），
--     但缺 (ref_type, ref_id) 的按键索引——补 idx_print_jobs_ref_id。
--  2. operation_requests.created_at：TTL 清理每 6 小时按 created_at < NOW()-7d DELETE，
--     现有 (user_id, action, created_at) 首列是 user_id，7 天窗口的 DELETE 无法走索引 → 全表扫。
--  3. sale_orders(sale_date,status)：KPI 报表 WHERE status=4 AND sale_date BETWEEN，此前无索引全表扫。
--  4. scan_logs(operator_id, scanned_at)：PDA 绩效报表按 operator 分组 + DATE(scanned_at) 过滤。
--  5. inventory_checks(status, created_at)：PDA 工作台 30s 轮询按 status=1 计数，此前全表扫。
--  6. payment_records(type,status,due_date)：对账页 overdue 过滤补全索引（原 (type,status) 前缀可用）。

-- 1. print_jobs ref_id 索引（ref_code/ref_lookup 已存在，仅补缺的 ref_id）
ALTER TABLE `print_jobs`
  ADD KEY `idx_print_jobs_ref_id` (`ref_type`, `ref_id`);

-- 2. operation_requests TTL 清理索引
ALTER TABLE `operation_requests`
  ADD KEY `idx_operation_requests_created_at` (`created_at`);

-- 3. sale_orders 报表日期索引
ALTER TABLE `sale_orders`
  ADD KEY `idx_so_sale_date` (`sale_date`, `status`);

-- 4. scan_logs PDA 绩效索引
ALTER TABLE `scan_logs`
  ADD KEY `idx_scan_operator_time` (`operator_id`, `scanned_at`);

-- 5. inventory_checks 待办轮询索引
ALTER TABLE `inventory_checks`
  ADD KEY `idx_ic_status_created` (`status`, `created_at`);

-- 6. payment_records 对账逾期过滤索引
ALTER TABLE `payment_records`
  ADD KEY `idx_payment_records_type_status_due` (`type`, `status`, `due_date`);
