-- 086: 补充关键表的缺失索引，优化查询性能
-- purchase / sale / inventory 子表长期缺少 order_id / check_id 索引

-- purchase_order_items: order_id 是 JOIN 条件但无索引 → 全表扫描
ALTER TABLE purchase_order_items ADD INDEX idx_order_id (order_id);

-- sale_order_items: 同上
ALTER TABLE sale_order_items ADD INDEX idx_order_id (order_id);

-- inventory_check_items: check_id 是 JOIN 条件但无索引
ALTER TABLE inventory_check_items ADD INDEX idx_check_id (check_id);

-- inventory_check_items: 同一盘点单不应有重复产品，加唯一约束
ALTER TABLE inventory_check_items ADD UNIQUE KEY uk_check_product (check_id, product_id);

-- transfer_order_items: 缺少 product_id 索引
ALTER TABLE transfer_order_items ADD INDEX idx_product_id (product_id);

-- package_items: 缺少 product_id 索引
ALTER TABLE package_items ADD INDEX idx_product_id (product_id);

-- picking_wave_tasks: 同一波次不应重复分配任务
ALTER TABLE picking_wave_tasks ADD UNIQUE KEY uk_wave_task (wave_id, task_id);

-- picking_wave_items: 同一波次内产品不应重复
ALTER TABLE picking_wave_items ADD UNIQUE KEY uk_wave_product (wave_id, product_id);

-- operation_requests: 添加字符集声明（原表遗漏）
ALTER TABLE operation_requests CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
