'use strict'

// Real HTTP, category routes/controllers, authentication, permission checks,
// request validation and errorHandler. Only service/persistence and logging use
// isolated fixtures, so this test never loads database or environment files.
const { test, before, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const express = require('../backend/node_modules/express')
const jwt = require('../backend/node_modules/jsonwebtoken')
const AppError = require('../backend/src/utils/AppError')
const { PERMISSIONS } = require('../backend/src/constants/permissions')

function load(relative, stubs = {}) {
  const filename = path.resolve(__dirname, '../backend/src', relative)
  const localRequire = createRequire(filename)
  const module_ = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module_, process,
    require: id => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id),
  }, { filename })
  return module_.exports
}

const categoryPermissions = [PERMISSIONS.CATEGORY_VIEW, PERMISSIONS.CATEGORY_CREATE, PERMISSIONS.CATEGORY_UPDATE, PERMISSIONS.CATEGORY_DELETE]
const rolePermissions = new Map([[2, categoryPermissions], [3, []], [4, [PERMISSIONS.CATEGORY_VIEW]]])
const calls = []
const fixtureId = 42
const service = {}
for (const name of ['getById', 'update', 'remove', 'toggleStatus']) {
  service[name] = async (...args) => {
    calls.push({ name, args })
    if (![fixtureId, Number.MAX_SAFE_INTEGER].includes(args[0])) throw new AppError('分类不存在', 404)
    return { id: args[0], name: '路由回归分类' }
  }
}
for (const [name, data] of Object.entries({ getTree: [{ id: fixtureId, children: [] }], getFlat: [{ id: fixtureId }], getLeaves: [{ id: fixtureId }] })) {
  service[name] = async () => { calls.push({ name, args: [] }); return data }
}
service.create = async () => ({ id: fixtureId })

const secret = 'categories-route-fixture-secret-only-20261021'
const env = { JWT_SECRET: secret, NODE_ENV: 'test' }
const { loadRolePermissions } = load('middleware/loadRolePermissions.js', {
  '../config/db': { pool: { query: async (_sql, [roleId]) => [(rolePermissions.get(roleId) || []).map(permission => ({ permission }))] } },
})
const auth = load('middleware/auth.js', {
  './opLogger': (_req, _res, next) => next(),
  './loadRolePermissions': { loadRolePermissions },
  '../config/env': { env },
  '../modules/auth/currentAuthUser': { getCurrentAuthUser: async userId => ({ id: userId, role_id: userId - 100, username: 'category-fixture', token_version: 0 }) },
  '../modules/auth/sessionFamilies': { assertActiveFamily: async () => {} },
  '../modules/auth/auth-audit.service': { recordAuthAudit: async () => {}, AUTH_AUDIT_EVENT: { PERMISSION_DENIED: 'permission_denied' } },
  '../utils/requestContext': { updateRequestContext: () => {} },
  '../utils/warehouseScope': { loadUserWarehouseScope: async () => null },
})
const controller = load('modules/categories/categories.controller.js', { './categories.service': service })
const router = load('modules/categories/categories.routes.js', {
  './categories.controller': controller,
  '../../middleware/auth': auth,
})
const errorHandler = load('middleware/errorHandler.js', {
  '../config/env': { env },
  '../utils/logger': { warn: () => {}, error: () => {} },
  '../utils/errorTracking': { initializeErrorTracking: () => {}, captureUnexpectedError: () => {} },
})

let server
let origin
before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/categories', router)
  app.use(errorHandler)
  server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    listening.once('error', reject)
  })
  origin = `http://127.0.0.1:${server.address().port}`
})
beforeEach(() => { calls.length = 0 })
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

async function request(method, suffix, body, roleId = 2) {
  const headers = { 'content-type': 'application/json' }
  if (roleId !== null) headers.authorization = `Bearer ${jwt.sign({ userId: 100 + roleId, tokenVersion: 0 }, secret, { expiresIn: '5m' })}`
  const response = await fetch(`${origin}/api/categories/${suffix}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}

const routes = [
  { method: 'GET', suffix: '', service: 'getById', permission: PERMISSIONS.CATEGORY_VIEW },
  { method: 'PUT', suffix: '', service: 'update', permission: PERMISSIONS.CATEGORY_UPDATE, body: { name: '回归分类' } },
  { method: 'DELETE', suffix: '', service: 'remove', permission: PERMISSIONS.CATEGORY_DELETE },
  { method: 'PATCH', suffix: '/status', service: 'toggleStatus', permission: PERMISSIONS.CATEGORY_UPDATE, body: { status: false } },
]

for (const route of routes) {
  for (const id of ['abc', '0', '-1', '1.5', '1e2', '9007199254740992', '9007199254740993', '01', '+1', '0x10']) {
    test(`${route.method} rejects invalid category id ${id} before service access`, async () => {
      const result = await request(route.method, encodeURIComponent(id) + route.suffix, route.body)
      assert.equal(result.status, 400)
      assert.equal(result.body.success, false)
      assert.equal(result.body.code, 'VALIDATION_ERROR')
      assert.deepEqual(calls, [])
    })
  }

  test(`${route.method} authenticates before rejecting an invalid category id`, async () => {
    const result = await request(route.method, 'abc' + route.suffix, route.body, null)
    assert.equal(result.status, 401)
    assert.equal(result.body.code, 'AUTH_TOKEN_MISSING')
    assert.deepEqual(calls, [])
  })

  test(`${route.method} checks its original permission before category id validation`, async () => {
    const result = await request(route.method, 'abc' + route.suffix, route.body, 3)
    assert.equal(result.status, 403)
    assert.equal(result.body.code, 'PERMISSION_DENIED')
    assert.equal(result.body.data.permission, route.permission)
    assert.deepEqual(calls, [])
  })

  for (const id of [fixtureId, Number.MAX_SAFE_INTEGER]) {
    test(`${route.method} retains valid safe category id ${id}`, async () => {
      const result = await request(route.method, String(id) + route.suffix, route.body)
      assert.equal(result.status, 200)
      assert.equal(result.body.success, true)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].name, route.service)
      assert.equal(calls[0].args[0], id)
      if (route.method === 'GET') assert.equal(result.body.data.id, id)
      else assert.equal(calls[0].args.at(-1), 102)
      if (route.method === 'PUT') assert.deepEqual(calls[0].args[1], route.body)
      if (route.method === 'PATCH') assert.equal(calls[0].args[1], 0)
    })
  }

  test(`${route.method} keeps a nonexistent valid category id as 404`, async () => {
    const result = await request(route.method, '43' + route.suffix, route.body)
    assert.equal(result.status, 404)
    assert.equal(result.body.message, '分类不存在')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, route.service)
    assert.equal(calls[0].args[0], 43)
  })
}

for (const route of routes.filter(route => route.method !== 'GET')) {
  test(`${route.method} still denies category writes to a view-only role`, async () => {
    const result = await request(route.method, String(fixtureId) + route.suffix, route.body, 4)
    assert.equal(result.status, 403)
    assert.equal(result.body.code, 'PERMISSION_DENIED')
    assert.equal(result.body.data.permission, route.permission)
    assert.deepEqual(calls, [])
  })
}

for (const [suffix, name] of [['tree', 'getTree'], ['flat', 'getFlat'], ['leaves', 'getLeaves']]) {
  test(`GET /${suffix} remains a named read route for a view-only role`, async () => {
    const result = await request('GET', suffix, undefined, 4)
    assert.equal(result.status, 200)
    assert.equal(result.body.success, true)
    assert.deepEqual(calls, [{ name, args: [] }])
  })
}
