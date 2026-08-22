-- 217_inbound_task_status_index.sql
-- 索引补充（2026-08-22 逐项核实后落地）：
--  1. inbound_tasks 补 (status, created_at) 索引：收货列表按状态+时间排序此前全表扫。
--  2. （核实无改动）inbound_tasks.audit_status 是「结算状态」仍在用（settle/payment/purchase
--     多处依赖），audit_remark/audited_at/audited_by/audited_by_name 是人工审核遗留——
--     但 audited_at/audited_by 等仍被 putaway 自动结算写入（系统自动结算留痕）、helpers 读取、
--     void 重置，属活字段而非死字段，本次不删。inventory_logs.change_qty 列已不存在（089
--     注释文本声称存在但实际列已随其他迁移删除）；全库 TIMESTAMP 列已无。

ALTER TABLE `inbound_tasks`
  ADD KEY `idx_inbound_status_created` (`status`, `created_at`);
