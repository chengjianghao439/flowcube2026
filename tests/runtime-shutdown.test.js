'use strict'
// All runtime/SQL/timer boundaries are fake. Child processes load index.js in a VM,
// never dotenv, Express, mysql2 or the real scheduler, and own their signals only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { fork, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const root = path.resolve(__dirname, '..')
const { deferred, fixture, flush } = require('./helpers/runtimeShutdownHarness')
const createRuntimeLifecycle = (...args) => require('../backend/src/utils/runtimeLifecycle').createRuntimeLifecycle(...args)
const createGracefulShutdown = (...args) => require('../backend/src/utils/gracefulShutdown').createGracefulShutdown(...args)
const { createReadinessHandler } = require('../backend/src/utils/readiness')

function response() { return { code: 200, headers: {}, status(n) { this.code = n; return this }, set(k, v) { this.headers[k] = v; return this }, json(body) { this.body = body; return this } } }
function timers() {
  const ticks = [], cleared = []
  return { ticks, cleared, setIntervalFn: tick => { const timer = { tick, unref() {} }; ticks.push(timer); return timer }, clearIntervalFn: timer => cleared.push(timer) }
}

test('退出期间 ready 拒绝旧的成功缓存，且不再借连接', async () => {
  let draining = false, acquired = 0
  const handler = createReadinessHandler({ getConnection: async () => { acquired++; return { query: async () => {}, release() {} } } }, { isDraining: () => draining })
  const before = response(); await handler({}, before); assert.equal(before.code, 200)
  draining = true
  const after = response(); await handler({}, after)
  assert.equal(after.code, 503); assert.equal(after.body.code, 'NOT_READY'); assert.equal(acquired, 1)
})
test('ready 在途探测完成前进入 draining 也不得回 200，并仍释放连接', async () => {
  const query = deferred(); let draining = false, released = 0
  const handler = createReadinessHandler({ getConnection: async () => ({ query: () => query.promise, release() { released++ } }) }, { isDraining: () => draining })
  const res = response(), work = handler({}, res)
  await flush(); draining = true; query.resolve(); await work
  assert.equal(res.code, 503); assert.equal(res.body.data.status, 'unavailable'); assert.equal(released, 1)
})
test('循环不重入，停止清掉全部 timer，等待已经开始的工作，禁止迟到 tick 和新增循环', async () => {
  const clock = timers(), runtime = createRuntimeLifecycle(clock), work = deferred()
  let calls = 0, drained = false
  runtime.startTask('worker', () => { calls++; return work.promise }, 100, { immediate: true })
  runtime.startTask('worker', () => { calls++ }, 100, { immediate: true })
  await flush(); await clock.ticks[0].tick(); // tick returns immediately when busy
  assert.equal(calls, 1); assert.equal(clock.ticks.length, 1)
  runtime.beginDrain(); runtime.stopTasks()
  const drain = runtime.waitForTasks().then(() => { drained = true })
  await flush(); assert.equal(drained, false); assert.equal(clock.cleared.length, 1)
  await clock.ticks[0].tick(); runtime.startTask('late', () => { calls++ }, 1, { immediate: true })
  assert.equal(calls, 1); assert.equal(clock.ticks.length, 1)
  work.resolve(); await drain; assert.equal(drained, true)
})
test('同步异常和异步拒绝仍可在下轮重试并保留错误记录', async () => {
  const clock = timers(), errors = [], runtime = createRuntimeLifecycle(clock)
  let calls = 0
  runtime.startTask('error', () => { if (++calls === 1) throw new Error('sync'); return Promise.reject(new Error('async')) }, 1, { onError: e => errors.push(e.message) })
  await clock.ticks[0].tick(); await clock.ticks[0].tick()
  runtime.beginDrain(); runtime.stopTasks(); await runtime.waitForTasks()
  assert.deepEqual(errors, ['sync', 'async'])
})
test('退出总预算覆盖 HTTP、任务和关池；超时非零且不提前关池', async () => {
  for (const pending of ['http', 'worker', 'startup', 'handler', 'pool']) {
    const held = deferred(), events = []; let deadline, duration
    const shutdown = createGracefulShutdown({
      lifecycle: { beginDrain() { events.push('draining') }, stopTasks() { events.push('stop') }, waitForTasks: () => pending === 'worker' ? held.promise : Promise.resolve() },
      getServer: () => ({ close(cb) { events.push('close'); if (pending !== 'http') cb() } }),
      waitForStartup: () => pending === 'startup' ? held.promise : Promise.resolve(),
      waitForHttpHandlers: () => pending === 'handler' ? held.promise : Promise.resolve(),
      closePool: () => { events.push('pool'); return pending === 'pool' ? held.promise : Promise.resolve() },
      logger: { info() {}, error() {} }, exit: code => events.push(`exit:${code}`),
      setTimeoutFn: (fn, ms) => { deadline = fn; duration = ms; return 1 }, clearTimeoutFn() {},
    })
    const promise = shutdown('SIGTERM', null, 0); await flush()
    assert.equal(duration, 25000)
    if (pending !== 'pool') assert.ok(!events.includes('pool'))
    deadline(); assert.equal(await promise, 1); assert.equal(events.at(-1), 'exit:1')
    held.resolve(); await flush(); assert.equal(events.filter(x => x.startsWith('exit:')).length, 1)
  }
})
test('正常顺序、重复信号和退出中的致命错误：只关池一次，失败升级非零', async () => {
  for (const fatal of [false, true]) {
    const f = fixture(); await flush()
    f.process.emit('SIGTERM'); f.process.emit('SIGINT'); if (fatal) f.process.emit('uncaughtException', new Error('synthetic fatal'))
    await flush(); assert.ok(f.runtime.isDraining()); assert.ok(!f.events.includes('pool'))
    f.http.resolve(); await flush(); assert.ok(!f.events.includes('pool'))
    f.worker.resolve(); await flush(); assert.equal(f.events.filter(x => x === 'pool').length, 1)
    assert.deepEqual(f.exits, [fatal ? 1 : 0])
    assert.ok(f.events.indexOf('close') < f.events.indexOf('pool'))
    assert.ok(f.clock.cleared.length > 0)
  }
})
test('启动检查未完成时收到信号：不再 listen/启动 scheduler，检查结束后才关池', async () => {
  const f = fixture('startup'); f.process.emit('SIGTERM'); await flush()
  assert.ok(!f.events.includes('listen')); assert.ok(!f.events.includes('scheduler')); assert.ok(!f.events.includes('pool'))
  f.startup.resolve(); await flush()
  assert.deepEqual(f.exits, [0]); assert.equal(f.events.filter(x => x === 'pool').length, 1)
  assert.ok(!f.events.includes('listen')); assert.ok(!f.events.includes('scheduler'))
})
test('启动失败和关池失败明确非零，生产 operational rejection 保留原契约', async () => {
  const failed = fixture('startup'); failed.startup.reject(new Error('synthetic startup')); await flush(); assert.deepEqual(failed.exits, [1])
  const pool = fixture('pool-fails'); await flush(); pool.process.emit('SIGTERM'); pool.http.resolve(); pool.worker.resolve(); await flush(); assert.deepEqual(pool.exits, [1])
  const operational = fixture(); await flush(); operational.process.emit('unhandledRejection', Object.assign(new Error('operational'), { isOperational: true })); await flush()
  assert.equal(operational.runtime.isDraining(), false)
  operational.process.emit('SIGTERM'); operational.http.resolve(); operational.worker.resolve(); await flush(); assert.deepEqual(operational.exits, [0])
})
test('请求闸门在 CORS 和健康接口之后、业务解析之前；退出拒绝新业务但保留响应信封', () => {
  const { createDrainMiddleware } = require('../backend/src/utils/runtimeLifecycle')
  let draining = false, next = 0
  const gate = createDrainMiddleware({ isDraining: () => draining })
  gate({}, response(), () => next++); draining = true
  const res = response(); gate({}, res, () => next++)
  assert.equal(next, 1); assert.equal(res.code, 503); assert.equal(res.headers.Connection, 'close'); assert.equal(res.body.code, 'SERVER_DRAINING')
  const app = fs.readFileSync(path.join(root, 'backend/src/app.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const pos = app.indexOf('app.use(createDrainMiddleware())')
  assert.ok(pos > app.indexOf('app.use(cors(buildCorsOptions(env)))'))
  assert.ok(pos > app.indexOf("app.get('/api/ready'"))
  assert.ok(pos < app.indexOf("express.json({ limit: '2mb' })"))
  assert.ok(app.indexOf('httpDrain.trackAppHandlers(app)') > app.indexOf('app.use(errorHandler)'))
  assert.ok(app.indexOf('httpDrain.trackAppHandlers(app)') < app.indexOf('module.exports = app'))
})

// Run actual wrappers with a shared real lifecycle; SQL and foreign modules remain local fakes.
function loadWithRuntime(rel, runtime, modules = {}, env = {}) {
  const filename = path.join(root, rel), m = { exports: {} }
  const context = { module: m, exports: m.exports, console, Buffer, process: { env },
    require: name => {
      if (name.endsWith('/runtimeLifecycle')) return { lifecycle: runtime }
      if (Object.hasOwn(modules, name)) return modules[name]
      if (name === 'crypto' || name === 'node:crypto') return require(name)
      if (name.endsWith('AppError')) return Error
      if (name.endsWith('logger')) return { info() {}, warn() {}, error() {} }
      return {}
    } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename }); return m.exports
}
test('幂等清理即时工作也必须排空，重复启动不叠加且不改七天 TTL', async () => {
  const clock = timers(), runtime = createRuntimeLifecycle(clock), work = deferred(), sqls = []
  const service = loadWithRuntime('backend/src/utils/operationRequest.js', runtime, { '../config/db': { pool: { query: (sql, args) => { sqls.push({ sql, args }); return work.promise } } } })
  service.startCleanupSweeper(); service.startCleanupSweeper(); await flush()
  assert.equal(clock.ticks.length, 1); assert.equal(sqls.length, 1); assert.equal(sqls[0].args[0], 7)
  runtime.beginDrain(); runtime.stopTasks(); let finished = false
  const drain = runtime.waitForTasks().then(() => { finished = true }); await flush(); assert.equal(finished, false)
  work.resolve([{}]); await drain; assert.equal(finished, true)
})
test('打印三支清理并行工作全部结束才能排空，一支失败不提前关池，重复 start 不叠加', async () => {
  const clock = timers(), runtime = createRuntimeLifecycle(clock), works = [deferred(), deferred(), deferred()], sqls = []
  const service = loadWithRuntime('backend/src/modules/print-jobs/print-jobs.dispatch.js', runtime, {
    '../../config/db': { pool: { query: sql => { sqls.push(sql); return works[sqls.length - 1].promise } } },
    './print-jobs.status': { STATUS: {}, ttlMinutes: () => 10, clientOfflineReclaimSeconds: () => 60 },
  }, { PRINT_JOB_SWEEP_MS: '50' })
  service.startPrintJobSweeper(); service.startPrintJobSweeper(); await flush()
  assert.equal(sqls.length, 3); assert.equal(clock.ticks.length, 1)
  runtime.beginDrain(); runtime.stopTasks(); let done = false
  const drain = runtime.waitForTasks().then(() => { done = true })
  works[0].reject(new Error('synthetic print failure')); works[1].resolve([{ affectedRows: 0 }]); await flush(); assert.equal(done, false)
  works[2].resolve([{ affectedRows: 0 }]); await drain; assert.equal(done, true)
})
test('采购快照定时器统一停止；仅清内存，不改查询/业务状态', async () => {
  const clock = timers(), runtime = createRuntimeLifecycle(clock); let pruned = 0
  loadWithRuntime('backend/src/modules/inventory/inventory.procurement.js', runtime, { './procurement.snapshots': { createProcurementSnapshots: () => ({ prune() { pruned++ } }) } })
  await clock.ticks[0].tick(); assert.equal(pruned, 1)
  runtime.beginDrain(); runtime.stopTasks(); await clock.ticks[0].tick(); assert.equal(pruned, 1)
})
test('Compose 普通与 prod 合并都具备 ready 检查，宽限超过应用总预算；只解析不启用', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, MYSQL_ROOT_PASSWORD: 'synthetic', DB_NAME: 'synthetic', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic', JWT_SECRET: 'synthetic-only-not-real-at-least-32-characters' }
  for (const files of [['docker-compose.yml'], ['docker-compose.yml', 'docker-compose.prod.yml']]) {
    const r = spawnSync('docker', ['compose', '--env-file', '/dev/null', ...files.flatMap(f => ['-f', f]), 'config', '--format', 'json'], { cwd: root, env, encoding: 'utf8', timeout: 10000 })
    assert.equal(r.status, 0, r.stderr)
    const backend = JSON.parse(r.stdout).services.backend
    assert.equal(backend.stop_grace_period, '30s'); assert.match(backend.healthcheck.test.join(' '), /127\.0\.0\.1:3000\/api\/ready/)
    assert.equal(backend.environment.CORS_ALLOW_NULL_ORIGIN, '0')
  }
})
for (const signal of ['SIGTERM', 'SIGINT']) test(`真实本轮合成子进程 ${signal}：重复信号等待 HTTP/worker 后只关池一次`, { timeout: 5000 }, async t => {
  const child = fork(path.join(__dirname, 'helpers/runtimeShutdownHarness.js'), ['child', root, 'normal'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk })
  const messages = []
  const until = predicate => new Promise(resolve => { const listener = value => { if (predicate(value)) { child.off('message', listener); resolve(value) } }; child.on('message', listener) })
  const ready = until(value => value.ready); child.on('message', value => messages.push(value)); await ready
  const closed = until(value => value.event === 'close'); child.kill(signal); await closed; child.kill(signal)
  child.send('finish-http'); child.send('finish-worker')
  const [code, sig] = await once(child, 'exit')
  assert.equal(sig, null, stderr); assert.equal(code, 0, stderr)
  const events = messages.filter(m => m.event).map(m => m.event)
  assert.equal(events.filter(e => e === 'pool').length, 1); assert.ok(events.indexOf('close') < events.indexOf('pool'))
})

