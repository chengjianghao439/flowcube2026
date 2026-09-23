'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const dbPath = require.resolve('../backend/src/config/db')
const queries = []
const pool = { query: async (sql, params) => {
  queries.push({ sql, params })
  if (sql.includes('COUNT(*) AS total')) return [[{ total: 0 }]]
  return [[]]
} }
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } }
const service = require('../backend/src/modules/users/users.service')
const exportService = require('../backend/src/modules/export/export.service')

test('开发账号筛选覆盖用户列表和下拉选项，并在分页前执行', async () => {
  queries.length = 0
  await service.findAll({ hideDevelopment: true })
  await service.listOptions(1, true)
  assert.equal(queries.length, 3)
  for (const { sql } of queries) {
    assert.match(sql, /username NOT REGEXP/)
    assert.match(sql, /cua_pda_test/)
  }
  assert.match(queries[0].sql, /WHERE[\s\S]+username NOT REGEXP[\s\S]+LIMIT/)
})

test('用户导出使用与列表相同的开发账号筛选', async () => {
  queries.length = 0
  const payload = await exportService.getUsersExportPayload({ hideDevelopment: '1' })
  assert.deepEqual(payload.rows, [])
  assert.match(queries[0].sql, /username NOT REGEXP/)
})
