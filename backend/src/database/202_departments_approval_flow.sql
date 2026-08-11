-- FlowCube ERP - Migration 202
-- 部门组织 + 多级审批流引擎（P2-7，P2 收官项）。
--
-- 现状：系统内 4 个审批点（费用报销 / 采购请购 / 采购单金额阈值 / 呆滞处置）都是
-- 各自实现的「单级、固定语义」审批，无法按金额分级、无法多级顺序审批、无部门概念。
-- 本迁移落地三组能力：
--   ① sys_departments 部门 + sys_users.department_id（按部门找上级/负责人）
--   ② approval_flows / approval_flow_steps 审批流配置（按 业务类型+金额区间 定义节点序列）
--   ③ approval_instances / approval_instance_tasks 审批实例与节点任务（运行期快照）
--
-- 引擎语义见 docs/proposals/15-部门组织与多级审批流.md：串行逐级、节点审批人三选一
-- （指定角色/部门负责人/指定用户）、申请人不得自批、超管可代批、实例快照不受流程改配影响。

-- ── 部门 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sys_departments` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(50)     NOT NULL COMMENT '部门名称',
  `parent_id`  BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上级部门 0=根',
  `manager_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '部门负责人（审批流可指定按部门负责人寻人）',
  `sort_order` INT             NOT NULL DEFAULT 0,
  `remark`     VARCHAR(200)    DEFAULT NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_dep_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统部门';

-- sys_users 加部门归属
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_users' AND COLUMN_NAME = 'department_id');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE `sys_users` ADD COLUMN `department_id` BIGINT UNSIGNED DEFAULT NULL
     COMMENT ''部门ID（sys_departments）'' AFTER `role_name`',
  'SELECT "sys_users.department_id exists" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 审批流配置 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `approval_flows` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `biz_type`    VARCHAR(40)     NOT NULL COMMENT '业务类型 purchase_requisition / expense_claim / ...',
  `name`        VARCHAR(80)     NOT NULL COMMENT '流程名称，如「请购单多级审批」',
  `min_amount`  DECIMAL(14,2)   NOT NULL DEFAULT 0 COMMENT '适用金额下限（含）',
  `max_amount`  DECIMAL(14,2)   DEFAULT NULL COMMENT '适用金额上限（含），NULL=不设上限',
  `is_active`   TINYINT(1)      NOT NULL DEFAULT 1,
  `remark`      VARCHAR(200)    DEFAULT NULL,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_af_biz` (`biz_type`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批流配置（多级审批引擎）';

CREATE TABLE IF NOT EXISTS `approval_flow_steps` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id`       BIGINT UNSIGNED NOT NULL,
  `step_order`    INT             NOT NULL COMMENT '节点序号 1,2,3... 串行',
  `approver_type` TINYINT         NOT NULL DEFAULT 1 COMMENT '审批人类型 1=指定角色 2=部门负责人 3=指定用户',
  `role_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT 'approver_type=1 时：角色ID',
  `department_id` BIGINT UNSIGNED DEFAULT NULL COMMENT 'approver_type=2 时：部门ID（0=申请人所属部门）',
  `user_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT 'approver_type=3 时：用户ID',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_afs_flow` (`flow_id`, `step_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批流节点';

-- ── 审批实例（运行期） ───────────────────────────────────────────────────
-- 无 UNIQUE(biz_type,biz_id)：终态实例（驳回/撤销）后允许重新发起，靠 status 找活跃实例。
CREATE TABLE IF NOT EXISTS `approval_instances` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id`        BIGINT UNSIGNED NOT NULL,
  `biz_type`       VARCHAR(40)     NOT NULL,
  `biz_id`         BIGINT UNSIGNED NOT NULL,
  `applicant_id`   BIGINT UNSIGNED NOT NULL COMMENT '申请人（发起审批的用户）',
  `applicant_name` VARCHAR(50)     NOT NULL,
  `amount`         DECIMAL(14,2)   NOT NULL DEFAULT 0 COMMENT '提交时金额快照',
  `current_step`   INT             NOT NULL DEFAULT 1 COMMENT '当前待处理节点序号',
  `status`         TINYINT         NOT NULL DEFAULT 1 COMMENT '1审批中 2已通过 3已驳回 4已撤销',
  `reject_reason`  VARCHAR(500)    DEFAULT NULL,
  `finished_at`    DATETIME        DEFAULT NULL,
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_biz` (`biz_type`, `biz_id`, `status`),
  KEY `idx_ai_applicant` (`applicant_id`),
  KEY `idx_ai_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批实例';

CREATE TABLE IF NOT EXISTS `approval_instance_tasks` (
  `id`                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `instance_id`            BIGINT UNSIGNED NOT NULL,
  `step_order`             INT             NOT NULL,
  `approver_type`          TINYINT         NOT NULL COMMENT '审批人类型 1=指定角色 2=部门负责人 3=指定用户（仅展示）',
  `approver_role_id`       BIGINT UNSIGNED DEFAULT NULL,
  `approver_department_id` BIGINT UNSIGNED DEFAULT NULL,
  `approver_user_id`       BIGINT UNSIGNED DEFAULT NULL,
  `approver_name`          VARCHAR(50)     DEFAULT NULL COMMENT '实际审批人姓名（通过/驳回时写）',
  `status`                 TINYINT         NOT NULL DEFAULT 1 COMMENT '1待审批 2已通过 3已驳回',
  `action_at`              DATETIME        DEFAULT NULL,
  `comment`                VARCHAR(500)    DEFAULT NULL,
  `created_at`             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ait_instance` (`instance_id`, `step_order`),
  KEY `idx_ait_pending_role` (`status`, `approver_role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批实例节点任务';

-- 节点审批人关联（一个节点可有多个命中审批人，如「角色任一成员」）：待办匹配与审批校验都走这张表
CREATE TABLE IF NOT EXISTS `approval_instance_task_approvers` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id`     BIGINT UNSIGNED NOT NULL,
  `instance_id` BIGINT UNSIGNED NOT NULL,
  `user_id`     BIGINT UNSIGNED NOT NULL COMMENT '命中审批人（已排除申请人本人）',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aita_task_user` (`task_id`, `user_id`),
  KEY `idx_aita_instance` (`instance_id`),
  KEY `idx_aita_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批节点审批人关联';

-- ── 权限 seed ───────────────────────────────────────────────────────────
-- 部门管理与审批流配置是系统级管理能力，只在权限管理页由管理员手动授（不随角色批量下发，
-- 同 purchase.requisition.approve 内控先例）。超管 role_id=1 恒有。
-- 待办列表（approval.task.view）例外：审批待办是「每人自己的任务」，任何能登录的用户都要
-- 能进入待我审批页，故 seed 给全部角色（1管理员 2仓库经理 3采购与销售 4财务 5只读用户）。
INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (1, 'approval.task.view'),
  (2, 'approval.task.view'),
  (3, 'approval.task.view'),
  (4, 'approval.task.view'),
  (5, 'approval.task.view');
