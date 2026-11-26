#!/usr/bin/env node
'use strict'

// 219 的老数据可能是可解码的数组、截断字符串或 JSON null。只返回编号与分类。
async function inspectTemplates(conn) {
  const [rows] = await conn.query(`SELECT id, type, JSON_TYPE(JSON_EXTRACT(layout_json,'$.elements')) AS element_type,
         CASE WHEN JSON_TYPE(JSON_EXTRACT(layout_json,'$.elements'))='STRING'
              THEN JSON_UNQUOTE(JSON_EXTRACT(layout_json,'$.elements')) END AS encoded
    FROM print_templates
    WHERE (type BETWEEN 1 AND 4 OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(layout_json,'$.format')),'') <> 'zpl')
      AND COALESCE(JSON_TYPE(JSON_EXTRACT(layout_json,'$.elements')),'MISSING') <> 'ARRAY'
    ORDER BY id`)
  return rows.map(row => {
    let state = 'needs-original'
    if (row.element_type === 'STRING') {
      try { if (Array.isArray(JSON.parse(row.encoded))) state = 'encoded-array' } catch { /* 原版可能已截断。 */ }
    }
    return { id: Number(row.id), type: Number(row.type), state }
  })
}

if (require.main === module) {
  require('dotenv').config()
  const { pool } = require('../src/config/db')
  inspectTemplates(pool).then(rows => console.log(JSON.stringify(rows, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => pool.end())
}
module.exports = { inspectTemplates }
