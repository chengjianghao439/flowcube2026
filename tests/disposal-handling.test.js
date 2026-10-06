'use strict'
// Real H1 modules; SQL/config boundaries are stubs. No app, DB, env, socket or DDL.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const AppError = require('../backend/src/utils/AppError')
const precision = require('../backend/src/utils/qtyPrecision')
const identifiers = require('../backend/src/utils/sqlIdentifier')
const base = path.resolve(__dirname, '../backend/src')
function load(name, deps) {
  const filename = path.join(base, name), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    throw Error(`Unstubbed require: ${filename}: ${name}`)
  } }, { filename })
  return module.exports
}
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const rules = () => load('modules/disposal/disposal.handling.rules.js', { '../../utils/AppError': AppError, '../../utils/qtyPrecision': precision, 'node:crypto': crypto })
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const body = { intentUuid: uuid(1), operationUuid: uuid(2), productId: 3, warehouseId: 8, unit: '个', handlingType: 1, quantity: 10 }
const operator = { userId: 9, realName: '夹具' }
function insertRow(sql, args) {
  const columns = sql.match(/INSERT INTO \w+\s*\(([^)]+)\)/)?.[1].split(',').map(s => s.trim())
  assert.ok(columns, `explicit INSERT columns required: ${sql}`)
  assert.equal(columns.length, args.length, 'INSERT placeholder count matches bound values')
  return Object.fromEntries(columns.map((key, index) => [key, args[index]]))
}
function fixture() {
  const events = [], sqls = []
  const state = { sources: [], operations: [], links: [] }
  let tx = null, connections = 0
  const warehouse = { id: 8, code: 'W8', name: '仓八', is_active: 1, deleted_at: null }
  const product = { id: 3, code: 'P3', name: '商品三', unit: '个', allow_decimal_qty: 1, is_active: 1, deleted_at: null }
  const current = () => tx || state
  const conn = {
    beginTransaction: async () => { events.push('begin'); tx = structuredClone(state) },
    commit: async () => { events.push('commit'); if (tx) Object.assign(state, tx); tx = null },
    rollback: async () => { events.push('rollback'); tx = null }, release: () => events.push('release'),
    query: async (sql, args = []) => {
      sqls.push({ sql, args })
      if (/^(?:SET TRANSACTION|START TRANSACTION READ ONLY)/.test(sql)) { events.push('readOnly'); return [{}] }
      if (sql.includes('FROM inventory_warehouses')) { events.push('warehouse'); return [[{ ...warehouse }]] }
      if (sql.includes('FROM product_items')) { events.push('product'); return [[{ ...product }]] }
      if (sql.includes('INSERT INTO disposal_handling_operations')) {
        const row = insertRow(sql, args)
        if (current().operations.some(op => op.operation_uuid === row.operation_uuid)) throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' })
        row.id = current().operations.length + 1; current().operations.push(row); events.push('insertOperation'); return [{ insertId: row.id }]
      }
      if (sql.includes('UPDATE disposal_handling_operations')) {
        const op = current().operations.find(row => row.operation_uuid === args.at(-1))
        assert.ok(op, 'completing exact operation UUID')
        Object.assign(op, { source_id: args[0], resource_type: args[1], resource_id: args[2], response_json: args[3], status: 1 })
        events.push('completeOperation'); return [{ affectedRows: 1 }]
      }
      if (sql.includes('FROM disposal_handling_operations')) {
        const rows = current().operations.filter(row => row.operation_uuid === args[0] && (!sql.includes('actor_id=?') || Number(row.actor_id) === Number(args[1])))
        events.push('readOperation'); return [rows.map(row => ({ ...row }))]
      }
      if (sql.includes('INSERT INTO disposal_handling_sources')) {
        const row = insertRow(sql, args)
        if (current().sources.some(s => s.intent_uuid === row.intent_uuid)) throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' })
        row.id = current().sources.length + 1; current().sources.push(row); events.push('insertSource'); return [{ insertId: row.id }]
      }
      if (sql.includes('UPDATE disposal_handling_sources')) {
        const row = current().sources.find(source => Number(source.id) === Number(args[1]) && source.created_operation_uuid === args[2])
        assert.ok(row, 'persist exact original source response'); row.response_json = args[0]
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('FROM disposal_handling_sources')) {
        let rows = current().sources.map(row => ({ ...row }))
        if (sql.includes('s.id=?') || sql.includes('WHERE id=?')) rows = rows.filter(row => Number(row.id) === Number(args[0]))
        if (sql.includes('intent_uuid=?')) rows = rows.filter(row => row.intent_uuid === args[0])
        if (sql.includes('s.warehouse_id IN (?)')) { const scopeArg = args.find(Array.isArray); rows = rows.filter(row => scopeArg.includes(Number(row.warehouse_id))) }
        if (sql.includes('1=0')) rows = []
        if (sql.includes('COUNT(*)')) return [[{ total: rows.length }]]
        if (sql.includes('LIMIT ? OFFSET ?')) rows = rows.sort((a, b) => b.id - a.id).slice(args.at(-1), args.at(-1) + args.at(-2))
        return [rows]
      }
      if (sql.includes('FROM disposal_handling_links')) return [current().links.filter(row => args[0].map(Number).includes(Number(row.source_id))).map(row => ({ ...row }))]
      if (/^SELECT \* FROM (sale_orders|sale_order_items) WHERE (id|order_id) IN \(\?\) ORDER BY id$/.test(sql)) { assert.deepEqual(Array.from(args[0]), [21]); return [[]] }
      if (sql.startsWith('SELECT * FROM warehouse_tasks WHERE sale_order_id IN (?)')) { assert.deepEqual(Array.from(args[0]), [21]); return [[]] }
      throw Error(`Unexpected SQL: ${sql}`)
    },
  }
  const pure = rules()
  const opFile = path.join(base, 'modules/disposal/disposal.handling.operations.js')
  const operations = fs.existsSync(opFile) ? load('modules/disposal/disposal.handling.operations.js', { '../../utils/AppError': AppError, './disposal.handling.rules': pure }) : {}
  const proof = load('modules/disposal/disposal.handling.proof.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/sqlIdentifier': identifiers, './disposal.handling.rules': pure })
  const facts = load('modules/disposal/disposal.handling.facts.js', { '../../utils/sqlIdentifier': identifiers, './disposal.handling.rules': pure, './disposal.handling.proof': proof })
  const release = load('modules/disposal/disposal.handling.release.js', { '../../config/db': {pool:{getConnection:async()=>conn}}, '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, './disposal.handling.rules': pure, './disposal.handling.operations': operations, './disposal.handling.proof': proof, './disposal.handling.facts': facts })
  const service = load('modules/disposal/disposal.handling.js', {
    '../../config/db': { pool: { getConnection: async () => { connections++; return conn } } },
    '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/qtyPrecision': precision,
    '../../utils/sqlIdentifier': identifiers,
    './disposal.handling.rules': pure, './disposal.handling.operations': operations, './disposal.handling.proof': proof, './disposal.handling.facts': facts, './disposal.handling.release': release,
  })
  return { service, conn, state, events, sqls, warehouse, product, connections: () => connections }
}
const create = (f, input = body, key = 'original-key', actor = operator, warehouses = [8]) => f.service.createSource(input, { requestKey: key, operator: actor, scopeWarehouseIds: warehouses })
test('strict identities, UUIDs, original quantity scale and forbidden legacy origin rejected before reads', async () => {
  for (const change of [{ productId: [3] }, { productId: '3e0' }, { warehouseId: Number.MAX_SAFE_INTEGER + 1 }, { intentUuid: 'broken' }, { quantity: 0.001 }, { quantity: 0 }, { legacyDisposalId: 10 }, { credentials: 'not-allowed' }]) {
    const f = fixture()
    await assert.rejects(create(f, { ...body, ...change }), e => e.statusCode === 400)
    assert.equal(f.connections(), 0)
  }
})
test('source creation is one durable commit with current identity/basic unit; no inventory or target write', async () => {
  const f = fixture(), result = await create(f)
  assert.ok(result?.id > 0); assert.equal(result.intentUuid, body.intentUuid)
  assert.equal(f.state.sources.length, 1); assert.equal(f.state.operations.length, 1)
  assert.equal(f.state.sources[0].quantity, 10); assert.equal(f.state.sources[0].unit, '个')
  assert.equal(f.state.sources[0].product_name, '商品三')
  assert.deepEqual(f.events.filter(event => ['begin', 'commit', 'rollback', 'release'].includes(event)), ['begin', 'commit', 'release'])
  assert.ok(!f.sqls.some(({ sql }) => /inventory_stock|inventory_containers|sale_orders|purchase_returns|operation_requests/.test(sql)))
})
test('current scope blocks source creation before durable replay/read or connection acquisition', async () => {
  const f = fixture(); await create(f)
  const count = f.connections(), length = f.sqls.length
  await assert.rejects(create(f, body, 'original-key', operator, []), e => e.statusCode === 403)
  assert.equal(f.connections(), count); assert.equal(f.sqls.length, length)
})
test('same permanent operation after generic receipt TTL returns its ORIGINAL response once', async () => {
  const f = fixture(), first = await create(f)
  f.state.operations[0].completed_at = '2020-01-01'; f.product.name = '现名称'
  const second = await create(f)
  assert.equal(rules().stableJson(second), rules().stableJson(first))
  assert.equal(f.state.sources.length, 1); assert.equal(f.events.filter(event => event === 'commit').length, 1)
})
test('same operation UUID refuses actor, key, body, action or resource drift without another source', async () => {
  for (const mutation of ['actor', 'key', 'body', 'action', 'resource']) {
    const f = fixture(); await create(f)
    if (mutation === 'action') f.state.operations[0].action = 'other'
    if (mutation === 'resource') f.state.operations[0].resource_id = 999
    await assert.rejects(create(f, mutation === 'body' ? { ...body, quantity: 9 } : body, mutation === 'key' ? 'new-key' : 'original-key', mutation === 'actor' ? { ...operator, userId: 10 } : operator), e => e.statusCode === 409)
    assert.equal(f.state.sources.length, 1)
  }
})
test('same source UUID cannot become another operation/source budget', async () => {
  const f = fixture(); await create(f)
  await assert.rejects(create(f, { ...body, operationUuid: uuid(3) }, 'another-key'), e => e.statusCode === 409)
  assert.equal(f.state.sources.length, 1); assert.equal(f.state.operations.length, 1)
})
test('unit, current active master and integer policy checks remain before replay', async () => {
  for (const changed of ['unit', 'inactive', 'integer', 'warehouse']) {
    const f = fixture(); await create(f, { ...body, quantity: 1.5 })
    if (changed === 'unit') f.product.unit = '件'
    if (changed === 'inactive') f.product.is_active = 0
    if (changed === 'integer') f.product.allow_decimal_qty = 0
    if (changed === 'warehouse') f.warehouse.is_active = 0
    const position = f.sqls.length
    await assert.rejects(create(f, { ...body, quantity: 1.5 }), e => e.statusCode >= 400 && e.statusCode < 500)
    assert.ok(!f.sqls.slice(position).some(({ sql }) => sql.includes('disposal_handling_operations')))
  }
})
const source = { id: 1, product_id: 3, warehouse_id: 8, unit: '个', quantity: 10 }
const link = { id: 1, source_id: 1, target_type: 'sale_order', target_id: 21, target_line_id: 31, product_id: 3, warehouse_id: 8, unit: '个', allocated_quantity: 6, released_quantity: 4, final_executed_quantity: 2, state: 'TERMINATED' }
test('Q/A/R stays intention budget: Q10 A6 E2 R4 leaves8 and active unknown E never becomes executed0', () => {
  const r = rules(), budget = r.calculateBudget(source, [link])
  assert.equal(budget.availableQuantity, 8); assert.equal(budget.consumedQuantity, 2)
  assert.equal(budget.actualExecutedQuantity, null)
  const active = r.calculateBudget(source, [{ ...link, state: 'ACTIVE', released_quantity: 0, final_executed_quantity: null }])
  assert.equal(active.availableQuantity, 4); assert.equal(active.actualExecutedQuantity, null)
})
test('negative, excessive, mismatched and missing link quantities fail closed instead of clamp', () => {
  for (const mutation of [{ released_quantity: -1 }, { final_executed_quantity: 7 }, { released_quantity: 5 }, { allocated_quantity: 11 }, { product_id: 4 }, { allocated_quantity: null }, { state: 'ACTIVE', released_quantity: 0, final_executed_quantity: 2 }]) {
    assert.throws(() => rules().calculateBudget(source, [{ ...link, ...mutation }]), e => e.statusCode === 409)
  }
})
test('source page count and rows use scope BEFORE LIMIT; links batch once; empty scope reads nothing', async () => {
  const f = fixture(); await create(f)
  const original = f.state.sources[0]
  f.state.sources = [1, 2, 3, 4, 5].map(id => ({ ...original, id, intent_uuid: uuid(id + 10), warehouse_id: id === 5 ? 9 : 8 }))
  const start = f.sqls.length
  const page = await f.service.listSources({ page: '2', pageSize: '2', scopeWarehouseIds: [8] })
  assert.equal(page.pagination.total, 4); assert.deepEqual(Array.from(page.list, row => row.id), [2, 1])
  const selects = f.sqls.slice(start).filter(({ sql }) => sql.includes('FROM disposal_handling_sources'))
  assert.equal(selects.length, 2); assert.ok(selects.every(({ sql }) => sql.includes('s.warehouse_id IN (?)')))
  assert.equal(f.sqls.slice(start).filter(({ sql }) => sql.includes('FROM disposal_handling_links')).length, 1)
  const count = f.connections()
  const empty = await f.service.listSources({ scopeWarehouseIds: [] })
  assert.equal(empty.pagination.total, 0); assert.equal(f.connections(), count)
})
test('detail scope is checked before link reads, and no target identity is returned by quantity view', async () => {
  const f = fixture(); const created = await create(f); const start = f.sqls.length
  await assert.rejects(f.service.getSource(created.id, [9]), e => e.statusCode === 403)
  assert.ok(!f.sqls.slice(start).some(({ sql }) => sql.includes('disposal_handling_links')))
  f.state.links = [link]
  const view = await f.service.getSource(created.id, [8])
  assert.equal(view.budget.availableQuantity, 8)
  assert.ok(!JSON.stringify(view).includes('targetId')); assert.ok(!JSON.stringify(view).includes('SO'))
})
const query = { operationUuid: body.operationUuid, intentUuid: body.intentUuid, action: 'disposal.handling.source.create', requestKey: 'original-key', userId: 9, scopeWarehouseIds: [8] }
test('authenticated own original result remains readable without VIEW/CREATE, only original source response', async () => {
  const f = fixture(), created = await create(f)
  const result = await f.service.getOwnOperation(query)
  assert.equal(result.status, 'success'); assert.equal(rules().stableJson(result.data), rules().stableJson(created))
  assert.equal(result.resourceType, 'disposal_handling_source'); assert.equal(result.resourceId, created.id)
  const other = await f.service.getOwnOperation({ ...query, userId: 10 })
  assert.equal(other.status, 'not_found'); assert.equal(other.data, null)
})
test('own operation wrong action/key/intent/resource, corrupt success and revoked warehouse never synthesize success', async () => {
  for (const change of [{ action: 'other' }, { requestKey: 'new-key' }, { intentUuid: uuid(99) }, { scopeWarehouseIds: [] }]) {
    const f = fixture(); await create(f)
    await assert.rejects(f.service.getOwnOperation({ ...query, ...change }), e => e.statusCode === 409 || e.statusCode === 403)
  }
  for (const change of [{ resource_id: 999 }, { response_json: 'bad-json' }]) {
    const f = fixture(); await create(f); Object.assign(f.state.operations[0], change)
    await assert.rejects(f.service.getOwnOperation(query), e => e.statusCode === 409)
  }
})
test('pending and not-found retain uncertainty with no source or target read or POST', async () => {
  const f = fixture(); await create(f); f.state.operations[0].status = 0
  const start = f.sqls.length
  const pending = await f.service.getOwnOperation(query)
  assert.equal(pending.status, 'pending'); assert.equal(pending.data, null)
  const missing = await f.service.getOwnOperation({ ...query, operationUuid: uuid(99) })
  assert.equal(missing.status, 'not_found'); assert.equal(missing.data, null)
  assert.ok(f.sqls.slice(start).filter(({ sql }) => /^SELECT/.test(sql)).every(({ sql }) => sql.includes('FROM disposal_handling_operations')))
})

// Source revision is mutable coordination metadata; the original create ACK is permanent.
test('later source revision never rewrites or blocks the original create receipt', async () => {
  const f = fixture(), first = await create(f)
  f.state.sources[0].revision = 2
  const replay = await create(f)
  assert.equal(rules().stableJson(replay), rules().stableJson(first))
  const result = await f.service.getOwnOperation(query)
  assert.equal(rules().stableJson(result.data), rules().stableJson(first))
  assert.equal(result.data.revision, 1)
})
test('matching but corrupt stored payload digests never produce an own successful receipt', async () => {
  const f = fixture(); await create(f)
  f.state.sources[0].payload_hash = '0'.repeat(64)
  f.state.operations[0].payload_hash = '0'.repeat(64)
  await assert.rejects(f.service.getOwnOperation(query), e => e.code === 'DISPOSAL_HANDLING_RECEIPT_INVALID')
})

function routeFixture() {
  const routes = [], uses = []
  const router = { use: (...handlers) => uses.push(handlers) }
  for (const method of ['get', 'post', 'put']) router[method] = (route, ...handlers) => routes.push({ method, route, handlers })
  const permissions = require('../backend/src/constants/permissions').PERMISSIONS
  const ctrl = new Proxy({}, { get: (_, name) => ({ handler: name }) })
  const auth = { authMiddleware: { auth: true }, requirePermission: permission => ({ permission }), requireAnyPermission: any => ({ any }) }
  load('modules/disposal/disposal.routes.js', { express: { Router: () => router }, zod: require('../backend/node_modules/zod'), './disposal.controller': ctrl, './disposal.handling.contracts': load('modules/disposal/disposal.handling.contracts.js', { zod: require('../backend/node_modules/zod'), '../../utils/AppError': AppError, './disposal.handling.rules': rules() }),
    '../../middleware/auth': auth, '../../constants/permissions': { PERMISSIONS: permissions }, '../../utils/route': { validateBody: schema => ({ schema }) } })
  return { routes, uses, permissions }
}
test('ordinary source API keeps original CREATE/VIEW gates; precise own result is authenticated without write/view gate', () => {
  const { routes, uses, permissions } = routeFixture()
  assert.ok(uses[0][0].auth)
  for (const [method, route, permission] of [
    ['post', '/handling-sources', permissions.INVENTORY_DISPOSAL_CREATE],
    ['get', '/handling-sources', permissions.INVENTORY_DISPOSAL_VIEW],
    ['get', '/handling-sources/:id', permissions.INVENTORY_DISPOSAL_VIEW],
  ]) {
    const found = routes.find(row => row.method === method && row.route === route)
    assert.ok(found, `real ${method} ${route} is registered`)
    assert.equal(found.handlers[0].permission, permission)
    assert.ok(routes.indexOf(found) < routes.findIndex(row => row.method === 'get' && row.route === '/:id'))
  }
  const own = routes.find(row => row.method === 'get' && row.route === '/handling-operations/:operationUuid')
  assert.ok(own); assert.equal(own.handlers.length, 1); assert.equal(own.handlers[0].handler, 'ownHandlingOperation')
})

test('real controller retains raw single-value queries and authenticated actor/range, never client identity', async () => {
  const calls = []
  const handling = Object.fromEntries(['createSource', 'listSources', 'getSource', 'getOwnOperation'].map(name => [name, async (...args) => { calls.push({ name, args }); return { ok: true } }]))
  const ctrl = load('modules/disposal/disposal.controller.js', { './disposal.service': {}, './disposal.handling': handling,
    '../../middleware/auth': {hasPermission:()=>false}, '../../constants/permissions': {PERMISSIONS:require('../backend/src/constants/permissions').PERMISSIONS},
    '../../utils/response': { successResponse: (_res, data) => data }, '../../utils/operator': require('../backend/src/utils/operator'), '../../utils/requestKey': require('../backend/src/utils/requestKey') })
  const req = { body, query: { page: ['1', '2'], productId: '', warehouseId: '8', intentUuid: body.intentUuid, action: query.action, requestKey: query.requestKey, userId: 123, scopeWarehouseIds: [99] },
    headers: { 'x-request-key': ['one', 'two'] }, params: { id: '1e0', operationUuid: body.operationUuid }, user: { userId: 9, realName: '真实认证', warehouseIds: [8] } }
  const next = error => { throw error }
  await ctrl.handlingSources(req, {}, next); await ctrl.handlingSource(req, {}, next); await ctrl.createHandlingSource(req, {}, next); await ctrl.ownHandlingOperation(req, {}, next)
  assert.deepEqual(Array.from(calls[0].args[0].page), ['1', '2']); assert.equal(calls[0].args[0].productId, '')
  assert.equal(calls[1].args[0], '1e0'); assert.equal(calls[2].args[0], body)
  assert.deepEqual(Array.from(calls[2].args[1].requestKey), ['one', 'two'])
  assert.equal(calls[2].args[1].operator.userId, 9); assert.equal(calls[3].args[0].userId, 9)
  assert.deepEqual(Array.from(calls[3].args[0].scopeWarehouseIds), [8])
})
test('registered source body schema rejects forged origin, missing UUID and unsafe IDs; service also rejects original scale', () => {
  const route = routeFixture().routes.find(row => row.method === 'post' && row.route === '/handling-sources')
  const schema = route.handlers[1].schema
  assert.equal(schema.safeParse(body).success, true)
  for (const change of [{ legacyDisposalId: 1 }, { operationUuid: '' }, { productId: Number.MAX_SAFE_INTEGER + 1 }]) assert.equal(schema.safeParse({ ...body, ...change }).success, false)
})
test('scope null means all, explicit empty means none; malformed optional filters never become valid defaults', async () => {
  const f = fixture(); await create(f)
  assert.equal((await f.service.listSources({ scopeWarehouseIds: null })).pagination.total, 1)
  for (const input of [{ page: ['1','2'] }, { page: '' }, { pageSize: '101' }, { productId: '' }, { warehouseId: '8e0' }, { handlingType: '4' }]) {
    const before = f.connections()
    await assert.rejects(f.service.listSources(input), e => e.statusCode === 400)
    assert.equal(f.connections(), before)
  }
})
test('a valid allocation beyond Q is rejected independently of terminal evidence fields', () => {
  assert.throws(() => rules().calculateBudget(source, [{ ...link, state: 'ACTIVE', allocated_quantity: 11, released_quantity: 0, final_executed_quantity: null }]), e => e.code === 'DISPOSAL_HANDLING_DATA_INVALID')
})

test('failure to persist the exact original operation response rolls the whole source back and releases the same conn', async () => {
  const f = fixture(), original = f.conn.query
  f.conn.query = async (sql, args) => {
    if (sql.includes('UPDATE disposal_handling_operations')) throw new AppError('simulated write failure', 500)
    return original(sql, args)
  }
  await assert.rejects(create(f), e => e.statusCode === 500)
  assert.equal(f.state.sources.length, 0); assert.equal(f.state.operations.length, 0)
  assert.equal(f.connections(), 1); assert.deepEqual(f.events.filter(e => ['commit', 'rollback', 'release'].includes(e)), ['rollback', 'release'])
})
test('277 source schema covers the real bound INSERTs and preserves historical line identity without target-line FK', async () => {
  const sql = fs.readFileSync(path.join(base, 'database/279_disposal_handling.sql'), 'utf8')
  const statements = require('../backend/src/database/sqlStatements').splitSqlStatements(sql)
  const creates = statements.filter(s => /CREATE TABLE IF NOT EXISTS/.test(s)).map(s => s.replace(/^--[^\n]*$/gm, '').trim())
  assert.equal(creates.length, 4)
  const f = fixture(); await create(f)
  for (const { sql: insert } of f.sqls.filter(({ sql }) => sql.startsWith('INSERT'))) {
    const [, table, columns] = insert.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/)
    const create = creates.find(s => s.startsWith(`CREATE TABLE IF NOT EXISTS \`${table}\``))
    assert.ok(create, `real ${table} has schema`)
    for (const column of columns.split(',').map(s => s.trim())) assert.ok(create.includes(`\`${column}\``), `bound ${table}.${column} exists`)
  }
  assert.ok(sql.includes('UNIQUE INDEX `uk_dho_operation` (`operation_uuid`)'))
  assert.ok(sql.includes('UNIQUE INDEX `uk_dhs_intent` (`intent_uuid`)'))
  assert.ok(sql.includes('UNIQUE INDEX `uk_dhs_legacy_item` (`legacy_disposal_item_id`)'))
  assert.ok(sql.includes('UNIQUE INDEX `uk_dhl_target` (`target_type`,`target_id`)'))
  assert.ok(sql.includes('ORDER BY SEQ_IN_INDEX')); assert.ok(sql.includes('ORDER BY ORDINAL_POSITION'))
  assert.ok(!/FOREIGN KEY \(`(?:target_line_id|legacy_disposal_item_id)`\)/.test(sql))
  assert.ok(!/ON DELETE (?:CASCADE|SET NULL)|\b(?:DELETE FROM|UPDATE `?(?:sale_orders|purchase_returns|inventory_disposal_orders)\b|DROP TABLE)\b/i.test(sql))
  for (const table of ['sale_orders', 'purchase_returns', 'inventory_disposal_orders']) {
    assert.ok(sql.includes(`ALTER TABLE \`${table}\` ADD COLUMN \`disposal_handling_link_id\` BIGINT UNSIGNED NULL`))
  }
  assert.ok(statements.length > 100, 'all metadata checks split into individual migration statements')
})
test('canonical payload uses real JSON undefined/null semantics while retaining stable key order', () => {
  const r = rules()
  assert.equal(r.stableJson({ happenedAt: new Date('2026-10-05T01:02:03.000Z') }), '{"happenedAt":"2026-10-05T01:02:03.000Z"}')
  assert.equal(r.stableJson({ z: undefined, b: [undefined, { z: undefined, a: 1 }], a: 2 }), '{"a":2,"b":[null,{"a":1}]}')
  assert.equal(r.stableJson({ b: 1, a: 2 }), r.stableJson({ a: 2, b: 1 }))
})

