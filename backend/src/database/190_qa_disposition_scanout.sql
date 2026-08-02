-- FlowCube ERP - Migration 190
-- 拒收处置「PDA 物理扫出确认」（文档07 · Phase3 严格化，§11 line 250/278）。
--
-- 现状（v0.4.43）：ERP 一步 createDisposition 立即把 REJECTED 容器 void（6→VOID）——「记状态不移位」。
-- 本迁移把处置改为两阶段：ERP 决策创建处置单(status=1 待扫出，不 void 容器) → 仓库在 PDA 逐个扫
-- REJECTED 容器码物理确认出场(void + 序列号回冲) → 全部扫完处置单 status=2 已完成。
-- 守「仓库端只执行不决策」：处置去向(退供应商/报废/哪些商品)在 ERP 决策，PDA 只扫**系统列出**的容器、不自选。
--
-- status 默认 2：存量处置单（若有）都是旧一步流程、容器早已 void 完成，回填「已完成」，不进 PDA 待扫出列表。

ALTER TABLE `inbound_qa_dispositions`
  ADD COLUMN `status` TINYINT NOT NULL DEFAULT 2
    COMMENT '1待扫出(PDA物理出场确认中) 2已完成；存量默认2(旧一步流程已void完成)' AFTER `disposition_type`;

-- 处置单待扫出容器清单（记录每个 REJECTED 容器的扫出进度）。存量处置单无本表行（旧流程直接 void）。
CREATE TABLE IF NOT EXISTS `inbound_qa_disposition_containers` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `disposition_id` BIGINT UNSIGNED NOT NULL,
  `container_id`   BIGINT UNSIGNED NOT NULL,
  `product_id`     BIGINT UNSIGNED NOT NULL,
  `barcode`        VARCHAR(64)     NOT NULL              COMMENT '容器条码快照（PDA 扫码匹配用）',
  `qty`            DECIMAL(14,4)   NOT NULL DEFAULT 0    COMMENT '容器待处置数量快照',
  `scanned_at`     DATETIME        DEFAULT NULL          COMMENT 'PDA 扫出确认时间；NULL=待扫出',
  `scanned_by`     BIGINT UNSIGNED DEFAULT NULL,
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dispo_container` (`container_id`),
  KEY `idx_dispo` (`disposition_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='拒收处置待扫出容器清单（PDA 物理出场确认进度，文档07 Phase3）';
