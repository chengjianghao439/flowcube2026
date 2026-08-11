-- FlowCube ERP - Migration 206
-- 固定资产（文档10 完整会计准则 · 功能1 固定资产折旧）。
--
-- 三张表：固定资产卡片 / 折旧台账（每期每资产）/ 处置单。
-- 折旧口径：直线法（平均年限法）月折旧额 = 原值×(1−残值率)/使用月数，四舍五入到分。
-- 凭证：复用 voucher-engine.upsertVoucher（source_type=asset_acquire/depreciation/disposal），
--   只读本表、只写 acct_*；折旧台账 UNIQUE(asset_id,period) 幂等，凭证 source_id=台账行 id。

CREATE TABLE IF NOT EXISTS `fixed_assets` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`    BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `asset_no`      VARCHAR(30)     NOT NULL COMMENT '资产编号（系统生成 固-YYYYMM-序号）',
  `asset_name`    VARCHAR(100)    NOT NULL,
  `category`      VARCHAR(30)     DEFAULT NULL COMMENT '资产类别（电子设备/运输工具/房屋…）',
  `department_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '使用部门（费用科目归集）',
  `department_name` VARCHAR(80)   DEFAULT NULL COMMENT '部门名快照',
  `acquire_date`  DATE            NOT NULL COMMENT '购置日期（当月开始计提）',
  `original_cost` DECIMAL(16,2)   NOT NULL COMMENT '原值',
  `residual_rate` DECIMAL(6,4)    NOT NULL DEFAULT 0.0500 COMMENT '残值率（默认5%）',
  `useful_months` SMALLINT        NOT NULL COMMENT '使用年限(月)，如 36/60/120',
  `depr_method`   TINYINT         NOT NULL DEFAULT 1 COMMENT '折旧方法 1直线法(平均年限法)',
  `status`        TINYINT         NOT NULL DEFAULT 1 COMMENT '1使用中 2已提足 3已处置/报废',
  `dispose_date`  DATE            DEFAULT NULL,
  `dispose_type`  TINYINT         DEFAULT NULL COMMENT '1出售 2报废',
  `dispose_income` DECIMAL(16,2)  DEFAULT NULL COMMENT '处置收入(售价/残料)',
  `is_active`     TINYINT(1)      NOT NULL DEFAULT 1,
  `remark`        VARCHAR(300)    DEFAULT NULL,
  `created_by`    BIGINT UNSIGNED DEFAULT NULL,
  `created_by_name` VARCHAR(50)   DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fa_no` (`asset_no`),
  KEY `idx_fa_status` (`status`),
  KEY `idx_fa_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产卡片';

CREATE TABLE IF NOT EXISTS `fixed_asset_depr` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`    BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `asset_id`      BIGINT UNSIGNED NOT NULL,
  `period`        CHAR(6)         NOT NULL COMMENT '计提期间 YYYYMM',
  `depr_date`     DATE            NOT NULL COMMENT '期间末日',
  `monthly_amount` DECIMAL(16,2)  NOT NULL COMMENT '本月计提额',
  `accum_amount`  DECIMAL(16,2)   NOT NULL COMMENT '计提后累计已提',
  `is_disposal`   TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1本行是处置当期最后一次计提',
  `created_by`    BIGINT UNSIGNED DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fa_depr` (`asset_id`, `period`),
  KEY `idx_fa_depr_company_period` (`company_id`, `period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产折旧台账';

CREATE TABLE IF NOT EXISTS `fixed_asset_disposals` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`   BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `dispose_no`   VARCHAR(30)     NOT NULL COMMENT '处置单号 固处-YYYYMM-序号',
  `asset_id`     BIGINT UNSIGNED NOT NULL,
  `dispose_date` DATE            NOT NULL,
  `dispose_type` TINYINT         NOT NULL COMMENT '1出售 2报废',
  `income`       DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '处置收入',
  `expense`      DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '清理费用',
  `status`       TINYINT         NOT NULL DEFAULT 1 COMMENT '1已确认(生成凭证)',
  `created_by`   BIGINT UNSIGNED DEFAULT NULL,
  `created_by_name` VARCHAR(50)  DEFAULT NULL,
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fa_dispose_no` (`dispose_no`),
  KEY `idx_fa_dispose_asset` (`asset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产处置/报废单';

-- ── 固定资产/处置所需科目（与 voucherSource.js PRESET_ACCOUNTS 同步）──
INSERT IGNORE INTO `acct_accounts` (`company_id`,`code`,`name`,`category`,`balance_dir`,`level`,`is_leaf`,`aux_type`,`is_preset`,`sort_order`) VALUES
  (1, '1601', '固定资产',      1, 1, 1, 1, 0, 1, 110),
  (1, '1602', '累计折旧',      1, 2, 1, 1, 0, 1, 111),
  (1, '1606', '固定资产清理',  1, 1, 1, 1, 0, 1, 112),
  (1, '6115', '资产处置损益',  5, 2, 1, 1, 0, 1, 155),
  (1, '660203', '管理费用-折旧费', 6, 1, 2, 1, 0, 1, 182);
