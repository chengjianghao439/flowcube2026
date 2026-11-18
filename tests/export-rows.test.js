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

test('账款导出各页使用同一只读快照，实时成员替换和余额变化不会混入', async () => {
  const { collectSnapshotExportRows } = require('../backend/src/utils/exportRows')
  const events = []
  const live = Array.from({ length: 501 }, (_, i) => ({ id: i + 1, balance: 100 }))
  let snapshot
  const connection = {
    query: async sql => {
      events.push(sql)
      if (sql === 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY') snapshot = live.map(row => ({ ...row }))
    },
    commit: async () => { events.push('commit') },
    rollback: async () => { events.push('rollback') },
    release: () => events.push('release'),
  }
  const pool = { getConnection: async () => connection }
  const result = await collectSnapshotExportRows(pool, async ({ page, pageSize, scopeWarehouseIds }, conn) => {
    assert.equal(conn, connection)
    assert.deepEqual(scopeWarehouseIds, [9])
    const offset = (page - 1) * pageSize
    const rows = snapshot.slice(offset, offset + pageSize)
    if (page === 1) live[500] = { id: 502, balance: 35 }
    return { list: rows, pagination: { total: snapshot.length } }
  }, { scopeWarehouseIds: [9] })
  assert.equal(result.list.length, 501)
  assert.deepEqual(result.list.at(-1), { id: 501, balance: 100 })
  assert.deepEqual(events, ['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', 'commit', 'release'])
})

test('账款导出第二页失败即回滚并归还连接，错误原样返回', async () => {
  const { collectSnapshotExportRows } = require('../backend/src/utils/exportRows')
  const interrupted = new Error('synthetic export interruption')
  const events = []
  const connection = {
    query: async () => {},
    rollback: async () => { events.push('rollback') },
    release: () => events.push('release'),
  }
  await assert.rejects(collectSnapshotExportRows({ getConnection: async () => connection }, async ({ page }) => {
    if (page === 2) throw interrupted
    return { list: [{ id: 1 }], pagination: { total: 2 } }
  }), error => error === interrupted)
  assert.deepEqual(events, ['rollback', 'release'])
})
