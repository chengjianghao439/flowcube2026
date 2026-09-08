'use strict'

// 只在显式回环独立测试库验证队列；虚拟打印机没有任何真实消费客户端。
const assert = require('node:assert/strict')
const { prepareSmokeContext, login, randomRef } = require('./helpers/smokeTestKit')
const command = require('../backend/src/modules/print-jobs/print-jobs.command')
const dispatch = require('../backend/src/modules/print-jobs/print-jobs.dispatch')
const labels = require('../backend/src/modules/print-jobs/print-jobs.label-command')
const { pool: appPool } = require('../backend/src/config/db')

async function main() {
  const ctx = await prepareSmokeContext()
  const { pool, http } = ctx
  let failed = 0
  let passed = 0
  const check = async (title, fn) => {
    try { await fn(); passed++; console.log(`[PASS] ${title}`) }
    catch (e) { failed++; console.error(`[FAIL] ${title}: ${e.message}`) }
  }
  const code = randomRef('PRINT-Q')
  const clientId = `test-${code}`
  const originalEnvCode = process.env.INBOUND_LABEL_PRINTER_CODE
  const printerIds = []
  let warehouseId
  const [[smokePrinter]] = await pool.query('SELECT warehouse_id FROM printers WHERE id=?', [ctx.printer.id])
  try {
    await pool.query('UPDATE printers SET warehouse_id=? WHERE id=?', [ctx.warehouse.id, ctx.printer.id])
    const [w] = await pool.query('INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)', ['打印队列专用仓', code])
    warehouseId = w.insertId
    const [p] = await pool.query('INSERT INTO printers (name,code,type,warehouse_id,client_id,status) VALUES (?,?,1,?,?,1)', ['虚拟标签机', code, warehouseId, clientId])
    printerIds.push(p.insertId)
    await pool.query('INSERT INTO print_clients (client_id,hostname,status,last_seen) VALUES (?,?,1,NOW())', [clientId, 'test-only'])
    const { token } = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    assert.ok(token, '测试账号应登录成功')
    const post = (route, json) => http.post(route, { token, headers: { 'X-Client-Id': clientId }, json })
    const createJob = (extra = {}) => command.create({ printerId: p.insertId, warehouseId, jobType: 'product_label', title: '队列测试', contentType: 'zpl', content: '^XA^FDTEST^FS^XZ', ...extra })
    const claim = () => dispatch.claimClientJobs({ clientId, limit: 10 })
    const state = async id => (await pool.query('SELECT status,ack_token FROM print_jobs WHERE id=?', [id]))[0][0]

    await check('缺少本次令牌的失败回执拒绝，正确令牌可失败并重试', async () => {
      const job = await createJob(); const a = (await claim()).find(j => j.id === job.id)
      const missing = await post(`/api/print-jobs/${job.id}/fail-client`, { errorMessage: 'missing token' })
      assert.equal(missing.status, 400)
      assert.equal((await state(job.id)).status, 1)
      assert.equal((await post(`/api/print-jobs/${job.id}/fail-client`, { ackToken: a.ackToken, errorMessage: 'failed A' })).status, 200)
      assert.equal((await post(`/api/print-jobs/${job.id}/retry`, {})).status, 200)
    })

    await check('旧失败回执不得覆盖新领取，新令牌仍可完成', async () => {
      const job = await createJob(); const a = (await claim()).find(j => j.id === job.id)
      assert.equal((await post(`/api/print-jobs/${job.id}/fail`, { ackToken: a.ackToken, errorMessage: 'failed A' })).status, 200)
      await command.retry(job.id)
      const b = (await claim()).find(j => j.id === job.id)
      assert.notEqual(a.ackToken, b.ackToken)
      assert.equal((await post(`/api/print-jobs/${job.id}/fail-client`, { ackToken: a.ackToken, errorMessage: 'late A' })).status, 409)
      assert.equal((await state(job.id)).ack_token, b.ackToken)
      assert.equal((await post(`/api/print-jobs/${job.id}/complete-client`, { ackToken: b.ackToken })).status, 200)
      assert.equal((await state(job.id)).status, 2)
      assert.equal((await post(`/api/print-jobs/${job.id}/fail-client`, { ackToken: b.ackToken, errorMessage: 'late B' })).status, 409)
    })

    await check('过期任务不能领取，新任务可领取且过期任务由扫描器处理', async () => {
      const old = await createJob(); const fresh = await createJob()
      await pool.query('UPDATE print_jobs SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=?', [old.id])
      const jobs = await claim()
      assert.ok(!jobs.some(j => j.id === old.id))
      assert.ok(jobs.some(j => j.id === fresh.id))
      await dispatch.expireStaleJobs()
      assert.equal((await state(old.id)).status, 3)
    })

    await check('并发客户端领取不会重复返回同一个任务', async () => {
      const jobs = await Promise.all(Array.from({ length: 4 }, () => createJob()))
      const batches = await Promise.all([claim(), claim()])
      const ids = batches.flat().map(j => j.id)
      assert.equal(ids.length, new Set(ids).size)
      assert.ok(jobs.every(j => ids.includes(j.id)))
    })

    await check('无面单绑定时不回退，专用绑定后可入队', async () => {
      const payload = { waybillId: Date.now(), warehouseId, content: '^XA^FDWAYBILL^FS^XZ' }
      assert.equal(await labels.enqueueWaybillLabelJob(payload), null)
      const [p2] = await pool.query('INSERT INTO printers (name,code,type,warehouse_id,client_id,status) VALUES (?,?,2,?,?,1)', ['虚拟面单机', `${code}-W`, warehouseId, clientId])
      printerIds.push(p2.insertId)
      await pool.query('INSERT INTO printer_bindings (warehouse_id,print_type,printer_id,printer_code) VALUES (?, ?, ?, ?)', [warehouseId, 'waybill', p2.insertId, `${code}-W`])
      assert.equal((await labels.enqueueWaybillLabelJob(payload)).printerId, p2.insertId)
    })

    await check('指定仓无设备时拒绝跨仓环境兜底，同仓容器标签仍可入队', async () => {
      const [other] = await pool.query('INSERT INTO inventory_warehouses (name,code) VALUES (?,?)', ['无设备仓', `${code}-EMPTY`])
      try {
        process.env.INBOUND_LABEL_PRINTER_CODE = code
        const payload = { containerId: Date.now(), data: { container_code: 'C-TEST', product_name: '测试', qty: 1 } }
        assert.equal(await labels.enqueueContainerLabelJob({ ...payload, warehouseId: other.insertId }), null)
        assert.equal((await labels.enqueueContainerLabelJob({ ...payload, warehouseId })).printerId, p.insertId)
      } finally {
        await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [other.insertId])
      }
    })

    await check('入队只接受1–100整数份数，合法份数完整保存', async () => {
      for (const copies of [0, -1, 1.5, 101, '3', 'abc', true, {}, null]) {
        const res = await post('/api/print-jobs', { printerId: p.insertId, title: 'invalid copies', contentType: 'zpl', content: '^XA^XZ', copies })
        assert.equal(res.status, 400, `copies=${JSON.stringify(copies)}`)
      }
      assert.equal((await createJob({ copies: 3 })).copies, 3)
      assert.equal((await createJob({ copies: 100 })).copies, 100)
      assert.equal((await createJob()).copies, 1)
    })

    await check('事务回滚不会留下可领取打印任务', async () => {
      const conn = await pool.getConnection(); let id
      try {
        await conn.beginTransaction()
        const job = await command.createWithinTransaction(conn, { printerId: p.insertId, title: 'rollback', contentType: 'zpl', content: '^XA^XZ' })
        id = job.id; await conn.rollback()
      } finally { conn.release() }
      assert.equal(await state(id), undefined)
    })
  } finally {
    if (originalEnvCode === undefined) delete process.env.INBOUND_LABEL_PRINTER_CODE
    else process.env.INBOUND_LABEL_PRINTER_CODE = originalEnvCode
    if (printerIds.length) {
      await pool.query('DELETE FROM print_jobs WHERE printer_id IN (?)', [printerIds])
      await pool.query('DELETE FROM printer_health_stats WHERE printer_id IN (?)', [printerIds])
      await pool.query('DELETE FROM printer_bindings WHERE printer_id IN (?)', [printerIds])
      await pool.query('DELETE FROM printers WHERE id IN (?)', [printerIds])
    }
    await pool.query('DELETE FROM print_clients WHERE client_id=?', [clientId])
    if (warehouseId) await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [warehouseId])
    await pool.query('UPDATE printers SET warehouse_id=? WHERE id=?', [smokePrinter.warehouse_id, ctx.printer.id])
    await ctx.close(); await appPool.end()
  }
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
