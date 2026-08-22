-- 库位条码标签默认模板（type 10，对应 print-jobs.label-command.js enqueueLocationLabelJob）。
-- 与 079_seed_default_print_templates.sql 同模式：按 (type, name) 幂等，重复执行不产生新行。
-- 变量：location_barcode（R+数字）、location_code（库位编码）、zone（区域）、name（名称）。

INSERT INTO print_templates (name, type, paper_size, layout_json, is_default)
SELECT '默认库位条码标签模板', 10, 'thermal75', '{"elements":[{"id":"lb10_bc","type":"barcode","fieldKey":"location_barcode","label":"库位条码","x":2,"y":2,"width":71,"height":12,"fontSize":10,"fontWeight":"normal","textAlign":"left","border":false},{"id":"lb10_lc","type":"text","fieldKey":"location_code","label":"库位编码","x":2,"y":16,"width":71,"height":6,"fontSize":9,"fontWeight":"normal","textAlign":"left","border":false},{"id":"lb10_z","type":"text","fieldKey":"zone","label":"区域","x":2,"y":24,"width":71,"height":6,"fontSize":8,"fontWeight":"normal","textAlign":"left","border":false},{"id":"lb10_n","type":"text","fieldKey":"name","label":"名称","x":2,"y":32,"width":71,"height":14,"fontSize":8,"fontWeight":"normal","textAlign":"left","border":false}]}', 1
WHERE EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_templates')
  AND NOT EXISTS (SELECT 1 FROM print_templates WHERE type = 10 AND name = '默认库位条码标签模板');
