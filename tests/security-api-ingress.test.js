'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const express = require('../backend/node_modules/express')
const root = path.resolve(__dirname, '..')

function load(file, deps) {
  const mod = { exports: {} }
  const localRequire = require('node:module').createRequire(path.join(root, file))
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module: mod, exports: mod.exports, require: key => Object.hasOwn(deps, key) ? deps[key] : localRequire(key),
    process: { env: { RATE_LIMIT_MAX: '1', AUTH_LOGIN_MAX_PER_IP: '1' } }, console: { log() {}, warn() {} },
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename: file })
  return mod.exports
}

async function fixture(t, max = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-api-security-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const queries = []
  const pool = { query: async sql => { queries.push(sql); return [{ insertId: 1 }] }, getConnection: async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, query: async sql => { queries.push(sql); return [[]] },
  }) }
  const opLogger = load('backend/src/middleware/opLogger.js', {
    '../config/db': { pool }, '../utils/logger': { error() {} },
  })
  const protectedRoute = express.Router()
  protectedRoute.post('/', (req, res) => res.status(401).json({ success: false }))
  const bodyRoute = express.Router()
  bodyRoute.post('/', (req, res) => res.json({ success: true }))
  const authRoute = express.Router()
  authRoute.post('/login', (req, res) => res.json({ success: true }))
  const deps = {
    './config/env': { env: { IS_PROD: false, TRUST_PROXY: true, APP_UPDATE_DOWNLOADS_DIR: dir } },
    './config/cors': { buildCorsOptions: () => ({ origin: false }) },
    './middleware/opLogger': opLogger, './middleware/requestLogger': (_req, _res, next) => next(),
    './config/db': { pool }, './utils/readiness': { createReadinessHandler: () => (_req, res) => res.json({ ready: true }) },
    './middleware/errorHandler': (err, _req, res, _next) => res.status(err.status || err.statusCode || 500).json({ code: err.code || err.type }),
  }
  const src = fs.readFileSync(path.join(root, 'backend/src/app.js'), 'utf8')
  for (const match of src.matchAll(/require\('(\.\/modules\/[^']+\.routes)'\)/g)) {
    deps[match[1]] = match[1].includes('/auth/') ? authRoute : match[1].includes('/users/') ? protectedRoute : bodyRoute
  }
  if (fs.existsSync(path.join(root, 'backend/src/middleware/apiIngress.js'))) {
    const realIngress = require('../backend/src/middleware/apiIngress')
    deps['./middleware/apiIngress'] = {
      ...realIngress,
      createApiLimiter: () => realIngress.createApiLimiter({ max }),
      loginLimiter: realIngress.createLoginLimiter({ max: 1 }),
    }
  }
  const app = load('backend/src/app.js', deps)
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  t.after(() => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())))
  return { app, queries, base: 'http://127.0.0.1:' + server.address().port }
}

test('两层代理下两个公网客户端身份独立；公网直连不信任伪造XFF', async t => {
  const { app } = await fixture(t)
  function ip(peer, forwarded) {
    const req = Object.create(express.request)
    req.app = app; req.connection = { remoteAddress: peer }; req.socket = req.connection
    req.headers = { 'x-forwarded-for': forwarded }
    return req.ip
  }
  assert.equal(ip('172.22.0.3', '198.51.100.1, 172.22.0.1'), '198.51.100.1')
  assert.equal(ip('172.22.0.3', '198.51.100.2, 172.22.0.1'), '198.51.100.2')
  assert.equal(ip('203.0.113.8', '198.51.100.99'), '203.0.113.8')
})

test('未认证POST不消耗operation_logs连接或预写意图', async t => {
  const { base, queries } = await fixture(t)
  const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(response.status, 401)
  assert.equal(queries.length, 0)
})

test('API超额请求在JSON解析之前返回429', async t => {
  const { base, queries } = await fixture(t)
  const request = body => fetch(base + '/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  assert.equal((await request('{}')).status, 401)
  assert.equal((await request('{')).status, 429)
  assert.equal(queries.length, 0)
})

test('登录独立配额也先于解析；不会消耗业务数据库', async t => {
  const { base, queries } = await fixture(t, 100)
  const request = body => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  assert.equal((await request('{}')).status, 200)
  assert.equal((await request('{')).status, 429)
  assert.equal(queries.length, 0)
})

test('有效但过深的JSON在递归日志清洗前被明确拒绝', async t => {
  const { base, queries } = await fixture(t, 100)
  let body = {}
  for (let i = 0; i < 80; i++) body = { nested: body }
  const response = await fetch(base + '/api/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(response.status, 400)
  assert.equal(queries.length, 0)
})

test('并发入场在业务处理前有界，finish/close只释放一次且恢复容量', () => {
  const { EventEmitter } = require('node:events')
  const { createRequestConcurrencyGuard } = require('../backend/src/middleware/apiIngress')
  const guard = createRequestConcurrencyGuard(1)
  const first = new EventEmitter(), denied = new EventEmitter(), next = new EventEmitter()
  let accepted = 0, status
  denied.status = code => { status = code; return { json() {} } }
  guard({}, first, () => accepted++)
  guard({}, denied, () => accepted++)
  assert.equal(accepted, 1); assert.equal(status, 429)
  first.emit('finish'); first.emit('close')
  guard({}, next, () => accepted++)
  assert.equal(accepted, 2)
  next.emit('close')
})

test('非API路径不经过JSON解析，不能绕过API入场预算制造解析负载', async t => {
  const { base, queries } = await fixture(t)
  const request = path => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
  assert.equal((await request('/outside-api')).status, 404)
  assert.equal((await request('/outside-api')).status, 404)
  assert.equal((await request('/downloads')).status, 405)
  assert.equal(queries.length, 0)
})

test('请求上下文与认证审计来源IP来自已验证req.ip而非原始XFF', () => {
  let context
  const logger = load('backend/src/middleware/requestLogger.js', {
    '../utils/logger': {}, '../utils/requestContext': { runWithRequestContext: (value, next) => { context = value; return next() } },
  })
  logger({ method: 'POST', originalUrl: '/api/auth/login', headers: { 'x-forwarded-for': 'spoofed' }, ip: '198.51.100.1' }, { setHeader() {}, on() {} }, () => {})
  assert.equal(context.ip, '198.51.100.1')
})

test('合法JSON深度/节点边界保留，超过预算明确拒绝', () => {
  const { validateBodyBudget } = require('../backend/src/middleware/apiIngress')
  let body = 1
  for (let i = 0; i < 32; i++) body = { child: body }
  let result
  validateBodyBudget({ body }, {}, error => { result = error })
  assert.equal(result, undefined)
  validateBodyBudget({ body: { child: body } }, {}, error => { result = error })
  assert.equal(result.statusCode, 400)
  result = undefined
  validateBodyBudget({ body: Array(49_999).fill(1) }, {}, error => { result = error })
  assert.equal(result, undefined)
  validateBodyBudget({ body: Array(50_000).fill(1) }, {}, error => { result = error })
  assert.equal(result.statusCode, 400)
})

test('JSON字节上限恰好2MiB兼容，增加一字节在路由前返回413', async t => {
  const { base } = await fixture(t, 100)
  const limit = 2 * 1024 * 1024
  const body = JSON.stringify({ value: 'x'.repeat(limit - JSON.stringify({ value: '' }).length) })
  assert.equal(Buffer.byteLength(body), limit)
  const request = payload => fetch(base + '/api/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
  assert.equal((await request(body)).status, 200)
  assert.equal((await request(body.replace('xxx', 'xxxx'))).status, 413)
})
