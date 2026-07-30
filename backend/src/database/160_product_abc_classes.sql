-- FlowCube ERP - Migration 160
-- 商品 ABC 分类物化结果（文档 08，按仓）。循环盘按 ABC 频率抽盘：A类勤盘、B类中等、C类稀盘。
-- 按近 N 天出库消耗金额(sold_value)帕累托分类：累计≤80%→A，≤95%→B，其余→C。可重算覆盖（按仓整仓刷新）。
-- 不设 deleted_at：可重算派生数据，软删会和唯一键打架（同文档01哨兵表原则）。

CREATE TABLE IF NOT EXISTS `product_abc_classes` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `warehouse_id`   BIGINT UNSIGNED NOT NULL              COMMENT '所属仓库ID（ABC 按仓分类）',
  `product_id`     BIGINT UNSIGNED NOT NULL,
  `abc_class`      CHAR(1)         NOT NULL DEFAULT 'C'  COMMENT 'A / B / C',
  `metric_type`   VARCHAR(16)      NOT NULL DEFAULT 'sold_value' COMMENT '分类依据：sold_value 出库消耗金额 / stock_value 库存占用金额',
  `metric_value`  DECIMAL(18,4)    NOT NULL DEFAULT 0    COMMENT '排序指标值（消耗金额或库存金额）',
  `cumulative_pct` DECIMAL(9,6)    NOT NULL DEFAULT 0    COMMENT '帕累托累计占比（0~1）',
  `window_days`   INT UNSIGNED     NOT NULL DEFAULT 90   COMMENT '统计窗口天数（sold_value 时有意义）',
  `computed_at`   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本次分类计算时刻',
  `created_at`    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wh_product` (`warehouse_id`,`product_id`),
  INDEX `idx_wh_class` (`warehouse_id`,`abc_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品 ABC 分类物化结果（按仓，可重算覆盖）';