test('启动连接探测 ping 失败仍释放连接并向统一退出链抛错，不自行退出进程', async () => {
  const filename = path.join(root, 'backend/src/config/db.js')
  for (const fails of [false, true]) {
    let released = 0, exits = 0
    const conn = { query: async () => {}, ping: async () => { if (fails) throw new Error('synthetic ping failure') }, release() { released++ } }
    const pool = { on() {}, getConnection: async () => conn }
    const m = { exports: {} }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: m, console: { log() {}, error() {} }, process: { exit() { exits++ } }, WeakMap,
      require: name => {
        if (name === 'mysql2/promise') return { createPool: () => pool }
        if (name === './env') return { env: {} }
        if (name === '../utils/boundedPool') return { boundPoolAcquisition() {} }
        throw new Error('Unapproved dependency: ' + name)
      },
    })
    // Replace the session-initialized acquisition only; no real driver or .env is loaded.
    pool.getConnection = async () => conn
    if (fails) await assert.rejects(m.exports.testConnection(), /synthetic ping failure/)
    else await m.exports.testConnection()
    assert.equal(released, 1); assert.equal(exits, 0)
  }
})
test('HTTP close 回调报错或同步抛错都明确失败，不声称关池成功', async () => {
  for (const throws of [false, true]) {
    let closed = 0, exitCode = null
    const shutdown = createGracefulShutdown({ lifecycle: { beginDrain() {}, stopTasks() {}, waitForTasks: async () => {} },
      getServer: () => ({ close(cb) { const err = new Error('synthetic server close'); if (throws) throw err; cb(err) } }),
      closePool: async () => { closed++ }, logger: { info() {}, error() {} }, exit: code => { exitCode = code },
    })
    assert.equal(await shutdown('SIGTERM'), 1); assert.equal(exitCode, 1); assert.equal(closed, 0)
  }
})
for (const held of ['http', 'worker', 'handler', 'pool']) test(`合成子进程 ${held} 不结束：断开 IPC 后仍由引用的总期限非零退出`, { timeout: 5000 }, async t => {
  const child = fork(path.join(__dirname, 'helpers/runtimeShutdownHarness.js'), ['child', root, held === 'pool' ? 'pool-hangs' : held === 'handler' ? 'http-handler' : 'normal'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  const until = predicate => new Promise(resolve => { const listener = value => { if (predicate(value)) { child.off('message', listener); resolve(value) } }; child.on('message', listener) })
  await until(value => value.ready)
  const closing = until(value => value.event === 'close'); child.kill('SIGTERM'); await closing
  if (held !== 'http') child.send('finish-http')
  if (held !== 'worker') child.send('finish-worker')
  child.disconnect()
  const [code, signal] = await once(child, 'exit'); assert.equal(signal, null); assert.equal(code, 1)
})

test('CORS 纯函数保留桌面 null 显式批准、精确白名单及生产反射拒绝契约', () => {
  const { buildCorsOptions } = require('../backend/src/config/cors')
  for (const allowNull of [false, true]) {
    const policy = buildCorsOptions({ IS_PROD: true, CORS_ALLOW_NULL_ORIGIN: allowNull, CORS_ORIGIN: 'https://erp.example,https://localhost' })
    for (const [origin, expected] of [['null', allowNull], [undefined, allowNull], ['https://erp.example', true], ['https://localhost', true], ['https://evil.example', false], ['https://erp.example.evil.example', false], ['http://erp.example', false], ['https://erp.example:444', false]]) {
      let actual; policy.origin(origin, (err, allowed) => { assert.equal(err, null); actual = allowed }); assert.equal(actual, expected)
    }
    assert.equal(policy.credentials, true)
  }
  assert.throws(() => buildCorsOptions({ IS_PROD: true, CORS_REFLECT: true }), /CORS/)
  assert.throws(() => buildCorsOptions({ IS_PROD: true, CORS_ORIGIN: '*' }), /CORS/)
})


test('冷态 ready 在 draining 时不借连接、不发 SQL', async () => {
  let acquired = 0
  const handler = createReadinessHandler({ getConnection: async () => { acquired++; throw new Error('must not acquire') } }, { isDraining: () => true })
  const res = response(); await handler({}, res)
  assert.equal(res.code, 503); assert.equal(acquired, 0)
})
test('真实 scheduler 的在途 worker 必须排空，停止后同一 tick 不再执行', async () => {
  const clock = timers(), runtime = createRuntimeLifecycle(clock), work = deferred()
  let started = 0, done = false
  const service = loadWithRuntime('backend/src/scheduler.js', runtime, {
    './utils/operationRequest': { startCleanupSweeper() {} },
    './modules/fulfillment/fulfillment.worker': { runFulfillmentSync: () => { started++; return work.promise } },
    './utils/requestContext': { runWithRequestContext: ({ requestId }, fn) => requestId === 'scheduler:order-fulfillment' ? fn() : undefined },
    './modules/notifications/operation-alerts.service': { createOperationAlertWorker: () => () => {} },
  })
  service.startScheduler(); const count = clock.ticks.length; service.startScheduler(); assert.equal(clock.ticks.length, count)
  const tick = clock.ticks[0].tick(); await flush(); assert.equal(started, 1)
  runtime.beginDrain(); runtime.stopTasks(); const drain = runtime.waitForTasks().then(() => { done = true })
  await clock.ticks[0].tick(); await flush(); assert.equal(started, 1); assert.equal(done, false); assert.equal(clock.cleared.length, count)
  work.resolve(); await tick; await drain; assert.equal(done, true)
})


test('客户端已断开但业务 handler Promise 未结束时，实际 index 不能提前关池', async () => {
  const f = fixture('http-handler'); await flush()
  f.process.emit('SIGTERM'); f.http.resolve(); f.worker.resolve(); await flush()
  assert.ok(!f.events.includes('pool')); assert.deepEqual(f.exits, [])
  f.handler.resolve(); await flush(); assert.deepEqual(f.exits, [0]); assert.equal(f.events.filter(x => x === 'pool').length, 1)
})
test('实际 Express4 嵌套路由：断连不替代 async auth/控制器完成，next 后仍在执行也要等', async () => {
  const { createHttpDrain } = require('../backend/src/utils/httpDrain')
  const { Router } = require('../backend/node_modules/express')
  const tracker = createHttpDrain(), auth = deferred(), afterNext = deferred(), business = deferred()
  const parent = Router(), nested = Router(), events = [], req = { method: 'GET', url: '/nested/work', headers: {} }
  nested.use(async (_req, _res, next) => { await auth.promise; events.push('auth'); next(); await afterNext.promise; events.push('auth-done') })
  nested.get('/work', async () => { events.push('business'); await business.promise; events.push('commit') })
  parent.use('/nested', nested); tracker.trackAppHandlers({ _router: parent }); tracker.trackAppHandlers({ _router: parent })
  const res = new (require('node:events').EventEmitter)(); parent.handle(req, res, e => { if (e) throw e })
  res.emit('close'); let drained = false
  const drain = tracker.waitForHandlers().then(() => { drained = true }); await flush(); assert.equal(drained, false)
  auth.resolve(); await flush(); assert.deepEqual(events, ['auth', 'business']); assert.equal(drained, false)
  business.resolve(); await flush(); assert.equal(drained, false)
  afterNext.resolve(); await drain; assert.deepEqual(events, ['auth', 'business', 'commit', 'auth-done'])
})
test('HTTP 包装保持 this、参数、0至4 arity、同步throw、thenable与拒绝语义，异步error层也排空', async () => {
  const { createHttpDrain } = require('../backend/src/utils/httpDrain')
  const tracker = createHttpDrain(), work = deferred(), args = [{}, {}, () => {}], self = {}
  const functions = [function () { return this }, function (_a) { return this }, function (_a, _b) { return this }, function (_a, _b, _c) { return this }, function (_err, _a, _b, _c) { return this }]
  const layers = functions.map(handle => ({ handle })); tracker.trackAppHandlers({ _router: { stack: layers } })
  layers.forEach((layer, i) => { assert.equal(layer.handle.length, i); assert.equal(layer.handle.apply(self, args), self) })
  const error = new Error('synthetic async error'), rejected = { handle: () => Promise.reject(error) }, thrown = { handle() { throw error } }, thenable = { handle: () => ({ then(resolve) { work.promise.then(resolve) } }) }
  tracker.trackAppHandlers({ _router: { stack: [rejected, thrown, thenable] } })
  await assert.rejects(rejected.handle(), e => e === error); assert.throws(() => thrown.handle(), e => e === error)
  const result = thenable.handle(); let done = false; const drain = tracker.waitForHandlers().then(() => { done = true }); await flush(); assert.equal(done, false)
  work.resolve(); await result; await drain; assert.equal(done, true)
  const { Router } = require('../backend/node_modules/express'), router = Router(), finished = deferred()
  router.get('/error', () => { throw error }); router.use(async (err, _req, _res, _next) => { assert.equal(err, error); await finished.promise })
  tracker.trackAppHandlers({ _router: router }); router.handle({ method: 'GET', url: '/error', headers: {} }, {}, e => { if (e) throw e })
  let drained = false; const final = tracker.waitForHandlers().then(() => { drained = true }); await flush(); assert.equal(drained, false)
  finished.resolve(); await final; assert.equal(drained, true)
})


test('合成子进程 HTTP Promise 在退出中拒绝：保持原fatal策略，不能抢先exit0', { timeout: 5000 }, async t => {
  const child = fork(path.join(__dirname, 'helpers/runtimeShutdownHarness.js'), ['child', root, 'handler-reject'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  const until = predicate => new Promise(resolve => { const listener = value => { if (predicate(value)) { child.off('message', listener); resolve(value) } }; child.on('message', listener) })
  await until(value => value.ready)
  const closing = until(value => value.event === 'close'); child.kill('SIGTERM'); await closing
  child.send('finish-http'); child.send('finish-worker'); child.send('reject-handler')
  const [code, signal] = await once(child, 'exit'); assert.equal(signal, null); assert.equal(code, 1)
})

// Load F4's exact dependency whitelist as well as the isolated runtime wrapper above.
// Breaking its runtime mapping must fail the same runtime regression file N14 selected.
test('F4 真实依赖加载与每夹具生命周期隔离，不共享 draining 状态', async () => {
  const f4 = require('./helpers/supplier-refunds-backfill-fixture')
  const first = await f4.fixture(), second = await f4.fixture()
  try {
    assert.notEqual(first.lifecycle, second.lifecycle)
    assert.equal(first.lifecycle.isDraining(), false)
    first.lifecycle.beginDrain()
    assert.equal(first.lifecycle.isDraining(), true)
    assert.equal(second.lifecycle.isDraining(), false)
    for (const f of [first, second]) {
      const requests = f.load('operation')
      assert.equal(typeof requests.beginResourceOperationRequest, 'function')
      assert.match(requests.creationFingerprint({ operation: 'F4' }), /^[a-f0-9]+$/)
    }
  } finally {
    first.lifecycle.stopTasks(); second.lifecycle.stopTasks()
    await Promise.all([first.lifecycle.waitForTasks(), second.lifecycle.waitForTasks()])
    f4.assertNoModelErrors()
  }
})
test('F4 幂等清理使用真实生命周期：即时执行、不重入、排空等待和晚启动闸门', async () => {
  const f4 = require('./helpers/supplier-refunds-backfill-fixture')
  const clock = timers(), intervals = [], work = deferred(), queries = []
  const runtimeTimers = { ...clock, setIntervalFn(tick, ms) { intervals.push(ms); return clock.setIntervalFn(tick) } }
  const f = await f4.fixture('4.0000', { runtimeTimers }), originalQuery = f.f.conn.query
  f.f.conn.query = (sql, args) => {
    assert.equal(sql, 'DELETE FROM operation_requests WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)')
    assert.deepEqual(Array.from(args), [7])
    queries.push(sql)
    return work.promise
  }
  try {
    const requests = f.load('operation')
    requests.startCleanupSweeper(); requests.startCleanupSweeper(); await flush()
    assert.equal(clock.ticks.length, 1); assert.deepEqual(intervals, [6 * 60 * 60 * 1000]); assert.equal(queries.length, 1)
    await clock.ticks[0].tick(); assert.equal(queries.length, 1)
    f.lifecycle.beginDrain(); f.lifecycle.stopTasks()
    let drained = false
    const drain = f.lifecycle.waitForTasks().then(() => { drained = true })
    await flush(); assert.equal(drained, false); assert.equal(clock.cleared.length, 1)
    await clock.ticks[0].tick(); requests.startCleanupSweeper(); await flush()
    assert.equal(queries.length, 1); assert.equal(clock.ticks.length, 1)
    work.resolve([{ affectedRows: 0 }]); await drain; assert.equal(drained, true)
  } finally {
    work.resolve([{ affectedRows: 0 }]); f.lifecycle?.stopTasks(); await f.lifecycle?.waitForTasks()
    f.f.conn.query = originalQuery; f4.assertNoModelErrors()
  }
})
