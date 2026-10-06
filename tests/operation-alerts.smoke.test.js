'use strict'

// Real current-schema SQL only. No app, scheduler, webhook, printer or business
// worker is started. Random owned rows remain in one transaction and roll back.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
const { buildOperationAlerts } = require('../backend/src/modules/notifications/operation-alerts.service')

test('作业异常真实SQL使用现行仓库表，只返回当前异常metadata', async () => {
  configureTestEnvironment()
  const config = validateTestEnvironment()
  const mysql = require('../backend/node_modules/mysql2/promise')
  const conn = await mysql.createConnection({ ...config, timezone: '+08:00', dateStrings: true, connectTimeout: 10000 })
  let transaction = false
  const mark = `OA${randomBytes(6).toString('hex')}`
  const expected = new Map()
  let sequence = 0
  const insert = async (sql, params) => Number((await conn.query(sql, params))[0].insertId)
  try {
    const [[target]] = await conn.query('SELECT DATABASE() AS databaseName')
    assert.equal(target.databaseName, config.database)
    const [[table]] = await conn.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='inventory_warehouses'")
    assert.equal(Number(table.count), 1, 'runner必须先执行当前全部迁移')
    await conn.beginTransaction(); transaction = true
    const warehouseName = `合成作业仓-${mark}`
    const warehouseId = await insert('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [mark, warehouseName])

    async function task(status, minutes, { cancel = false, adjustment = false, deleted = false } = {}) {
      const taskNo = `${mark}T${++sequence}`
      const id = await insert(`INSERT INTO warehouse_tasks
        (task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,task_type,status,
         updated_at,cancel_requested_at,adjustment_requested_at,deleted_at)
        VALUES (?,NULL,'',0,'合成客户',?,?,'sale_out',?,DATE_SUB(NOW(),INTERVAL ? MINUTE),
                IF(?,NOW(),NULL),IF(?,NOW(),NULL),IF(?,NOW(),NULL))`,
      [taskNo, warehouseId, warehouseName, status, minutes, cancel, adjustment, deleted])
      return { id, taskNo }
    }
    async function printCase({ jobStatus = 3, minutes = 20, taskStatus = 5, packageStatus = 2, replaced = false, ...flags } = {}) {
      const t = await task(taskStatus, minutes, flags)
      const barcode = `${mark}B${sequence}`
      const packageId = await insert('INSERT INTO packages (barcode,warehouse_task_id,status) VALUES (?,?,?)', [barcode, t.id, packageStatus])
      const job = status => insert(`INSERT INTO print_jobs (printer_id,title,content_type,content,status,warehouse_id,ref_type,ref_id,updated_at)
        VALUES (NULL,?,'zpl','^XA^FDsynthetic^FS^XZ',?,?,'package',?,DATE_SUB(NOW(),INTERVAL ? MINUTE))`,
      [mark, status, warehouseId, packageId, minutes])
      const id = await job(jobStatus)
      if (replaced) await job(2)
      return { id, taskNo: t.taskNo, barcode }
    }
    const failed = await printCase()
    expected.set(`print:${failed.id}`, { documentNo: failed.taskNo, barcode: failed.barcode, title: '出库打印失败' })
    for (const jobStatus of [0, 1]) {
      const pending = await printCase({ jobStatus, taskStatus: 6, minutes: 11 })
      expected.set(`print:${pending.id}`, { documentNo: pending.taskNo, barcode: pending.barcode, title: '出库打印排队超时' })
    }
    for (const options of [{ replaced: true }, { jobStatus: 2 }, { jobStatus: 0, minutes: 2 }, { taskStatus: 7 },
      { cancel: true }, { adjustment: true }, { deleted: true }, { packageStatus: 3 }]) await printCase(options)

    async function waveCase({ status = 2, taskStatus = 2, minutes = 600, recentScan = false, cancel = false, adjustment = false } = {}) {
      const t = await task(taskStatus, minutes, { cancel, adjustment })
      const waveNo = `${mark}W${sequence}`
      const id = await insert('INSERT INTO picking_waves (wave_no,warehouse_id,status,updated_at) VALUES (?,?,?,DATE_SUB(NOW(),INTERVAL ? MINUTE))', [waveNo, warehouseId, status, minutes])
      await conn.query('INSERT INTO picking_wave_tasks (wave_id,task_id) VALUES (?,?)', [id, t.id])
      if (recentScan) await conn.query(`INSERT INTO scan_logs
        (task_id,item_id,container_id,barcode,product_id,qty,scan_mode,scanned_at)
        VALUES (?,0,0,?,0,1,'whole',NOW())`, [t.id, `${mark}S${sequence}`])
      return { id, waveNo }
    }
    const picking = await waveCase()
    expected.set(`wave:${picking.id}`, { documentNo: picking.waveNo, title: '拣货波次停滞' })
    const sorting = await waveCase({ status: 3, taskStatus: 3, minutes: 300 })
    expected.set(`wave:${sorting.id}`, { documentNo: sorting.waveNo, title: '分拣波次超时' })
    for (const options of [{ recentScan: true }, { status: 3, taskStatus: 4 }, { status: 4 }, { cancel: true },
      { adjustment: true }, { minutes: 120 }]) await waveCase(options)

    let queries = 0
    const results = await buildOperationAlerts({ query: async (sql, params) => {
      queries++
      assert.doesNotMatch(sql, /\bj\.\*|\bcontent\b/i, '作业扫描不得读取打印正文')
      return conn.query(sql, params)
    } }, { printTimeoutMinutes: 10 })
    assert.equal(queries, 2)
    const owned = results.filter(item => item.documentNo.startsWith(mark))
    assert.deepEqual(owned.map(item => item.key).sort(), [...expected.keys()].sort())
    for (const item of owned) {
      const wanted = expected.get(item.key)
      for (const [key, value] of Object.entries(wanted)) assert.equal(item[key], value)
      assert.equal(item.warehouse, warehouseName)
      assert.ok(item.minutes >= (item.kind === 'print' ? 10 : 240))
      assert.equal(Object.hasOwn(item, 'content'), false)
    }
    console.log('[OPERATION-ALERTS] real SQL: latest print failure/timeout and wave idle; terminal, suspended, replaced and recent-scan exclusions passed')
  } finally {
    try { if (transaction) await conn.rollback() } finally { await conn.end() }
  }
})
