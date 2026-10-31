'use strict'

// Execute the real settings handlers with an in-memory connection. No database
// config or environment files are loaded. Assertions inspect writes, including
// the integer-product policy and raw input before storage/conversion rounding.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const qtyPrecision = require('../backend/src/utils/qtyPrecision')
const AppError = require('../backend/src/utils/AppError')
const units = require('../backend/src/utils/unitConversion')
const noop = () => {}

function load(rel, mocks, tail = '') {
  const filename = path.join(root, rel)
  const localRequire = createRequire(filename)
  const module_ = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + tail, {
    module: module_,
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id.endsWith('/qtyPrecision')) return qtyPrecision
      if (id.endsWith('/AppError')) return AppError
      if (id.endsWith('/unitConversion')) return units
      if (['express', 'zod'].includes(id) || id.endsWith('/route') || id.endsWith('/permissions')) return localRequire(id)
      return {}
    },
  }, { filename })
  return module_.exports
}

function context({ allowDecimal = true, rate = 1, legacyPolicy = null } = {}) {
  const writes = []
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: noop,
    async query(sql, params) {
      if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) { writes.push({ sql, params }); return [{ affectedRows: 1 }] }
      if (sql.includes('allow_decimal_qty')) return [[{ id: 7, name: '数量策略商品', allow_decimal_qty: allowDecimal ? 1 : 0 }]]
      if (sql.includes('supply_suppliers')) return [[{ id: 8 }]]
      if (sql.includes('FROM product_items')) return [[{ id: 7, unit: '个', is_active: 1 }]]
      if (sql.includes('supplier_product_purchase_policies')) return [[...(writes.length ? [] : legacyPolicy ? [legacyPolicy] : [])]]
      if (sql.includes('FROM product_units')) return [[{ unit_name: '箱', conversion_rate: rate, unitName: '箱', conversionRate: rate }]]
      if (sql.includes('FROM procurement_plan_items')) return [[{ id: 9, product_id: 7, warehouse_id: 1, status: 1, adjusted_qty: 0 }]]
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  const mocks = { '../../config/db': { pool: { ...conn, getConnection: async () => conn } } }
  return { conn, writes, mocks }
}

function policyService(ctx) {
  return load('backend/src/modules/procurement/procurement.policies.js', {
    ...ctx.mocks, './procurement.planning': { lockPlanning: async () => {} },
  })
}
const policyInput = { productId: 7, supplierId: 8, entryUnit: '个', packMultiple: 0, minimumOrderQty: 0 }
const decimalsError = error => error.code === 'QTY_DECIMALS_EXCEEDED'
const integerError = error => error.code === 'QTY_INTEGER_REQUIRED'

test('purchase policy rejects each raw overprecision field without writes', async () => {
  for (const field of ['packMultiple', 'minimumOrderQty']) {
    const ctx = context()
    await assert.rejects(() => policyService(ctx).savePolicy({ ...policyInput, [field]: 1.005 }), decimalsError)
    assert.equal(ctx.writes.length, 0)
  }
})
test('purchase policy rejects retired auxiliary units before conversion', async () => {
  const ctx = context({ rate: 1.1 })
  await assert.rejects(() => policyService(ctx).savePolicy({ ...policyInput, entryUnit: '箱', packMultiple: 0.01 }), { code: 'PRODUCT_MULTI_UNIT_REMOVED' })
  assert.equal(ctx.writes.length, 0)
})
test('purchase policy cannot restore auxiliary entry even when conversion would yield an integer base', async () => {
  const invalid = context({ allowDecimal: false, rate: 3 })
  await assert.rejects(() => policyService(invalid).savePolicy({ ...policyInput, entryUnit: '箱', packMultiple: 0.5 }), { code: 'PRODUCT_MULTI_UNIT_REMOVED' })
  assert.equal(invalid.writes.length, 0)
  const valid = context({ allowDecimal: false, rate: 2 })
  await assert.rejects(() => policyService(valid).savePolicy({ ...policyInput, entryUnit: '箱', packMultiple: 0.5, minimumOrderQty: 1 }), { code: 'PRODUCT_MULTI_UNIT_REMOVED' })
  assert.equal(valid.writes.length, 0)
})
test('purchase policy preserves valid decimals and unrestricted zero', async () => {
  const ctx = context()
  await policyService(ctx).savePolicy({ ...policyInput, packMultiple: 0.12, minimumOrderQty: 0 })
  assert.equal(ctx.writes[0].params[3], 0.12)
  assert.equal(ctx.writes[0].params[4], 0)
})

