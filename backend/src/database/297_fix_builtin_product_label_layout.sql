-- 219 used JSON_SET(... CAST(... AS CHAR)), storing the product-label
-- elements as a JSON string. Only restore the complete known 079 system seed
-- after its spec-label rename; never guess from a template name or a prefix.
-- The other seeded label types do not contain the old spec label and are intact.
-- Customized/unknown/truncated layouts stay visible as validation failures.
-- Keep IDs, metadata, paper size and the user's current default choice.

SET @builtin_product_label_297 = CAST('{"elements":[{"id":"lb8_bc","type":"barcode","fieldKey":"product_code","label":"产品条码","x":2,"y":2,"width":71,"height":12,"fontSize":10,"fontWeight":"normal","textAlign":"left","border":false},{"id":"lb8_pn","type":"text","fieldKey":"product_name","label":"产品名称","x":2,"y":16,"width":71,"height":8,"fontSize":9,"fontWeight":"normal","textAlign":"left","border":false},{"id":"lb8_sp","type":"text","fieldKey":"spec","label":"型号","x":2,"y":26,"width":71,"height":6,"fontSize":9,"fontWeight":"normal","textAlign":"left","border":false}]}' AS JSON);

UPDATE print_templates
SET layout_json = @builtin_product_label_297
WHERE type = 8
  AND BINARY name = BINARY '默认产品条码标签模板'
  AND BINARY paper_size = BINARY 'thermal75'
  AND created_by IS NULL
  AND JSON_TYPE(layout_json) = 'OBJECT'
  AND JSON_LENGTH(layout_json) = 1
  AND JSON_TYPE(JSON_EXTRACT(layout_json, '$.elements')) = 'STRING'
  AND CASE
    WHEN JSON_VALID(JSON_UNQUOTE(JSON_EXTRACT(layout_json, '$.elements')))
    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(layout_json, '$.elements')) AS JSON)
    ELSE NULL
  END = JSON_EXTRACT(@builtin_product_label_297, '$.elements');
