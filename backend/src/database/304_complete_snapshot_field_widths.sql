-- 只扩宽已知旧列。保留列字符集、排序规则、备注及已有更宽的列。
DROP TEMPORARY TABLE IF EXISTS fc_304_snapshot_columns;
CREATE TEMPORARY TABLE fc_304_snapshot_columns AS
SELECT table_name AS tbl, column_name AS col, data_type, character_maximum_length AS width,
       character_set_name, collation_name, column_comment, is_nullable, column_default, extra, generation_expression,
       CASE WHEN column_name='product_name' AND table_name IN ('inbound_task_items','picking_wave_items','picking_wave_routes')
            THEN 'NO' ELSE 'YES' END AS expected_nullable,
       CASE column_name WHEN 'article_number' THEN 50 WHEN 'spec' THEN 100 WHEN 'color' THEN 30 ELSE 100 END AS old_width,
       CASE column_name WHEN 'article_number' THEN 100 WHEN 'spec' THEN 200 WHEN 'color' THEN 60 ELSE 150 END AS new_width
FROM information_schema.columns
WHERE table_schema=DATABASE() AND (
  (table_name IN ('sale_order_items','purchase_order_items','transfer_order_items','inbound_task_items','purchase_return_items','sale_return_items','package_items','warehouse_task_items') AND column_name IN ('article_number','spec','color'))
  OR (table_name IN ('sale_order_adjustment_items','inbound_task_items','picking_wave_items','picking_wave_routes') AND column_name='product_name')
  OR (table_name='sale_commercial_components' AND column_name='spec')
);
-- 在第一条 ALTER 前检查整组，避免其中一列漂移却只改了部分表。
SET @valid := (SELECT COUNT(*)=29 AND COUNT(CASE WHEN data_type='varchar'
  AND (width=old_width OR width>=new_width) AND is_nullable=expected_nullable
  AND extra='' AND generation_expression=''
  AND character_set_name REGEXP '^[A-Za-z_][A-Za-z0-9_]*$'
  AND collation_name REGEXP '^[A-Za-z_][A-Za-z0-9_]*$' THEN 1 END)=29
  FROM fc_304_snapshot_columns);
SET @stmt := IF(@valid,'SELECT 1','SELECT * FROM __snapshot_304_unknown_column_shape__');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @no_backslash := FIND_IN_SET('NO_BACKSLASH_ESCAPES', @@SESSION.sql_mode) > 0;
SET @saved_concat := @@SESSION.group_concat_max_len;
SET SESSION group_concat_max_len=65536;
DROP TEMPORARY TABLE IF EXISTS fc_304_snapshot_ddl;
CREATE TEMPORARY TABLE fc_304_snapshot_ddl AS
SELECT tbl, CONCAT('ALTER TABLE `',tbl,'` ',GROUP_CONCAT(
  CONCAT('MODIFY COLUMN `',col,'` VARCHAR(',new_width,') CHARACTER SET `',character_set_name,
         '` COLLATE `',collation_name,'` ',IF(is_nullable='YES','NULL','NOT NULL'),
         CASE WHEN column_default IS NULL THEN IF(is_nullable='YES',' DEFAULT NULL','')
              ELSE CONCAT(' DEFAULT ',IF(@no_backslash,
                CONCAT(CHAR(39),REPLACE(column_default,CHAR(39),CONCAT(CHAR(39),CHAR(39))),CHAR(39)),
                QUOTE(column_default))) END,
         ' COMMENT ',IF(@no_backslash,
           CONCAT(CHAR(39),REPLACE(column_comment,CHAR(39),CONCAT(CHAR(39),CHAR(39))),CHAR(39)),
           QUOTE(column_comment))) ORDER BY col SEPARATOR ', ')) AS ddl
FROM fc_304_snapshot_columns WHERE width=old_width GROUP BY tbl;
SET SESSION group_concat_max_len=@saved_concat;

SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='sale_order_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='purchase_order_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='transfer_order_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='inbound_task_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='purchase_return_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='sale_return_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='package_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='warehouse_task_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='sale_order_adjustment_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='picking_wave_items'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='picking_wave_routes'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @stmt := COALESCE((SELECT ddl FROM fc_304_snapshot_ddl WHERE tbl='sale_commercial_components'),'SELECT 1');
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
DROP TEMPORARY TABLE fc_304_snapshot_ddl;
DROP TEMPORARY TABLE fc_304_snapshot_columns;
