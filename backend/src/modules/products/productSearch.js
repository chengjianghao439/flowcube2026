const { assertSqlIdentifier, assertSqlColumnList } = require('../../utils/sqlIdentifier')

// 三个商品搜索入口共用同一静态字段口径；值、命中说明与精确等级均由数据库比较。
const PRODUCT_SEARCH_FIELDS = ['code', 'name', 'barcode', 'article_number', 'spec', 'color']
const LABELS = ['编码', '名称', '条码', '供应商型号', '型号', '颜色']

function productSearch(rawKeyword, alias = null) {
  const keyword = String(rawKeyword || '').trim()
  if (alias != null) assertSqlIdentifier(alias, 'product search alias')
  const fields = PRODUCT_SEARCH_FIELDS.map(field => alias ? `${alias}.${field}` : field)
  assertSqlColumnList(fields.join(', '), 'product search fields')
  if (!keyword) return { keyword, where: '', select: '', whereParams: [], selectParams: [] }
  // 使用显式转义字符，字面匹配不依赖 MySQL 的反斜杠 SQL_MODE。
  const literal = keyword.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')
  const matches = fields.map(field => `${field} LIKE ? ESCAPE '!'`)
  const whereParams = fields.map(() => `%${literal}%`)
  const otherExact = [fields[1], fields[3], fields[4], fields[5]]
  return {
    keyword,
    where: `(${matches.join(' OR ')})`,
    select: `, CONCAT_WS('、', ${fields.map((field, i) => `IF(NULLIF(${field}, '') LIKE ? ESCAPE '!', '${LABELS[i]}', NULL)`).join(', ')}) AS search_match,
      CASE WHEN ${fields[0]} = ? OR ${fields[2]} = ? THEN 0
        WHEN ${otherExact.map(field => `${field} = ?`).join(' OR ')} THEN 1
        WHEN ${matches.join(' OR ')} THEN 2 ELSE 3 END AS search_rank`,
    whereParams,
    selectParams: [...whereParams, keyword, keyword, ...otherExact.map(() => keyword), ...fields.map(() => `${literal}%`)],
  }
}

module.exports = { PRODUCT_SEARCH_FIELDS, productSearch }
