-- FlowCube ERP - Migration 172
-- 采购计划头表（文档 11 单据化 Phase 2）。把 MVP 只读报表的一次预测结果固化为可编辑、可转采购的单据。
-- 状态语义以 documentStatusRules.procurementPlan 为准（1草稿 2部分转采购 3已完成 4已作废）。
-- 纯办公端决策支持：生成只读计算、转出的是采购单草稿（需人工确认），绝不自动下单。

CREATE TABLE IF NOT EXISTS `procurement_plans` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `code`             VARCHAR(32)  NOT NULL              COMMENT '计划编号 PLAN-yyyymmdd-xxx',
  `name`             VARCHAR(128) NULL                  COMMENT '计划名（可空，默认按生成时间）',
  `horizon_days`     INT          NOT NULL              COMMENT '需求覆盖周期天数 P（快照）',
  `forecast_method`  VARCHAR(16)  NOT NULL DEFAULT 'sma' COMMENT '预测算法：sma 简单移动平均（Phase1 只此一种）',
  `forecast_window`  INT          NOT NULL              COMMENT '预测取样窗口 N（近 N 天出库算日均，快照）',
  `default_lead_time` INT         NOT NULL DEFAULT 7    COMMENT '本次计划全局默认提前期（供应商未设时回退，快照）',
  `status`           TINYINT(1)   NOT NULL DEFAULT 1    COMMENT '1草稿 2部分转采购 3已完成 4已作废；语义见 documentStatusRules.procurementPlan',
  `item_count`       INT          NOT NULL DEFAULT 0    COMMENT '生成时明细行数快照',
  `operator_id`      BIGINT       NOT NULL              COMMENT '生成人',
  `operator_name`    VARCHAR(64)  NULL,
  `remark`           VARCHAR(500) NULL,
  `deleted_at`       DATETIME     NULL,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购计划（MRP 轻量版）头表';
