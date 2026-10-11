'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// Only the caller's live owned fixture can reach these synthetic writes.
async function runPrintCases(c, test, { packedSale }) {
  const key = () => `reprint-v2-${Date.now()}-${crypto.randomUUID()}`
  const jobs = (type, id) => c.rows('SELECT id,request_purpose,created_by,created_by_name,source_print_job_id,copies,dispatch_reason,status,acknowledged_at,error_message FROM print_jobs WHERE ref_type=? AND ref_id=? ORDER BY id', [type, id])
  const record = async (category, barcode) => {
    const list = await c.ok('GET', `/print-jobs/barcodes?category=${category}&keyword=${encodeURIComponent(barcode)}`)
    const row = list.list.find(value => value.barcode === barcode)
    assert.ok(row, '真实打印查询必须返回当前对象')
    return row
  }
  const metadata = (job, purpose) => {
    assert.equal(job.request_purpose, purpose)
    assert.equal(Number(job.created_by), c.userId)
    assert.equal(job.created_by_name, c.mark)
    assert.equal(Number(job.copies), 1)
  }
  await test('打印元数据迁移：重复执行、列序与未知形状拒绝', async () => {
    const { splitSqlStatements } = c.req('backend/src/database/sqlStatements')
    const parts = splitSqlStatements(fs.readFileSync(path.join(__dirname, '../../backend/src/database/287_print_request_metadata.sql'), 'utf8'))
    const conn = await c.pool.getConnection()
    const apply = async () => { for (const part of parts) await conn.query(part) }
    try {
      await apply(); await apply()
      await conn.query('ALTER TABLE print_jobs MODIFY COLUMN request_purpose VARCHAR(17) DEFAULT NULL')
      try { await assert.rejects(apply, { code: 'ER_NO_SUCH_TABLE' }) }
      finally { await conn.query('ALTER TABLE print_jobs MODIFY COLUMN request_purpose VARCHAR(16) DEFAULT NULL') }
      await apply()
      const [columns] = await conn.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND COLUMN_NAME IN ('request_purpose','created_by_name','source_print_job_id') ORDER BY COLUMN_NAME")
      assert.equal(columns.length, 3)
      assert.ok(columns.every(column => column.IS_NULLABLE === 'YES' && column.COLUMN_DEFAULT === null))
      const [index] = await conn.query("SELECT COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_jobs' AND INDEX_NAME='idx_print_jobs_source_print_job' ORDER BY SEQ_IN_INDEX")
      assert.deepEqual(index.map(row => row.COLUMN_NAME), ['source_print_job_id'])
      return { repeated: 2, rejectedDrift: true, columns, index }
    } finally { conn.release() }
  })
  const sample = await c.receive('PRINT-META')
  c.guiBarcode = sample.barcode
  await test('自动收货初打与中心并发补打：目的独立、回放一次、库存账款不变', async () => {
    const original = await jobs('inventory_container', sample.containerId)
    assert.equal(original.length, 1); metadata(original[0], 'initial')
    const facts = async () => ({ container: await c.one('SELECT remaining_qty,status,warehouse_id,locked_by_task_id FROM inventory_containers WHERE id=?', [sample.containerId]), payable: await c.rows('SELECT id,total_amount,paid_amount FROM payment_records WHERE type=1 AND order_id=? ORDER BY id', [sample.poId]) })
    const before = await facts(), requestKey = key(), body = { category: 'inbound', recordId: sample.containerId }
    const pair = await Promise.all([c.ok('POST', '/print-jobs/barcodes/reprint', body, { key: requestKey }), c.ok('POST', '/print-jobs/barcodes/reprint', body, { key: requestKey })])
    assert.deepEqual(pair[0], pair[1])
    assert.deepEqual(await c.ok('POST', '/print-jobs/barcodes/reprint', body, { key: requestKey }), pair[0])
    const rows = await jobs('inventory_container', sample.containerId)
    assert.equal(rows.length, 2); metadata(rows[1], 'reprint')
    assert.equal(rows[1].source_print_job_id, null, '重新渲染不是克隆某个旧任务')
    assert.deepEqual(await facts(), before)
    const current = (await record('inbound', sample.barcode)).latestJob
    assert.equal(current.requestPurpose, 'reprint'); assert.equal(current.createdById, c.userId); assert.equal(current.createdByName, c.mark)
    assert.equal(current.requestedCopies, 1); assert.equal(current.acknowledgedAt, null)
    assert.ok(!/"(?:ackToken|ack_token|content|credential|requestFingerprint)"/.test(JSON.stringify(current)))
    return { initial: original[0], latest: current, concurrentReplayOnce: true, factsUnchanged: true }
  })
  await test('详情三种原补打意图：task、item、barcode目的一致且原键回放', async () => {
    const item = await c.one('SELECT id FROM inbound_task_items WHERE task_id=?', [sample.taskId])
    const outcomes = []
    for (const body of [{ mode: 'task' }, { mode: 'item', itemId: item.id }, { mode: 'barcode', barcode: sample.barcode }]) {
      const before = (await jobs('inventory_container', sample.containerId)).length, requestKey = key()
      const first = await c.ok('POST', `/inbound-tasks/${sample.taskId}/reprint`, body, { key: requestKey })
      assert.deepEqual(await c.ok('POST', `/inbound-tasks/${sample.taskId}/reprint`, body, { key: requestKey }), first)
      const rows = await jobs('inventory_container', sample.containerId)
      assert.equal(rows.length, before + 1); metadata(rows.at(-1), 'reprint')
      outcomes.push({ mode: body.mode, jobId: rows.at(-1).id })
    }
    return outcomes
  })
  await test('渲染失败与无设备仍保留真实初打/补打目的，回放不重建', async () => {
    const outcomes = []
    c.renderFail = true
    try {
      const failed = await c.receive('PRINT-RENDER')
      const rows = await jobs('inventory_container', failed.containerId)
      metadata(rows[0], 'initial'); assert.equal(Number(rows[0].status), 3)
      const requestKey = key(), body = { category: 'inbound', recordId: failed.containerId }
      const first = await c.ok('POST', '/print-jobs/barcodes/reprint', body, { key: requestKey })
      assert.equal(first.queued, false)
      assert.deepEqual(await c.ok('POST', '/print-jobs/barcodes/reprint', body, { key: requestKey }), first)
      const after = await jobs('inventory_container', failed.containerId)
      assert.equal(after.length, 2); metadata(after.at(-1), 'reprint'); assert.match(after.at(-1).error_message, /LABEL_RENDER_FAILED/)
      outcomes.push({ kind: 'render', initial: rows[0], reprint: after.at(-1) })
    } finally { c.renderFail = false }
    await c.pool.query('UPDATE printers SET status=0 WHERE id=?', [c.printerId])
    try {
      const missing = await c.receive('PRINT-NOPRINTER')
      const rows = await jobs('inventory_container', missing.containerId)
      metadata(rows[0], 'initial'); assert.equal(Number(rows[0].status), 3)
      const first = await c.ok('POST', '/print-jobs/barcodes/reprint', { category: 'inbound', recordId: missing.containerId }, { key: key() })
      assert.equal(first.queued, false)
      const after = await jobs('inventory_container', missing.containerId)
      metadata(after.at(-1), 'reprint'); assert.equal(Number(after.at(-1).status), 3)
      outcomes.push({ kind: 'no_printer', initial: rows[0], reprint: after.at(-1) })
    } finally { await c.pool.query('UPDATE printers SET status=1 WHERE id=?', [c.printerId]) }
    return outcomes
  })
  await test('历史未知与实际请求人快照：不借派机原因、账号改名不改记录', async () => {
    const latest = (await jobs('inventory_container', sample.containerId)).at(-1)
    await c.pool.query('UPDATE sys_users SET real_name=? WHERE id=?', [c.mark + '-renamed', c.userId])
    try { assert.equal((await record('inbound', sample.barcode)).latestJob.createdByName, c.mark) }
    finally { await c.pool.query('UPDATE sys_users SET real_name=? WHERE id=?', [c.mark, c.userId]) }
    const legacy = await c.receive('PRINT-LEGACY'), old = (await jobs('inventory_container', legacy.containerId))[0]
    await c.pool.query("UPDATE print_jobs SET request_purpose=NULL,created_by_name=NULL,dispatch_reason='manual_reprint' WHERE id=?", [old.id])
    const current = (await record('inbound', legacy.barcode)).latestJob
    assert.equal(current.requestPurpose, null); assert.equal(current.createdByName, null)
    assert.equal(current.dispatchReason, 'manual_reprint')
    return { snapshotJobId: latest.id, legacy: current, inferredPurpose: false }
  })
  await test('真实客户端领取及回报：请求份数保留，目的与快照不变', async () => {
    const latest = (await jobs('inventory_container', sample.containerId)).at(-1)
    // Limit only this synthetic client's unconsumed jobs, so the real claim can
    // reliably select the target without inventing a client acknowledgement.
    await c.pool.query('UPDATE print_jobs SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE printer_id=? AND status=0 AND id<>?', [c.printerId, latest.id])
    const dispatch = c.req('backend/src/modules/print-jobs/print-jobs.dispatch')
    const claimed = (await dispatch.claimClientJobs({ identity: c.printClient.identity, limit: 10 })).find(job => Number(job.id) === Number(latest.id))
    assert.ok(claimed)
    const wrong = await c.request('POST', `/print-jobs/${latest.id}/complete-client`, { ackToken: claimed.ackToken })
    assert.equal(wrong.status, 401, '没有认证工作站不能冒充完成')
    await c.ok('POST', `/print-jobs/${latest.id}/complete-client`, { ackToken: claimed.ackToken }, { headers: c.printClient.headers })
    const current = (await record('inbound', sample.barcode)).latestJob
    assert.equal(current.status, 2); assert.ok(current.acknowledgedAt)
    assert.equal(current.requestPurpose, 'reprint'); assert.equal(current.requestedCopies, 1); assert.equal(current.createdByName, c.mark)
    return { latest: current, acknowledgement: '认证客户端回报；未证明物理出纸', unauthenticatedStatus: wrong.status }
  })
  await test('出库补打与面单克隆：真实来源和多份请求分别可查', async () => {
    const packed = await packedSale('PRINT-OUTBOUND')
    const original = await jobs('package', packed.packageId)
    assert.ok(original.length); metadata(original.at(-1), 'initial')
    const out = await c.ok('POST', '/print-jobs/barcodes/reprint', { category: 'outbound', recordId: packed.packageId }, { key: key() })
    const packageRow = (await jobs('package', packed.packageId)).at(-1)
    metadata(packageRow, 'reprint')
    const packageBarcode = (await c.one('SELECT barcode FROM packages WHERE id=?', [packed.packageId])).barcode
    assert.equal((await record('outbound', packageBarcode)).latestJob.requestPurpose, 'reprint')
    const source = await c.insert("INSERT INTO print_jobs(printer_id,warehouse_id,job_unique_key,job_type,content_type,title,content,copies,status,ref_code) VALUES (?,?,?,'waybill','zpl','SYNTHETIC WAYBILL','^XA^FDTEST-ONLY^FS^XZ',3,2,?)", [c.printerId, c.a.id, key(), c.mark + '-WAYBILL'])
    const body = { category: 'logistics', recordId: source }, requestKey = key()
    const clone = await c.ok('POST', '/print-jobs/barcodes/reprint', body, { key: requestKey })
    assert.deepEqual(await c.ok('POST', '/print-jobs/barcodes/reprint', body, { key: requestKey }), clone)
    const job = await c.one('SELECT request_purpose,source_print_job_id,copies,created_by_name FROM print_jobs WHERE id=?', [clone.id || clone.jobId])
    assert.equal(job.request_purpose, 'reprint'); assert.equal(Number(job.source_print_job_id), source); assert.equal(Number(job.copies), 3); assert.equal(job.created_by_name, c.mark)
    const current = (await record('logistics', c.mark + '-WAYBILL')).latestJob
    assert.equal(current.requestPurpose, 'reprint'); assert.equal(current.sourcePrintJobId, source); assert.equal(current.requestedCopies, 3)
    return { packageJobId: out.id || out.jobId, sourceJobId: source, clone: current }
  })
}
module.exports = { runPrintCases }
