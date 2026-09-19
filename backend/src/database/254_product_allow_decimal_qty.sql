-- FlowCube ERP - Migration 254
-- 商品数量小数位开关（仿 121 的 batch_managed、168 的 serial_managed）
--
-- allow_decimal_qty = 1（默认）：该商品数量可以带小数——「1.25 公斤」「2.5 米」这类可拆分的
--   商品。**不限制小数位数**：数量列是 DECIMAL(14,4)，系统的最小库存精度就是 0.0001
--   （unitConversion.round4），收紧到两位会否掉调拨/盘点/单位换算已有的能力。
-- allow_decimal_qty = 0：该商品数量必须是整数——「个 / 台 / 箱」这类不可拆分的商品，
--   下单、收货、退货、调拨、盘点、库存调整与出库一律不接受小数数量。
--
-- **默认 1 是刻意的**：存量商品行为零变化，只有显式关掉开关的商品才受整数约束。
-- 反过来默认 0 会让所有「按重量/长度卖」的商品突然无法下单。
--
-- 数量列本身**不改精度**（`sale_order_items.quantity` 等都是 DECIMAL(14,4)）：
-- 库存事实源与历史数据不受影响，整数约束是**录入校验**，不回改既有数据——
-- 存量若已有三位以上小数的数量，仍然读得出、算得对，只是不能再这么录。

-- 刻意不写 AFTER：本列的位置无关紧要，而 AFTER 一个可能尚未执行的迁移（如 168 的
-- serial_managed）加出来的列，会让迁移在落后的库上直接失败——2026-09-19 在测试库实测过。

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_items'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_items'
       AND COLUMN_NAME = 'allow_decimal_qty'
  ),
  'ALTER TABLE `product_items` ADD COLUMN `allow_decimal_qty` TINYINT NOT NULL DEFAULT 1 COMMENT ''1=数量可带小数(两位)；0=数量必须为整数''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
