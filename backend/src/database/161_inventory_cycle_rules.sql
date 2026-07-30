-- FlowCube ERP - Migration 161
-- 循环盘频率规则（文档 08，按仓+ABC类）。warehouse_id=0 为全局默认（非NULL，理由同文档01：
-- NULL 不被唯一索引约束、默认值会不唯一）。取值 COALESCE(本仓规则, warehouse_id=0 默认)。
-- seed 全局默认：A 月盘(30) / B 季盘(90) / C 年盘(365)，行业常见起点，可按盘点人力微调。

CREATE TABLE IF NOT EXISTS `inventory_cycle_rules` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `warehouse_id`  BIGINT UNSIGNED NOT NULL DEFAULT 0    COMMENT '0=全局默认；>0=特定仓覆盖',
  `abc_class`     CHAR(1)         NOT NULL              COMMENT 'A / B / C',
  `interval_days` INT UNSIGNED    NOT NULL              COMMENT '该类盘点周期（天）：到期未盘即进入抽盘候选',
  `batch_limit`   INT UNSIGNED    NOT NULL DEFAULT 200  COMMENT '单次该类抽盘最多拉多少 SKU',
  `enabled`       TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wh_class` (`warehouse_id`,`abc_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='循环盘频率规则（按仓+ABC类，warehouse_id=0 全局默认）';

INSERT IGNORE INTO `inventory_cycle_rules` (warehouse_id, abc_class, interval_days, batch_limit) VALUES
  (0, 'A', 30,  200),
  (0, 'B', 90,  200),
  (0, 'C', 365, 200);
