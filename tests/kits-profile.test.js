'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const contracts = require('../backend/src/modules/kits/kits.contracts')
const target = path.resolve(__dirname, '../backend/src/modules/kits/kits.profile.js')
const api = fs.existsSync(target) ? require(target) : {}
const call = (name, ...args) => {
  assert.equal(typeof api[name], 'function', `missing kit profile behavior: ${name}`)
  return api[name](...args)
}
const parts = [{ productId: 1, baseQty: 1 }]
const rates = { A: 10, B: 20, C: 30, D: 40 }
test('definition accepts no client code and optional product profile with cost only', () => {
  assert.deepEqual(contracts.definition.parse({ name: '组合', costPrice: 10, components: parts }), { name: '组合', costPrice: 10, components: parts })
  assert.equal(contracts.definition.parse({ name: '旧接口', referenceUnitPrice: 7, components: parts, code: 'FORGED' }).code, 'FORGED')
})
test('cost uses the real common tier function for missing prices, including configured rates', () => {
  assert.deepEqual(call('resolvePrices', { costPrice: 10 }, null, rates), { referenceUnitPrice: 11, salePriceA: 11, salePriceB: 12, salePriceC: 13, salePriceD: 14 })
  assert.equal(call('resolvePrices', { costPrice: 10 }, null, { ...rates, B: 25 }).salePriceB, 12.5)
})
test('explicit zero remains zero; four-place prices and positive cost enforce storage limits', () => {
  assert.equal(call('resolvePrices', { costPrice: 10, salePriceA: 0, salePriceB: 0 }, null, rates).salePriceB, 0)
  for (const input of [{ costPrice: 0 }, { costPrice: -1 }, { costPrice: 1.00001 }, { costPrice: 100000000 }, { costPrice: 10, salePriceC: 1.00001 }, { costPrice: 10, salePriceD: 100000000 }]) {
    assert.throws(() => call('resolvePrices', input, null, rates), e => e.code === 'KIT_PRICE_INVALID')
  }
  assert.throws(() => call('resolvePrices', { costPrice: 99999999.9999 }, null, rates), e => e.code === 'KIT_PRICE_INVALID', 'computed prices must also fit DECIMAL(12,4)')
})
test('reference alias agrees with A; unknown legacy cost preserves nullable tiers', () => {
  assert.deepEqual(call('resolvePrices', { referenceUnitPrice: 7 }, null, rates), { referenceUnitPrice: 7, salePriceA: 7, salePriceB: null, salePriceC: null, salePriceD: null })
  assert.equal(call('resolvePrices', { referenceUnitPrice: 7, salePriceA: 7 }, null, rates).salePriceA, 7)
  assert.throws(() => call('resolvePrices', { referenceUnitPrice: 7, salePriceA: 8 }, null, rates), e => e.code === 'KIT_PRICE_ALIAS_CONFLICT')
  assert.throws(() => call('resolvePrices', {}, null, rates), e => e.code === 'KIT_PRICE_REQUIRED')
})
test('metadata-only changes preserve tier prices; clearing one tier computes only that tier', () => {
  const old = { referenceUnitPrice: 20, salePriceA: 20, salePriceB: 21, salePriceC: 22, salePriceD: 23 }
  assert.deepEqual(call('resolvePrices', { costPrice: 10 }, old, rates), old)
  assert.deepEqual(call('resolvePrices', { costPrice: 10, salePriceB: null }, old, rates), { ...old, salePriceB: 12 })
  assert.deepEqual(call('resolvePrices', { salePriceA: 0 }, old, rates), { ...old, referenceUnitPrice: 0, salePriceA: 0 })
})
test('an explicit empty tier requires a known cost and never silently reuses legacy prices', () => {
  const old = { referenceUnitPrice: 20, salePriceA: 20, salePriceB: null, salePriceC: 22, salePriceD: 23 }
  for (const field of ['salePriceA', 'salePriceB', 'salePriceC', 'salePriceD']) {
    assert.throws(() => call('resolvePrices', { [field]: null }, old, rates), e => e.code === 'KIT_PRICE_REQUIRED')
    assert.throws(() => call('resolvePrices', { referenceUnitPrice: 7, [field]: null }, null, rates), e => e.code === 'KIT_PRICE_REQUIRED')
  }
})
test('stored nullable B/C/D fall back to A while explicit zero never falls back', () => {
  assert.deepEqual(call('effectivePrices', { referenceUnitPrice: 7, salePriceB: null, salePriceC: 0, salePriceD: 9 }), { salePriceA: 7, salePriceB: 7, salePriceC: 0, salePriceD: 9 })
})
test('profile contract allows old omissions but rejects empty fields and malformed references', () => {
  const input = { name: '成套', categoryId: 1, supplierId: 2, unit: '套', spec: 'A型', color: '银', articleNumber: '供应商型', costPrice: 10, remark: '备注', components: parts }
  assert.deepEqual(contracts.definition.parse(input), input)
  for (const delta of [{ unit: '' }, { categoryId: 0 }, { supplierId: 1.5 }, { color: '' }, { costPrice: 0 }, { remark: '长'.repeat(31) }]) assert.equal(contracts.definition.safeParse({ ...input, ...delta }).success, false)
})
test('provided profile references are checked on the same connection and stale references reject', async () => {
  const seen = []
  const conn = { async query(sql, params) { seen.push([sql, params]); return [[{ id: params[0], ...(sql.includes('product_categories') ? { status: 1 } : { is_active: 1 }), deleted_at: null }]] } }
  await call('validateReferences', conn, { categoryId: 1, supplierId: 2 })
  assert.equal(seen.length, 2)
  assert.ok(seen.every(([sql]) => sql.includes('FOR SHARE')))
  for (const row of [null, { id: 1, status: 0, is_active: 0, deleted_at: null }, { id: 1, status: 1, is_active: 1, deleted_at: 'deleted' }]) {
    await assert.rejects(call('validateReferences', { async query() { return [row ? [row] : []] } }, { categoryId: 1 }), e => e.code === 'KIT_CATEGORY_UNAVAILABLE')
    await assert.rejects(call('validateReferences', { async query() { return [row ? [row] : []] } }, { supplierId: 1 }), e => e.code === 'KIT_SUPPLIER_UNAVAILABLE')
  }
})
function serviceFixture({ duplicate = null, historicalReceipt = null, maxNum = null } = {}) {
  const lifecycle = [], inserts = [], generations = [], requests = [], queries = []
  let connections = 0, row
  const pool = { async getConnection() {
    const attempt = ++connections
    return {
      async beginTransaction() { lifecycle.push(`begin:${attempt}`) },
      async commit() { lifecycle.push(`commit:${attempt}`) },
      async rollback() { lifecycle.push(`rollback:${attempt}`) },
      release() { lifecycle.push(`release:${attempt}`) },
      async query(sql, params) {
        queries.push([sql, params])
        if (sql.includes('FROM operation_requests')) {
          if (historicalReceipt && params[1] !== 'kit.create') return [[{ ...historicalReceipt, response_json: JSON.stringify(historicalReceipt.responseData) }]]
          return [[]]
        }
        if (sql.includes('INSERT INTO operation_requests')) { requests.push(params); lifecycle.push(`request:${attempt}`); return [{ insertId: 10 }] }
        if (sql.includes('UPDATE operation_requests')) { lifecycle.push(`receipt:${attempt}`); return [{ affectedRows: 1 }] }
        if (sql.includes('key_name')) return [[]]
        if (sql.includes('maxNum')) { generations.push([attempt, params]); return [[{ maxNum: maxNum ?? attempt - 1 }]] }
        if (sql.includes('FROM product_items')) return [[{ id: 1, name: '组件', sale_price_a: 80, allow_decimal_qty: 0, is_active: 1, deleted_at: null }]]
        if (sql.startsWith('INSERT INTO kit_definitions')) {
          inserts.push(params)
          if (duplicate && attempt === 1) throw duplicate
          row = { id: 1, code: params[0], name: params[1], is_active: 1, revision: 1, current_version_id: 2 }
          return [{ insertId: 1 }]
        }
        if (sql.startsWith('INSERT INTO kit_definition_versions')) return [{ insertId: 2 }]
        if (sql.includes('FROM kit_definitions') || sql.includes('FROM kit_definitions k')) return [[row]]
        if (sql.includes('FROM kit_definition_versions')) return [[{ id: 2, kit_id: 1, version_no: 1, reference_unit_price: 7, sale_price_b: null, sale_price_c: null, sale_price_d: null }]]
        if (sql.includes('FROM kit_definition_components')) return [[{ id: 3, version_id: 2, product_id: 1, base_qty: 1, reference_price: 80, amount_weight: '80.000000', weight_source: 'product_a', sort_no: 0, code: 'P1', name: '组件', is_active: 1, allow_decimal_qty: 0 }]]
        return [{ affectedRows: 1 }]
      },
    }
  } }
  // Compile the actual module while replacing only its configured pool. No fictional exports.
  const operationFile = path.resolve(__dirname, '../backend/src/utils/operationRequest.js')
  const operationModule = new Module(operationFile, module)
  operationModule.filename = operationFile; operationModule.paths = Module._nodeModulePaths(path.dirname(operationFile))
  const operationRequire = Module.createRequire(operationFile)
  operationModule.require = id => id === '../config/db' ? { pool } : operationRequire(id)
  operationModule._compile(fs.readFileSync(operationFile, 'utf8'), operationFile)
  const modules = {
    '../backend/src/config/db': { pool },
    '../backend/src/engine/containerEngine': { getStockProjections: async () => new Map() },
    '../backend/src/utils/operationRequest': operationModule.exports,
  }
  const saved = new Map()
  for (const [name, exports] of Object.entries(modules)) {
    const id = require.resolve(name); saved.set(id, require.cache[id]); require.cache[id] = { id, filename: id, loaded: true, exports }
  }
  const serviceId = require.resolve('../backend/src/modules/kits/kits.service')
  saved.set(serviceId, require.cache[serviceId]); delete require.cache[serviceId]
  let service
  try { service = require(serviceId) } finally { for (const [id, value] of saved) { if (value) require.cache[id] = value; else delete require.cache[id] } }
  return { service, lifecycle, inserts, generations, requests, queries, fingerprint: operationModule.exports.creationFingerprint }
}
test('version component reads include the complete product identity in the same bounded query', async () => {
  const f = serviceFixture(), reads = []
  const product = { code: 'P1', name: '组件', unit: '个', spec: 'M8×22', color: '黑色', article_number: 'ART-1', is_active: 1, allow_decimal_qty: 0, deleted_at: null }
  const conn = { async query(sql, params) {
    reads.push([sql, params])
    if (sql.includes('FROM kit_definition_versions')) return [[{ id: 7, kit_id: 1, version_no: 1, reference_unit_price: 81 }]]
    assert.match(sql, /FROM kit_definition_components/)
    const selected = Object.fromEntries(Object.entries(product).filter(([field]) => sql.split('FROM')[0].includes(`p.${field}`)))
    return [[{ id: 8, version_id: 7, product_id: 1, base_qty: 4, reference_price: 21, amount_weight: '84.000000', weight_source: 'product_a', sort_no: 0, ...selected }]]
  } }
  const versions = await f.service.loadVersions(conn, [7, 7])
  assert.deepEqual(versions.get(7).components[0], {
    id: 8, productId: 1, baseQty: 4, referencePrice: 21, amountWeight: '84.000000', weightSource: 'product_a', sortNo: 0,
    productCode: 'P1', productName: '组件', unit: '个', spec: 'M8×22', color: '黑色', articleNumber: 'ART-1', productActive: true, allowDecimal: false,
  })
  assert.equal(reads.length, 2)
  assert.ok(reads.every(([sql, params]) => !/INSERT|UPDATE|DELETE/.test(sql) && params[0].length === 1))
})
test('creation uses same-transaction K generation and ignores the client code in persistence and fingerprint', async () => {
  const f = serviceFixture()
  const result = await f.service.create({ code: 'FORGED', name: '成套', referenceUnitPrice: 7, components: parts }, { requestKey: 'stable', userId: 1 })
  assert.equal(result.code, 'K000001')
  assert.equal(f.inserts[0][0], 'K000001')
  assert.deepEqual(f.generations, [[1, [2, 'K']]])
  assert.equal(f.requests[0][1], `kit.create.${f.fingerprint({ name: '成套', referenceUnitPrice: 7, components: parts })}`)
  assert.deepEqual(f.lifecycle, ['begin:1', 'request:1', 'receipt:1', 'commit:1', 'release:1'])
})
test('known kit-code collision rolls back the full transaction and generates again in a fresh snapshot', async () => {
  const f = serviceFixture({ duplicate: Object.assign(new Error("Duplicate entry for key 'kit_definitions.uk_kit_code_active'"), { code: 'ER_DUP_ENTRY' }) })
  const result = await f.service.create({ name: '成套', referenceUnitPrice: 7, components: parts }, { requestKey: 'stable', userId: 1 })
  assert.equal(result.code, 'K000002')
  assert.deepEqual(f.lifecycle, ['begin:1', 'request:1', 'rollback:1', 'release:1', 'begin:2', 'request:2', 'receipt:2', 'commit:2', 'release:2'])
  assert.deepEqual(f.generations.map(g => g[0]), [1, 2])
})
test('a different duplicate constraint is not mislabeled or retried as a kit code collision', async () => {
  const duplicate = Object.assign(new Error("Duplicate entry for key 'uk_kit_version_no'"), { code: 'ER_DUP_ENTRY' })
  const f = serviceFixture({ duplicate })
  await assert.rejects(f.service.create({ name: '成套', referenceUnitPrice: 7, components: parts }, { requestKey: 'stable', userId: 1 }), e => e === duplicate)
  assert.deepEqual(f.lifecycle, ['begin:1', 'request:1', 'rollback:1', 'release:1'])
})
test('pre-upgrade code-bearing creation receipt replays exactly before using the new normalized fingerprint', async () => {
  const receipt = { status: 1, responseData: { id: 8, code: 'HISTORIC-CODE' } }
  const f = serviceFixture({ historicalReceipt: receipt })
  assert.deepEqual(await f.service.create({ code: 'FORGED', name: '成套', referenceUnitPrice: 7, components: parts }, { requestKey: 'old-stable', userId: 1 }), receipt.responseData)
  assert.deepEqual(f.generations, [])
  assert.deepEqual(f.lifecycle, ['begin:1', 'commit:1', 'release:1'])
})
test('legacy fingerprint probe is nonlocking and exactly binds the original input, request key and actor', async () => {
  const f = serviceFixture(), input = { code: 'FORGED', name: '成套', referenceUnitPrice: 7, components: parts }
  await f.service.create(input, { requestKey: 'actor-owned-key', userId: 73 })
  const [sql, params] = f.queries.find(([sql]) => sql.startsWith('SELECT status,response_json,error_message'))
  assert.match(sql, /WHERE request_key=\? AND action=\? AND user_id <=> \?/)
  assert.doesNotMatch(sql, /FOR SHARE|FOR UPDATE/)
  assert.deepEqual(params, ['actor-owned-key', `kit.create.${f.fingerprint(input)}`, 73])
})
test('exhausted six-digit K sequence rejects before persisting a seven-digit code', async () => {
  const f = serviceFixture({ maxNum: 999999 })
  await assert.rejects(f.service.create({ name: '成套', referenceUnitPrice: 7, components: parts }, { requestKey: 'stable', userId: 1 }), e => e.code === 'KIT_CODE_EXHAUSTED')
  assert.deepEqual(f.inserts, [])
  assert.deepEqual(f.lifecycle, ['begin:1', 'request:1', 'rollback:1', 'release:1'])
})