function stockPolicy(ctx) {
  const save = load('backend/src/modules/products/products.service.js', ctx.mocks,
    '\nmodule.exports.testStockPolicy = upsertDefaultStockPolicy\n').testStockPolicy
  return (db, productId, input) => save(db, productId, input, null)
}
test('stock settings reject each overprecision value before INSERT/DELETE', async () => {
  for (const field of ['safetyStock', 'reorderPoint']) {
    const ctx = context()
    await assert.rejects(() => stockPolicy(ctx)(ctx.conn, 7, { [field]: 0.001 }), decimalsError)
    assert.equal(ctx.writes.length, 0)
  }
})
test('stock settings honor integer product policy', async () => {
  const ctx = context({ allowDecimal: false })
  await assert.rejects(() => stockPolicy(ctx)(ctx.conn, 7, { safetyStock: 1.5 }), integerError)
  assert.equal(ctx.writes.length, 0)
})
test('stock settings preserve decimals, omitted fields and zero clear behavior', async () => {
  const ctx = context()
  const save = stockPolicy(ctx)
  await save(ctx.conn, 7, {})
  assert.equal(ctx.writes.length, 0)
  await save(ctx.conn, 7, { safetyStock: 1.25, reorderPoint: 2.5 })
  assert.equal(ctx.writes[0].params[1], 1.25)
  assert.equal(ctx.writes[0].params[2], 2.5)
  await save(ctx.conn, 7, { safetyStock: 0, reorderPoint: 0 })
  assert.match(ctx.writes[1].sql, /^DELETE/)
})

function planService(ctx) {
  return load('backend/src/modules/procurement/procurement.service.js', {
    ...ctx.mocks,
    './procurement.planning': { lockPlanning: async () => {} },
    '../../utils/statusTransition': { lockStatusRow: async () => ({ id: 1, status: 1 }) },
    '../../constants/documentStatusRules': { assertStatusAction: noop },
    '../../utils/warehouseScope': { assertInScope: noop },
  }, '\ngetPlan = async () => ({ id: 1 })\n')
}
test('plan adjusted quantity rejects overprecision and fractional integer products', async () => {
  for (const [qty, allowDecimal, predicate] of [[1.005, true, decimalsError], [1.5, false, integerError]]) {
    const ctx = context({ allowDecimal })
    await assert.rejects(() => planService(ctx).updatePlanItem(1, 9, { adjustedQty: qty }), predicate)
    assert.equal(ctx.writes.length, 0)
  }
})
test('plan adjusted quantity preserves legal decimal/zero values', async () => {
  for (const qty of [1.25, 0]) {
    const ctx = context()
    await planService(ctx).updatePlanItem(1, 9, { adjustedQty: qty })
    assert.equal(ctx.writes[0].params[0], qty)
  }
})

test('procurement setting routes reject more than two decimals', () => {
  const routes = load('backend/src/modules/procurement/procurement.routes.js', {
    './procurement.controller': new Proxy({}, { get: () => noop }),
    '../../middleware/auth': { authMiddleware: noop, requirePermission: () => noop },
  })
  const inputs = [
    ['/purchase-policy', { ...policyInput, packMultiple: 1.005 }],
    ['/purchase-policy', { ...policyInput, minimumOrderQty: 1.005 }],
    ['/plans/:id/items/:itemId', { adjustedQty: 1.005 }],
  ]
  for (const [url, body] of inputs) {
    const route = routes.stack.find(layer => layer.route?.path === url && layer.route.methods.put).route
    let failure
    route.stack[1].handle({ body }, {}, error => { failure = error })
    assert.ok(failure?.issues?.length, url)
  }
})

