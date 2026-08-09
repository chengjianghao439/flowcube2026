-- FlowCube ERP - Migration 201
-- 已收款退货退款单（P2-6）：专用红冲退款链路。
--
-- 背景：销售退货在「已登记收款 > 退货冲减后账款总额」时会被 returns.helpers 的
-- 负余额守卫硬拦截（提示「请先处理退款」），但系统此前没有退款功能，已收款的退货
-- 直接卡死。本表提供退款单：把多收的钱退还给客户。
--
-- 状态机（documentStatusRules 的 refundOrder）：
--   1 草稿 → 2 已确认 → 3 已完成 / 4 已取消
--
-- 执行退款语义（refund-orders.service.execute，事务内）：
--   1. 锁退款单 + 锁关联 payment_records（FOR UPDATE）
--   2. 校验退款金额 ≤ 已收金额（paid_amount）
--   3. paid_amount -= 退款额，balance += 退款额，重算 status
--   4. 写负向 payment_entries（退款留痕）
--   5. 资金账户 OUT（退款 BIZ_TYPE）——与报销付款同模式
--   6. 退款单 → 已完成
-- 幂等：执行走 CAS（2→3），重复执行 409。
--
-- 退款完成后，退货链路的负余额守卫（assertReturnPaymentHeadroom）即可通过。

CREATE TABLE IF NOT EXISTS `refund_orders` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `refund_no`        VARCHAR(30)     NOT NULL COMMENT '退款单号',
  `sale_order_id`    BIGINT UNSIGNED NOT NULL COMMENT '关联销售单',
  `sale_order_no`    VARCHAR(30)     NOT NULL,
  `customer_name`    VARCHAR(100)    NOT NULL,
  `amount`           DECIMAL(14,4)   NOT NULL COMMENT '退款金额',
  `status`           TINYINT         NOT NULL DEFAULT 1 COMMENT '1草稿 2已确认 3已完成 4已取消',
  `payment_record_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联账款记录（可空：期初/手工）',
  `account_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '退款资金账户',
  `refund_date`      DATE            DEFAULT NULL COMMENT '实际退款日期',
  `remark`           VARCHAR(500)    DEFAULT NULL,
  `operator_id`      BIGINT UNSIGNED DEFAULT NULL,
  `operator_name`    VARCHAR(50)     DEFAULT NULL,
  `confirmed_by`     BIGINT UNSIGNED DEFAULT NULL,
  `confirmed_by_name` VARCHAR(50)    DEFAULT NULL,
  `confirmed_at`     DATETIME        DEFAULT NULL,
  `refunded_at`      DATETIME        DEFAULT NULL COMMENT '退款完成时间',
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_refund_no` (`refund_no`),
  KEY `idx_refund_sale` (`sale_order_id`, `status`),
  KEY `idx_refund_payment` (`payment_record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已收款退货退款单';
