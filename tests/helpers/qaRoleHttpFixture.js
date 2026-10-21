'use strict'

// Real routes/auth/permission loader; only authentication persistence, logging
// and successful business controllers are synthetic. Permission queries run on
// the SAME connection-local tables that the SQL migration actually changes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const express = require('../../backend/node_modules/express')
const jwt = require('../../backend/node_modules/jsonwebtoken')
const { randomBytes } = require('node:crypto')

function load(relative, stubs = {}) {
  const filename = path.resolve(__dirname, '../../backend/src', relative)
  const localRequire = createRequire(filename)
  const module_ = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module_, process,
    require: id => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id),
  }, { filename })
  return module_.exports
}

async function httpFixture(conn, roles, fn) {
  const calls = [], permissionQueries = []
  const pool = { query: async (sql, values) => {
    // Never load a real app pool or execute unrelated persistence from HTTP.
    assert.match(sql, /^SELECT permission FROM sys_role_permissions WHERE role_id=\?$/)
    permissionQueries.push(Number(values[0]))
    return conn.query(sql, values)
  } }
  const { loadRolePermissions } = load('middleware/loadRolePermissions.js', { '../config/db': { pool } })
  const secret = randomBytes(32).toString('hex')
  const env = { JWT_SECRET: secret, NODE_ENV: 'test' }
  const auth = load('middleware/auth.js', {
    './opLogger': (_req, _res, next) => next(),
    './loadRolePermissions': { loadRolePermissions },
    '../config/env': { env },
    '../modules/auth/currentAuthUser': { getCurrentAuthUser: async userId => {
      const role = roles.find(r => r.id === Number(userId) - 1000)
      assert.ok(role, 'fixture JWT must reference an approved role')
      return { id: userId, role_id: role.id, username: `qa-role-${role.code}`, token_version: 0 }
    } },
    '../modules/auth/sessionFamilies': { assertActiveFamily: async () => {} },
    '../modules/auth/auth-audit.service': { recordAuthAudit: async () => {}, AUTH_AUDIT_EVENT: { PERMISSION_DENIED: 'permission_denied' } },
    '../utils/requestContext': { updateRequestContext: () => {} },
    '../utils/warehouseScope': { loadUserWarehouseScope: async () => null },
  })
  const controller = moduleName => new Proxy({}, { get: (_target, name) => (req, res) => {
    calls.push({ module: moduleName, name, roleId: req.user.roleId, method: req.method, path: req.originalUrl })
    res.json({ success: true, data: { fixtureControllerReached: true } })
  } })
  const router = moduleName => load(`modules/${moduleName}/${moduleName}.routes.js`, {
    [`./${moduleName}.controller`]: controller(moduleName),
    '../../middleware/auth': auth,
    '../../middleware/loadRolePermissions': { loadRolePermissions },
    '../../config/db': { pool },
    ...(moduleName === 'accounting' ? { './finance-backfills.routes': load('modules/accounting/finance-backfills.routes.js', {
      './finance-backfills.controller': controller('finance-backfills'), '../../middleware/auth': auth,
    }) } : {}),
  })
  const app = express()
  app.use(express.json())
  for (const name of ['reports', 'finance', 'accounting', 'payments', 'logistics', 'oplogs', 'credit-overrides', 'sale', 'purchase', 'inventory', 'products']) {
    app.use(`/api/${name}`, router(name))
  }
  app.use(load('middleware/errorHandler.js', {
    '../config/env': { env },
    '../utils/logger': { warn() {}, error() {} },
    '../utils/errorTracking': { initializeErrorTracking() {}, captureUnexpectedError() {} },
  }))
  let server
  try {
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
      listening.once('error', reject)
    })
    const origin = `http://127.0.0.1:${server.address().port}`
    async function request(role, route) {
      const previousCalls = calls.length, previousQueries = permissionQueries.length
      const roleId = typeof role === 'number' ? role : roles.find(r => r.code === role).id
      const token = jwt.sign({ userId: 1000 + roleId, tokenVersion: 0 }, secret, { expiresIn: '5m' })
      const response = await fetch(origin + route.path, {
        method: route.method || 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
      })
      return { status: response.status, body: await response.json(), calls: calls.slice(previousCalls), permissionQueries: permissionQueries.slice(previousQueries) }
    }
    await fn({ request, calls, permissionQueries })
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

module.exports = { httpFixture }
