'use strict'
// Real routes/controller/service/error handler; only auth and SQL transport are controlled.
// No app, production config, business writes or request-time DDL are imported.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const express = require('../../backend/node_modules/express')
const root = path.resolve(__dirname, '../..')
function load(file, dependencies) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, process: { env: {} }, require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${file}: ${name}`)
      return dependencies[name]
    },
  }, { filename: file })
  return module.exports
}
function createFixture(query) {
  const warnings = [], inserts = []
  let injectedError = null
  const noop = () => {}
  const pool = { async query(sql, params) {
    assert.match(sql, /^\s*INSERT INTO pda_(?:error|undo)_logs\b/, 'only append-only PDA audit SQL is allowed')
    inserts.push({ sql, params })
    if (injectedError) throw injectedError
    return query(sql, params)
  } }
  const logger = { warn(...args) { warnings.push(args) }, error: noop }
  const AppError = require('../../backend/src/utils/AppError')
  const service = load('backend/src/modules/scan-logs/scan-logs.service.js', {
    '../../utils/qtyPrecision': require('../../backend/src/utils/qtyPrecision'),
    '../../utils/unitConversion': require('../../backend/src/utils/unitConversion'),
    '../fulfillment/fulfillment.refresh': {}, '../../config/db': { pool }, '../../utils/AppError': AppError,
    '../../utils/warehouseScope': {}, '../../utils/sqlIdentifier': require('../../backend/src/utils/sqlIdentifier'),
    '../../engine/containerEngine': {}, '../../constants/warehouseTaskStatus': {},
    '../warehouse-tasks/warehouse-tasks.service': {}, '../warehouse-tasks/warehouse-task-events.service': {},
    '../warehouse-tasks/warehouse-tasks.helpers': {}, '../../utils/operationRequest': {}, '../../utils/logger': logger,
  })
  const controller = load('backend/src/modules/scan-logs/scan-logs.controller.js', {
    './scan-logs.service': service, '../../utils/response': require('../../backend/src/utils/response'),
    '../../utils/requestKey': {}, '../../utils/operator': require('../../backend/src/utils/operator'),
  })
  const pass = (_req, _res, next) => next()
  const router = load('backend/src/modules/scan-logs/scan-logs.routes.js', {
    express, zod: require('../../backend/node_modules/zod'), './scan-logs.controller': controller,
    '../../middleware/auth': { authMiddleware(req, _res, next) { req.user = { userId: 7, realName: '合成操作员' }; next() }, requirePermission: () => pass },
    '../../constants/permissions': require('../../backend/src/constants/permissions'),
    '../../middleware/pdaSession': { pdaSessionRequired: () => pass }, '../../middleware/pdaOnly': { pdaOnly: pass },
    '../../utils/route': require('../../backend/src/utils/route'),
  })
  const errorHandler = load('backend/src/middleware/errorHandler.js', {
    '../utils/AppError': AppError, multer: require('../../backend/node_modules/multer'), '../utils/logger': logger,
    '../utils/response': require('../../backend/src/utils/response'), '../config/env': { env: { NODE_ENV: 'test', SENTRY_DSN: '' } },
    '../utils/errorTracking': { initializeErrorTracking: noop, captureUnexpectedError: noop },
  })
  const app = express()
  app.use(express.json())
  app.use('/api/scan-logs', router)
  app.use(errorHandler)
  return { app, service, inserts, warnings, failWith(error) { injectedError = error } }
}
async function listen(fixture) {
  const server = await new Promise((resolve, reject) => {
    const listening = fixture.app.listen(0, '127.0.0.1', () => resolve(listening))
    listening.once('error', reject)
  })
  return {
    async post(kind, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/scan-logs/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() }
    },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}
function payload(kind, barcode) {
  return kind === 'error' ? { taskId: 11, barcode, reason: '合成扫码错误' }
    : { taskId: 11, itemId: 12, barcode, prevQty: 2, newQty: 1 }
}
module.exports = { createFixture, listen, payload }
