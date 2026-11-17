'use strict'

// HTTP contract fixture. The Express routers, Zod, controllers, JWT middleware,
// response envelopes and operation-request helper are production code. Domain
// persistence and identity lookup are synthetic, with no app or DB pool import.
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { resolve } = require('node:path')
const { runInNewContext } = require('node:vm')
const express = require('../../backend/node_modules/express')
const jwt = require('../../backend/node_modules/jsonwebtoken')
const AppError = require('../../backend/src/utils/AppError')
const { PERMISSIONS: P } = require('../../backend/src/constants/permissions')
const { SALE_STATUS } = require('../../backend/src/constants/saleOrderStatus')

function load(relative, stubs) {
  const filename = resolve(__dirname, '../../backend/src', relative)
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  runInNewContext(readFileSync(filename, 'utf8'), {
    module, process,
    require: id => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id),
  }, { filename })
  return module.exports
}

async function startContractServer() {
  const requests = [], mutations = []
  const operationRows = []
  const sales = new Map(), receipts = new Map()
  const pool = {
    async query(sql, args) {
      if (sql.includes('INSERT INTO operation_requests')) {
        const [request_key, action, user_id, status] = args
        if (operationRows.some(row => row.request_key === request_key && row.action === action && row.user_id === user_id)) {
          throw Object.assign(new Error('同一合成请求'), { code: 'ER_DUP_ENTRY' })
        }
        const id = operationRows.length + 1
        operationRows.push({ id, request_key, action, user_id, status })
        return [{ insertId: id }]
      }
      if (sql.includes('SELECT *') && sql.includes('FROM operation_requests')) {
        const [key, action, userId] = args
        return [operationRows.filter(row => row.request_key === key && row.action === action && row.user_id === userId)]
      }
      assert.match(sql, /^UPDATE operation_requests\s+SET status = \?, response_json = \?/)
      const [status, response_json, response_message, resource_type, resource_id, id] = args
      const row = operationRows.find(item => item.id === id)
      assert.ok(row)
      Object.assign(row, { status, response_json, response_message, resource_type, resource_id })
      return [{ affectedRows: 1 }]
    },
  }
  const operations = load('utils/operationRequest.js', { '../config/db': { pool } })
  const env = { JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test' }
  const auth = load('middleware/auth.js', {
    './opLogger': (_req, _res, next) => next(),
    './loadRolePermissions': { loadRolePermissions(req, _res, next) {
      req.user.permissions = [P.SALE_ORDER_CREATE, P.SALE_ORDER_VIEW, P.PAYMENT_EXECUTE, P.PAYMENT_VIEW]
      next()
    } },
    '../config/env': { env },
    '../modules/auth/currentAuthUser': { async getCurrentAuthUser(id) {
      assert.equal(id, 7)
      return { id, role_id: 8, username: 'erp-xiaoman-contract', real_name: '合成操作员', token_version: 0 }
    } },
    '../modules/auth/sessionFamilies': { async assertActiveFamily() {} },
    '../modules/auth/auth-audit.service': { async recordAuthAudit() {}, AUTH_AUDIT_EVENT: { PERMISSION_DENIED: 'permission_denied' } },
    '../utils/requestContext': { updateRequestContext() {} },
    '../utils/warehouseScope': { async loadUserWarehouseScope() { return [21] } },
  })
  const normalPeriod = load('modules/accounting/finance-period.guard.js', {
    '../../config/db': { pool }, '../../middleware/auth': auth, '../../utils/operationRequest': operations,
  })

  async function write({ action, body, operator, key, resourceType, resourceId }, save) {
    assert.equal(operator.userId, 7)
    assert.ok(key, '两个客户端必须转交原请求键')
    const input = { action, userId: operator.userId, requestKey: key }
    const state = resourceId
      ? await operations.beginResourceOperationRequest(pool, { ...input, resourceType, resourceId })
      : await operations.beginCreationOperationRequest(pool, { ...input, payload: body })
    if (state.replay) return state.responseData
    const data = save()
    mutations.push({ action, key, body, ...(resourceId ? { resourceId } : {}) })
    await operations.completeOperationRequest(pool, state, { data, resourceType, resourceId: data.id })
    return data
  }

  const sale = load('modules/sale/sale.controller.js', {
    './sale.service': {
      create({ operator, requestKey, scopeWarehouseIds, repeatCreate, ...body }) {
        assert.deepEqual(scopeWarehouseIds, [21])
        assert.equal(repeatCreate, false)
        return write({ action: 'sale.create', body, operator, key: requestKey, resourceType: 'sale_order' }, () => {
          const id = 101 + sales.size
          const created = { id, orderNo: `SO-CONTRACT-${id}` }
          sales.set(id, { ...created, status: SALE_STATUS.DRAFT, ...body })
          return created
        })
      },
      findById(id) { return sales.get(id) },
    },
  })
  const payments = load('modules/payments/payments.controller.js', {
    './party-ledger.service': {}, './payments.service': {}, './reconciliation-statements.service': {}, './payment-aging.service': {},
    '../accounting/finance-period.guard': normalPeriod,
    './payment-receipts.service': {
      create(body, operator, key) {
        return write({ action: 'payment.receipt.create', body, operator, key, resourceType: 'payment_receipt' }, () => {
          const id = 201 + receipts.size
          const data = { id, receiptNo: `RC-CONTRACT-${id}`, amount: body.amount, settledAmount: 0, balance: body.amount, applied: [] }
          receipts.set(id, { ...data, status: 1, settlements: [] })
          return data
        })
      },
      settle(id, body, operator, key) {
        return write({ action: 'payment.receipt.settle', body, operator, key, resourceType: 'payment_receipt', resourceId: id }, () => {
          const receipt = receipts.get(id)
          if (!receipt) throw new AppError('收付款单不存在', 404)
          const amount = body.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
          const { receiptNo } = receipt
          const settledAmount = receipt.settledAmount + amount
          const balance = receipt.balance - amount
          const applied = body.allocations.map(allocation => ({ ...allocation, orderNo: 'SO-CONTRACT-AR-51', settled: true }))
          const data = { id, receiptNo, settledAmount, balance, applied }
          const settlements = applied.map(({ settled, ...allocation }) => ({ ...allocation, orderStatus: settled ? 3 : 2 }))
          receipts.set(id, { ...receipt, ...data, status: 3, settlements })
          return data
        })
      },
      findById(id) { return receipts.get(id) },
    },
  })
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    res.on('finish', () => requests.push({
      method: req.method, path: req.originalUrl, requestKey: req.get('X-Request-Key'), status: res.statusCode,
    }))
    next()
  })
  for (const [name, controller] of Object.entries({ sale, payments })) {
    app.use(`/api/${name}`, load(`modules/${name}/${name}.routes.js`, {
      [`./${name}.controller`]: controller, '../../middleware/auth': auth,
    }))
  }
  app.use(load('middleware/errorHandler.js', {
    '../config/env': { env },
    '../utils/logger': { warn() {}, error(_message, error) { console.error(error) } },
    '../utils/errorTracking': { initializeErrorTracking() {}, captureUnexpectedError() {} },
  }))
  const server = await new Promise((resolveListen, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolveListen(listening))
    listening.once('error', reject)
  })
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    token: jwt.sign({ userId: 7, tokenVersion: 0 }, env.JWT_SECRET, { expiresIn: '5m' }),
    requests,
    mutations,
    close: () => new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())),
  }
}

module.exports = { startContractServer }
