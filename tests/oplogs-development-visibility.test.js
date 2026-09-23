'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const dbPath = require.resolve('../backend/src/config/db')
const queries = []
const pool = { query: async (sql, params) => {
  queries.push({ sql, params })
  return sql.includes('COUNT(*) AS total') ? [[{ total: 0 }]] : [[]]
} }
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } }
const service = require('../backend/src/modules/oplogs/oplogs.service')
const exportService = require('../backend/src/modules/export/export.service')

test('操作日志展示筛选在列表和总数中排除开发账号并保留匿名访问', async () => {
  await service.findAll({ page: 1, pageSize: 20, keyword: '', hideDevelopment: true })
  assert.equal(queries.length, 2)
  for (const { sql } of queries) {
    assert.match(sql, /user_name IS NULL/)
    assert.match(sql, /user_name NOT REGEXP/)
    assert.match(sql, /cua_pda_test/)
  }
})

test('操作日志导出复用开发账号筛选', async () => {
  queries.length = 0
  const payload = await exportService.getOplogsExportPayload({ hideDevelopment: '1' })
  assert.deepEqual(payload.rows, [])
  assert.match(queries[0].sql, /user_name NOT REGEXP/)
})

test('操作日志页面和导出可排除已留存的成功打印轮询，仍保留失败请求', async () => {
  queries.length = 0
  await service.findAll({ page: 1, pageSize: 20, keyword: '', hidePrintPolling: true })
  assert.equal(queries.length, 2)
  for (const { sql } of queries) {
    assert.match(sql, /client-heartbeat/)
    assert.match(sql, /claim-client/)
    assert.match(sql, /status_code/)
    assert.match(sql, /NOT/)
  }
  queries.length = 0
  await exportService.getOplogsExportPayload({ hidePrintPolling: '1' })
  assert.match(queries[0].sql, /client-heartbeat/)
})