function inventoryPolicies(ctx) {
  const scope = load('backend/src/utils/warehouseScope.js', { '../config/db': ctx.mocks['../../config/db'] })
  return load('backend/src/modules/inventory/inventory.service.js', { ...ctx.mocks, '../../utils/warehouseScope': scope })
}
test('warehouse stock policies validate all raw quantities before batch writes', async () => {
  for (const field of ['safetyStock', 'reorderPoint', 'targetStock']) {
    const ctx = context()
    await assert.rejects(() => inventoryPolicies(ctx).saveStockPolicies([
      { productId: 7, warehouseId: 1, safetyStock: 1 },
      { productId: 7, warehouseId: 2, [field]: 0.005 },
    ], null), decimalsError)
    assert.equal(ctx.writes.length, 0)
  }
})
test('warehouse stock policies apply integer rules to target quantity as well', async () => {
  const ctx = context({ allowDecimal: false })
  await assert.rejects(() => inventoryPolicies(ctx).saveStockPolicies([
    { productId: 7, warehouseId: 1, targetStock: 1.5 },
  ], null), integerError)
  assert.equal(ctx.writes.length, 0)
})
test('warehouse stock policies retain decimals, target zero and default fallback deletion', async () => {
  const ctx = context()
  const result = await inventoryPolicies(ctx).saveStockPolicies([
    { productId: 7, warehouseId: 1, safetyStock: 1.25, reorderPoint: 2.5, targetStock: 3.75 },
    { productId: 7, warehouseId: 2, targetStock: 0 },
    { productId: 7, warehouseId: 0 },
  ], null)
  assert.equal(result.saved, 2)
  assert.equal(result.deleted, 1)
  assert.equal(ctx.writes[0].params[2], 1.25)
  assert.equal(ctx.writes[0].params[4], 3.75)
  assert.equal(ctx.writes[1].params[4], 0)
  assert.match(ctx.writes[2].sql, /^DELETE/)
})

test('fixed-unit purchase policy still rejects fractional input for integer products', async () => {
  const ctx = context({ allowDecimal: false })
  await assert.rejects(() => policyService(ctx).savePolicy({ ...policyInput, packMultiple: 0.5 }), integerError)
  assert.equal(ctx.writes.length, 0)
})


test('旧采购包装规则只读投影为基本量，重新保存只写固定单位', async () => {
  const ctx = context({ rate: 12, legacyPolicy: { entry_unit: '箱', pack_multiple: 2, minimum_order_qty: 3 } })
  const service = policyService(ctx)
  const current = await service.getPolicy(7, 8)
  assert.equal(current.entryUnit, '个')
  assert.equal(current.conversionRate, 1)
  assert.equal(current.packMultiple, 24)
  assert.equal(current.minimumOrderQty, 36)
  assert.equal(ctx.writes.length, 0)
  await service.savePolicy({ ...policyInput, packMultiple: 24, minimumOrderQty: 36 })
  assert.deepEqual(Array.from(ctx.writes[0].params), [7, 8, '个', 24, 36])
})
test('缺失旧换算率时明确拒绝展示，用户仍可重新配置固定单位规则', async () => {
  const ctx = context({ rate: 0, legacyPolicy: { entry_unit: '箱', pack_multiple: 2 } })
  const service = policyService(ctx)
  await assert.rejects(service.getPolicy(7, 8), { code: 'PURCHASE_POLICY_UNIT_INVALID' })
  await service.savePolicy({ ...policyInput, packMultiple: 24 })
  assert.equal(ctx.writes[0].params[2], '个')
})
test('新建商品不再接受辅助单位配置，且不访问数据库', async () => {
  const service = load('backend/src/modules/products/products.service.js', {})
  await assert.rejects(service.create({ unit: '个', units: [{ unitName: '箱', conversionRate: 12 }] }), { code: 'PRODUCT_MULTI_UNIT_REMOVED' })
})
