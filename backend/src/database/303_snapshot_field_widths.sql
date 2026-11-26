-- 保留 303 文件名，兼容已在测试库执行早期版本的记录。完整扩容统一由 304 执行。
-- 新安装先确认早期版本涉及的 25 列存在且为普通 VARCHAR。
SET @valid := (SELECT COUNT(*)=25 AND COUNT(CASE WHEN data_type='varchar'
    AND extra='' AND generation_expression='' THEN 1 END)=25
  FROM information_schema.columns
  WHERE table_schema=DATABASE() AND (
  (table_name IN ('sale_order_items','purchase_order_items','transfer_order_items','inbound_task_items','purchase_return_items','sale_return_items','package_items','warehouse_task_items') AND column_name IN ('article_number','spec','color'))
  OR (table_name='sale_order_adjustment_items' AND column_name='product_name')
));
SET @stmt := IF(@valid,'SELECT 1','SELECT * FROM __snapshot_303_unknown_column_shape__');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
