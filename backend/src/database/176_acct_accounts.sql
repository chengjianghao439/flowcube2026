-- FlowCube ERP - Migration 176
-- 会计科目表（文档 10 · Phase 0 科目地基）。会计核算的地基：科目 → 凭证 → 总账 → 报表。
-- 本期只落「科目」这一层，凭证/总账/报表是后续 Phase。科目编码遵循企业会计准则习惯（1001/1122/6001…）。
-- 语义要点：
--   category    科目大类：1资产 2负债 3权益 4成本 5损益(收入) 6损益(费用)
--   balance_dir 余额方向：1借 2贷（资产/成本/费用借，负债/权益/收入贷；个别科目可人工指定，故独立成列）
--   is_leaf     1明细科目(可记账) 0汇总科目(有下级，不可直接挂分录)——将来凭证只能落到 is_leaf=1
--   is_preset   1系统预置（映射引擎按 code 引用，不可删/不可改码），见 177 seed
--   aux_type    辅助核算：0无 1往来单位（应收/应付挂客户/供应商）——本期仅登记，凭证辅助核算 Phase1 用

CREATE TABLE IF NOT EXISTS `acct_accounts` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(20)  NOT NULL              COMMENT '科目编码，如 1001/1122/6001（企业会计准则习惯）',
  `name`        VARCHAR(60)  NOT NULL              COMMENT '科目名称，如 库存现金/应收账款/主营业务收入',
  `category`    TINYINT      NOT NULL              COMMENT '1资产 2负债 3权益 4成本 5损益(收入) 6损益(费用)',
  `balance_dir` TINYINT      NOT NULL              COMMENT '余额方向 1借 2贷',
  `parent_id`   BIGINT UNSIGNED DEFAULT NULL       COMMENT '上级科目；顶级为 NULL',
  `level`       TINYINT      NOT NULL DEFAULT 1    COMMENT '科目级次（由 parent 派生）',
  `is_leaf`     TINYINT      NOT NULL DEFAULT 1    COMMENT '1明细科目(可记账) 0汇总科目(有下级，不可直接记账)',
  `aux_type`    TINYINT      NOT NULL DEFAULT 0    COMMENT '辅助核算 0无 1往来单位（本期仅 0/1）',
  `is_active`   TINYINT      NOT NULL DEFAULT 1    COMMENT '1启用 0停用',
  `is_preset`   TINYINT      NOT NULL DEFAULT 0    COMMENT '1系统预置(映射依赖，不可删/不可改码)',
  `sort_order`  INT          NOT NULL DEFAULT 0    COMMENT '同级排序，数字越小越靠前',
  `remark`      VARCHAR(300) DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_acct_accounts_code` (`code`),
  KEY `idx_acct_accounts_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会计科目表（文档10）';
