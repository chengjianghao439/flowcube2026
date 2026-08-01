-- FlowCube ERP - Migration 188
-- 来料质检「让步接收」旁路统计列（文档 07 · Phase 3 增强，§11 待确认清单第 1 条）。
--
-- 背景：现状质检只分「合格放行 / 拒收」两桶，让步接收（不良但协商后接收入库）被并入合格量，
--       无法在质量报表里区分「正常合格」与「让步放行」。本迁移新增旁路统计列 concession_qty。
--
-- 关键语义（务必守住）：concession_qty 是**合格量(putaway 基数)的子集**，不是第四种数量流——
--   let  passedQty(合格总量, 含让步) = 合格 + 让步   →  仍走 PENDING_PUTAWAY → 上架 → 结算（一字不改）
--        concession_qty              = 其中让步的部分（旁路，只作质量统计）
--        checked_qty = 合格总量 + 拒收 ；rejected_qty = 拒收 （语义完全不变）
--   即 concession_qty ≤ (checked_qty − rejected_qty)。它**绝不参与**库存/应付/均价计算：
--   allocateInboundQaContainers 仍按 passedQty(含让步) 分流到可上架容器，结算基数 putaway_qty 不变。
--
-- 存量行：concession_qty 默认 0，历史质检=「全部正常合格」，严格合格率=宽口径合格率，零行为变化。

ALTER TABLE `inbound_task_items`
  ADD COLUMN `concession_qty` DECIMAL(12,4) NOT NULL DEFAULT 0
    COMMENT '让步接收量（合格量的子集，只作质量统计，不进库存/结算；concession_qty ≤ checked_qty−rejected_qty）'
    AFTER `rejected_qty`;
