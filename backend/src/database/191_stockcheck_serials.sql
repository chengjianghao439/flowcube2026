-- FlowCube ERP - Migration 191
-- 序列号级盘点（文档04 Phase3b·C-full）：序列号管控商品的盘点不再手填实盘数，
-- 而是由 PDA 现场逐台扫「在架的每一台」，系统据此算盘盈/盘亏：
--   盘亏 = 账面在库集 − 扫到集（这些具体台丢了，扣它们各自所在的容器，不能走 FIFO
--          否则容器数量与其挂载序列号数立刻错配，破坏核心不变量）
--   盘盈 = 扫到集 − 账面在库集（发现系统不知道的实物台，登记为在库并绑到盘盈容器）
-- 实盘数 actual_qty 由扫码台数派生，禁止手填（防"填 5 实扫 3"）。

CREATE TABLE IF NOT EXISTS `inventory_check_item_serials` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `check_item_id`  BIGINT UNSIGNED NOT NULL COMMENT '盘点明细行 inventory_check_items.id',
  `serial_no`      VARCHAR(64) NOT NULL COMMENT '现场扫到的序列号',
  `scanned_by`     BIGINT UNSIGNED DEFAULT NULL,
  `scanned_by_name` VARCHAR(50) DEFAULT NULL,
  `scanned_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- 同一明细行内同一 SN 只能有一条：重复扫天然幂等，也防现场重复计数
  UNIQUE KEY `uk_check_item_serial` (`check_item_id`, `serial_no`),
  KEY `idx_icis_item` (`check_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='盘点现场逐台扫到的序列号（序列号管控商品专用）';

-- product_serials.status 增加 4 盘亏丢失：盘点确认该台不在库存现场，
-- 置 4 + container_id=NULL（不删行，丢失是真实历史事实，需留档可追溯）。
-- status=1 才计入「容器 remaining_qty == 在库序列号数」不变量，故置 4 后不变量随容器扣减自然成立。
ALTER TABLE `product_serials`
  MODIFY COLUMN `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1在库 2已出库 3已退货(待处理) 4盘亏丢失';
