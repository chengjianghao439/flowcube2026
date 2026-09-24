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
      // 2026-09-14：没有面单机绑定时不再静默丢弃，而是留一条「无打印机」记录
      // （打印记录页可见、绑定后可补打）；关键不变量仍是**不回退**到普通标签机。
      const noBinding = await labels.enqueueWaybillLabelJob(payload)
      assert.equal(noBinding.printerId, null)
      assert.equal(noBinding.unprintable, true)
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
        // 2026-09-14：无设备仓不再静默丢弃，而是留一条「无打印机」记录；
        // 关键不变量是不能跨仓兜底到别的仓的打印机。
        const noDevice = await labels.enqueueContainerLabelJob({ ...payload, warehouseId: other.insertId })
        assert.equal(noDevice.printerId, null)
        assert.equal(noDevice.unprintable, true)
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

    // 2026-09-14：补打中心不该给「从未进过打印队列」的塑料盒凭空造任务。
    // 塑料盒（container_type=2 / B 码）的条码由现场人工处理，只有真的打过任务的
    // （PDA 拆分勾选「打印新塑料盒条码」那种）才保留补打入口。
    const inboundQuery = require('../backend/src/modules/print-jobs/print-jobs.query')
    const fixtureIds = []
    const packageIds = []
    const taskIds = []
    const inboundList = async () => {
      const res = await inboundQuery.findBarcodeRecords({ category: 'inbound', pageSize: 200 })
      return (res.list ?? []).filter(r => fixtureIds.includes(r.recordId))
    }
    const addContainer = async (barcode, containerType, sourceRefType = null, warehouseId = ctx.warehouse.id) => {
      const [r] = await pool.query(
        'INSERT INTO inventory_containers (barcode,container_type,product_id,warehouse_id,status,initial_qty,remaining_qty,source_type,source_ref_type,is_legacy) VALUES (?,?,?,?,1,0,0,?,?,0)',
        [barcode, containerType, ctx.product.id, warehouseId, sourceRefType ? 'container_split' : 'manual', sourceRefType],
      )
      fixtureIds.push(r.insertId)
      return r.insertId
    }
    const addJob = async (containerId, barcode) => {
      const [r] = await pool.query(
        "INSERT INTO print_jobs (printer_id,title,content_type,content,copies,priority,job_type,job_unique_key,ref_type,ref_id,ref_code,status) VALUES (?,?,'zpl','^XA^XZ',1,0,'container_label',?,'inventory_container',?,?,2)",
        [p.insertId, 'sut', `sut:${barcode}`, containerId, barcode],
      )
      return r.insertId
    }
    // 2026-09-14 用户决定：补打中心 = 打印记录，只列**真的生成过打印任务**的对象。
    // 从未打印过的容器（含塑料盒）不再出现，其打印入口在业务单据本身（收货订单详情补打）。
    await check('补打中心=唯一码的打印记录：空盒不进，散货/库存条码要有记录才进', async () => {
      // 可复用空盒（塑料盒自身的码）：即使打过标签也不进（非唯一码）
      const reusable = await addContainer(`BP${code}`, 2, 'plastic_box_create')
      await addJob(reusable, `BP${code}`)
      // 拆分产生的散货（同为 B 码，但每次新建、唯一）：有打印记录就该进
      const splitBox = await addContainer(`BS${code}`, 2, 'container_split')
      await addJob(splitBox, `BS${code}`)
      const boxNever = await addContainer(`BT${code}`, 2, 'container_split')
      const invNever = await addContainer(`IT${code}`, 1)
      const invWithJob = await addContainer(`IJ${code}`, 1)
      await addJob(invWithJob, `IJ${code}`)
      const ids = (await inboundList()).map(r => r.recordId)
      assert.ok(!ids.includes(reusable), '可复用空盒（非唯一码）即使有打印记录也不应出现')
      assert.ok(!ids.includes(boxNever), '从未打印过的散货不应出现')
      assert.ok(!ids.includes(invNever), '从未打印过的库存容器不应出现（补打中心=打印记录）')
      assert.ok(ids.includes(splitBox), '有打印记录的拆分散货应保留（唯一码）')
      assert.ok(ids.includes(invWithJob), '有打印记录的库存容器应保留')
    })
    await check('补打接口只接受有打印记录的对象', async () => {
      const boxNever = await addContainer(`BX${code}`, 2, 'container_split')
      const reusable = await addContainer(`BZ${code}`, 2, 'plastic_box_create')
      await addJob(reusable, `BZ${code}`)
      const invNever = await addContainer(`IX${code}`, 1)
      const invWithJob = await addContainer(`IY${code}`, 1)
      await addJob(invWithJob, `IY${code}`)
      for (const id of [boxNever, invNever]) {
        await assert.rejects(
          () => labels.reprintBarcodeRecord({ category: 'inbound', recordId: id, createdBy: null }),
          (e) => e.code === 'PRINT_BARCODE_NO_PRINT_RECORD',
        )
      }
      // 非唯一码（可复用空盒）即使有打印记录也从这里拒绝，指向塑料盒功能
      await assert.rejects(
        () => labels.reprintBarcodeRecord({ category: 'inbound', recordId: reusable, createdBy: null }),
        (e) => e.code === 'PRINT_BARCODE_NOT_UNIQUE',
      )
      assert.ok((await labels.reprintBarcodeRecord({ category: 'inbound', recordId: invWithJob, createdBy: null }))?.id, '有打印记录的容器应能补打')
    })
    await check('可复用空盒不进打印记录，但在「塑料盒」功能里可重复打印', async () => {
      const box = await addContainer(`BH${code}`, 2, 'plastic_box_create')
      const boxSvc = require('../backend/src/modules/plastic-boxes/plastic-boxes.service')
      const job = await boxSvc.printLabel(box, { userId: null, scopeWarehouseIds: null })
      assert.ok(job?.id, '塑料盒页面重打应生成打印任务')
      const ids = (await inboundList()).map(r => r.recordId)
      assert.ok(!ids.includes(box), '即使这次打印产生了任务，可复用空盒也不应出现在打印记录页')
    })
    // 2026-09-14 用户决定（方案 A）：没有可用打印机时也要留打印记录，
    // 对象因此出现在打印记录页，绑定打印机后可以从那里补打。
    await check('没有可用打印机时也留打印记录，对象因此可被找到', async () => {
      const [npWh] = await pool.query('INSERT INTO inventory_warehouses (name,code) VALUES (?,?)', ['无标签机仓', `${code}-NP`])
      try {
        const cid = await addContainer(`IP${code}`, 1, null, npWh.insertId)
        const job = await labels.enqueueContainerLabelJob({
          containerId: cid,
          warehouseId: npWh.insertId,
          data: { container_code: `IP${code}`, product_name: '测试', qty: 1 },
          createdBy: null,
          jobUniqueKey: `sut-noprinter:${code}`,
        })
        assert.equal(job.printerId, null, '没有可用打印机时不应绑定打印机')
        assert.equal(job.unprintable, true, '应标记为只留记录')
        const ids = (await inboundList()).map(r => r.recordId)
        assert.ok(ids.includes(cid), '有打印记录的容器（即使没打成）应出现在打印记录页')
      } finally {
        await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [npWh.insertId])
      }
    })
    await check('出库箱贴同样只列有打印记录的对象', async () => {
      const [wt] = await pool.query(
        'INSERT INTO warehouse_tasks (task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name) VALUES (?,0,?,?,?,?,?)',
        [`SUT${code}`, `SO${code}`, ctx.customer.id, ctx.customer.name, ctx.warehouse.id, ctx.warehouse.name],
      )
      taskIds.push(wt.insertId)
      const makePkg = async (barcode) => {
        const [r] = await pool.query('INSERT INTO packages (barcode,warehouse_task_id,status) VALUES (?,?,1)', [barcode, wt.insertId])
        packageIds.push(r.insertId)
        return r.insertId
      }
      const never = await makePkg(`LB${code}`)
      const withJob = await makePkg(`LJ${code}`)
      await pool.query(
        "INSERT INTO print_jobs (printer_id,title,content_type,content,copies,priority,job_type,job_unique_key,ref_type,ref_id,ref_code,status) VALUES (?,?,'zpl','^XA^XZ',1,0,'package_label',?,'package',?,?,2)",
        [p.insertId, 'sut', `sut-pkg:${code}`, withJob, `LJ${code}`],
      )
      const listed = await inboundQuery.findBarcodeRecords({ category: 'outbound', pageSize: 200 })
      const ids = (listed.list ?? []).filter(r => packageIds.includes(r.recordId)).map(r => r.recordId)
      assert.ok(!ids.includes(never), '从未打印过的箱贴不应出现')
      assert.ok(ids.includes(withJob), '有打印记录的箱贴应保留')
      // 出库计数查询原先把最新任务子查询别名写成 j，而状态条件按 pj 拼——一带状态筛选就报
      // Unknown column 'pj.status'。这里同时钉住别名已统一。
      const filtered = await inboundQuery.findBarcodeRecords({ category: 'outbound', status: 'success', pageSize: 200 })
      assert.ok((filtered.list ?? []).some(r => r.recordId === withJob), '出库带状态筛选应能正常查询并命中已打印记录')
      await assert.rejects(
        () => labels.reprintBarcodeRecord({ category: 'outbound', recordId: never, createdBy: null }),
        (e) => e.code === 'PRINT_BARCODE_NO_PRINT_RECORD',
      )
    })
    await check('三类打印记录 HTTP 筛选与计数区分未配置、TTL、失联和普通失败', async () => {
      const [task] = await pool.query(
        'INSERT INTO warehouse_tasks (task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name) VALUES (?,0,?,?,?,?,?)',
        [`STAT${code}`, `SO${code}`, ctx.customer.id, ctx.customer.name, ctx.warehouse.id, ctx.warehouse.name],
      )
      let containerId, packageId
      const jobIds = []
      try {
        const barcode = `STAT${code}`
        containerId = await addContainer(barcode, 1)
        const [pkg] = await pool.query('INSERT INTO packages (barcode,warehouse_task_id,status) VALUES (?,?,1)', [barcode, task.insertId])
        packageId = pkg.insertId
        for (const [category, refType, refId] of [['inbound', 'inventory_container', containerId], ['outbound', 'package', packageId], ['logistics', 'waybill', task.insertId]]) {
          const [job] = await pool.query(
            "INSERT INTO print_jobs (printer_id,warehouse_id,title,content_type,content,job_type,ref_type,ref_id,ref_code,status,error_message) VALUES (NULL,?,?,'zpl','^XA^XZ',?,?,?, ?,3,'no printer available')",
            [ctx.warehouse.id, barcode, category === 'logistics' ? 'waybill' : 'container_label', refType, refId, barcode],
          )
          jobIds.push(job.insertId)
          const samples = [
            { printerId: null, error: 'no printer available', status: 'unassigned' },
            { printerId: p.insertId, error: 'no printer available', status: 'timeout' },
            { printerId: p.insertId, error: 'print client went offline', status: 'timeout' },
            { printerId: null, error: 'label render failed: LABEL_RENDER_INVALID', status: 'failed' },
          ]
          for (const sample of samples) {
            await pool.query('UPDATE print_jobs SET printer_id=?,error_message=? WHERE id=?', [sample.printerId, sample.error, job.insertId])
            for (const status of ['unassigned', 'timeout', 'failed']) {
              const response = await http.get(`/api/print-jobs/barcodes?category=${category}&keyword=${encodeURIComponent(barcode)}&status=${status}`, { token })
              assert.equal(response.status, 200)
              const result = response.data.data
              const expectedCount = sample.status === status ? 1 : 0
              assert.equal(result.list.length, expectedCount, `${category}/${sample.error}/${status}: list`)
              assert.equal(Number(result.pagination.total), expectedCount, `${category}/${sample.error}/${status}: count`)
              if (expectedCount) assert.equal(result.list[0].latestJob.statusKey, status, `${category}: derived state agrees with SQL`)
            }
          }
        }
      } finally {
        if (jobIds.length) {
          await pool.query('DELETE FROM print_jobs WHERE id IN (?)', [jobIds])
          const [[{ remaining }]] = await pool.query('SELECT COUNT(*) AS remaining FROM print_jobs WHERE id IN (?)', [jobIds])
          assert.equal(Number(remaining), 0)
        }
        if (containerId) await pool.query('DELETE FROM inventory_containers WHERE id=?', [containerId])
        if (packageId) await pool.query('DELETE FROM packages WHERE id=?', [packageId])
        await pool.query('DELETE FROM warehouse_tasks WHERE id=?', [task.insertId])
      }
    })
    await pool.query('DELETE FROM print_jobs WHERE ref_type=? AND ref_id IN (?)', ['inventory_container', fixtureIds])
    await pool.query('DELETE FROM inventory_containers WHERE id IN (?)', [fixtureIds])
    if (packageIds.length) {
      await pool.query("DELETE FROM print_jobs WHERE ref_type='package' AND ref_id IN (?)", [packageIds])
      await pool.query('DELETE FROM packages WHERE id IN (?)', [packageIds])
    }
    if (taskIds.length) await pool.query('DELETE FROM warehouse_tasks WHERE id IN (?)', [taskIds])
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
