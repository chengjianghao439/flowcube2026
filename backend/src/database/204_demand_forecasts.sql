-- FlowCube ERP - Migration 204
-- 需求预测明细表（文档11 Phase 3）：procurement generatePlan 每次计算落一份预测快照。
--
-- 背景：Phase 1 的采购计划把预测结果落 procurement_plan_items，但那是「按需生成、随计划编辑」的
-- 可变快照，无法做「预测 vs 实际」的准确度评估。本表单独物化每次预测的输入参数与结果，
-- 供未来预测准确度看板使用。只写不删（追加式审计快照）。
--
-- 口径：每次 generatePlan 在同一事务内，把每行（仓库×商品）的 窗口/方法/预测需求/实际出库 落一行。
-- actual_sold 在生成时点是未知的（未来），先置 NULL，由后续（预测期过后）的准确度回填任务补算。

CREATE TABLE IF NOT EXISTS `demand_forecasts` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id`        BIGINT UNSIGNED NOT NULL COMMENT '采购计划ID',
  `warehouse_id`   BIGINT UNSIGNED NOT NULL,
  `product_id`     BIGINT UNSIGNED NOT NULL,
  `forecast_method` VARCHAR(10)    NOT NULL COMMENT 'sma / wma',
  `window_days`    INT             NOT NULL COMMENT '预测窗口天数',
  `horizon_days`   INT             NOT NULL COMMENT '预测覆盖天数（= 提前期 + 覆盖周期）',
  `adu`            DECIMAL(18,4)   NOT NULL COMMENT '日均销量（生成时点）',
  `forecast_demand` DECIMAL(18,4)  NOT NULL COMMENT '预测需求 = adu × horizon',
  `actual_sold`    DECIMAL(18,4)   DEFAULT NULL COMMENT '预测期实际出库（回填前为 NULL）',
  `accuracy_rate`  DECIMAL(8,4)    DEFAULT NULL COMMENT '预测准确度 1-|误差|/实际（回填后）',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_df_plan` (`plan_id`),
  KEY `idx_df_wh_prod` (`warehouse_id`, `product_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求预测明细（文档11）';
