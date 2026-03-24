-- 复核功能：为仓库任务明细添加已复核数量字段
-- 关联功能：PDA 复核流程（pda/check）
ALTER TABLE warehouse_task_items
  ADD COLUMN checked_qty DECIMAL(12,4) NOT NULL DEFAULT 0
    COMMENT '已复核数量（PDA 复核阶段填写）'
  AFTER picked_qty;
