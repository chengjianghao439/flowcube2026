'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
function load(name) {
  const p = path.join(root, 'backend/src/utils', name)
  assert.ok(fs.existsSync(p), `缺少 ${name} 的有界实现`)
  return require(p)
}
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function connection() {
  return {
    released: 0, destroyed: 0, writes: 0,
    release() { this.released++ }, destroy() { this.destroyed++ },
    async query() { this.writes++; return [[{ ok: 1 }], []] },
    async execute() { this.writes++; return [[{ ok: 1 }], []] },
  }
}
for (const method of ['query', 'execute', 'getConnection']) {
  test(`${method} 获取连接超时后不能执行迟到操作，迟到连接归还`, async () => {
    const { boundPoolAcquisition } = load('boundedPool.js')
    const wait = deferred(), conn = connection()
    const pool = boundPoolAcquisition({ getConnection: () => wait.promise }, { timeoutMs: 15 })
    await assert.rejects(pool[method]('INSERT probe'), { code: 'DB_ACQUIRE_TIMEOUT', statusCode: 503 })
    wait.resolve(conn)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(conn.writes, 0)
    assert.equal(conn.released, 1)
    assert.equal(pool.getAcquisitionStats().timeouts, 1)
  })
}
test('正常查询、参数及连接释放保持原语义，SQL异常也释放', async () => {
  const { boundPoolAcquisition } = load('boundedPool.js')
  const conn = connection(), calls = []
  conn.query = async (...args) => { calls.push(args); return [[{ value: 42 }], []] }
  const pool = boundPoolAcquisition({ getConnection: async () => conn }, { timeoutMs: 100 })
  assert.deepEqual(await pool.query('SELECT ?', [42]), [[{ value: 42 }], []])
  assert.deepEqual(calls, [['SELECT ?', [42]]])
  assert.equal(conn.released, 1)
  conn.execute = async () => { throw new Error('synthetic sql failure') }
  await assert.rejects(pool.execute('invalid'), /synthetic sql failure/)
  assert.equal(conn.released, 2)
})
test('池排队上限映射为503，迟到获取失败不产生未处理拒绝', async () => {
  const { boundPoolAcquisition } = load('boundedPool.js')
  const pool = boundPoolAcquisition({ getConnection: async () => { throw new Error('Queue limit reached.') } }, { timeoutMs: 50 })
  await assert.rejects(pool.getConnection(), { statusCode: 503, code: 'DB_POOL_QUEUE_LIMIT' })
  const wait = deferred()
  const slow = boundPoolAcquisition({ getConnection: () => wait.promise }, { timeoutMs: 10 })
  await assert.rejects(slow.getConnection(), { code: 'DB_ACQUIRE_TIMEOUT' })
  wait.reject(new Error('late connection failure'))
  await new Promise(resolve => setImmediate(resolve))
})
function response() { return { code: 200, body: null, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } } }
test('readiness 真实数据库探测成功才返回ready，并复用短缓存', async () => {
  const { createReadinessHandler } = load('readiness.js')
  const conn = connection(); let acquired = 0
  const handler = createReadinessHandler({ getConnection: async () => { acquired++; return conn } }, { timeoutMs: 30, cacheMs: 100 })
  const res = response()
  await handler({}, res)
  assert.equal(res.code, 200); assert.equal(res.body.data.status, 'ready')
  await handler({}, response())
  assert.equal(acquired, 1); assert.equal(conn.released, 1)
})
test('readiness 查询卡住会限时503并销毁专用连接，不回收到池', async () => {
  const { createReadinessHandler } = load('readiness.js')
  const conn = connection(); conn.query = () => new Promise(() => {})
  const handler = createReadinessHandler({ getConnection: async () => conn }, { timeoutMs: 15, cacheMs: 0 })
  const res = response()
  await handler({}, res)
  assert.equal(res.code, 503); assert.equal(res.body.code, 'NOT_READY')
  assert.equal(conn.destroyed, 1); assert.equal(conn.released, 0)
})
test('readiness 获取失败不泄露数据库地址或凭据', async () => {
  const { createReadinessHandler } = load('readiness.js')
  const handler = createReadinessHandler({ getConnection: async () => { throw new Error('secret@internal-db') } }, { timeoutMs: 20, cacheMs: 0 })
  const res = response(); await handler({}, res)
  assert.equal(res.code, 503)
  assert.doesNotMatch(JSON.stringify(res.body), /secret|internal-db/)
})
