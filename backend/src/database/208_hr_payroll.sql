-- FlowCube ERP - Migration 208
-- 工资社保个税核算（文档10 完整会计准则 · 功能4）。
--
-- 六张表：员工档案 / 工资项目 / 工资单(期) / 工资单明细 / 社保公积金比例 / 个税累计预扣台账。
-- 个税用累计预扣法（2019 新个税）：本期应预扣 = 累计应纳税所得额×预扣率−速算扣除−累计已预扣。
-- 凭证：复用 voucher-engine（source_type=salary_accrual/social_company/social_personal/salary_payment），
--   一张工资单(期)一张凭证，source_id=hr_payrolls.id。

CREATE TABLE IF NOT EXISTS `hr_employees` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`   BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `emp_no`       VARCHAR(30)     NOT NULL,
  `name`         VARCHAR(50)     NOT NULL,
  `id_card_no`   VARCHAR(20)     DEFAULT NULL COMMENT '身份证号（个税累计预扣必用）',
  `department_id` BIGINT UNSIGNED DEFAULT NULL,
  `department_name` VARCHAR(80)  DEFAULT NULL,
  `hire_date`    DATE            DEFAULT NULL,
  `status`       TINYINT         NOT NULL DEFAULT 1 COMMENT '1在职 2离职',
  `is_active`    TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emp_no` (`emp_no`),
  KEY `idx_emp_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工档案';

CREATE TABLE IF NOT EXISTS `hr_salary_items` (
  `id`        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`      VARCHAR(20)     NOT NULL COMMENT 'basic/overtime/social_company/social_personal/tax…',
  `name`      VARCHAR(60)     NOT NULL,
  `item_type` TINYINT         NOT NULL COMMENT '1应发 2社保公积金(单位) 3社保公积金(个人) 4应税项 5免税项 6税前扣减 7税后扣减',
  `is_preset` TINYINT(1)      NOT NULL DEFAULT 1,
  `sort_order` INT            NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_si_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工资项目';

CREATE TABLE IF NOT EXISTS `hr_payrolls` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`  BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `period`      CHAR(6)         NOT NULL COMMENT '工资所属期 YYYYMM',
  `payroll_no`  VARCHAR(30)     NOT NULL,
  `total_gross` DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '应发合计',
  `total_social_company` DECIMAL(16,2) NOT NULL DEFAULT 0 COMMENT '单位社保公积金合计',
  `total_tax`   DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '个税合计',
  `total_net`   DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '实发合计',
  `status`      TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2已核算 3已发放',
  `created_by`  BIGINT UNSIGNED DEFAULT NULL,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payroll_company_period` (`company_id`, `period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工资单(期)';

CREATE TABLE IF NOT EXISTS `hr_payroll_lines` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payroll_id`  BIGINT UNSIGNED NOT NULL,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `gross`       DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '应发工资',
  `social_company` DECIMAL(16,2) NOT NULL DEFAULT 0 COMMENT '单位社保公积金',
  `social_personal` DECIMAL(16,2) NOT NULL DEFAULT 0 COMMENT '个人社保公积金',
  `taxable_income`  DECIMAL(16,2) NOT NULL DEFAULT 0 COMMENT '本期应纳税所得额',
  `tax`         DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '个税(累计预扣)',
  `net`         DECIMAL(16,2)   NOT NULL DEFAULT 0 COMMENT '实发',
  `detail_json` JSON            DEFAULT NULL COMMENT '工资项目明细快照',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pl_payroll` (`payroll_id`),
  KEY `idx_pl_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工资单明细(员工)';

CREATE TABLE IF NOT EXISTS `hr_social_rates` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`  BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `year`        CHAR(4)         NOT NULL,
  `base_min`    DECIMAL(16,2)   NOT NULL DEFAULT 0,
  `base_max`    DECIMAL(16,2)   NOT NULL DEFAULT 0,
  `social_company_rate` DECIMAL(6,4) NOT NULL DEFAULT 0,
  `social_personal_rate` DECIMAL(6,4) NOT NULL DEFAULT 0,
  `fund_company_rate`   DECIMAL(6,4) NOT NULL DEFAULT 0,
  `fund_personal_rate`  DECIMAL(6,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sr_company_year` (`company_id`, `year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='社保公积金缴费比例(按年)';

CREATE TABLE IF NOT EXISTS `hr_tax_accumulated` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`  BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `year`        CHAR(4)         NOT NULL,
  `month`       TINYINT         NOT NULL COMMENT '累计至该月',
  `accum_taxable` DECIMAL(16,2) NOT NULL DEFAULT 0 COMMENT '累计应纳税所得额',
  `accum_tax_paid` DECIMAL(16,2) NOT NULL DEFAULT 0 COMMENT '累计已预缴税额',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_taxacc` (`employee_id`, `year`, `month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个税累计预扣台账';

-- 预置工资项目
INSERT IGNORE INTO `hr_salary_items` (`code`,`name`,`item_type`,`is_preset`,`sort_order`) VALUES
  ('basic', '基本工资', 1, 1, 10),
  ('overtime', '加班费', 1, 1, 20),
  ('social_company', '单位社保公积金', 2, 1, 30),
  ('social_personal', '个人社保公积金', 3, 1, 40),
  ('tax', '个人所得税', 7, 1, 50);

-- 工资/社保科目（与 voucherSource.js PRESET_ACCOUNTS 同步）
INSERT IGNORE INTO `acct_accounts` (`company_id`,`code`,`name`,`category`,`balance_dir`,`level`,`is_leaf`,`aux_type`,`is_preset`,`sort_order`) VALUES
  (1, '2211', '应付职工薪酬',  2, 2, 1, 0, 0, 1, 220),
  (1, '221101', '应付职工薪酬-工资', 2, 2, 2, 1, 0, 1, 221),
  (1, '221102', '应付职工薪酬-社保公积金', 2, 2, 2, 1, 0, 1, 222),
  (1, '2241', '其他应付款',    2, 2, 1, 0, 0, 1, 225),
  (1, '224101', '其他应付款-代扣个税', 2, 2, 2, 1, 0, 1, 226),
  (1, '224102', '其他应付款-代扣个人社保', 2, 2, 2, 1, 0, 1, 227),
  (1, '660201', '管理费用-工资', 6, 1, 2, 1, 0, 1, 180),
  (1, '660202', '管理费用-社保公积金', 6, 1, 2, 1, 0, 1, 181);
