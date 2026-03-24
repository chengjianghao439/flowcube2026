-- Phase 1 修正：拆分 quantity → initial_qty + remaining_qty，简化 status 语义
ALTER TABLE inventory_containers
  ADD COLUMN initial_qty   DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '容器初始入库数量'  AFTER unit,
  ADD COLUMN remaining_qty DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '当前剩余数量'       AFTER initial_qty;

-- 将原 quantity 数据迁移到两个新字段
UPDATE inventory_containers SET initial_qty = quantity, remaining_qty = quantity;

-- 移除原 quantity 字段
ALTER TABLE inventory_containers DROP COLUMN quantity;

-- status 说明（通过 COMMENT 固化语义，无需新表）
-- 1 = ACTIVE  容器有效且有库存
-- 2 = EMPTY   容器已清空（remaining_qty = 0）
-- 3 = VOID    容器已作废（手动或系统标记）
ALTER TABLE inventory_containers
  MODIFY COLUMN status TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '1=ACTIVE 2=EMPTY 3=VOID';
