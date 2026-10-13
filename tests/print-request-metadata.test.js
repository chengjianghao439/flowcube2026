'use strict'
// Offline real-module regression. Database, printer and renderer I/O are isolated;
// queue normalization, SQL, DTOs and entry-point decisions execute production code.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '..')
const printDir = path.join(root, 'backend/src/modules/print-jobs')
const source = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\s*\/\/.*$/gm, '')
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
    m._compile(fs.readFileSync(file, 'utf8'), file)
    return m.exports
  }
  return load
}
function fixture() {
  const state = { jobs: new Map(), users: new Map([[7, '排队时姓名']]), queries: [], printer: true, renderFails: false, stored: null, nextId: 101 }
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    async query(sql, params = []) {
      state.queries.push({ sql, params })
      if (/INSERT INTO print_jobs/.test(sql)) {
        const columns = sql.match(/INSERT INTO print_jobs\s*\(([^)]+)\)/)[1].split(',').map(v => v.trim())
        const row = { id: state.nextId++, created_at: '2026-10-10 08:00:00', updated_at: '2026-10-10 08:00:00' }
        let i = 0
        for (const col of columns) {
          if (col === 'expires_at') { row[col] = '2026-10-10 08:30:00'; i++ }
          else if (col === 'created_by_name') row[col] = state.users.get(params[i++]) ?? null
          else row[col] = params[i++]
        }
        state.jobs.set(row.id, row)
        return [{ insertId: row.id }]
      }
      if (/SELECT id FROM print_jobs\s+WHERE job_unique_key/.test(sql)) {
        return [[...state.jobs.values()].filter(j => j.job_unique_key === params[0] && [0, 1, 2].includes(j.status) && j.warehouse_id === params[4] && j.job_type === params[5]).map(j => ({ id: j.id }))]
      }
      if (/WHERE j.id=\?/.test(sql)) return [[state.jobs.get(Number(params[0]))].filter(Boolean)]
      if (/SELECT id, warehouse_id FROM print_jobs WHERE id=\?/.test(sql)) return [[state.jobs.get(Number(params[0]))].filter(Boolean)]
      if (/UPDATE print_jobs/.test(sql)) { const id = /retry_count=0/.test(sql) ? params[2] : params[1]; const j = state.jobs.get(id); if (j) { j.status = params[0]; if (/acknowledged_at=NOW/.test(sql)) j.acknowledged_at = '2026-10-10 08:01:00' } return [{ affectedRows: j ? 1 : 0 }] }
      if (/TIMESTAMPDIFF\(MICROSECOND/.test(sql)) return [[]]
      if (/FROM printers/.test(sql)) return [state.printer ? [{ id: 3, code: 'TEST-P', status: 1, warehouse_id: 4 }] : []]
      if (/FROM inventory_containers c/.test(sql)) return [[{ id: params[0], barcode: 'I-SYNTHETIC', remaining_qty: 2, warehouse_id: 4, product_id: 5, container_status: 1, has_print_job: 1, source_ref_type: state.pick ? 'plastic_box_pick' : 'inbound_task', locked_by_task_id: 9 }]]
      if (/SELECT name FROM product_items/.test(sql)) return [[{ name: '测试商品' }]]
      if (/FROM scan_logs sl/.test(sql)) return [[{ id: 91, task_id: 9, task_status: 3 }]]
      if (/SELECT warehouse_task_id FROM packages/.test(sql)) return [[{ warehouse_task_id: 9 }]]
      if (/FROM warehouse_tasks WHERE id/.test(sql)) return [[{ id: 9, warehouse_id: 4 }]]
      if (/FROM packages WHERE id/.test(sql)) return [[{ id: params[0], warehouse_task_id: 9 }]]
      if (/SELECT id FROM print_jobs WHERE ref_type = 'package'/.test(sql)) return [[{ id: 81 }]]
      throw new Error(`Unisolated SQL: ${sql}`)
    },
  }
  const overrides = new Map([
    [path.join(root, 'backend/src/config/db.js'), { pool: { ...conn, getConnection: async () => conn } }],
    [path.join(root, 'backend/src/utils/logger.js'), { warn() {} }],
    [path.join(root, 'backend/src/utils/inboundThresholds.js'), { DEFAULT_INBOUND_THRESHOLDS: { printTimeoutMinutes: 10 }, getInboundClosureThresholds: async () => ({ printTimeoutMinutes: 10 }) }],
    [path.join(root, 'backend/src/engine/containerEngine.js'), { CONTAINER_STATUS: { ACTIVE: 1, EMPTY: 2, VOID: 3 } }],
    [path.join(root, 'backend/src/engine/inventoryEngine.js'), { MOVE_TYPE: { RECEIPT_VOID: 11 } }],
    [path.join(printDir, 'print-dispatch.js'), { normalizeJobType: v => v ?? 'raw', resolvePrinterForJob: async () => ({ printerId: state.printer ? 3 : null, dispatchReason: 'binding' }) }],
    [path.join(printDir, 'printer-health.js'), { recordPrintSuccess: async () => {}, recordPrintFailure: async () => {} }],
    [path.join(root, 'backend/src/modules/printers/print-client-auth.js'), { requireClientIdentity: v => v }],
    [path.join(printDir, 'labelVariables.js'), { containerLabelVariables: () => ({}), readLabelVariables: async () => ({ row: { warehouse_id: 4, barcode: 'TEST-LABEL', code: 'TEST-PRODUCT' }, vars: { container_code: 'TEST-LABEL' } }) }],
    [path.join(printDir, 'labelZplTemplate.js'), { getLabelZplFromDefaultTemplate: async () => { if (state.renderFails) throw Object.assign(new Error('synthetic renderer failure'), { code: 'LABEL_RENDER_FAILED' }); return '^XA^FO1,1^FDTEST^FS^XZ' } }],
    [path.join(printDir, 'labelRasterService.js'), { renderLabelAsync: async () => { throw new Error('unexpected renderer') } }],
    [path.join(printDir, 'labelRasterDefaults.js'), { defaultLabelLayout: () => ({}) }],
    [path.join(printDir, 'print-jobs.dispatch.js'), { getDispatchHintForJob: async () => null }],
    [path.join(printDir, 'print-jobs.reprint-source.js'), { lockContainerReprintSource: async () => ({ id: 11, warehouse_id: 4 }), identity: row => ({ id: row.id }) }],
    // Reprint intent protocol has its own real-module suite. Here we isolate only its I/O
    // to exercise the existing centre branches and assert metadata does not rewrite replay.
    [path.join(printDir, 'print-jobs.reprint-intent.js'), { beginReprintIntent: async () => state.stored ? { replay: true, result: state.stored } : { id: 51 }, completeReprintIntent: async (_c, _i, data) => { state.stored = data.result } }],
  ])
  const load = loader(overrides)
  return { state, conn, load, command: load(path.join(printDir, 'print-jobs.command.js')), labels: load(path.join(printDir, 'print-jobs.label-command.js')), helpers: load(path.join(printDir, 'print-jobs.helpers.js')), overrides }
}
const args = { printerId: 3, warehouseId: 4, title: '合成标签', contentType: 'zpl', content: '^XA^FDTEST^FS^XZ', copies: 3, createdBy: 7, jobType: 'raw' }

