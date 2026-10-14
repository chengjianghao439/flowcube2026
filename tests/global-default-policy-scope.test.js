'use strict'

// Real domain/controller functions, closed SQL adapter. Actual HTTP/auth scope
// loading and MySQL evidence are separate. No identity/role/scope persistence.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const qty = require('../backend/src/utils/qtyPrecision')
const root = path.resolve(__dirname, '..')
const sourceRoot = process.env.GLOBAL_POLICY_SOURCE_ROOT || root
function load(file, mocks) {
  const module = { exports: {} }
  const candidate = path.join(sourceRoot, file)
  const filename = fs.existsSync(candidate) ? candidate : path.join(root, file)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name.endsWith('/AppError')) return AppError
    if (name.endsWith('/qtyPrecision')) return qty
    if (name.endsWith('/operator')) return require('../backend/src/utils/operator')
    if (name.endsWith('/requestKey')) return require('../backend/src/utils/requestKey')
    throw new Error(`Unexpected dependency ${name}`)
  } }, { filename })
  return module.exports
}
function domain() {
  const calls = [], writes = [], transactions = []
  const query = async (sql, params = []) => {
    calls.push({ sql, params })
    if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) { writes.push({ sql, params }); return [{ affectedRows: 1, insertId: 41 }] }
    if (sql.includes('FROM product_categories')) return [[{ id: 1 }]]
    if (sql.includes('FROM inventory_cycle_rules')) return [[]]
    if (sql.includes('FROM product_stock_policies')) return [[{ product_id: 7, warehouse_id: 0, safety_stock: 1, reorder_point: 2, target_stock: null }]]
    if (sql.includes('FROM product_items')) return [[{ id: 7, name: '合成商品', code: 'SYN7', unit: '个', allow_decimal_qty: 0, revision: 1, cost_price: 5, sale_price_a: 10 }]]
    throw new Error(`Unexpected SQL ${sql}`)
  }
  const conn = { query, beginTransaction: async () => transactions.push('begin'), commit: async () => transactions.push('commit'), rollback: async () => transactions.push('rollback'), release: () => transactions.push('release') }
  const pool = { query, getConnection: async () => conn }
  const scopes = load('backend/src/utils/warehouseScope.js', { '../config/db': { pool } })
  const common = { '../../config/db': { pool }, '../../utils/warehouseScope': scopes }
  const inventory = load('backend/src/modules/inventory/inventory.service.js', {
    ...common, './manual-stock-request': {}, '../../engine/inventoryEngine': {}, '../../engine/containerEngine': {}, './inventoryProjection': {}, '../../utils/pagination': {}, '../../utils/expectedStock': {}, '../../utils/operationRequest': {},
  })
  const cycle = load('backend/src/modules/stockcheck/stockcheck.cycle.js', common)
  const products = load('backend/src/modules/products/products.service.js', {
    ...common,
    '../document-activity/document-change-audit': { normalizeReason: () => {}, assertChangeRequest: async () => 'proof', bindChangeRequest: async () => {} },
    '../../utils/operationRequest': { beginOperationRequest: async () => ({ replay: true, responseData: { updated: true } }) },
    '../../utils/codeGenerator': { generateMasterCode: async () => 'SYN-NEW' },
    '../../utils/priceLevels': { loadPriceRates: async () => ({}), computeTierPrices: () => ({ salePriceA: 10, salePriceB: 10, salePriceC: 10, salePriceD: 10 }) },
    '../inventory/inventoryProjection': {}, '../../utils/pagination': {}, './productSearch': {},
  })
  return { inventory, cycle, products, calls, writes, transactions }
}
const rule = [{ abcClass: 'A', intervalDays: 31, batchLimit: 21, enabled: true }]
const product = { name: '合成商品', categoryId: 1, supplierId: 2, unit: '个', spec: 'SYN', color: '合成', costPrice: 5, salePriceA: 10, isActive: true, revision: 1 }
async function denied(promise, d) {
  await assert.rejects(promise, error => error instanceof AppError && error.statusCode === 403)
  assert.deepEqual(d.writes, [], 'no domain writes')
}
for (const scope of [undefined, 'null', {}, false, 0, [], [8], [8, 9]]) {
  const label = JSON.stringify(scope) ?? 'undefined/omitted'
  for (const which of ['inventory', 'cycle', 'product-create', 'product-update-replay']) test(`${which}: global default rejects scope ${label}`, async () => {
    const d = domain()
    if (which === 'inventory') await denied(d.inventory.saveStockPolicies([{ productId: 7, warehouseId: 0, safetyStock: 1 }], scope), d)
    if (which === 'cycle') await denied(d.cycle.saveCycleRules({ rules: rule, scopeWarehouseIds: scope }), d)
    if (which === 'product-create') await denied(d.products.create({ ...product, safetyStock: 1 }, { scopeWarehouseIds: scope }), d)
    if (which === 'product-update-replay') await denied(d.products.update(7, { ...product, reorderPoint: 1 }, { userId: 1 }, 'original-key', { scopeWarehouseIds: scope }), d)
  })
}
for (const scope of [undefined, 'null', {}, false, 0, [0], [-8], [8, '9'], [8.5]]) {
  const label = JSON.stringify(scope) ?? 'undefined/omitted'
  for (const which of ['inventory', 'cycle']) test(`${which}: positive warehouse fails closed for invalid current scope ${label}`, async () => {
    const d = domain()
    if (which === 'inventory') await denied(d.inventory.saveStockPolicies([{ productId: 7, warehouseId: 8, safetyStock: 1 }], scope), d)
    if (which === 'cycle') await denied(d.cycle.saveCycleRules({ warehouseId: 8, rules: rule, scopeWarehouseIds: scope }), d)
    assert.deepEqual(d.calls, [])
  })
}
test('global stock policy deletion is also a global write', async () => {
  const d = domain()
  await denied(d.inventory.saveStockPolicies([{ productId: 7, warehouseId: 0, safetyStock: 0, reorderPoint: 0 }], [8]), d)
})
test('product explicit zero deletion is guarded before create or replay', async () => {
  for (const which of ['create', 'update']) {
    const d = domain()
    const input = { ...product, safetyStock: 0, reorderPoint: 0 }
    await denied(which === 'create' ? d.products.create(input, { scopeWarehouseIds: [8] }) : d.products.update(7, input, { userId: 1 }, 'original-key', { scopeWarehouseIds: [8] }), d)
  }
})
test('mixed positive/global batch rejects before policy/quantity SQL', async () => {
  const d = domain()
  await denied(d.inventory.saveStockPolicies([{ productId: 7, warehouseId: 8, safetyStock: 4 }, { productId: 7, warehouseId: 0, safetyStock: 5 }], [8]), d)
  assert.deepEqual(d.calls, [])
})
test('explicit null permits global writes, reads and original zero deletion', async () => {
  const d = domain()
  const saved = await d.inventory.saveStockPolicies([{ productId: 7, warehouseId: 0, safetyStock: 4 }], null)
  assert.equal(saved.saved, 1)
  await d.inventory.saveStockPolicies([{ productId: 7, warehouseId: 0, safetyStock: 0 }], null)
  assert.ok(d.writes.some(q => q.sql.startsWith('DELETE FROM product_stock_policies')))
  assert.equal((await d.cycle.saveCycleRules({ warehouseId: 0, rules: rule, scopeWarehouseIds: null })).warehouseId, 0)
})
test('positive warehouse write keeps original scope; global reads remain available to limited users', async () => {
  const d = domain()
  assert.equal((await d.inventory.saveStockPolicies([{ productId: 7, warehouseId: 8, safetyStock: 1 }], [8])).saved, 1)
  await d.cycle.saveCycleRules({ warehouseId: 8, rules: rule, scopeWarehouseIds: [8] })
  assert.equal((await d.cycle.getCycleRules({ warehouseId: 0, scopeWarehouseIds: [8] })).warehouseId, 0)
  assert.equal(Number((await d.inventory.getStockPolicies({ productId: 7, scopeWarehouseIds: [8] }))[0].warehouseId), 0)
  await assert.rejects(d.cycle.saveCycleRules({ warehouseId: 9, rules: rule, scopeWarehouseIds: [8] }), { statusCode: 403 })
})
test('ordinary product data with null/omitted policy inputs remains a non-policy operation', async () => {
  const d = domain()
  assert.equal((await d.products.create({ ...product, safetyStock: null, reorderPoint: '' }, { scopeWarehouseIds: [8] })).id, 41)
  assert.ok(!d.writes.some(q => q.sql.includes('product_stock_policies')))
})

