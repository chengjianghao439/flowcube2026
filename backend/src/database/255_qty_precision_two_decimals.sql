-- FlowCube ERP - Migration 255
-- 数量精度统一为两位小数（0.01）：所有**数量**列 DECIMAL(_,4) → DECIMAL(_,2)。
--
-- 背景：系统的最小库存精度此前是 0.0001，界面上根本读不出「0.0001 件」这种数量，
-- 而按重量/长度计量的商品两位小数已经足够。2026-09-20 按用户要求统一收到两位。
--
-- **存量数据按四舍五入到两位**（用户 2026-09-20 明确选择）：MySQL 在 MODIFY COLUMN
-- 时对 DECIMAL 缩小数位会自动四舍五入，0.0001 会变成 0.00。因此执行前请先确认
-- 生产库里 3~4 位小数的库存数量是可以接受这种处理的历史数据；查询语句见文件末尾。
--
-- **金额、单价、授信额度一律不动**：它们同样是 DECIMAL(_,4)，但那是有意的精度
-- （例如单价 8.3333 元/个），改两位会直接影响金额计算。
--
-- 幂等：每列先查 information_schema 确认 scale 仍为 4 才 ALTER；已改过的库重跑无操作。
-- 生成方式：scripts/gen-qty-precision-migration.cjs（对目标库实查 information_schema）。

SET @db = DATABASE();

