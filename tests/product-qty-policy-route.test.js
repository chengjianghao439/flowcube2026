'use strict'

// Exercise the real product routes and validateBody middleware without loading
// database configuration. Removing allowDecimalQty from productBase must fail
// the explicit-boolean and invalid-type cases below.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const filename = path.resolve(__dirname, '../backend/src/modules/products/products.routes.js')
const localRequire = createRequire(filename)
const noop = () => {}
const { PERMISSIONS } = localRequire('../../constants/permissions')
const permissionCheck = (permission) => (req, res, next) => {
  if (req.user?.roleId === 1 || req.user?.permissions?.includes(permission)) return next()
  const error = new Error('Forbidden')
  error.statusCode = 403
  return next(error)
}
const controller = new Proxy({}, { get: () => noop })
const module_ = { exports: {} }
const stubs = {
  './products.controller': controller,
  '../../middleware/auth': { authMiddleware: noop, requirePermission: permissionCheck },
  '../../middleware/loadRolePermissions': { loadRolePermissions: (req, res, next) => next() },
  '../../config/db': { pool: {} },
  '../../utils/codeGenerator': { generateMasterCode: noop },
}

function policyAccess(permissions, roleId = 2) {
  const route = module_.exports.stack.find(layer => layer.route?.path === '/qty-policies').route
  let result
  route.stack[0].handle({ user: { roleId, permissions } }, {}, error => { result = error })
  return result
}

test('quantity operators can read the minimal policy without product.view', () => {
  for (const permission of [
    PERMISSIONS.INBOUND_RECEIVE_EXECUTE, PERMISSIONS.RETURN_ORDER_EXECUTE,
    PERMISSIONS.STOCKCHECK_VIEW, PERMISSIONS.STOCKCHECK_UPDATE,
    PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.SALE_ORDER_UPDATE,
    PERMISSIONS.SALE_ORDER_RESERVE, PERMISSIONS.SALE_ORDER_RELEASE, PERMISSIONS.SALE_ORDER_SHIP,
    PERMISSIONS.PURCHASE_ORDER_CREATE, PERMISSIONS.PURCHASE_REQUISITION_CREATE,
    PERMISSIONS.PURCHASE_REQUISITION_CONVERT, PERMISSIONS.TRANSFER_ORDER_CREATE,
    PERMISSIONS.INVENTORY_DISPOSAL_CREATE, PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.INVENTORY_CONTAINER_SPLIT,
  ]) assert.equal(policyAccess([permission]), undefined, permission)
})

test('policy access rejects unrelated permissions and retains product/admin access', () => {
  assert.equal(policyAccess([])?.statusCode, 403)
  assert.equal(policyAccess([PERMISSIONS.PAYMENT_VIEW])?.statusCode, 403)
  assert.equal(policyAccess([PERMISSIONS.PRODUCT_VIEW]), undefined)
  assert.equal(policyAccess([], 1), undefined)
})

test('quantity-operation permission does not open full product records', () => {
  for (const url of ['/', '/active', '/finder', '/:id']) {
    const route = module_.exports.stack.find(layer => layer.route?.path === url && layer.route.methods.get).route
    let failure
    route.stack[0].handle({ user: { roleId: 2, permissions: [PERMISSIONS.INBOUND_RECEIVE_EXECUTE] } }, {}, error => { failure = error })
    assert.equal(failure?.statusCode, 403, url)
  }
})
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module: module_,
  require: (id) => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id),
}, { filename })

function parseThroughRoute(method, body) {
  const route = module_.exports.stack.find(layer =>
    layer.route?.path === (method === 'post' ? '/' : '/:id') && layer.route.methods[method],
  ).route
  const req = { body }
  let failure
  // Permission is first, real validateBody second, controller third.
  route.stack[1].handle(req, {}, error => { failure = error })
  if (failure) throw failure
  return req.body
}

const base = {
  name: '精度测试商品', categoryId: 1, supplierId: 1, unit: '个',
  spec: '测试型号', color: '黑', costPrice: 1, isActive: true,
}

for (const method of ['post', 'put']) {
  for (const value of [false, true]) {
    test(`${method} preserves allowDecimalQty=${value} through body validation`, () => {
      const parsed = parseThroughRoute(method, { ...base, allowDecimalQty: value })
      assert.equal(parsed.allowDecimalQty, value)
    })
  }
  test(`${method} keeps omitted policy absent for legacy clients`, () => {
    assert.equal(Object.hasOwn(parseThroughRoute(method, { ...base }), 'allowDecimalQty'), false)
  })
  test(`${method} rejects nonboolean quantity policies`, () => {
    for (const value of [0, 1, 'false', 'true', null, [], {}]) {
      assert.throws(() => parseThroughRoute(method, { ...base, allowDecimalQty: value }),
        error => error.issues?.some(issue => issue.path.join('.') === 'allowDecimalQty'))
    }
  })
}
