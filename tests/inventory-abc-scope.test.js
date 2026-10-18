'use strict'

// Actual controllers/services with SQL/auth context doubles. Live scoped HTTP
// and MySQL evidence is recorded separately; these tests do not claim login.
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
function load(file, mocks, source = null) {
  const filename = path.join(root, file), real = createRequire(filename), module = { exports: {} }
  vm.runInNewContext(source ?? fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : real(name) }, { filename })
  return module.exports
}
function warehouseScope(pool) { return load('backend/src/utils/warehouseScope.js', { '../config/db': { pool } }) }
const controllerCases = [
  ['inventory', 'trace', 'traceByProductId', 1],
  ['inventory', 'checkConsistency', 'checkStockConsistency', 0],
  ['inventory', 'containers', 'getContainers', 0],
  ['inventory', 'containerLogs', 'getContainerLogs', 1],
  ['inventory', 'stockPolicies', 'getStockPolicies', 0],
  ['inventory', 'saveStockPolicies', 'saveStockPolicies', 1],
  ['stockcheck', 'recomputeAbc', 'recomputeAbc', 0],
  ['stockcheck', 'cycleCandidates', 'getCycleCandidates', 0],
  ['stockcheck', 'cycleRules', 'getCycleRules', 0],
  ['stockcheck', 'saveCycleRules', 'saveCycleRules', 0],
]
for (const [domain, controllerName, method, index] of controllerCases) {
  test(`${domain}.${controllerName} forwards authenticated current scope, ignoring client scope`, async () => {
    const calls = [], api = { [method]: async (...args) => { calls.push(args); return { ok: true } } }
    const controllers = load(`backend/src/modules/${domain}/${domain}.controller.js`, {
      './inventory.service': api, './inventory.aging': {}, './inventory.procurement': {}, './inventory.reservations': {},
      './stockcheck.service': {}, './stockcheck.cycle': api,
      '../../utils/response': { successResponse: (res, data) => data },
    })
    for (const scope of [[8], [], null]) {
      const req = { user: { warehouseIds: scope }, params: { id: '14', productId: '37' }, query: { productId: '37', warehouseId: '8', scopeWarehouseIds: [9] }, body: { warehouseId: 8, scopeWarehouseIds: [9], items: [], rules: [] } }
      let error
      await controllers[controllerName](req, {}, e => { error = e })
      assert.equal(error, undefined)
      const arg = calls.at(-1)[index]
      const forwarded = ['containerLogs', 'saveStockPolicies'].includes(controllerName) ? arg : arg.scopeWarehouseIds
      assert.equal(forwarded, scope)
    }
  })
}