for (const [domainName, method, serviceName, optionsIndex] of [
  ['inventory', 'saveStockPolicies', 'saveStockPolicies', 1],
  ['stockcheck', 'saveCycleRules', 'saveCycleRules', 0],
  ['products', 'create', 'create', 1],
  ['products', 'update', 'update', 4],
]) test(`${domainName}.${method} forwards current authenticated scope verbatim and ignores body scope`, async () => {
  const calls = []
  const api = { [serviceName]: async (...args) => { calls.push(args); return {} } }
  const controllers = load(`backend/src/modules/${domainName}/${domainName}.controller.js`, {
    './inventory.service': api, './inventory.aging': {}, './inventory.procurement': {}, './inventory.reservations': {},
    './stockcheck.service': {}, './stockcheck.cycle': api, './products.service': api,
    '../../utils/response': { successResponse: (res, data) => data }, '../print-jobs/print-jobs.middleware': {},
  })
  for (const scope of [undefined, {}, [], [8], null]) {
    const req = { user: { userId: 1, warehouseIds: scope }, params: { id: '7' }, headers: {}, body: { ...product, warehouseId: 0, items: [], rules: rule, scopeWarehouseIds: null, warehouseIds: null } }
    let error
    await controllers[method](req, {}, value => { error = value })
    assert.equal(error, undefined)
    const forwarded = calls.at(-1)[optionsIndex]
    assert.equal(domainName === 'inventory' ? forwarded : forwarded?.scopeWarehouseIds, scope)
  }
})
