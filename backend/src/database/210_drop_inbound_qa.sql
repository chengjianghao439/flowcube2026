-- FlowCube ERP - Migration 210
-- 彻底删除「来料质检」与「拒收处置」功能（文档 07 的 QA 链路）。
--
-- 背景：质检/拒收是收货后的分流分支（建单时按供应商 qa_policy × 商品 qa_required 固化快照，
-- 收货时按快照把容器落 PENDING_QA(5)，质检分流 合格→PENDING_PUTAWAY / 拒收→REJECTED(6)，
-- 再由拒收处置消费 REJECTED 容器）。业务决定整体下线这两个作业，收货后全部直接进入待上架。
--
-- 存量数据先稳妥处理，再删表删列：
--   1) PENDING_QA(5) 容器 → PENDING_PUTAWAY(4)：已收货未质检的容器转入正常上架流（删除质检后
--      没有质检作业可处理它们，必须转态否则收货卡死）。
--   2) REJECTED(6) 容器 → VOID(3)：拒收容器从未入账（rejected_qty 不进 putaway_qty、不计库存缓存、
--      REJECTED 容器 status≠1 不参与库存），处置零 GL 影响，直接作废即可（删除功能后无处置出口）。
--   3) 处置表数据随表删除（历史处置单是功能数据，功能下线后不再保留）。
--
-- 注意：inventory_containers.status 的 5=PENDING_QA / 6=REJECTED 取值本身由迁移 100 为「销售退货质检」
-- 引入，退货流程仍在用，本迁移**只转存量容器，不删状态枚举**（CONTAINER_STATUS 常量保留）。
-- 删除动作全部用 information_schema 自行判断（MySQL 8.0 无 DROP ... IF EXISTS），可重复执行。

-- ── 1. 存量容器转态：PENDING_QA(5) → PENDING_PUTAWAY(4) ──────────────────────
UPDATE inventory_containers
   SET status = 4
 WHERE status = 5;

-- ── 2. 存量容器作废：REJECTED(6) → VOID(3) ──────────────────────────────────
UPDATE inventory_containers
   SET status = 3,
       remaining_qty = 0,
       location_id   = NULL
 WHERE status = 6;

-- ── 3. 删除拒收处置相关表（含存量处置单数据）────────────────────────────────
SET @tbl := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'inbound_qa_disposition_containers'
);
SET @sql := IF(@tbl > 0,
  'DROP TABLE `inbound_qa_disposition_containers`',
  'SELECT "inbound_qa_disposition_containers 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @tbl := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'inbound_qa_disposition_items'
);
SET @sql := IF(@tbl > 0,
  'DROP TABLE `inbound_qa_disposition_items`',
  'SELECT "inbound_qa_disposition_items 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @tbl := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'inbound_qa_dispositions'
);
SET @sql := IF(@tbl > 0,
  'DROP TABLE `inbound_qa_dispositions`',
  'SELECT "inbound_qa_dispositions 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 4. 删除来料质检列（每个列先查 information_schema 再删，保证可重复执行）──
-- inbound_task_items：qa_required / checked_qty / rejected_qty / concession_qty
SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inbound_task_items'
    AND column_name = 'concession_qty'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `inbound_task_items` DROP COLUMN `concession_qty`',
  'SELECT "concession_qty 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inbound_task_items'
    AND column_name = 'rejected_qty'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `inbound_task_items` DROP COLUMN `rejected_qty`',
  'SELECT "rejected_qty 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inbound_task_items'
    AND column_name = 'checked_qty'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `inbound_task_items` DROP COLUMN `checked_qty`',
  'SELECT "checked_qty 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inbound_task_items'
    AND column_name = 'qa_required'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `inbound_task_items` DROP COLUMN `qa_required`',
  'SELECT "qa_required 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- inbound_tasks：qa_status
SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inbound_tasks'
    AND column_name = 'qa_status'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `inbound_tasks` DROP COLUMN `qa_status`',
  'SELECT "qa_status 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- product_items：qa_required（商品质检开关，迁移 154）
SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'product_items'
    AND column_name = 'qa_required'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `product_items` DROP COLUMN `qa_required`',
  'SELECT "product_items.qa_required 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- supply_suppliers：qa_policy（供应商质检策略，迁移 154）
SET @col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'supply_suppliers'
    AND column_name = 'qa_policy'
);
SET @sql := IF(@col > 0,
  'ALTER TABLE `supply_suppliers` DROP COLUMN `qa_policy`',
  'SELECT "qa_policy 不存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 5. 清理权限授权（inbound.qa.dispose 的常量定义在代码里删）────────────────
DELETE FROM `sys_role_permissions`
 WHERE `permission` = 'inbound.qa.dispose';