function services({ inventorySource = null, sourceDocument = null } = {}) {
  const calls = [], writes = []
  const own = { id: 14, containerId: 14, barcode: 'OWN-A', warehouseId: 8, warehouse_id: 8, warehouseName: 'A', warehouse_name: 'A', sourceType: sourceDocument ? 'stockcheck' : null, sourceRefId: sourceDocument ? 7 : null, remainingQty: 2, remaining_qty: 2, initial_qty: 2 }
  const other = { ...own, id: 15, containerId: 15, barcode: 'OTHER-B', warehouseId: 9, warehouse_id: 9, warehouseName: 'B', warehouse_name: 'B' }
  const query = async (sql, params = []) => {
    calls.push({ sql, params })
    if (/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)) { writes.push({ sql, params }); return [{ affectedRows: 1 }] }
    if (sql.includes('allow_decimal_qty')) return [[{ id: 37, name: '合成商品', allow_decimal_qty: 0 }]]
    if (sql.includes('FROM inventory_checks')) return [sourceDocument && !sql.includes('warehouse_id IN') ? [{ id: 7, check_no: 'B-SC', warehouse_name: 'B', status: 2 }] : []]
    if (sql.includes('FROM product_items')) return [[{ id: 37, code: 'P37', name: '合成商品', unit: '个' }]]
    if (sql.includes('FROM product_stock_policies')) {
      const rows = [0, 8, 9].map(warehouse_id => ({ product_id: 37, warehouse_id, warehouse_name: String(warehouse_id), safety_stock: 1, reorder_point: 2 }))
      return [sql.includes('AND 1=0') ? rows.filter(r => !r.warehouse_id) : sql.includes('sp.warehouse_id IN') ? rows.filter(r => r.warehouse_id !== 9) : rows]
    }
    if (sql.includes('FROM inventory_logs')) return [sql.includes('AND 1=0') || sql.includes('il.warehouse_id IN') ? [] : [{ quantity: 3, type: 1, ref_no: 'B-IMPORT', warehouse_id: 9 }]]
    if (sql.includes('SUM(c.remaining_qty)') && sql.includes('cacheQty')) return [[]]
    if (sql.includes('FROM inventory_stock s')) return [sql.includes('s.warehouse_id IN') || sql.includes('AND 1=0') ? [] : [{ productId: 37, warehouseId: 9, cacheQty: 1 }]]
    if (sql.includes('FROM inventory_containers c')) return [sql.includes('AND 1=0') ? [] : sql.includes('c.warehouse_id IN') ? [own] : [own, other]]
    if (sql.includes('FROM inventory_cycle_rules')) return [[]]
    return [[]]
  }
  const conn = { query, async beginTransaction() {}, async rollback() {}, async commit() {}, release() {} }
  const pool = { query, getConnection: async () => conn }, scopes = warehouseScope(pool)
  const inventory = load('backend/src/modules/inventory/inventory.service.js', {
    '../../config/db': { pool }, '../../utils/warehouseScope': scopes,
    './manual-stock-request': {}, '../../engine/inventoryEngine': { MOVE_TYPE_LABEL: {} }, '../../engine/containerEngine': {},
    '../../utils/operationRequest': {}, '../../utils/expectedStock': {},
  }, inventorySource)
  const cycle = load('backend/src/modules/stockcheck/stockcheck.cycle.js', { '../../config/db': { pool }, '../../utils/warehouseScope': scopes })
  return { inventory, cycle, calls, writes }
}
for (const [method, invoke] of [
  ['containers', s => s.inventory.getContainers({ productId: 37, warehouseId: 9, scopeWarehouseIds: [8] })],
  ['consistency', s => s.inventory.checkStockConsistency({ warehouseId: 9, scopeWarehouseIds: [8] })],
  ['policy-save', s => s.inventory.saveStockPolicies([{ productId: 37, warehouseId: 9, safetyStock: 1 }], [8])],
  ['ABC-recompute', s => s.cycle.recomputeAbc({ warehouseId: 9, scopeWarehouseIds: [8] })],
  ['cycle-manual-candidates', s => s.cycle.getCycleCandidates({ warehouseId: 9, scopeType: 'manual', productIds: [37], scopeWarehouseIds: [8] })],
  ['cycle-rules', s => s.cycle.getCycleRules({ warehouseId: 9, scopeWarehouseIds: [8] })],
  ['cycle-rules-save', s => s.cycle.saveCycleRules({ warehouseId: 9, rules: [{ abcClass: 'A', intervalDays: 30, batchLimit: 20 }], scopeWarehouseIds: [8] })],
]) {
  test(`${method} rejects an explicit other warehouse before any data SQL`, async () => {
    const s = services()
    await assert.rejects(invoke(s), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' })
    assert.deepEqual(s.calls, [])
    assert.deepEqual(s.writes, [])
  })
}
for (const scope of [[8], []]) {
  test(`containers/trace/logs/consistency lists filter current scope ${JSON.stringify(scope)}`, async () => {
    const s = services()
    const containers = await s.inventory.getContainers({ productId: 37, scopeWarehouseIds: scope })
    assert.equal(containers.length, scope.length ? 1 : 0)
    const trace = await s.inventory.traceByProductId(37, { scopeWarehouseIds: scope })
    assert.equal(trace.containers.length, scope.length ? 1 : 0)
    assert.equal(trace.summary.length, scope.length ? 1 : 0)
    assert.deepEqual(Array.from(await s.inventory.getContainerLogs(15, scope)), [])
    const diagnostic = await s.inventory.checkStockConsistency({ scopeWarehouseIds: scope })
    assert.equal(diagnostic.mismatchCount, 0)
    const logQuery = s.calls.find(c => c.sql.includes('FROM inventory_logs'))
    assert.match(logQuery.sql, scope.length ? /il\.warehouse_id IN/ : /AND 1=0/)
    // History follows the original log warehouse. It must not be reauthorized
    // by the container's current warehouse after a legitimate transfer.
    assert.doesNotMatch(logQuery.sql, /JOIN inventory_containers/)
  })
}
test('stock policy list retains original global default reads but filters positive warehouses', async () => {
  const s = services()
  const rows = await s.inventory.getStockPolicies({ productId: 37, scopeWarehouseIds: [8] })
  assert.deepEqual(Array.from(rows, r => Number(r.warehouseId)), [0, 8])
})
test('mixed warehouse policy batch is fully authorized before any quantity or write SQL', async () => {
  const s = services()
  await assert.rejects(s.inventory.saveStockPolicies([{ productId: 37, warehouseId: 8, safetyStock: 1 }, { productId: 37, warehouseId: 9, safetyStock: 2 }], [8]), { statusCode: 403 })
  assert.deepEqual(s.calls, [])
})
test('trace enrichment cannot resolve an other-warehouse source document', async () => {
  const s = services({ sourceDocument: true })
  const trace = await s.inventory.traceByProductId(37, { scopeWarehouseIds: [8] })
  assert.equal(trace.chains.length, 1)
  assert.equal(trace.chains[0].document, null)
  assert.match(s.calls.find(c => c.sql.includes('FROM inventory_checks')).sql, /warehouse_id IN/)
})
test('unlimited internal ABC/rules calls preserve the scheduler contract', async () => {
  const s = services()
  const result = await s.cycle.recomputeAbc({ warehouseId: 8 })
  assert.equal(result.warehouseId, 8)
  assert.equal((await s.cycle.getCycleRules({ warehouseId: 8 })).rules.length, 3)
  assert.equal((await s.cycle.getCycleRules({ warehouseId: 0, scopeWarehouseIds: [8] })).warehouseId, 0)
  assert.deepEqual(Array.from((await s.cycle.getCycleCandidates({ warehouseId: 8, scopeType: 'manual', productIds: [37], scopeWarehouseIds: [8] })).productIds), [37])
})
test('removing a real trace scope filter is caught by the collection expectations', async () => {
  const file = path.join(root, 'backend/src/modules/inventory/inventory.service.js')
  const source = fs.readFileSync(file, 'utf8')
  const start = source.indexOf('async function traceByProductId('), end = source.indexOf('\n/**', start)
  const body = source.slice(start, end)
  const mutantBody = body.replace("scopeFilter(scopeWarehouseIds, 'c.warehouse_id')", "scopeFilter(null, 'c.warehouse_id')")
  assert.notEqual(mutantBody, body, 'mutation must remove a real guard')
  const s = services({ inventorySource: source.slice(0, start) + mutantBody + source.slice(end) })
  assert.equal((await s.inventory.traceByProductId(37, { scopeWarehouseIds: [8] })).containers.length, 2)
})

// Execute the actual relational aggregate against an in-memory SQLite database.
// Only MySQL DATE_SUB/NOW syntax is adapted; this is not native MySQL evidence.
function coverageFixture(rules) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE inventory_warehouses (id INTEGER PRIMARY KEY,name TEXT,deleted_at TEXT,is_active INTEGER);
    CREATE TABLE inventory_containers (warehouse_id INTEGER,status INTEGER,deleted_at TEXT);
    CREATE TABLE product_abc_classes (warehouse_id INTEGER,product_id INTEGER,abc_class TEXT);
    CREATE TABLE inventory_count_coverage (warehouse_id INTEGER,product_id INTEGER,last_counted_at TEXT);
    CREATE TABLE inventory_cycle_rules (warehouse_id INTEGER,abc_class TEXT,interval_days INTEGER,enabled INTEGER,UNIQUE(warehouse_id,abc_class));
    INSERT INTO inventory_warehouses VALUES (8,'A',NULL,1),(9,'B',NULL,1);
    INSERT INTO inventory_containers VALUES (8,1,NULL),(9,1,NULL);
    INSERT INTO product_abc_classes VALUES (8,37,'A'),(8,38,'A'),(9,39,'A');
    INSERT INTO inventory_count_coverage VALUES (8,37,'2026-09-01'),(8,38,'2026-10-14');`)
  for (const r of rules) db.prepare('INSERT INTO inventory_cycle_rules VALUES (?,?,?,?)').run(...r)
  db.function('cutoff_days', days => new Date(Date.parse('2026-10-15T00:00:00Z') - Number(days) * 86400000).toISOString().slice(0, 10))
  const queries = []
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params })
    assert.match(sql, /^\s*SELECT/)
    const translated = sql.replace(/DATE_SUB\(NOW\(\), INTERVAL (COALESCE\([\s\S]*?\)) DAY\)/g, 'cutoff_days($1)')
    const expanded = []; let index = 0
    const bound = translated.replace(/\?/g, () => {
      const value = params[index++]
      expanded.push(...(Array.isArray(value) ? value : [value]))
      return Array.isArray(value) ? value.map(() => '?').join(',') : '?'
    })
    return [db.prepare(bound).all(...expanded)]
  } }
  const cycle = load('backend/src/modules/stockcheck/stockcheck.cycle.js', { '../../config/db': { pool }, '../../utils/warehouseScope': warehouseScope(pool) })
  return { cycle, queries, close: () => db.close() }
}
for (const [label, rules, due] of [
  ['global only', [[0,'A',30,1]], 1],
  ['warehouse only', [[8,'A',90,1]], 0],
  ['warehouse period overrides global without double counting', [[0,'A',30,1],[8,'A',90,1]], 0],
  ['two matching due rules count each SKU once', [[0,'A',30,1],[8,'A',30,1]], 1],
  ['disabled warehouse override does not fall back to enabled global', [[0,'A',30,1],[8,'A',30,0]], 0],
  ['enabled warehouse override replaces disabled global', [[0,'A',30,0],[8,'A',30,1]], 1],
  ['disabled global with no override has no due obligations', [[0,'A',30,0]], 0],
  ['missing rule retains A default', [], 1],
]) {
  test('coverage executes real aggregate: '+label, async () => {
    const f = coverageFixture(rules)
    try {
      const [row] = await f.cycle.getCoverage({ warehouseId: 8, scopeWarehouseIds: [8] })
      assert.equal(row.totalItems, 2); assert.equal(row.dueItems, due)
      assert.equal(row.coverageRate, (2-due)/2*100)
      assert.ok(row.dueItems >= 0 && row.dueItems <= row.totalItems)
      assert.equal(f.queries.length, 1)
    } finally { f.close() }
  })
}
test('coverage keeps null, empty, own warehouse and explicit other warehouse scope', async () => {
  const f = coverageFixture([[0,'A',30,1],[8,'A',30,1]])
  try {
    assert.deepEqual((await f.cycle.getCoverage({})).map(r=>r.warehouseId), [8,9])
    assert.deepEqual(Array.from(await f.cycle.getCoverage({scopeWarehouseIds:[]})), [])
    assert.deepEqual((await f.cycle.getCoverage({scopeWarehouseIds:[8]})).map(r=>r.warehouseId), [8])
    assert.deepEqual(Array.from(await f.cycle.getCoverage({warehouseId:9,scopeWarehouseIds:[8]})), [])
  } finally { f.close() }
})
