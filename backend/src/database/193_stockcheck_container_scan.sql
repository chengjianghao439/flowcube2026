-- FlowCube ERP - Migration 193
-- PDA 扫码盘点（设计文档 13 §4.3 收尾）：盘点扫容器码的现场记录表。
--
-- 语义承接已删除的 inventory_check_item_serials（序列号盘点扫码表，迁移191 建、192 随体系下线），
-- 但粒度从「序列号」换成「容器条码」——一物一码由库存容器承担后，扫容器码就是逐件核对：
--   个体容器（container_type=1 且 initial_qty=1）：扫到即计 1；
--   数量容器：扫码后由现场填该容器的实盘数（counted_qty）。
-- 提交盘点时按容器精确对账：账面 ACTIVE 而现场没扫到的容器 = 盘亏（精确扣这些容器，不走 FIFO）；
-- 扫到但实盘少于账面剩余的容器按差额盘亏；实盘多于账面剩余拒收（请核实实物与条码）。

CREATE TABLE IF NOT EXISTS `inventory_check_item_containers` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `check_item_id`  BIGINT UNSIGNED NOT NULL COMMENT '盘点明细ID（inventory_check_items.id）',
  `container_id`   BIGINT UNSIGNED NOT NULL COMMENT '扫到的容器ID',
  `barcode`        VARCHAR(64)  NOT NULL COMMENT '扫码时刻的容器条码快照（容器后续作废/清空仍可追溯）',
  `counted_qty`    DECIMAL(14,4) NOT NULL COMMENT '现场实盘数（个体容器恒为 1）',
  `scanned_by`     BIGINT UNSIGNED DEFAULT NULL COMMENT '扫码人ID',
  `scanned_by_name` VARCHAR(50)  DEFAULT NULL COMMENT '扫码人',
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_check_item_container` (`check_item_id`, `container_id`),
  KEY `idx_check_container_container` (`container_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点扫码记录（容器粒度）';
