'use strict'
// Run the actual controller/services; replace only external database/dispatch boundaries.
// Removing any added warehouse filter, raw namespace or body check makes these fail.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '..')
const backend = path.join(root, 'backend/src')
const ExcelJS = require('../backend/node_modules/exceljs')
function loader(overrides) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (overrides.has(file)) return overrides.get(file)
    if (cache.has(file)) return cache.get(file).exports
    const m = new Module(file, module)
    m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); cache.set(file, m)
    const native = m.require.bind(m)
    m.require = name => name.startsWith('.') ? load(require.resolve(path.resolve(path.dirname(file), name))) : native(name)
    const before = process.env.FLOWCUBE_SECURITY_SCOPE_BASELINE_DIR && path.join(process.env.FLOWCUBE_SECURITY_SCOPE_BASELINE_DIR, path.relative(root, file))
    m._compile(fs.readFileSync(before && fs.existsSync(before) ? before : file, 'utf8'), file)
    return m.exports
  }
  return load
}
function notificationFixture() {
  const calls = []
  const aliases = ['failedPrintJobs', 'inboundPrintFailures', 'overdueInboundPutaway', 'outboundPrintFailures', 'staleWavePicking', 'staleWaveSorting', 'logisticsPrintFailures']
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params })
    const alias = sql.match(/COUNT\(\*\) AS (\w+)/)?.[1]
    const scope = params.find(Array.isArray)
    const visible = /AND 1=0/.test(sql) ? [] : /warehouse_id IN \(\?\)/.test(sql) ? [22, 11].filter(id => scope.includes(id)) : [22, 11]
    if (aliases.includes(alias)) return [[{ [alias]: visible.length }]]
    if (/AS taskId/.test(sql)) return [visible.map(id => ({ taskId: id * 10 }))]
    if (/AS waveId/.test(sql)) return [visible.map(id => ({ waveId: id * 10, waveNo: 'SYNTHETIC-' + id }))]
    if (alias === 'pendingTransfer') {
      const total = /AND 1=0/.test(sql) ? 0 : /from_warehouse_id IN/.test(sql) ? Number(scope.includes(11) || scope.includes(22)) : 1
      return [[{ [alias]: total }]]
    }
    if (['unpaidPayable', 'unpaidReceivable', 'overduePayable', 'overdueReceivable'].includes(alias)) return [[{ [alias]: 7 }]]
    return [[{ [alias || 'count']: 0 }]]
  } }
  const load = loader(new Map([
    [path.join(backend, 'config/db.js'), { pool }],
    [path.join(backend, 'utils/inboundThresholds.js'), { getInboundClosureThresholds: async () => ({ printTimeoutMinutes: 10, putawayTimeoutHours: 24 }) }],
    [path.join(backend, 'engine/containerEngine.js'), { CONTAINER_STATUS: { PENDING_PUTAWAY: 4 } }],
  ]))
  return { calls, aliases, build: load(path.join(backend, 'modules/notifications/notifications.service.js')).buildNotifications }
}
for (const [label, scope, expected, target] of [['A仓', [11], 1, 110], ['B仓', [22], 1, 220], ['多仓', [11, 22], 2, 220], ['空范围', [], 0, null], ['不限仓', null, 2, 220]]) {
  test(`通知${label}：全部仓库异常计数及跳转标识沿同一范围，财务/调拨原口径保留`, async () => {
    const f = notificationFixture(); const result = await f.build(scope, null)
    for (const alias of f.aliases) assert.equal(result.counts[alias], expected, alias)
    const targets = result.items.filter(i => ['INBOUND_PRINT_FAILED', 'INBOUND_PUTAWAY_TIMEOUT', 'OUTBOUND_PRINT_FAILED', 'WAVE_STALE_PICKING', 'WAVE_STALE_SORTING'].includes(i.code))
    if (target === null) assert.equal(targets.length, 0)
    else {
      assert.equal(targets.length, 5)
      for (const item of targets) assert.match(item.path, new RegExp(String(target)), item.code)
    }
    assert.equal(result.counts.unpaidPayable, 7); assert.equal(result.counts.overdueReceivable, 7)
    assert.equal(result.counts.pendingTransfer, scope?.length === 0 ? 0 : 1)
    for (const q of f.calls.filter(q => /COUNT\(\*\) AS (inboundPrintFailures|overdueInboundPutaway|outboundPrintFailures|staleWavePicking|staleWaveSorting)/.test(q.sql))) {
      const table = q.sql.match(/FROM (\w+)(?:\s+j)?/)[1]
      const targetQ = f.calls.find(r => r !== q && r.sql.includes('FROM ' + table) && /AS (taskId|waveId)/.test(r.sql) && (table !== 'print_jobs' || r.sql.includes(q.sql.includes("'inventory_container'") ? "'inventory_container'" : "'package'")))
      assert.ok(targetQ, table)
      const authorization = sql => sql.match(/AND (?:(?:j\.)?warehouse_id IN \(\?\)|1=0)/)?.[0] ?? ''
      assert.equal(authorization(q.sql), authorization(targetQ.sql), 'COUNT/target must share warehouse authorization; original target-link predicates stay intact')
      assert.deepEqual(q.params, targetQ.params)
    }
  })
}
function importFixture() {
  const calls = []
  const pool = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('FROM product_items')) return [[{ code: 'SYNTHETIC-P1', name: '合成商品', unit: '件' }]]
    if (sql.includes('FROM inventory_warehouses')) {
      const scope = params.find(Array.isArray)
      return [[{ id: 11, name: '合成A仓' }, { id: 22, name: '合成B仓' }].filter(row => !/AND 1=0/.test(sql) && (!/IN \(\?\)/.test(sql) || scope.includes(row.id)))]
    }
    throw new Error('unexpected import SQL')
  } }
  const load = loader(new Map([[path.join(backend, 'config/db.js'), { pool }]]))
  return { calls, service: load(path.join(backend, 'modules/import/import.service.js')), controller: load(path.join(backend, 'modules/import/import.controller.js')) }
}
for (const [label, scope, ids] of [['限仓', [11], [11]], ['空范围', [], []], ['多仓', [11, 22], [11, 22]], ['不限仓', null, [11, 22]]]) {
  test(`库存模板${label}：真实XLSX参考页与填报页一致，只读生成`, async () => {
    const f = importFixture(); let buffer; let failure
    await f.controller.downloadStockTemplate({ user: { warehouseIds: scope }, query: { warehouseIds: [22] } }, { setHeader() {}, send(b) { buffer = b } }, e => { failure = e })
    assert.ifError(failure)
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer)
    const values = (name, col) => workbook.getWorksheet(name).getColumn(col).values.slice(2).map(Number)
    assert.deepEqual(values('仓库参考', 1), ids)
    assert.deepEqual(values('库存初始化', 2), ids)
    assert.deepEqual(workbook.worksheets.map(w => w.name), ['库存初始化', '仓库参考'])
    assert.ok(f.calls.every(q => /^SELECT /.test(q.sql)))
  })
}
function printFixture() {
  const state = { nextId: 100, queries: [], jobs: new Map(), operations: new Map() }
  const conn = {
    async beginTransaction() { this.snapshot = structuredClone({ jobs: state.jobs, operations: state.operations }) },
    async commit() { this.snapshot = null },
    async rollback() { if (this.snapshot) { state.jobs = this.snapshot.jobs; state.operations = this.snapshot.operations; this.snapshot = null } },
    release() {},
    async query(sql, params = []) {
      state.queries.push({ sql, params })
      if (/INSERT INTO operation_requests/.test(sql)) {
        const key = JSON.stringify(params.slice(0, 3))
        if (state.operations.has(key)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
        const row = { id: state.nextId++, request_key: params[0], action: params[1], user_id: params[2], status: params[3] }
        state.operations.set(key, row); return [{ insertId: row.id }]
      }
      if (/SELECT \*\s+FROM operation_requests/.test(sql)) return [[state.operations.get(JSON.stringify(params.slice(0, 3)))].filter(Boolean)]
      if (/UPDATE operation_requests/.test(sql)) {
        const row = [...state.operations.values()].find(r => r.id === params[5]); assert.ok(row)
        Object.assign(row, { status: params[0], response_json: params[1], response_message: params[2], resource_type: params[3], resource_id: params[4] }); return [{ affectedRows: 1 }]
      }
      if (/SELECT id FROM print_jobs\s+WHERE job_unique_key\s*=/.test(sql)) return [[...state.jobs.values()].filter(j => j.job_unique_key === params[0] && [0, 1, 2].includes(j.status) && j.warehouse_id === params[4] && j.job_type === params[5]).map(j => ({ id: j.id }))]
      if (/SELECT id FROM print_jobs WHERE job_unique_key LIKE/.test(sql)) return [[...state.jobs.values()].filter(j => j.job_unique_key?.startsWith(params[0].slice(0, -1)) && j.created_by === params[1]).sort((a,b) => b.id-a.id).slice(0,1).map(j => ({ id: j.id }))]
      if (/WHERE j.id=\?/.test(sql)) return [[state.jobs.get(Number(params[0]))].filter(Boolean)]
      if (/INSERT INTO print_jobs/.test(sql)) {
        const columns = sql.match(/INSERT INTO print_jobs\s*\(([^)]+)\)/)[1].split(',').map(v => v.trim())
        const row = { id: state.nextId++ }; let index = 0
        for (const col of columns) row[col] = col === 'created_by_name' ? '合成人员' + params[index++] : col === 'expires_at' ? (index++, '2030-01-01') : params[index++]
        state.jobs.set(row.id, row); return [{ insertId: row.id }]
      }
      if (/FROM printers/.test(sql)) return [[{ id: 3, code: 'SYNTHETIC-P', status: 1, warehouse_id: 11 }]]
      throw new Error('Unexpected print SQL: ' + sql)
    },
  }
  const pool = { query: conn.query.bind(conn), getConnection: async () => conn }
  const overrides = new Map([
    [path.join(backend, 'config/db.js'), { pool }],
    [path.join(backend, 'utils/logger.js'), { warn() {} }],
    [path.join(backend, 'utils/inboundThresholds.js'), { DEFAULT_INBOUND_THRESHOLDS: { printTimeoutMinutes: 10 } }],
    [path.join(backend, 'engine/containerEngine.js'), { CONTAINER_STATUS: {} }],
    [path.join(backend, 'engine/inventoryEngine.js'), { MOVE_TYPE: {} }],
    [path.join(backend, 'modules/print-jobs/print-dispatch.js'), { normalizeJobType: j => j || 'product_label', resolvePrinterForJob: async () => ({ printerId: 3 }) }],
    [path.join(backend, 'modules/print-jobs/printer-health.js'), {}],
    [path.join(backend, 'modules/printers/print-client-auth.js'), {}],
  ])
  const load = loader(overrides)
  const command = load(path.join(backend, 'modules/print-jobs/print-jobs.command.js'))
  overrides.set(path.join(backend, 'modules/print-jobs/print-jobs.service.js'), { create: command.create })
  const controller = load(path.join(backend, 'modules/print-jobs/print-jobs.controller.js'))
  const body = { printerId: 3, warehouseId: 11, jobType: 'waybill', jobUniqueKey: 'waybill:711', title: '本人合成标签', contentType: 'zpl', content: '^XA^FDBODY-A^FS^XZ', copies: 1 }
  async function send(value = body, actor = 7, scope = [11], key = 'original-raw-key') {
    let result; let failure
    await controller.create({ body: value, headers: key ? { 'x-request-key': key } : {}, user: { userId: actor, warehouseIds: scope } }, { status() { return this }, json(value) { result = value.data } }, e => { failure = e })
    if (failure) throw failure
    return result
  }
  return { state, command, conn, send, body }
}
test('CREATE-only raw不命中同仓业务/他人namespace，不返回ackToken；领域原键仍可回放', async () => {
  const f = printFixture()
  const original = await f.command.createWithinTransaction(f.conn, { ...f.body, createdBy: 99, refType: 'waybill', refId: 711, content: '^XA^FDBUSINESS-SYNTHETIC^FS^XZ' })
  f.state.jobs.get(original.id).ack_token = 'synthetic-nonauth-ack-fixture'
  const own = await f.send()
  assert.notEqual(own.id, original.id)
  assert.equal(own.createdBy, 7); assert.equal(own.content, f.body.content); assert.match(own.jobUniqueKey, /^raw:/)
  assert.equal(Object.hasOwn(own, 'ackToken'), false)
  assert.equal((await f.command.createWithinTransaction(f.conn, { ...f.body, createdBy: 99 })).id, original.id)
})
test('raw本人原key/完整body返回原任务；修改正文、份数、目标或忽略字段均409且零新任务', async () => {
  const f = printFixture(); const own = await f.send()
  assert.equal((await f.send({ ...f.body })).id, own.id)
  for (const diff of [{ content: '^XA^FDBODY-B^FS^XZ' }, { copies: 2 }, { title: '改标题' }, { printerId: 4 }, { jobType: 'product_label' }, { extra: 'ignored-but-bound' }]) {
    await assert.rejects(f.send({ ...f.body, ...diff }), { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' })
    assert.equal(f.state.jobs.size, 1)
  }
})
test('不同actor使用同key独立，本人范围撤销原回放403；空scope和无仓资源仍拒绝', async () => {
  const f = printFixture(); const a = await f.send(); const b = await f.send(f.body, 8)
  assert.notEqual(a.id, b.id); assert.equal(b.createdBy, 8)
  await assert.rejects(f.send(f.body, 7, [22]), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' })
  await assert.rejects(f.send(f.body, 7, []), { statusCode: 403 })
  await assert.rejects(f.send({ ...f.body, warehouseId: null }, 7, [11]), { statusCode: 403 })
  assert.equal(f.state.jobs.size, 2)
})
test('raw回放须核actual job身份，不能将被篡改resource或body回执当本人结果', async () => {
  const f = printFixture(); const a = await f.send(); f.state.jobs.get(a.id).created_by = 99
  await assert.rejects(f.send(), { statusCode: 409 })
  assert.equal(f.state.jobs.size, 1)
})
test('raw实际任务范围变化后原POST仍403，不依赖旧载荷头仓', async () => {
  const f = printFixture(); const a = await f.send(); f.state.jobs.get(a.id).warehouse_id = 22
  await assert.rejects(f.send(f.body, 7, [11]), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.equal(f.state.jobs.size, 1)
})
test('raw回执TTL清理但打印历史仍在时：原body保留原任务、改body409，失败任务也不重新入队', async () => {
  const f = printFixture(); const a = await f.send(); f.state.operations.clear(); f.state.jobs.get(a.id).status = 3
  assert.equal((await f.send()).id, a.id); assert.equal(f.state.jobs.size, 1)
  f.state.operations.clear()
  await assert.rejects(f.send({ ...f.body, content: '^XA^FDCHANGED^FS^XZ' }), { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(f.state.jobs.size, 1); assert.equal(f.state.operations.size, 0)
})
test('raw沿body旧uniqueKey保护本人重试；无key PDA正文保持每次合法新建', async () => {
  const f = printFixture(); const old = await f.send(f.body, 7, [11], null)
  assert.equal((await f.send(f.body, 7, [11], null)).id, old.id)
  const { jobUniqueKey: _key, ...pda } = f.body
  const first = await f.send(pda, 7, [11], null); const second = await f.send(pda, 7, [11], null)
  assert.notEqual(first.id, second.id); assert.match(first.jobUniqueKey, /^raw:/); assert.equal(first.content, pda.content)
})
test('raw拒绝客户端业务/请求人元数据；预算在正文指纹及数据库写前仍有效', async () => {
  const f = printFixture()
  for (const body of [{ ...f.body, refId: 9 }, { ...f.body, createdById: 99 }]) await assert.rejects(f.send(body), { statusCode: 400 })
  await assert.rejects(f.send({ ...f.body, content: 'x'.repeat(1024 * 1024 + 1) }), { code: 'PRINT_CONTENT_BUDGET_EXCEEDED' })
  assert.equal(f.state.jobs.size, 0)
})
