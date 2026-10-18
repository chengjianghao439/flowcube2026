'use strict'
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const root = path.resolve(__dirname, '../..')
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(mode = 'normal', realProcess = null, sourceRoot = root) {
  const { createRuntimeLifecycle } = require(path.join(sourceRoot, 'backend/src/utils/runtimeLifecycle'))
  const { createGracefulShutdown } = require(path.join(sourceRoot, 'backend/src/utils/gracefulShutdown'))
  const tracker = mode === 'handler-reject' ? require(path.join(sourceRoot, 'backend/src/utils/httpDrain')).createHttpDrain() : null
  const events = [], exits = [], clock = { ticks: [], cleared: [], setIntervalFn(tick) { const timer = { tick, unref() {} }; clock.ticks.push(timer); return timer }, clearIntervalFn(timer) { clock.cleared.push(timer) } }
  const runtime = createRuntimeLifecycle(clock), startup = deferred(), worker = deferred(), http = deferred(), handler = deferred()
  const record = event => { events.push(event); realProcess?.connected && realProcess.send({ event }) }
  const processLike = realProcess || Object.assign(new EventEmitter(), { env: {}, exit(code) { exits.push(code); record(`exit:${code}`) } })
  const server = new EventEmitter()
  server.close = cb => { record('close'); http.promise.then(() => cb()) }
  server.closeIdleConnections = () => record('idle')
  const modules = {
    path: require('node:path'), dotenv: { config() {} },
    './src/app': { listen(_port, cb) { record('listen'); queueMicrotask(cb); return server } },
    './src/config/db': { testConnection: () => mode === 'startup' ? startup.promise : Promise.resolve(), pool: { end: async () => { record('pool'); if (mode === 'pool-fails') throw new Error('synthetic close failure'); if (mode === 'pool-hangs') return new Promise(() => {}) } } },
    './src/config/env': { env: { PORT: 0, IS_PROD: true, NODE_ENV: 'test' } },
    './src/utils/logger': { info() {}, error() {} },
    './src/utils/runtimeLifecycle': { lifecycle: runtime },
    './src/utils/httpDrain': { httpDrain: { waitForHandlers: () => tracker ? tracker.waitForHandlers() : mode === 'http-handler' ? handler.promise : Promise.resolve() } },
    './src/utils/gracefulShutdown': { createGracefulShutdown: opts => createGracefulShutdown({ ...opts, exit: code => processLike.exit(code), timeoutMs: 2000 }) },
    './src/scheduler': { startScheduler() { record('scheduler'); runtime.startTask('fake-work', () => worker.promise, 100, { immediate: true }) } },
  }
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'backend/index.js'), 'utf8'), {
    require: name => { if (!Object.hasOwn(modules, name)) throw new Error('Unapproved dependency: ' + name); return modules[name] },
    __dirname: path.join(sourceRoot, 'backend'), process: processLike, setTimeout, clearTimeout, Error, console,
  }, { filename: 'fake-only/backend/index.js' })
  if (tracker) { const layer = { handle: () => handler.promise }; tracker.trackAppHandlers({ _router: { stack: [layer] } }); void layer.handle() }
  return { events, exits, clock, runtime, startup, worker, http, handler, process: processLike }
}
module.exports = { deferred, fixture, flush }
if (process.argv[2] === 'child') {
  const f = fixture(process.argv[4], process, process.argv[3])
  process.on('message', value => { if (value === 'finish-http') f.http.resolve(); if (value === 'finish-worker') f.worker.resolve(); if (value === 'reject-handler') f.handler.reject(new Error('synthetic handler failure')) })
  // Ignore earlier bootstrap events; signal tests synchronize on this explicit marker.
  setImmediate(() => process.send({ ready: true }))
}