test('277 foreign-key symbols are schema-wide unique and repair metadata belongs to the declared owner', () => {
  const sql = fs.readFileSync(path.join(base, 'database/279_disposal_handling.sql'), 'utf8')
  const owners = new Map()
  const blocks = sql.split('SET @dh277_fk =').slice(1)
  assert.ok(blocks.length > 0, 'migration has actual FK repair declarations')
  for (const block of blocks) {
    const declaration = block.match(/ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` FOREIGN KEY/)
    assert.ok(declaration, 'each FK metadata block has an ADD declaration')
    const [, table, symbol] = declaration
    if (!owners.has(symbol)) owners.set(symbol, new Set())
    owners.get(symbol).add(table)
    for (const metadata of ['KEY_COLUMN_USAGE', 'REFERENTIAL_CONSTRAINTS']) {
      const statement = block.match(new RegExp(`FROM information_schema\\.${metadata}([^;]+);`))
      assert.ok(statement, `actual ${metadata} lookup exists for ${table}.${symbol}`)
      assert.ok(statement[1].includes(`TABLE_NAME='${table}'`), `${metadata} owner matches ADD table`)
      assert.ok(statement[1].includes(`CONSTRAINT_NAME='${symbol}'`), `${metadata} symbol matches ADD constraint`)
    }
  }
  // MySQL constraint symbols belong to the database. Repeated repair of the same owner is allowed.
  for (const [symbol, tables] of owners) assert.equal(tables.size, 1, `schema-wide FK ${symbol} collides across ${Array.from(tables).join(',')}`)
})

// MySQL8.0.46 CHECK_CLAUSE bytes observed on the owned first-run instance, including quote byte pair 92,39.
// This is a finite model of the actual SET decision, not a SQL parser or a MySQL execution.
const printedChecks = {
  ck_dho_status: '(`status` in (0,1))',
  ck_dho_payload: 'json_valid(`payload_json`)',
  ck_dho_response: '((`response_json` is null) or json_valid(`response_json`))',
  ck_dhs_intention: '((`quantity` > 0) and (`revision` > 0) and (`handling_type` in (1,2,3)))',
  ck_dhs_legacy_pair: '(((`legacy_disposal_id` is null) and (`legacy_disposal_item_id` is null)) or ((`legacy_disposal_id` is not null) and (`legacy_disposal_item_id` is not null)))',
  ck_dhs_payload: 'json_valid(`payload_json`)',
  ck_dhs_response: '((`response_json` is null) or json_valid(`response_json`))',
  ck_dhl_target: "(`target_type` in (_utf8mb4\\'sale_order\\',_utf8mb4\\'purchase_return\\',_utf8mb4\\'inventory_disposal\\'))",
  ck_dhl_budget: "((`allocated_quantity` > 0) and (`released_quantity` >= 0) and (`released_quantity` <= `allocated_quantity`) and (((`state` = _utf8mb4\\'ACTIVE\\') and (`released_quantity` = 0) and (`final_executed_quantity` is null)) or ((`state` = _utf8mb4\\'TERMINATED\\') and (`final_executed_quantity` is not null) and (`final_executed_quantity` >= 0) and (`final_executed_quantity` <= `allocated_quantity`) and (`released_quantity` = (`allocated_quantity` - `final_executed_quantity`)))))",
  ck_dhl_response: 'json_valid(`response_json`)',
  ck_dhl_release_json: '(((`release_evidence_json` is null) or json_valid(`release_evidence_json`)) and ((`release_response_json` is null) or json_valid(`release_response_json`)))',
  ck_dhc_json: '(json_valid(`original_head_json`) and json_valid(`original_items_json`) and json_valid(`approval_snapshot_json`) and json_valid(`payload_json`) and json_valid(`response_json`))',
}
const weakBudget = "(((`allocated_quantity` > 0) and (`released_quantity` >= 0) and (`released_quantity` <= `allocated_quantity`) and (`state` = _utf8mb4\\'ACTIVE\\') and (`released_quantity` = 0) and (`final_executed_quantity` is null)) or ((`state` = _utf8mb4\\'TERMINATED\\') and (`final_executed_quantity` is not null) and (`final_executed_quantity` >= 0) and (`final_executed_quantity` <= `allocated_quantity`) and (`released_quantity` = (`allocated_quantity` - `final_executed_quantity`))))"
const weakRelease = '((`release_evidence_json` is null) or (json_valid(`release_evidence_json`) and (`release_response_json` is null)) or json_valid(`release_response_json`))'
const checkSqlModes = ['', 'NO_BACKSLASH_ESCAPES']
function unquoteSql(literal, sqlMode = '') {
  assert.ok(checkSqlModes.includes(sqlMode), 'only the two CHECK construction modes are modelled')
  assert.match(literal, /^'(?:[^']|'')*'$/)
  assert.ok(!literal.includes('\\'), 'mode-dependent backslash literals are outside the finite model')
  return literal.slice(1, -1).replaceAll("''", "'")
}
function exactPrintedLiteral(expression, sqlMode) {
  if (expression.startsWith("'")) return unquoteSql(expression, sqlMode)
  const concat = expression.match(/^CONCAT\((.+)\)$/)
  assert.ok(concat, 'only a literal or explicit CONCAT/CHAR(92,39) construction is modelled')
  const atoms = concat[1].match(/'(?:[^'\\]|'')*'|CHAR\(92,39\)/g) || []
  assert.equal(atoms.join(','), concat[1], 'all CONCAT atoms must be exact mode-independent literals or CHAR(92,39)')
  return atoms.map(atom => atom === 'CHAR(92,39)' ? String.fromCharCode(92, 39) : unquoteSql(atom, sqlMode)).join('')
}
function actualCheckStatements() {
  const sql = fs.readFileSync(path.join(base, 'database/279_disposal_handling.sql'), 'utf8')
  const chunks = sql.split('SET @dh277_check =').slice(1)
  return new Map(chunks.map(chunk => {
    const name = chunk.match(/tc\.CONSTRAINT_NAME='([^']+)'/)[1]
    const statement = chunk.match(/SET @dh277_sql = ([^\n]+);/)[1]
    return [name, statement]
  }))
}
function actualCheckDecision(statement, clause, sqlMode = '') {
  const add = statement.match(/^IF\(@dh277_check IS NULL, ('(?:[^']|'')*'), IF\(/)
  assert.ok(add, 'real migration has the missing-check ADD branch')
  if (clause === null) return unquoteSql(add[1], sqlMode)
  const condition = statement.match(/, IF\((.+), 'SELECT 1', 'SELECT \* FROM __disposal_handling_277_check_mismatch__'\)\)$/)[1]
  const binary = condition.match(/^BINARY @dh277_check = BINARY (.+)$/)
  if (binary) return clause === exactPrintedLiteral(binary[1], sqlMode) ? 'SELECT 1' : 'mismatch'
  // Recognize only the previous migration's exact nested LOWER/REPLACE expression.
  // Execute its literal replacement arguments taken from production; unknown expressions throw.
  const old = condition.match(/^(.+) =?\s*('(?:[^']|'')*')$/) || condition.match(/^(.+)=('(?:[^']|'')*')$/)
  assert.ok(old && old[1].includes('LOWER(@dh277_check)'), 'unsupported CHECK decision expression')
  const operations = Array.from(old[1].matchAll(/,('(?:[^']|'')*'|CHAR\(\d+\)),'\'\)/g))
  assert.equal(operations.length, (old[1].match(/REPLACE\(/g) || []).length, 'all actual replacements modelled')
  assert.equal(operations.length, 9, 'only the known prior decision is modelled')
  let normalized = clause.toLowerCase()
  for (const operation of operations) {
    const arg = operation[1]
    const from = arg.startsWith('CHAR') ? String.fromCharCode(Number(arg.match(/\d+/)[0])) : unquoteSql(arg)
    normalized = normalized.split(from).join('')
  }
  return normalized === unquoteSql(old[2]) ? 'SELECT 1' : 'mismatch'
}
for (const [name, canonical] of Object.entries(printedChecks)) test(`277 actual SET accepts the MySQL8 printed ${name} and adds only when missing`, () => {
  const statement = actualCheckStatements().get(name)
  assert.ok(statement, `production contains ${name}`)
  for (const sqlMode of checkSqlModes) {
    assert.equal(actualCheckDecision(statement, canonical, sqlMode), 'SELECT 1')
    assert.equal(actualCheckDecision(statement, canonical + ' ', sqlMode), 'mismatch', 'unknown print form is not normalized into agreement')
    assert.equal(actualCheckDecision(statement, canonical.toUpperCase(), sqlMode), 'mismatch', 'BINARY preserves identifier/literal/print spelling')
    assert.ok(actualCheckDecision(statement, null, sqlMode).includes(`ADD CONSTRAINT \`${name}\` CHECK`))
  }
})
for (const name of ['ck_dhl_target', 'ck_dhl_budget']) test(`277 actual SET rejects quote-byte and introducer drift for ${name}`, () => {
  const canonical = printedChecks[name], statement = actualCheckStatements().get(name)
  const quote = String.fromCharCode(92, 39)
  assert.ok(canonical.includes(quote), 'fixture contains the actual backslash and apostrophe bytes')
  for (const changed of [canonical.replaceAll(quote, "'"), canonical.replaceAll(quote, String.fromCharCode(92, 92, 39)), canonical.replaceAll('_utf8mb4', ''), canonical.slice(1, -1)]) {
    for (const sqlMode of checkSqlModes) assert.equal(actualCheckDecision(statement, changed, sqlMode), 'mismatch')
  }
})
test('277 finite CHECK literal model rejects unsupported or mode-dependent constructions', () => {
  for (const expression of ["CONCAT('a',CHAR(39))", "CONCAT('a',LOWER('B'))", "CONCAT('a',CHAR(92,39),'b') + ''", "'a\\\\b'"]) {
    for (const sqlMode of checkSqlModes) assert.throws(() => exactPrintedLiteral(expression, sqlMode))
  }
})
// Three-valued CHECK semantics for the two exact bounded row counterexamples.
const sqlAnd = (...values) => values.includes(false) ? false : values.includes(null) ? null : true
const sqlOr = (...values) => values.includes(true) ? true : values.includes(null) ? null : false
const jsonValid = value => { if (value === null) return null; try { JSON.parse(value); return true } catch { return false } }
function budgetCase(clause, { A, R, E, state }) {
  assert.ok([printedChecks.ck_dhl_budget, weakBudget].includes(clause))
  const head = [A > 0, R >= 0, R <= A]
  const active = [state === 'ACTIVE', R === 0, E === null]
  const terminated = sqlAnd(state === 'TERMINATED', E !== null, E >= 0, E <= A, R === A - E)
  return clause === weakBudget ? sqlOr(sqlAnd(...head, ...active), terminated) : sqlAnd(...head, sqlOr(sqlAnd(...active), terminated))
}
function releaseCase(clause, evidence, response) {
  assert.ok([printedChecks.ck_dhl_release_json, weakRelease].includes(clause))
  return clause === weakRelease
    ? sqlOr(evidence === null, sqlAnd(jsonValid(evidence), response === null), jsonValid(response))
    : sqlAnd(sqlOr(evidence === null, jsonValid(evidence)), sqlOr(response === null, jsonValid(response)))
}
test('277 actual SET rejects weak budget grouping that lets TERMINATED A=R=E=0 through', () => {
  const row = { A: 0, R: 0, E: 0, state: 'TERMINATED' }
  assert.equal(budgetCase(printedChecks.ck_dhl_budget, row), false)
  assert.equal(budgetCase(weakBudget, row), true)
  assert.equal(actualCheckDecision(actualCheckStatements().get('ck_dhl_budget'), weakBudget), 'mismatch')
})
test('277 actual SET rejects weak JSON grouping that lets NULL evidence and bad response through', () => {
  assert.equal(releaseCase(printedChecks.ck_dhl_release_json, null, 'bad-json'), false)
  assert.equal(releaseCase(weakRelease, null, 'bad-json'), true)
  assert.equal(actualCheckDecision(actualCheckStatements().get('ck_dhl_release_json'), weakRelease), 'mismatch')
})
