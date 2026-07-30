-- FlowCube ERP - Migration 157
-- 客户授信额度（文档 05）。给客户加"能赊多少"的闸门，在销售占库(reserve)时校验。
--
-- 现状：系统对客户完全没有授信约束——无论欠多少未清应收，只要有库存就能继续下单占库发货。
-- 本功能给客户加 credit_limit，占库时校验"已用授信(未清应收+在途敞口) + 本单 ≤ 额度"。
--
-- credit_limit 语义（NULL 与 0 是两种不同业务语义，都要能表达）：
--   NULL = 不启用信控（随便赊）——存量客户 ALTER 后全为 NULL，上线零行为变化、逐客户显式开启
--   >=0  = 启用；0 表示现款现货（任何未清应收/在途都拦）
-- 用 NULL 而非 0 当默认：credit_limit 是普通列不是唯一键，无文档01那种"NULL不被唯一索引约束"的坑，
-- 可放心用 NULL 表达"未启用"。

ALTER TABLE `sale_customers`
  ADD COLUMN `credit_limit` DECIMAL(14,4) NULL DEFAULT NULL
    COMMENT '授信额度：NULL=不启用信控；>=0=启用，0=现款现货(任何赊欠都拦)' AFTER `payment_terms_days`;

-- 授信额度调整流水（审计）：额度直接决定能赊多少钱，改动必须留痕。只增不改，不设 deleted_at。
CREATE TABLE IF NOT EXISTS `sale_customer_credit_logs` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id`   BIGINT UNSIGNED NOT NULL,
  `old_limit`     DECIMAL(14,4) NULL COMMENT '变更前额度（NULL=此前未启用）',
  `new_limit`     DECIMAL(14,4) NULL COMMENT '变更后额度（NULL=关闭信控）',
  `reason`        VARCHAR(255) NULL COMMENT '调整理由',
  `operator_id`   BIGINT UNSIGNED NULL,
  `operator_name` VARCHAR(100) NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_credit_logs_customer` (`customer_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户授信额度调整流水（审计）';
