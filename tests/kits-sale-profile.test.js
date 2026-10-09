'use strict'
// Execute the real resolver with a bounded synthetic read connection, not a copied price formula.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/modules/sale/sale.commercial-resolver.js')
const part = { id: 1, productId: 1, baseQty: 1, referencePrice: 80, amountWeight: '80.000000', sortNo: 0 }
const scopeFilename = path.resolve(__dirname, '../backend/src/utils/warehouseScope.js')
const scopeModule = new Module(scopeFilename, module)
scopeModule.filename = scopeFilename; scopeModule.paths = Module._nodeModulePaths(path.dirname(scopeFilename))
const scopeRequire = Module.createRequire(scopeFilename)
scopeModule.require = id => id === '../config/db' ? { pool: { query: () => { throw new Error('Offline resolver proof must not use the configured pool') } } } : scopeRequire(id)
scopeModule._compile(fs.readFileSync(scopeFilename, 'utf8'), scopeFilename)
function fixture(level = 'B', prices = {}) {
  const version = { id: 7, kitId: 3, versionNo: 1, referenceUnitPrice: 100, salePriceA: 100, salePriceB: 90, salePriceC: 80, salePriceD: 70, components: [part], ...prices }
  const mod = new Module(filename, module)
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename))
  const localRequire = Module.createRequire(filename)
  mod.require = id => id === '../kits/kits.service' ? {
    loadVersions: async () => new Map([[7, version]]),
    disabledReasons: () => [], definitionView: (row, v) => ({ ...row, version: v }),
  } : id === '../../utils/warehouseScope' ? scopeModule.exports : localRequire(id)
  mod._compile(fs.readFileSync(filename, 'utf8'), filename)
  const master = { id: 3, code: 'K000003', name: '合页组合', current_version_id: 7, unit: '组', spec: 'H-20', color: '银色', article_number: 'SUP-20' }
  const queries = []
  const conn = { query: async sql => {
    queries.push(sql)
    if (sql.includes('FROM sale_customers')) return [[{ id: 1, name: '合成客户', is_active: 1, price_level: level }]]
    if (sql.includes('FROM inventory_warehouses')) return [[{ id: 1, name: '合成仓', is_active: 1 }]]
    if (sql.includes('FROM kit_definitions')) return [[master]]
    if (sql.includes('FROM product_items')) return [[{ id: 1, code: 'P000001', name: '铰链', unit: '个', is_active: 1, allow_decimal_qty: 0 }]]
    throw new Error(`Unexpected resolver query: ${sql}`)
  } }
  const input = { customerId: 1, warehouseId: 1, commercialGroups: [{ kind: 'kit', lineKey: 'one', kitVersionId: 7, quantity: 1, priceSource: 'kit_default', unitPrice: 0.01 }] }
  const resolve = (body = input, saved = [], formal = false) => mod.exports.resolve(conn, body, saved, { readOnly: true, formal })
  return { resolve, input, master, queries }
}
for (const [level, price] of [['A', 100], ['B', 90], ['C', 80], ['D', 70]]) {
  test(`new kit default uses customer ${level} tier rather than the client quote`, async () => {
    const f = fixture(level), result = await f.resolve()
    assert.equal(result.groups[0].unitPrice, price)
    assert.equal(result.total, price)
    assert.deepEqual(result.groups[0].metadata.quote, { referenceUnitPrice: price, resolvedPriceSource: 'price_level', resolvedPriceLevel: level, priceListId: null })
  })
}
test('an explicit zero tier remains zero in preview and is rejected for a formal sale', async () => {
  const f = fixture('B', { salePriceB: 0 })
  assert.equal((await f.resolve()).groups[0].unitPrice, 0)
  await assert.rejects(f.resolve(f.input, [], true), { code: 'SALE_PRICE_REQUIRED' })
})
test('legacy missing tiers fall back to the frozen version A; manual price stays authoritative', async () => {
  const f = fixture('B', { salePriceB: null })
  assert.equal((await f.resolve()).groups[0].unitPrice, 100)
  const input = { ...f.input, commercialGroups: [{ ...f.input.commercialGroups[0], priceSource: 'manual', unitPrice: 12.3456 }] }
  assert.equal((await f.resolve(input)).groups[0].unitPrice, 12.3456)
})
test('unit/model/color/supplier-model are frozen in the commercial group for later display', async () => {
  const f = fixture(), group = (await f.resolve()).groups[0]
  assert.equal(group.metadata.kitUnit, '组')
  assert.deepEqual(group.metadata.kitIdentity, { spec: 'H-20', color: '银色', articleNumber: 'SUP-20' })
  f.master.unit = '套'; f.master.spec = 'H-30'
  const saved = [{ ...group, metadata: { ...group.metadata, input: { ...f.input.commercialGroups[0], warehouseId: 1 } } }]
  const retained = (await f.resolve(f.input, saved)).groups[0]
  assert.equal(retained.retained, true)
  assert.equal(retained.metadata.kitUnit, '组')
  assert.equal(retained.metadata.kitIdentity.spec, 'H-20')
  assert.equal(retained.unitPrice, 90)
})
test('changing the customer re-resolves a default kit tier instead of retaining the old quote', async () => {
  const f = fixture(), group = (await f.resolve()).groups[0]
  const saved = [{ ...group, metadata: { ...group.metadata, input: { ...f.input.commercialGroups[0], warehouseId: 1 }, priceCustomerId: 2 } }]
  const result = await f.resolve(f.input, saved)
  assert.equal(result.groups[0].retained, undefined)
  assert.equal(result.groups[0].metadata.priceCustomerId, 1)
})
test('editing or clearing a line remark retains the original kit version, agreed price and money snapshot', async () => {
  const f = fixture(), group = (await f.resolve()).groups[0]
  const saved = [{ ...group, id: 51, metadata: { ...group.metadata, input: { ...f.input.commercialGroups[0], warehouseId: 1, remark: '原备注' } } }]
  f.master.current_version_id = 8
  for (const remark of ['分两箱装', '']) {
    const input = { ...f.input, commercialGroups: [{ ...f.input.commercialGroups[0], remark }] }
    const result = await f.resolve(input, saved)
    assert.equal(result.groups[0].retained, true)
    assert.equal(result.groups[0].id, 51)
    assert.equal(result.groups[0].unitPrice, 90)
    assert.equal(result.total, 90)
    assert.equal(result.groups[0].metadata.input.remark, remark)
    assert.deepEqual(result.groups[0].metadata.quote, group.metadata.quote)
    assert.equal(saved[0].metadata.input.remark, '原备注', 'the original snapshot is not mutated')
  }
  const omitted = await f.resolve(f.input, saved)
  assert.equal(omitted.groups[0].retained, true)
  assert.equal(omitted.groups[0].metadata.input.remark, '原备注', 'old clients omitting a note preserve it')
})
