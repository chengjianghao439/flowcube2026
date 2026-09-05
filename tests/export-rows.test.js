const { test } = require('node:test')
const assert = require('node:assert/strict')
const { collectExportRows } = require('../backend/src/utils/exportRows')

test('导出10000条完整；10001条明确拒绝', async () => {
  const result = await collectExportRows(async ({ page, pageSize }) => ({ list: Array.from({ length: pageSize }, (_, i) => ({ id: (page - 1) * pageSize + i })), pagination: { total: 10000 } }))
  assert.equal(result.list.length, 10000)
  await assert.rejects(collectExportRows(async () => ({ list: [], pagination: { total: 10001 } })), { code: 'EXPORT_ROW_LIMIT_EXCEEDED' })
})
test('导出期间总数变化、重复行或提前空页，拒绝不完整文件', async () => {
  for (const next of [
    { list: [{ id: 2 }], pagination: { total: 3 } },
    { list: [{ id: 1 }], pagination: { total: 2 } },
    { list: [], pagination: { total: 2 } },
  ]) {
    await assert.rejects(collectExportRows(async ({ page }) => page === 1 ? { list: [{ id: 1 }], pagination: { total: 2 } } : next), { code: 'EXPORT_DATA_CHANGED' })
  }
})
