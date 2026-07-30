-- FlowCube ERP - Migration 155
-- 采购收货质检 · 收货明细三段量增列 + 任务旁路质检标记（文档 07 · 第一步安全增量）。
--
-- inbound_task_items 现有三段量 ordered_qty / received_qty / putaway_qty（迁移 024），
-- 对齐销售退货 return_task_items（迁移 085/100）的质检三段量，增列如下。本迁移只加列（默认0），
-- 尚未有任何代码写入/读取质检逻辑——收货/上架/结算流程此刻完全不变，待后续危险核心批实现。
--
-- 数量语义（对齐退货，逐行守恒；本期先加列，逻辑后续实现）：
--   received_qty  实收量（合格+不合格都先收进来）
--   checked_qty   已质检量 = 合格 + 让步接收 + 拒收
--   rejected_qty  拒收量（转 REJECTED 容器，不上架不结算）
--   putaway_qty   已上架量 = 合格 + 让步接收（进 ACTIVE，结算基数，语义不变）
--   待质检量 = received_qty − checked_qty ；可上架量 = checked_qty − rejected_qty − putaway_qty
-- qa_required 是建单时按商品/供应商开关固化的快照（见迁移 154 取值规则），不实时读开关。

ALTER TABLE `inbound_task_items`
  ADD COLUMN `qa_required`  TINYINT NOT NULL DEFAULT 0
    COMMENT '本行是否需质检（建单时按商品/供应商开关固化的快照）' AFTER `putaway_qty`,
  ADD COLUMN `checked_qty`  DECIMAL(12,4) NOT NULL DEFAULT 0
    COMMENT '已质检处理量（合格+让步接收+拒收）' AFTER `qa_required`,
  ADD COLUMN `rejected_qty` DECIMAL(12,4) NOT NULL DEFAULT 0
    COMMENT '质检拒收量（不入库、不结算，转 REJECTED 容器）' AFTER `checked_qty`;

-- 任务旁路质检标记（类比 audit_status，不动主 status）：仅展示/筛选投影，权威事实仍是容器状态与明细数量
ALTER TABLE `inbound_tasks`
  ADD COLUMN `qa_status` TINYINT NOT NULL DEFAULT 0
  COMMENT '0=无需质检/无待质检容器 1=有待质检容器待处理 2=质检已全部完成' AFTER `status`;