-- demand_forecasts.adu（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='demand_forecasts' AND COLUMN_NAME='adu' AND NUMERIC_SCALE=4),
  'ALTER TABLE `demand_forecasts` MODIFY COLUMN `adu` DECIMAL(18,2) NOT NULL COMMENT ''日均销量（生成时点）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- demand_forecasts.forecast_demand（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='demand_forecasts' AND COLUMN_NAME='forecast_demand' AND NUMERIC_SCALE=4),
  'ALTER TABLE `demand_forecasts` MODIFY COLUMN `forecast_demand` DECIMAL(18,2) NOT NULL COMMENT ''预测需求 = adu × horizon''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- demand_forecasts.actual_sold（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='demand_forecasts' AND COLUMN_NAME='actual_sold' AND NUMERIC_SCALE=4),
  'ALTER TABLE `demand_forecasts` MODIFY COLUMN `actual_sold` DECIMAL(18,2) NULL COMMENT ''预测期实际出库（回填前为 NULL）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- disposal_scrapped.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='disposal_scrapped' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `disposal_scrapped` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL COMMENT ''报废数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inbound_task_items.ordered_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inbound_task_items' AND COLUMN_NAME='ordered_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inbound_task_items` MODIFY COLUMN `ordered_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''采购数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inbound_task_items.received_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inbound_task_items' AND COLUMN_NAME='received_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inbound_task_items` MODIFY COLUMN `received_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已收货数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inbound_task_items.putaway_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inbound_task_items' AND COLUMN_NAME='putaway_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inbound_task_items` MODIFY COLUMN `putaway_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已上架数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_check_item_containers.counted_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_check_item_containers' AND COLUMN_NAME='counted_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_check_item_containers` MODIFY COLUMN `counted_qty` DECIMAL(14,2) NOT NULL COMMENT ''现场实盘数（个体容器恒为 1）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_check_items.book_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_check_items' AND COLUMN_NAME='book_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_check_items` MODIFY COLUMN `book_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_check_items.actual_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_check_items' AND COLUMN_NAME='actual_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_check_items` MODIFY COLUMN `actual_qty` DECIMAL(14,2) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_check_items.diff_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_check_items' AND COLUMN_NAME='diff_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_check_items` MODIFY COLUMN `diff_qty` DECIMAL(14,2) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_containers.initial_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_containers' AND COLUMN_NAME='initial_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_containers` MODIFY COLUMN `initial_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''容器初始入库数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_containers.remaining_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_containers' AND COLUMN_NAME='remaining_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_containers` MODIFY COLUMN `remaining_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''当前剩余数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_disposal_items.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_disposal_items' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_disposal_items` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL COMMENT ''处置数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_logs.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_logs' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_logs` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''变动数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_logs.change_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_logs' AND COLUMN_NAME='change_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_logs` MODIFY COLUMN `change_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''变动数量（遗留列，现统一用 quantity）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_logs.before_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_logs' AND COLUMN_NAME='before_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_logs` MODIFY COLUMN `before_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''变动前数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_logs.after_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_logs' AND COLUMN_NAME='after_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_logs` MODIFY COLUMN `after_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''变动后数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_stock.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_stock' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_stock` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''库存数量缓存''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- inventory_stock.reserved（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='inventory_stock' AND COLUMN_NAME='reserved' AND NUMERIC_SCALE=4),
  'ALTER TABLE `inventory_stock` MODIFY COLUMN `reserved` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已预占数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- package_items.qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='package_items' AND COLUMN_NAME='qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `package_items` MODIFY COLUMN `qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- picking_wave_items.total_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='picking_wave_items' AND COLUMN_NAME='total_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `picking_wave_items` MODIFY COLUMN `total_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- picking_wave_items.picked_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='picking_wave_items' AND COLUMN_NAME='picked_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `picking_wave_items` MODIFY COLUMN `picked_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- picking_wave_routes.qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='picking_wave_routes' AND COLUMN_NAME='qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `picking_wave_routes` MODIFY COLUMN `qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- procurement_plan_items.adu（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='procurement_plan_items' AND COLUMN_NAME='adu' AND NUMERIC_SCALE=4),
  'ALTER TABLE `procurement_plan_items` MODIFY COLUMN `adu` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''预测日均需求 = 近N天出库/N''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- procurement_plan_items.forecast_demand（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='procurement_plan_items' AND COLUMN_NAME='forecast_demand' AND NUMERIC_SCALE=4),
  'ALTER TABLE `procurement_plan_items` MODIFY COLUMN `forecast_demand` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''毛需求 = adu×(提前期+覆盖周期)''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- procurement_plan_items.safety_stock（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='procurement_plan_items' AND COLUMN_NAME='safety_stock' AND NUMERIC_SCALE=4),
  'ALTER TABLE `procurement_plan_items` MODIFY COLUMN `safety_stock` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''安全库存快照（取自 product_stock_policies）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- procurement_plan_items.available（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='procurement_plan_items' AND COLUMN_NAME='available' AND NUMERIC_SCALE=4),
  'ALTER TABLE `procurement_plan_items` MODIFY COLUMN `available` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''可用量快照 = GREATEST(0, quantity-reserved)''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- procurement_plan_items.in_transit（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='procurement_plan_items' AND COLUMN_NAME='in_transit' AND NUMERIC_SCALE=4),
  'ALTER TABLE `procurement_plan_items` MODIFY COLUMN `in_transit` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''在途采购快照''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- procurement_plan_items.suggested_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='procurement_plan_items' AND COLUMN_NAME='suggested_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `procurement_plan_items` MODIFY COLUMN `suggested_qty` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''系统建议采购量 = GREATEST(0, 毛需求+安全库存-可用-在途)''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- procurement_plan_items.adjusted_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='procurement_plan_items' AND COLUMN_NAME='adjusted_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `procurement_plan_items` MODIFY COLUMN `adjusted_qty` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''采购员调整后数量，默认=suggested_qty''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- product_stock_policies.safety_stock（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_stock_policies' AND COLUMN_NAME='safety_stock' AND NUMERIC_SCALE=4),
  'ALTER TABLE `product_stock_policies` MODIFY COLUMN `safety_stock` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''安全库存下限（低于=紧急缺货风险）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- product_stock_policies.reorder_point（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_stock_policies' AND COLUMN_NAME='reorder_point' AND NUMERIC_SCALE=4),
  'ALTER TABLE `product_stock_policies` MODIFY COLUMN `reorder_point` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''补货点：可用+在途 低于此即建议补货''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- product_stock_policies.target_stock（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_stock_policies' AND COLUMN_NAME='target_stock' AND NUMERIC_SCALE=4),
  'ALTER TABLE `product_stock_policies` MODIFY COLUMN `target_stock` DECIMAL(18,2) NULL COMMENT ''目标库存，补货补到此值；NULL 则补到补货点''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- purchase_order_items.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='purchase_order_items' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `purchase_order_items` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- purchase_order_items.entry_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='purchase_order_items' AND COLUMN_NAME='entry_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `purchase_order_items` MODIFY COLUMN `entry_qty` DECIMAL(18,2) NULL COMMENT ''录入单位下的数量（快照，不参与计算）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- purchase_requisition_conversions.quantity（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='purchase_requisition_conversions' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `purchase_requisition_conversions` MODIFY COLUMN `quantity` DECIMAL(18,2) NOT NULL COMMENT ''本次从该请购行转出的数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- purchase_requisition_items.quantity（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='purchase_requisition_items' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `purchase_requisition_items` MODIFY COLUMN `quantity` DECIMAL(18,2) NOT NULL COMMENT ''请购数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- purchase_requisition_items.converted_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='purchase_requisition_items' AND COLUMN_NAME='converted_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `purchase_requisition_items` MODIFY COLUMN `converted_qty` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''已转采购量（分批转单累加），仿 sale_order_items.dispatched 分批语义''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- purchase_return_items.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='purchase_return_items' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `purchase_return_items` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- purchase_return_items.entry_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='purchase_return_items' AND COLUMN_NAME='entry_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `purchase_return_items` MODIFY COLUMN `entry_qty` DECIMAL(18,2) NULL COMMENT ''录入单位下的数量（快照，不参与计算）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- return_task_items.expected_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='return_task_items' AND COLUMN_NAME='expected_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `return_task_items` MODIFY COLUMN `expected_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''应退数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- return_task_items.received_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='return_task_items' AND COLUMN_NAME='received_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `return_task_items` MODIFY COLUMN `received_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已收货数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- return_task_items.checked_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='return_task_items' AND COLUMN_NAME='checked_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `return_task_items` MODIFY COLUMN `checked_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已质检数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- return_task_items.rejected_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='return_task_items' AND COLUMN_NAME='rejected_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `return_task_items` MODIFY COLUMN `rejected_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''质检不合格数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- return_task_items.putaway_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='return_task_items' AND COLUMN_NAME='putaway_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `return_task_items` MODIFY COLUMN `putaway_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已上架数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_adjustment_container_returns.qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_adjustment_container_returns' AND COLUMN_NAME='qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_adjustment_container_returns` MODIFY COLUMN `qty` DECIMAL(12,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_adjustment_items.old_required_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_adjustment_items' AND COLUMN_NAME='old_required_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_adjustment_items` MODIFY COLUMN `old_required_qty` DECIMAL(12,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_adjustment_items.new_required_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_adjustment_items' AND COLUMN_NAME='new_required_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_adjustment_items` MODIFY COLUMN `new_required_qty` DECIMAL(12,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_adjustment_items.pending_return_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_adjustment_items' AND COLUMN_NAME='pending_return_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_adjustment_items` MODIFY COLUMN `pending_return_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''需物理放回库位的数量，PDA确认后才释放预占/降低picked_qty''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_adjustment_items.pending_pick_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_adjustment_items' AND COLUMN_NAME='pending_pick_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_adjustment_items` MODIFY COLUMN `pending_pick_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''需补拣数量（复用现有拣货流程，本字段仅用于展示）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_expected_bindings.qty（decimal(16,4) → DECIMAL(16,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_expected_bindings' AND COLUMN_NAME='qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_expected_bindings` MODIFY COLUMN `qty` DECIMAL(16,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_items.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_items' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_items` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_items.entry_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_items' AND COLUMN_NAME='entry_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_items` MODIFY COLUMN `entry_qty` DECIMAL(18,2) NULL COMMENT ''录入单位下的数量（快照，不参与计算）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_items.shipped_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_items' AND COLUMN_NAME='shipped_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_items` MODIFY COLUMN `shipped_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''已发数量（分批累加）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_items.reserved_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_items' AND COLUMN_NAME='reserved_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_items` MODIFY COLUMN `reserved_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''已占数量（按数量占库，<= quantity）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_order_items.dispatched_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_order_items' AND COLUMN_NAME='dispatched_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_order_items` MODIFY COLUMN `dispatched_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''已派发到仓库任务的数量（替代 dispatched 布尔）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_return_items.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_return_items' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_return_items` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sale_return_items.entry_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='sale_return_items' AND COLUMN_NAME='entry_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `sale_return_items` MODIFY COLUMN `entry_qty` DECIMAL(18,2) NULL COMMENT ''录入单位下的数量（快照，不参与计算）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- scan_logs.qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='scan_logs' AND COLUMN_NAME='qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `scan_logs` MODIFY COLUMN `qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''扫描数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- stock_reservations.qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='stock_reservations' AND COLUMN_NAME='qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `stock_reservations` MODIFY COLUMN `qty` DECIMAL(12,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- supplier_product_purchase_policies.pack_multiple（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supplier_product_purchase_policies' AND COLUMN_NAME='pack_multiple' AND NUMERIC_SCALE=4),
  'ALTER TABLE `supplier_product_purchase_policies` MODIFY COLUMN `pack_multiple` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''Packaging multiple in entry unit; zero means unrestricted''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- supplier_product_purchase_policies.minimum_order_qty（decimal(18,4) → DECIMAL(18,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supplier_product_purchase_policies' AND COLUMN_NAME='minimum_order_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `supplier_product_purchase_policies` MODIFY COLUMN `minimum_order_qty` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT ''MOQ in entry unit''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- transfer_order_items.quantity（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transfer_order_items' AND COLUMN_NAME='quantity' AND NUMERIC_SCALE=4),
  'ALTER TABLE `transfer_order_items` MODIFY COLUMN `quantity` DECIMAL(14,2) NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- transfer_order_items.deducted_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transfer_order_items' AND COLUMN_NAME='deducted_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `transfer_order_items` MODIFY COLUMN `deducted_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''已扫出(源仓出库)数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- transfer_order_items.received_qty（decimal(14,4) → DECIMAL(14,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transfer_order_items' AND COLUMN_NAME='received_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `transfer_order_items` MODIFY COLUMN `received_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT ''已扫入(目标仓入库)数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- warehouse_task_items.required_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='warehouse_task_items' AND COLUMN_NAME='required_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `warehouse_task_items` MODIFY COLUMN `required_qty` DECIMAL(12,2) NOT NULL COMMENT ''需备货数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- warehouse_task_items.picked_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='warehouse_task_items' AND COLUMN_NAME='picked_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `warehouse_task_items` MODIFY COLUMN `picked_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已备货数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- warehouse_task_items.sorted_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='warehouse_task_items' AND COLUMN_NAME='sorted_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `warehouse_task_items` MODIFY COLUMN `sorted_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已分拣数量''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- warehouse_task_items.checked_qty（decimal(12,4) → DECIMAL(12,2)）
SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='warehouse_task_items' AND COLUMN_NAME='checked_qty' AND NUMERIC_SCALE=4),
  'ALTER TABLE `warehouse_task_items` MODIFY COLUMN `checked_qty` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''已复核数量（PDA 复核阶段填写）''', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 执行后自查：下面这条应返回 0 行（数量列不再有 scale=4 的）
-- SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE='decimal' AND NUMERIC_SCALE=4
--    AND COLUMN_NAME IN ('quantity','qty','entry_qty','base_qty','remaining_qty','initial_qty','reserved','reserved_qty','dispatched_qty','shipped_qty','received_qty','putaway_qty','picked_qty','sorted_qty','checked_qty','counted_qty','rejected_qty','required_qty','ordered_qty','expected_qty','deducted_qty','converted_qty','bound_qty','pending_return_qty','pending_pick_qty','old_required_qty','new_required_qty','diff_qty','book_qty','actual_qty','before_qty','after_qty','change_qty','safety_stock','reorder_point','pack_multiple','minimum_order_qty','min_order_qty','shortage_qty','over_qty','available_qty','allocated_qty','scanned_qty','total_qty','in_transit_qty','pending_qty','closed_qty','adu','actual_sold','forecast_demand','adjusted_qty','suggested_qty','available','in_transit','target_stock');

-- 执行前核对存量（把 <列> 换成要查的列）：
-- SELECT COUNT(*) FROM <表> WHERE <列> IS NOT NULL AND ROUND(<列>,4) <> ROUND(<列>,2);