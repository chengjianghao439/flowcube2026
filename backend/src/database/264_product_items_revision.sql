-- FlowCube ERP - Migration 264
-- 商品价格列的并发覆盖保护（2026-09-27）
--
-- 背景：`products.update` 无差别写 `cost_price` 与 `sale_price_a/b/c/d`，而商品编辑页会**全量回传**
-- 它「打开时读到的」旧值 ⇒ 别处刚生效的价格变更（含改价审批的 `cost`/`a`/`b`/`c`/`d`）会被一次
-- 普通编辑**静默回退**。隔离库实测：审批后 `cost_price` 150→100、`sale_price_a` 200→100 均被回退
-- （`sale_price` 列因 §18.4 方案三已不再被普通编辑写，故未受影响——说明当时只护住了一半）。
--
-- 修复方向（与发票 §20/迁移 263 同范式）：商品详情返回 `revision`，编辑页回传；普通更新在
-- **同一事务内先 `SELECT ... FOR UPDATE` 锁商品行、再比对 revision**，过期即 409；改价审批
-- `applyApprovedPrice` 在**写价格列的同一事务内**递增 revision。
--
-- 不做的事：`inbound-tasks.putaway` 写的是 `avg_cost`（移动加权成本），与编辑页提交的列**不重叠**，
-- 且收货频繁——若也递增会让编辑页频繁冲突，故**不在该路径递增**。
--
-- 幂等：重复执行无副作用（列已存在则跳过）。

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product_items'
    AND COLUMN_NAME = 'revision'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `product_items` ADD COLUMN `revision` INT NOT NULL DEFAULT 1 COMMENT ''编辑乐观锁：每次成功编辑/审批改价 +1；客户端回传旧值以拒绝过期覆盖''',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
