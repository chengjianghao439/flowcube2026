-- FlowCube ERP - Migration 203
-- 超额放行审批单（文档 05 Phase 2）：销售员发起 → 多级审批 → 审批通过后该销售单占库自动放行。
--
-- 现状（Phase 1）：占库超限硬阻断，仅「有 sale.credit.override 权限的人」可一次性放行（写
-- credit_override 事件）。问题是权限要么下发给销售员（内控缺失），要么销售员得线下找人代操作。
-- 本表提供「申请—审批」两步：销售员发起申请单（说明超量原因）→ 走 approvalEngine 多级审批
-- （biz_type='sale_credit_override'）→ 审批通过后占库接口自动放行该销售单，无需再要 override 权限。
--
-- 状态机：1草稿 → 2待审批 → 3已批准 / 4已驳回 / 5已取消。
--   · 2/3 由审批流引擎实例驱动（实例通过→3，驳回→4）；1/5 是纯单据态。
--   · 一张销售单同时只允许一张「未结束」的放行申请（活跃唯一性由 UNIQUE 索引 + 状态判断保证）。
--
-- 放行语义：sale.service.reserveStock 超限时，若该销售单存在「已批准(3)」的申请单 → 自动放行
-- （等效 confirmCreditOverride，但不要求操作者有 override 权限），写 credit_override 事件留痕。
CREATE TABLE IF NOT EXISTS `sale_credit_overrides` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `override_no`       VARCHAR(30)     NOT NULL COMMENT '申请单号 CO+日期+序号',
  `sale_order_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联销售单',
  `sale_order_no`     VARCHAR(30)     NOT NULL COMMENT '销售单号快照',
  `customer_id`       BIGINT UNSIGNED NOT NULL COMMENT '客户',
  `customer_name`     VARCHAR(80)     NOT NULL COMMENT '客户名快照',
  `credit_limit`      DECIMAL(14,2)   NOT NULL COMMENT '额度快照（申请时）',
  `used_credit`       DECIMAL(14,2)   NOT NULL DEFAULT 0 COMMENT '已用授信快照（申请时）',
  `this_amount`       DECIMAL(14,2)   NOT NULL COMMENT '本单金额',
  `over_amount`       DECIMAL(14,2)   NOT NULL COMMENT '超量 = used + this - limit',
  `reason`            VARCHAR(500)    DEFAULT NULL COMMENT '超额原因（销售员说明）',
  `applicant_id`      BIGINT UNSIGNED NOT NULL COMMENT '申请人（审批人不得为本人，引擎校验）',
  `applicant_name`    VARCHAR(50)     NOT NULL,
  `status`            TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2待审批 3已批准 4已驳回 5已取消',
  `reject_reason`     VARCHAR(300)    DEFAULT NULL COMMENT '驳回原因',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sco_no` (`override_no`),
  KEY `idx_sco_sale` (`sale_order_id`),
  KEY `idx_sco_customer` (`customer_id`),
  KEY `idx_sco_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='超额放行审批单';

-- 权限 seed：申请/查看是销售员自助链路（seed 给销售与采购角色 3），审批走引擎不依赖权限码。
INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES
  (3, 'sale.credit.override.apply'),
  (3, 'sale.credit.override.view');
