-- 最终库存闭环：历史标记、待上架截止时间/超时、入库任务乐观锁

ALTER TABLE inventory_containers
  ADD COLUMN is_legacy TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=历史不合规/无完整来源' AFTER putaway_flagged_overdue,
  ADD COLUMN putaway_deadline_at DATETIME NULL COMMENT '待上架截止时间' AFTER is_legacy,
  ADD COLUMN is_overdue TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=待上架超时' AFTER putaway_deadline_at;

-- 历史数据收口：无来源、审计标记、或 legacy 类型
UPDATE inventory_containers SET is_legacy = 1
WHERE deleted_at IS NULL
  AND (
    source_ref_id IS NULL
    OR source_audit_missing = 1
    OR source_type = 'legacy'
    OR (TRIM(COALESCE(source_type, '')) = '' AND source_ref_id IS NULL)
  );

ALTER TABLE inbound_tasks
  ADD COLUMN lock_version INT NOT NULL DEFAULT 0 COMMENT '乐观锁：收货/上架提交递增' AFTER status;

-- 已有超时的容器同步 is_overdue（与 putaway_flagged_overdue 并存）
UPDATE inventory_containers SET is_overdue = 1
WHERE deleted_at IS NULL AND status = 4
  AND putaway_flagged_overdue = 1 AND is_overdue = 0;
