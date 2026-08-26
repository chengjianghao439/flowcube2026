-- 打印模板 spec 字段标签订正：规格 → 型号
--
-- 背景：product_items.spec（及 082/093 等快照列）的真实语义是「型号」——
-- 商品资料页/表单、商品选择器、各单据、后端 zod 校验（'型号不能为空'）、
-- 089 迁移注释全部叫「型号」，唯独打印模板相关 3 处标签 + 079 种子模板误标为
-- 「规格」，导致报表/单据打印列头与商品资料对不上。
--
-- 本迁移只订正 print_templates.layout_json 中 fieldKey='spec' AND label='规格'
-- 的元素（079 已 seed 的默认模板 + 用户已保存的模板）；代码里的 printFieldDefs/
-- TemplateRenderer 随发版走，不在本迁移范围。
-- 幂等：改后不再命中「规格」，重跑 affectedRows=0。
-- 结构说明：JSON_TABLE 按 ORDINALITY 保持元素原顺序重组成数组（字段 x/y/width 等
-- 顺序变化不影响语义，TemplateRenderer/editor 均按 key 取值）。

UPDATE print_templates pt
SET pt.layout_json = JSON_SET(pt.layout_json, '$.elements',
  CAST(CONCAT('[', (SELECT GROUP_CONCAT(
      IF(JSON_EXTRACT(t.el, '$.fieldKey') = 'spec' AND JSON_EXTRACT(t.el, '$.label') = '规格',
         CAST(JSON_SET(t.el, '$.label', '型号') AS CHAR),
         CAST(t.el AS CHAR))
      ORDER BY t.ord SEPARATOR ',')
    FROM JSON_TABLE(pt.layout_json, '$.elements[*]' COLUMNS (ord FOR ORDINALITY, el JSON PATH '$')) AS t), ']') AS CHAR))
WHERE JSON_SEARCH(pt.layout_json, 'one', '规格') IS NOT NULL;