test('queue stores purpose separately from dispatch and snapshots the actual requesting account', async () => {
  const f = fixture()
  const job = await f.command.createWithinTransaction(f.conn, { ...args, requestPurpose: 'initial', createdByName: '伪造姓名', dispatchReason: 'manual_reprint' })
  assert.equal(job.requestPurpose, 'initial'); assert.equal(job.dispatchReason, 'manual_reprint')
  assert.equal(job.createdById, 7); assert.equal(job.createdByName, '排队时姓名'); assert.equal(job.requestedCopies, 3)
  const insert = f.state.queries.find(q => /INSERT INTO print_jobs/.test(q.sql))
  assert.match(insert.sql, /\(SELECT\s+(?:u\.)?real_name\s+FROM sys_users/)
  f.state.users.set(7, '改名后'); f.state.users.delete(7)
  assert.equal((await f.command.createWithinTransaction(f.conn, { ...args, requestPurpose: 'reprint', jobUniqueKey: 'second' })).createdByName, null)
  assert.equal(f.helpers.fmt(f.state.jobs.get(job.id)).createdByName, '排队时姓名')
})
test('unknown/legacy purpose and absent creator/source facts remain null, regardless of key/dispatch/history', async () => {
  const f = fixture()
  const job = await f.command.createWithinTransaction(f.conn, { ...args, createdBy: null, jobUniqueKey: 'manual_reprint:old', dispatchReason: 'manual_reprint' })
  assert.equal(job.requestPurpose, null); assert.equal(job.createdByName, null); assert.equal(job.sourcePrintJobId, null)
  const legacy = f.helpers.fmt({ id: 1, status: 2, copies: 2, dispatch_reason: 'manual_reprint', job_unique_key: 'manual_reprint:legacy', created_by: 7 })
  assert.equal(legacy.requestPurpose, null); assert.equal(legacy.createdByName, null); assert.equal(legacy.sourcePrintJobId, null)
})
test('same active job and retry keep original purpose/name/copies/source; ACK adds client report time only', async () => {
  const f = fixture()
  const original = await f.command.createWithinTransaction(f.conn, { ...args, requestPurpose: 'reprint', sourcePrintJobId: 80, jobUniqueKey: 'same' })
  f.state.users.set(7, '新姓名')
  const replay = await f.command.createWithinTransaction(f.conn, { ...args, requestPurpose: 'initial', copies: 1, sourcePrintJobId: 90, jobUniqueKey: 'same' })
  assert.deepEqual(replay, original); assert.equal(f.state.jobs.size, 1)
  f.state.jobs.get(original.id).status = 3
  const retried = await f.command.retry(original.id)
  assert.equal(retried.requestPurpose, 'reprint'); assert.equal(retried.createdByName, '排队时姓名'); assert.equal(retried.requestedCopies, 3); assert.equal(retried.sourcePrintJobId, 80)
  f.state.jobs.get(original.id).status = 1
  const ack = await f.command.complete(original.id, { ackToken: 'synthetic-ack' }, null, { clientId: 'test', credentialHash: 'test' })
  assert.equal(ack.acknowledgedAt, '2026-10-10 08:01:00'); assert.equal(ack.requestedCopies, 3)
  assert.equal(Object.hasOwn(ack, 'printedCopies'), false)
})
test('metadata creation and centre reprint still enforce current warehouse scope before writing', async () => {
  const f = fixture()
  await assert.rejects(f.command.createWithinTransaction(f.conn, { ...args, requestPurpose: 'initial', scopeWarehouseIds: [8] }), { code: 'WAREHOUSE_SCOPE_DENIED' })
  await assert.rejects(f.labels.reprintBarcodeRecord({ category: 'inbound', recordId: 11, createdBy: 7, scopeWarehouseIds: [8] }), { code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.equal(f.state.jobs.size, 0)
})
test('invalid internal purpose/source values are rejected before queue mutation', async () => {
  for (const patch of [{ requestPurpose: 'manual_reprint' }, { sourcePrintJobId: -1 }, { sourcePrintJobId: 1.5 }]) {
    const f = fixture(); await assert.rejects(f.command.createWithinTransaction(f.conn, { ...args, ...patch }), { code: 'PRINT_REQUEST_METADATA_INVALID' }); assert.equal(f.state.jobs.size, 0)
  }
})
for (const [method, payload] of [
  ['enqueueContainerLabelJob', { containerId: 11, warehouseId: 4, data: { container_code: 'I-TEST', qty: 2 } }],
  ['enqueuePickLabelJob', { containerId: 11, scanLogId: 91, warehouseId: 4, data: { container_code: 'I-TEST' } }],
  ['enqueuePackageLabelJob', { packageId: 21 }],
  ['enqueueWaybillLabelJob', { waybillId: 31, warehouseId: 4, content: args.content }],
]) {
  for (const mode of ['success', 'no-printer', ...(method === 'enqueueWaybillLabelJob' ? [] : ['render-failure'])]) {
    test(`${method} preserves explicit purpose and requesting account on ${mode}`, async () => {
      for (const requestPurpose of ['initial', 'reprint']) {
        const f = fixture(); f.state.printer = mode !== 'no-printer'; f.state.renderFails = mode === 'render-failure'
        const job = await f.labels[method]({ ...payload, conn: f.conn, createdBy: 7, requestPurpose })
        assert.equal(job.requestPurpose, requestPurpose); assert.equal(job.createdByName, '排队时姓名'); assert.equal(job.requestedCopies, 1); assert.equal(job.sourcePrintJobId, null)
        assert.equal(!!job.unprintable, mode !== 'success')
      }
    })
  }
}
for (const [method, payload] of [['enqueueRackLabelJob', { rackId: 1 }], ['enqueueLocationLabelJob', { locationId: 1 }], ['enqueueProductLabelJob', { productId: 1 }]]) {
  test(`${method} does not invent purpose for ordinary manual label printing`, async () => {
    const f = fixture(); await f.labels[method]({ ...payload, createdBy: 7 })
    assert.equal(f.state.jobs.values().next().value.request_purpose, null)
  })
}
for (const type of ['container', 'pick', 'outbound', 'logistics']) {
  test(`centre ${type} creates reprint metadata with source job only for an actual logistics clone`, async () => {
    const f = fixture(); f.state.pick = type === 'pick'
    let id = 11
    if (type === 'logistics') { const job = await f.command.createWithinTransaction(f.conn, { ...args, jobType: 'waybill', refType: 'waybill', refId: 31, requestPurpose: 'initial' }); id = job.id }
    const result = await f.labels.reprintBarcodeRecord({ category: ['container', 'pick'].includes(type) ? 'inbound' : type, recordId: id, createdBy: 7, requestKey: 'synthetic-request', scopeWarehouseIds: [4] })
    assert.equal(result.requestPurpose, 'reprint'); assert.equal(result.createdById, 7)
    assert.equal(result.sourcePrintJobId, type === 'logistics' ? id : null)
    if (type === 'logistics') assert.equal(result.requestedCopies, 3)
    const again = await f.labels.reprintBarcodeRecord({ category: ['container', 'pick'].includes(type) ? 'inbound' : type, recordId: id, createdBy: 7, requestKey: 'synthetic-request', scopeWarehouseIds: [4] })
    assert.deepEqual(again, result)
  })
}
test('old replay DTO is returned unchanged, without fabricated new metadata', async () => {
  const f = fixture(); f.state.stored = { queued: true, id: 1, category: 'inbound', recordId: 11 }
  assert.deepEqual(await f.labels.reprintBarcodeRecord({ category: 'inbound', recordId: 11, createdBy: 7 }), f.state.stored)
  assert.equal(f.state.jobs.size, 0)
})
test('generic HTTP rejects client supplied request metadata and keeps actual user identity', async () => {
  const f = fixture(); let passed
  f.overrides.set(path.join(printDir, 'print-jobs.service.js'), { create: async value => { passed = value; return value } })
  const controller = loader(f.overrides)(path.join(printDir, 'print-jobs.controller.js'))
  for (const key of ['requestPurpose', 'request_purpose', 'createdByName', 'created_by_name', 'createdById', 'sourcePrintJobId', 'source_print_job_id']) {
    let error; await controller.create({ body: { ...args, [key]: 'forged' }, user: { userId: 7 } }, {}, e => { error = e })
    assert.equal(error?.code, 'PRINT_REQUEST_METADATA_FORBIDDEN', key)
  }
  const res = { status() { return this }, json() {} }
  await controller.create({ body: { ...args, createdBy: 99 }, user: { userId: 7 } }, res, e => { throw e })
  assert.equal(passed.createdBy, 7); assert.equal(passed.requestPurpose ?? null, null)
})
test('latest read-only DTO includes persisted facts for all categories with fixed scoped batch reads', async () => {
  for (const category of ['inbound', 'outbound', 'logistics']) {
    const f = fixture(), sqls = []
    const row = { id: 31, record_id: 11, print_job_id: 31, status: 2, print_status: 2, container_status: 1, valid_origin: 1, remaining_qty: 2, barcode: 'TEST', copies: 3, request_purpose: 'reprint', created_by: 7, created_by_name: '原姓名快照', source_print_job_id: 30, acknowledged_at: '2026-10-10 08:01:00', ref_type: 'waybill', ref_id: 9, ref_code: 'TEST', created_at: '2026-10-10 08:00:00', print_created_at: '2026-10-10 08:00:00' }
    f.overrides.set(path.join(root, 'backend/src/config/db.js'), { pool: { query: async (sql, params) => { sqls.push({ sql, params }); return /SELECT COUNT\(\*\) AS total/.test(sql) ? [[{ total: 1 }]] : [[row]] } } })
    const query = loader(f.overrides)(path.join(printDir, 'print-jobs.query.js'))
    const result = await query.findBarcodeRecords({ category, scopeWarehouseIds: [4], page: 1, pageSize: 100 })
    const job = result.list[0].latestJob
    assert.equal(job.requestPurpose, 'reprint'); assert.equal(job.createdById, 7); assert.equal(job.createdByName, '原姓名快照'); assert.equal(job.requestedCopies, 3); assert.equal(job.sourcePrintJobId, 30); assert.equal(job.acknowledgedAt, row.acknowledged_at)
    assert.equal(sqls.length, 2); assert.doesNotMatch(sqls[0].sql, /JOIN sys_users/); assert.match(sqls[0].sql, /j\.request_purpose/); assert.match(sqls[0].sql, /j\.created_by_name/)
    const alias = { inbound: 'c', outbound: 'wt', logistics: 'j' }[category]
    for (const q of sqls) assert.ok(q.sql.includes(`${alias}.warehouse_id IN (?)`))
    for (const secret of ['ackToken', 'content', 'claimedClientId', 'credentialHash', 'fingerprint', 'jobUniqueKey']) assert.equal(Object.hasOwn(job, secret), false)
  }
})
test('automatic business entry points explicitly identify initial, and explicit repeat-print entries reprint', () => {
  const rules = [
    ['backend/src/modules/inbound-tasks/inbound-tasks.command.js', 'inbound_receive:', 'initial'],
    ['backend/src/modules/inbound-tasks/inbound-tasks.command.js', 'manual_reprint:', 'reprint'],
    ['backend/src/modules/inventory/inventory.split.js', 'split_cnt_', 'initial'],
    ['backend/src/modules/return-tasks/return-tasks.labels.js', 'return_${phase}', 'initial'],
    ['backend/src/modules/scan-logs/scan-logs.service.js', 'enqueuePickLabelJob', 'initial'],
    ['backend/src/modules/logistics/logistics.worker.js', 'enqueueWaybillLabelJob({', 'initial'],
    ['backend/src/modules/packages/packages.service.js', 'jobUniqueKey: packageLabelJobKey', 'initial'],
    ['backend/src/modules/packages/packages.service.js', 'jobUniqueKey: requestKey ? `package_label:', 'reprint'],
    ['backend/src/modules/plastic-boxes/plastic-boxes.service.js', 'plastic_box_label:', 'reprint'],
    ['backend/src/modules/plastic-boxes/plastic-boxes.service.js', 'enqueueContainerLabelJob({', 'initial'],
  ]
  const check = (text, marker, purpose) => { const pos = text.indexOf(marker); assert.ok(pos >= 0, marker); assert.ok(text.slice(Math.max(0, pos - 900), pos + 900).includes(`requestPurpose: '${purpose}'`), `${marker} must explicitly mean ${purpose}`) }
  for (const [file, marker, purpose] of rules) { const s = source(file); check(s, marker, purpose); assert.throws(() => check(s.replaceAll(`requestPurpose: '${purpose}'`, 'requestPurpose: null'), marker, purpose)) }
})
test('migration adds only nullable metadata, rejects unknown column/index shapes and never backfills purposes', () => {
  const s = source('backend/src/database/287_print_request_metadata.sql')
  for (const col of ['request_purpose', 'created_by_name', 'source_print_job_id']) {
    assert.match(s, new RegExp(`COLUMN_NAME='${col}'`)); assert.match(s, new RegExp(`ADD COLUMN ${col} [^']+DEFAULT NULL`))
  }
  assert.match(s, /IS_NULLABLE='YES'/); assert.match(s, /COLUMN_DEFAULT IS NULL/); assert.match(s, /EXTRA=''/); assert.match(s, /GENERATION_EXPRESSION=''/)
  assert.match(s, /ORDER BY SEQ_IN_INDEX/); assert.match(s, /source_print_job_id/); assert.match(s, /shape_mismatch/); assert.match(s, /index_mismatch/)
  assert.doesNotMatch(s, /\bUPDATE\b|\bDELETE\b|\bDROP\b|\bMODIFY\b/i)
})


test('business barcode reprint rejects any explicit copies before service or queue access', async () => {
  let delegated = 0
  const controller = loader(new Map([[path.join(printDir, 'print-jobs.service.js'), {
    reprintBarcodeRecord: async () => { delegated++; return { queued: true } },
  }]]))(path.join(printDir, 'print-jobs.controller.js'))
  for (const copies of [undefined, null, 0, 1, 3, -1, 1.5, 100, 101, '1', '3', [], {}, false]) {
    let error, responded = false
    await controller.reprintBarcode({ body: { category: 'inbound', recordId: 11, copies }, user: { userId: 7 }, headers: { 'x-request-key': 'same-original-key' } },
      { status() { return this }, json() { responded = true } }, e => { error = e })
    assert.equal(error?.statusCode, 400, 'explicit copies=' + String(copies))
    assert.equal(error?.code, 'PRINT_REPRINT_COPIES_UNSUPPORTED')
    assert.match(error.message, /不支持.*份数/)
    assert.equal(responded, false, 'unsupported field must not produce a success response')
    assert.equal(delegated, 0, 'reject before source lookup, intent or queue creation')
  }
})

test('business barcode reprint omitted copies keeps legacy body and original intent key for all categories', async () => {
  const calls = [], result = { queued: true, id: 31, requestId: 71 }
  const controller = loader(new Map([[path.join(printDir, 'print-jobs.service.js'), {
    reprintBarcodeRecord: async input => { calls.push(input); return result },
  }]]))(path.join(printDir, 'print-jobs.controller.js'))
  for (const category of ['inbound', 'outbound', 'logistics']) {
    let response, status
    const body = { category, recordId: 11, recovery: true }
    await controller.reprintBarcode({ body, user: { userId: 7, warehouseIds: [4] }, headers: { 'x-request-key': 'same-original-key' } },
      { status(v) { status = v; return this }, json(v) { response = v } }, e => { throw e })
    assert.equal(status, 200); assert.deepEqual(response.data, result)
    assert.deepEqual(calls.at(-1), { category, recordId: 11, recovery: true, scopeWarehouseIds: [4], createdBy: 7, requestKey: 'same-original-key' })
    assert.deepEqual(body, { category, recordId: 11, recovery: true }, 'do not normalize or extend the old fingerprint body')
  }
})

test('generic queue retains numeric1..100 copies independently of the business reprint restriction', async () => {
  const f = fixture()
  for (const copies of [1, 3, 100]) {
    const result = await f.command.createWithinTransaction(f.conn, { ...args, copies, jobUniqueKey: 'generic-copies-' + copies })
    assert.equal(result.requestedCopies, copies)
  }
  const { copies: ignored, ...withoutCopies } = args
  const omitted = await f.command.createWithinTransaction(f.conn, { ...withoutCopies, jobUniqueKey: 'generic-default' })
  assert.equal(omitted.requestedCopies, 1)
  const count = f.state.jobs.size
  for (const copies of [0, -1, 1.5, 101, null, '3']) {
    await assert.rejects(f.command.createWithinTransaction(f.conn, { ...args, copies, jobUniqueKey: 'invalid-' + copies }), { statusCode: 400 })
    assert.equal(f.state.jobs.size, count)
  }
})
