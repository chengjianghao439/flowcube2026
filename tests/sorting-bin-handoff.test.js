'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const calls = []
const dbPath = require.resolve('../backend/src/config/db')
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async (sql, params) => { calls.push({ sql, params }); return sql.includes('COUNT(*)') ? [[{ total: 1 }]] : [[{ id: 91, task_no: 'WT-91', warehouse_id: 8, status: 2 }]] } } } }
const service = require('../backend/src/modules/warehouse-tasks/warehouse-tasks.sorting-bin')
test('精确任务过滤在分页前应用，并同仓库、范围、资格条件用于数据与计数', async () => {
  calls.length = 0
  const result = await service.listAwaitingSortingBin({ taskId: 91, warehouseId: 8, scopeWarehouseIds: [8], pageSize: 20 })
  assert.equal(result.list[0].id, 91)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.match(call.sql, /wt\.id=\?/)
    assert.match(call.sql, /wt\.warehouse_id=\?/)
    assert.match(call.sql, /wt\.warehouse_id IN/)
    assert.match(call.sql, /wt\.sorting_bin_id IS NULL/)
    assert.match(call.sql, /wt\.cancel_requested_at IS NULL AND wt\.adjustment_requested_at IS NULL/)
    assert.ok(call.params.includes(91))
  }
})
