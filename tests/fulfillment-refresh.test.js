const test = require('node:test')
const assert = require('node:assert/strict')
let refresh = {}
try { refresh = require('../backend/src/modules/fulfillment/fulfillment.refresh-queue') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }

test('重复提交合并，队列容量与每轮处理数有界', async () => {
  assert.equal(typeof refresh.createRefreshQueue, 'function')
  const seen = []
  const queue = refresh.createRefreshQueue({ process: async job => { seen.push(job.id) }, capacity: 2, batchSize: 1 })
  assert.equal(queue.notify('sale', 1), true)
  assert.equal(queue.notify('sale', 1), true)
  queue.notify('purchase', 2)
  assert.equal(queue.notify('sale', 3), false)
  await queue.run()
  assert.deepEqual(seen, [1])
  assert.equal(queue.stats().pending, 1)
  assert.equal(queue.stats().overflow, 1)
  await queue.run()
  assert.deepEqual(seen, [1, 2])
})
test('处理中再次变化保留，防止重入与无限同轮处理', async () => {
  assert.equal(typeof refresh.createRefreshQueue, 'function')
  let finish, calls = 0
  const queue = refresh.createRefreshQueue({ process: async () => { calls++; if (calls === 1) await new Promise(resolve => { finish = resolve }) } })
  queue.notify('sale', 1)
  const running = queue.run()
  await queue.run()
  queue.notify('sale', 1)
  finish()
  await running
  assert.equal(calls, 1)
  assert.equal(queue.stats().pending, 1)
  await queue.run()
  assert.equal(calls, 2)
  assert.equal(queue.stats().pending, 0)
})
test('失败退避三次后释放，诊断不返回原始错误', async () => {
  assert.equal(typeof refresh.createRefreshQueue, 'function')
  let now = 0, attempts = 0
  const queue = refresh.createRefreshQueue({ now: () => now, process: async () => { attempts++; throw new Error('password=secret') } })
  queue.notify('purchase', 1)
  await queue.run()
  await queue.run()
  assert.equal(attempts, 1)
  now = 1000; await queue.run()
  now = 3000; await queue.run()
  assert.equal(attempts, 3)
  assert.equal(queue.stats().pending, 0)
  assert.equal(queue.stats().exhausted, 1)
  assert.ok(!JSON.stringify(queue.stats()).includes('secret'))
})
test('依赖分页继续执行，新变化重置游标，非法通知不入队', async () => {
  assert.equal(typeof refresh.createRefreshQueue, 'function')
  const cursors = []
  const queue = refresh.createRefreshQueue({ process: async job => { cursors.push(job.cursor); return job.cursor ? null : 20 } })
  assert.equal(queue.notify('invalid', 1), false)
  assert.equal(queue.notify('sale', -1), false)
  queue.notify('purchase', 1)
  await queue.run()
  queue.notify('purchase', 1)
  await queue.run()
  await queue.run()
  assert.deepEqual(cursors, [0, 0, 20])
})
test('仅成功提交后通知；提交失败和回滚无通知，通知异常不改变提交结果', async () => {
  assert.equal(typeof refresh.createCommitNotifier, 'function')
  const calls = []
  const commit = refresh.createCommitNotifier((...args) => calls.push(args))
  let resolveCommit
  const pending = commit({ commit: () => new Promise(resolve => { resolveCommit = resolve }) }, 'sale', 4)
  assert.deepEqual(calls, [])
  resolveCommit(); await pending
  assert.deepEqual(calls, [['sale', 4]])
  await assert.rejects(commit({ commit: async () => { throw new Error('rollback') } }, 'sale', 5))
  assert.equal(calls.length, 1)
  await refresh.createCommitNotifier(() => { throw new Error('notification only') })({ commit: async () => {} }, 'sale', 6)
})
test('事项列表共享筛选计数，权限范围先于业务快照搜索，批量最多500', async () => {
  require.cache[require.resolve('../backend/src/config/db')] = { exports: { pool: { query: async () => { throw new Error('offline test cannot connect') } } } }
  let createIssueReader
  try { ({ createIssueReader } = require('../backend/src/modules/fulfillment/fulfillment.query')) } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
  assert.equal(typeof createIssueReader, 'function')
  const queries = []
  const read = createIssueReader({ query: async (sql, values) => {
    queries.push({ sql, values })
    if (sql.includes('AS open')) return [[{ open: 1 }]]
    if (sql.includes('COUNT(*)')) return [[{ total: 1 }]]
    return [[{ id: 2, documentNo: 'SO-1', partyName: '客户', warehouseName: '一仓' }]]
  } })
  const result = await read({ keyword: "a' OR 1=1 --", documentType: 'sale', pageSize: 99999 }, { roleId: 1, userId: 1, warehouseIds: [2] })
  assert.equal(result.pagination.pageSize, 500)
  assert.equal(queries.length, 3)
  assert.ok(queries[1].sql.includes('NOT EXISTS(SELECT 1 FROM sale_order_items'))
  assert.ok(queries[2].sql.includes('AS documentNo'))
  assert.ok(!queries[1].sql.includes("a' OR"))
  assert.ok(queries[1].values.includes("%a' OR 1=1 --%"))
  assert.deepEqual(queries[2].values.slice(0, -2), queries[1].values)
  await assert.rejects(read({ documentType: 'other' }, { roleId: 1 }), /类型/)
})
test('运行诊断仅管理员可读，内容为有界匿名统计', () => {
  const runtime = require('../backend/src/modules/fulfillment/fulfillment.refresh')
  assert.equal(typeof runtime.getRefreshStatus, 'function')
  assert.throws(() => runtime.getRefreshStatus({ roleId: 2 }), e => e.statusCode === 403)
  const status = runtime.getRefreshStatus({ roleId: 1 })
  assert.equal(status.capacity, 1000)
  assert.equal(status.batchSize, 25)
  assert.equal(status.lastFailureAt, null)
  assert.ok(!Object.hasOwn(status, 'jobs'))
})
test('库存维度通知共享容量并合并，提交失败不发送旧维度', async () => {
  const queue = refresh.createRefreshQueue({ process: async () => {}, capacity: 1 })
  assert.equal(queue.notify('stock', '12:34'), true)
  assert.equal(queue.notify('stock', '12:34'), true)
  assert.equal(queue.notify('stock', '12:35'), false)
  assert.equal(queue.notify('stock', '12:0'), false)
  const notifications = []
  const commit = refresh.createCommitNotifier((...args) => notifications.push(args))
  await assert.rejects(commit({ commit: async () => { throw Error('failed') } }, 'sale', 1, { pairs: ['12:34'] }))
  assert.deepEqual(notifications, [])
  await commit({ commit: async () => {} }, 'sale', 1, { pairs: ['12:34'] })
  assert.deepEqual(notifications, [['sale', 1], ['stock', '12:34']])
})
test('旧维度快照有界并显式记录截断，回滚前不通知', async () => {
  const runtime = require('../backend/src/modules/fulfillment/fulfillment.refresh')
  assert.equal(typeof runtime.captureDimensions, 'function')
  const queries = []
  const snapshot = await runtime.captureDimensions({ query: async (sql, params) => {
    queries.push({ sql, params })
    return [Array.from({ length: 501 }, (_, i) => ({ productId: i + 1, warehouseId: 2 }))]
  } }, 'sale', 8)
  assert.equal(snapshot.pairs.length, 500)
  assert.equal(snapshot.truncated, true)
  assert.ok(queries[0].sql.includes('COALESCE(x.warehouse_id,d.warehouse_id)'))
  assert.equal(queries[0].params.at(-1), 501)
  let overflow = 0
  const commit = refresh.createCommitNotifier(() => {}, () => overflow++)
  await commit({ commit: async () => {} }, 'sale', 8, snapshot)
  assert.equal(overflow, 1)
})
test('26个同维度直接通知经真实processor分页后收敛，不被依赖通知反复拉回首页', async () => {
  const { createRefreshProcessor } = require('../backend/src/modules/fulfillment/fulfillment.refresh')
  const ids = Array.from({ length: 26 }, (_, index) => index + 1)
  const refreshed = new Set()
  let queries = 0, queue
  const processor = createRefreshProcessor({
    pool: { query: async (_sql, [after, own, _source, limit]) => { queries++; return [ids.filter(id => id > after && id !== own).slice(0, limit).map(id => ({ id }))] } },
    syncDocument: async (_type, id) => { refreshed.add(id) },
    notify: (...args) => queue.notify(...args),
  })
  queue = refresh.createRefreshQueue({ process: processor, budgetMs: 10000 })
  for (const id of ids) queue.notify('sale', id)
  for (let round = 0; round < 20 && queue.stats().pending; round++) await queue.run()
  assert.equal(queue.stats().pending, 0, '依赖提示不得打断已开始的展开游标')
  assert.equal(refreshed.size, 26)
  assert.ok(queries <= 52, '每张单据最多两个依赖分页查询')
})
test('展开期间收到依赖通知保留一次自身复检，不重跑依赖首页', async () => {
  const cursors = []
  let finish, queue
  queue = refresh.createRefreshQueue({ process: async job => {
    cursors.push({ cursor: job.cursor, expand: job.expand })
    if (cursors.length === 1) { await new Promise(resolve => { finish = resolve }); return 25 }
    return null
  } })
  queue.notify('sale', 1)
  const running = queue.run()
  queue.notify('sale', 1, false)
  finish(); await running
  await queue.run()
  await queue.run()
  assert.deepEqual(cursors, [{ cursor: 0, expand: true }, { cursor: 25, expand: true }, { cursor: 0, expand: false }])
  assert.equal(queue.stats().pending, 0)
})
