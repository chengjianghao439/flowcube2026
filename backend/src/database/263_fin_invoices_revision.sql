-- FlowCube ERP - Migration 263
-- 发票编辑的乐观锁（2026-09-27）
--
-- 背景：`accounting.invoice.service.updateInvoice` 原先只做**状态 CAS**（`WHERE ... AND status = 1`），
-- 没有版本校验——那不是并发编辑的版本校验，只是"这张票还是不是可编辑状态"。于是两个并发编辑
-- 同一张发票会互相**静默覆盖**：隔离库实测 **8/8 轮**两次请求都 200、最终只留其一。
-- 金额与 `source_no`/`source_id` 都会丢，后者还会改变 `loadTaxMaps` 的税额归属。
--
-- 为什么不用 `updated_at` 当版本：它是 **datetime（秒精度）**，同一秒内的并发更新取到的值不变，
-- 做 CAS 会整体失效（本反例正是同秒）。故新增独立 `revision` 列。
--
-- 幂等：重复执行无副作用（列已存在则跳过）。

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'fin_invoices'
    AND COLUMN_NAME = 'revision'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `fin_invoices` ADD COLUMN `revision` INT NOT NULL DEFAULT 1 COMMENT ''编辑乐观锁：每次成功编辑 +1；客户端回传旧值以拒绝过期覆盖''',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
