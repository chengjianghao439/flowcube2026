-- FlowCube ERP - Migration 145
-- payment_records.order_id 改回可空，修复「手工建账款」必然 500 的历史断裂。
--
-- 背景：091 建 UNIQUE(type, order_id) 时的注释白纸黑字写着「order_id 允许 NULL
-- （多个 NULL 不冲突，兼容无关联单据的记录）」，054 的兼容建表也写的 DEFAULT NULL。
-- 但线上表实际是 `order_id BIGINT UNSIGNED NOT NULL`（054 是 CREATE TABLE IF NOT
-- EXISTS，表早已由更早的脚本建出，那份定义没跟上），于是 payments.service.createManual
-- 的 INSERT（不写 order_id）在 STRICT_TRANS_TABLES 下必然报
-- 「Field 'order_id' doesn't have a default value」→ 500。
--
-- 该接口 POST /api/payments 至今没有任何前端页面调用（frontend/src/api/payments.ts
-- 里 createPaymentApi 定义了但无引用），所以这条 bug 一直没被业务发现。
--
-- 为什么是「改列」而不是「给个默认值」：UNIQUE(type, order_id) 下，若手工单统一填 0，
-- 每种类型只能存在一条手工账款，第二条就撞唯一键。NULL 才是这个约束下「无关联单据」
-- 的正确表达——这也正是 091 当初的设计。
--
-- 对既有数据与幂等的影响：无。299 条存量账款全部由采购/销售结算生成、order_id 非空，
-- 结算侧的 INSERT ... ON DUPLICATE KEY UPDATE 依旧靠 (type, order_id) 去重。

SET @is_nullable := (
  SELECT IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payment_records'
    AND COLUMN_NAME = 'order_id'
);
SET @sql := IF(@is_nullable = 'NO',
  'ALTER TABLE payment_records MODIFY COLUMN `order_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT ''关联单据ID：采购单/销售单；手工录入的账款为 NULL''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
