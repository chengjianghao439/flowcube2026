-- FlowCube ERP - Migration 194
-- 会计期末结转与期间锁定（用户 2026-08-09 确认：本系统是正式账，需要结账控制）。
--
-- 1. acct_periods 会计期间表：期间一经结账（status=2），该期间的凭证禁止新建/红冲/删除/重算生成，
--    要改必须先反结账——这是会计敢信这套账的前提。
-- 2. 预置结转科目（is_preset=1）：4103 本年利润 / 4104 利润分配（仅 12 月年结用）。
-- 3. 权限 seed：accounting.period.manage 授予角色 4（财务），与 voucher.manage 同口径。

CREATE TABLE IF NOT EXISTS `acct_periods` (
  `period`         CHAR(6)      NOT NULL COMMENT '会计期间 YYYYMM',
  `status`         TINYINT      NOT NULL DEFAULT 1 COMMENT '1开放 2已结账',
  `closed_by`      BIGINT UNSIGNED DEFAULT NULL COMMENT '结账人ID',
  `closed_by_name` VARCHAR(50)  DEFAULT NULL COMMENT '结账人',
  `closed_at`      DATETIME     DEFAULT NULL COMMENT '最近结账时间',
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会计期间（结账状态）';

-- 预置结转科目（仅当不存在时插入；与 voucherSource.js PRESET_ACCOUNTS 同步新增）
INSERT INTO `acct_accounts`
  (`code`, `name`, `category`, `balance_dir`, `parent_id`, `level`, `is_leaf`, `aux_type`, `is_preset`, `sort_order`)
SELECT '4103', '本年利润', 3, 2, NULL, 1, 1, 0, 1, 70 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `acct_accounts` WHERE code = '4103');

INSERT INTO `acct_accounts`
  (`code`, `name`, `category`, `balance_dir`, `parent_id`, `level`, `is_leaf`, `aux_type`, `is_preset`, `sort_order`)
SELECT '4104', '利润分配', 3, 2, NULL, 1, 1, 0, 1, 75 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `acct_accounts` WHERE code = '4104');

-- 期间管理权限 seed：4 财务（与 accounting.voucher.manage 一致）
INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (4, 'accounting.period.manage');
