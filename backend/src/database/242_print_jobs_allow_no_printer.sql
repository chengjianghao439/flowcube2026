-- 2026-09-14：没有可用打印机时也要留下打印记录。
--
-- 用户规则：「只要发出打印任务都要记录」——打印记录页只列有打印记录的对象，而收货等环节
-- 在没有可用打印机时原本会直接跳过入队（`if (!printerId) return null`），这些容器因此没有
-- 任何记录，事后既不会出现在打印记录页，也无处补打。
--
-- 现在允许 printer_id 为空：无打印机时落一条 status=3(失败)、error_message='no printer available'
-- 的记录，对象因此可见、可在绑定打印机后从打印记录页补打。物理打印路径不受影响——
-- 领取（claim-client）按 printer_id 过滤，NULL 行不会被任何客户端取走。
ALTER TABLE print_jobs MODIFY COLUMN printer_id BIGINT UNSIGNED NULL COMMENT '目标打印机（无可用打印机时为 NULL，仅作记录）';
