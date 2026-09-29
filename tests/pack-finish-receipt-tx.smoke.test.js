'use strict'

/**
 * 批 C2 · 完成箱子（`finish`）的回执事务边界。
 *
 * 已静态定位的四处边界（本套件钉其中的**可真实复现项**）：
 *  ① controller 用 **pool** 做 `beginResourceOperationRequest`，**先于** service 的范围 / 设备仓校验；
 *  ② service 的 finish 业务在**自己的事务**里 commit，controller 之后才 `completeOperationRequest` ——
 *     两步之间是「业务已提交、回执未落」的窗口；
 *  ③ catch 用 **base action** 调 `failOperationRequest`；
 *  ④ service **commit 之后**才调 `buildFinishedPackagePrintResult(pool, ...)`，它自身失败会让
 *     业务已提交而调用方拿不到结果（回执也不会写）。
 *
 * 本文件用**真实业务 API** 钉住 ① 的可复现形式：**用越权设备票据持原键重放**，
 * 当前会先命中 replay 直接返回原回执（等于重放绕过了范围 / 设备仓校验），正确语义应是 **403**。
 * 其余为**护栏**（修完必须保持）：回执里必须带**本事务内**产生的打印任务信息、
 * 同键重放回原回执、无键旧路径照常、新键对已完成箱走既有捷径。
 *
 * 断言口径：HTTP 状态码 + **数据库事实**。任一项失败即 `process.exitCode = 1`。
 * 只在显式回环独立测试库运行：先断言确切库名 / 回环 / 端口，不符即失败。
 */
const assert = require('node:assert/strict')

const EXPECTED_DB = 'flowcube_plastic_box_20260929_test'
assert.equal(process.env.DB_NAME, EXPECTED_DB, `本批用例只允许在 ${EXPECTED_DB} 运行，实际 ${process.env.DB_NAME}`)
assert.equal(process.env.DB_HOST, '127.0.0.1', '必须走本机回环')
assert.equal(Number(process.env.DB_PORT), 3307, '必须走本机 3307')

const {
  prepareSmokeContext, login, dbQuery, randomRef,
  createPurchaseOrder, confirmPurchaseOrder, createInboundTaskFromPurchase,
} = require('./helpers/smokeTestKit')

async function main() {
  let ctx
  try {
    ctx = await prepareSmokeContext({ requestTimeoutMs: 30000 })
  } catch (e) {
    try { await require('../backend/src/config/db').pool.end() } catch (e2) { console.error(`[FAIL] 初始化失败后关池出错：${e2.message}`) }
    throw e
  }
  const { pool, http, warehouse, location, product, supplier, customer, pdaHeaders, close } = ctx

  let token
  try {
    const authed = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = authed.token
    assert.ok(token, '管理员应登录成功')
  } catch (e) {
    try { await close() } catch (e2) { console.error(`[FAIL] 登录失败后释放出错：${e2.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e2) { console.error(`[FAIL] 登录失败后关池出错：${e2.message}`) }
    throw e
  }

  let passed = 0
  let failed = 0
  const check = async (title, fn) => {
    try { await fn(); passed++; console.log(`[PASS] ${title}`) }
    catch (e) { failed++; console.error(`[FAIL] ${title}\n        ${e.message}`) }
  }

  const key = (p) => `${p}-${randomRef('K')}`

  async function makeWholeContainer(qty) {
    const po = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: qty })
    assert.equal(po.status, 201, `采购单创建失败：${JSON.stringify(po.data).slice(0, 200)}`)
    const poId = po.data.data.id
    assert.equal((await confirmPurchaseOrder(http, token, poId)).status, 200, '采购确认失败')
    const it = await createInboundTaskFromPurchase(http, token, poId)
    assert.equal(it.status, 201, `入库任务创建失败：${JSON.stringify(it.data).slice(0, 200)}`)
    const taskId = it.data.data.taskId ?? it.data.data.id
    assert.equal((await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })).status, 200, '入库提交失败')
    const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
      token, headers: pdaHeaders(), json: { productId: product.id, qty },
    })
    assert.equal(recv.status, 200, `收货失败：${JSON.stringify(recv.data).slice(0, 200)}`)
    const cid = recv.data.data.containerId
    const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
      token, headers: pdaHeaders(), json: { containerId: cid, locationId: location.id },
    })
    assert.equal(put.status, 200, `上架失败：${JSON.stringify(put.data).slice(0, 200)}`)
    return cid
  }

  async function createEmptyBox() {
    const r = await http.post('/api/plastic-boxes', {
      token, json: { productId: product.id, warehouseId: warehouse.id, locationId: location.id },
    })
    assert.equal(r.status, 201, `建盒失败：${JSON.stringify(r.data).slice(0, 200)}`)
    return r.data.data.id
  }

  const fillReq = (boxId, sourceContainerId, k) =>
    http.post(`/api/plastic-boxes/${boxId}/fill`, { token, headers: { 'X-Request-Key': k }, json: { sourceContainerId } })

  const createdSales = []

  async function saleToTask(qty) {
    const sale = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('pb-fin'),
        items: [{
          productId: Number(product.id), productCode: product.code, productName: product.name,
          unit: product.unit, quantity: qty, unitPrice: 10,
        }],
      },
    })
    assert.equal(sale.status, 201, `建销售单失败：${JSON.stringify(sale.data).slice(0, 200)}`)
    const saleId = Number(sale.data.data.id)
    createdSales.push({ saleId, taskId: null })
    assert.equal((await http.post(`/api/sale/${saleId}/reserve`, { token })).status, 200, '占库失败')
    const ship = await http.post(`/api/sale/${saleId}/ship`, { token })
    assert.ok(ship.ok, `发货(生成任务)失败：${JSON.stringify(ship.data).slice(0, 200)}`)
    const [so] = await dbQuery(pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
    const taskId = Number(so.task_id)
    const [wti] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])
    createdSales[createdSales.length - 1].taskId = taskId
    return { saleId, taskId, itemId: Number(wti.id) }
  }

  const createdBins = []
  async function ensureFreeBin() {
    const list = await http.get(`/api/sorting-bins/warehouse/${warehouse.id}`, { token })
    const free = (list.data?.data ?? []).find(b => Number(b.status) === 1)
    if (free) return free
    const code = `RF${String(randomRef('B')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`
    const created = await http.post('/api/sorting-bins', {
      token, json: { code, warehouseId: Number(warehouse.id), remark: 'pb-finish' },
    })
    assert.ok(created.ok, `自建分拣格失败：${JSON.stringify(created.data).slice(0, 200)}`)
    const id = Number(created.data.data.id)
    createdBins.push(id)
    return { id, code, status: 1 }
  }

  /** 真实链造「待打包 + 已装箱」的箱 */
  async function packedBox(qty) {
    await ensureFreeBin()
    const src = await makeWholeContainer(qty)
    const box = await createEmptyBox()
    assert.equal((await fillReq(box, src, key('fill'))).status, 200, '前置：放货失败')
    const boxBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [box]))[0].barcode
    const sale = await saleToTask(qty)
    const picked = await http.post('/api/scan-logs', {
      token, headers: { ...pdaHeaders(), 'X-Request-Key': key('pick') },
      json: { taskId: sale.taskId, itemId: sale.itemId, containerId: box, barcode: boxBarcode, productId: Number(product.id), qty, scanMode: '整件' },
    })
    assert.ok(picked.ok, `前置：扫盒取货失败：${JSON.stringify(picked.data).slice(0, 220)}`)
    const [newI] = await dbQuery(pool,
      "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
      [box])
    assert.ok(newI, '前置：应生成新 I')

    assert.ok((await http.put(`/api/warehouse-tasks/${sale.taskId}/ready`, { token, headers: pdaHeaders() })).ok, '前置：ready 失败')
    const [tk] = await dbQuery(pool, 'SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [sale.taskId])
    const sd = await http.put(`/api/warehouse-tasks/${sale.taskId}/sort-done`, {
      token, headers: { ...pdaHeaders(), 'X-Request-Key': key('sort') },
      json: { items: [{ containerId: Number(newI.id), binCode: tk.sorting_bin_code }] },
    })
    assert.ok(sd.ok, `前置：分拣失败：${JSON.stringify(sd.data).slice(0, 220)}`)

    const locked = await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE locked_by_task_id=?', [sale.taskId])
    for (const c of locked) {
      const cr = await http.post('/api/scan-logs/check', {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('chk') }, json: { taskId: sale.taskId, barcode: c.barcode },
      })
      assert.ok(cr.ok, `前置：复核 ${c.barcode} 失败：${cr.status} ${JSON.stringify(cr.data).slice(0, 200)}`)
    }
    const [tk5] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [sale.taskId])
    assert.equal(Number(tk5.status), 5, '前置：应进入待打包(5)')

    const pkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: sale.taskId } })
    assert.ok(pkg.ok, `前置：建箱失败：${JSON.stringify(pkg.data).slice(0, 220)}`)
    const pkgId = Number(pkg.data.data.id)
    const add = await http.post(`/api/packages/${pkgId}/add-item`, {
      token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add') }, json: { labelBarcode: newI.barcode },
    })
    assert.ok(add.ok, `前置：标签入箱失败：${JSON.stringify(add.data).slice(0, 220)}`)
    return { ...sale, box, newI, pkgId, itemLineId: Number(add.data.data.itemId) }
  }

  const pkgStatusOf = async (pkgId) => Number((await dbQuery(pool, 'SELECT status FROM packages WHERE id=?', [pkgId]))[0].status)

  const finishReq = (pkgId, k, headers) =>
    http.put(`/api/packages/${pkgId}/finish`, {
      token, headers: { ...(headers || pdaHeaders()), ...(k ? { 'X-Request-Key': k } : {}) }, json: {},
    })

  // ── 越权夹具：独立仓库 + 独立设备（**走合法 ERP 接口登记**，收尾合法解绑/停用/软删）──
  const createdDevices = []
  const createdWarehouses = []
  let pda2Headers = null
  try {
    const whResp = await http.post('/api/warehouses', {
      token,
      json: { name: `PB-C2-SCOPE-${String(randomRef('W')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`, type: 1 },
    })
    assert.ok(whResp.ok, `前置：建独立仓库失败：${whResp.status}`)
    const wh2Id = Number(whResp.data.data.id)
    createdWarehouses.push({ id: wh2Id })

    const dev = await http.post('/api/pda-devices', {
      token, json: { deviceName: `PB-C2-SCOPE-${randomRef('D')}`, warehouseId: wh2Id },
    })
    assert.ok(dev.ok, `前置：登记独立设备失败：${dev.status}`)
    createdDevices.push({ id: Number(dev.data.data.id) })

    const ses = await http.post('/api/pda/sessions', {
      token, json: { device_code: dev.data.data.deviceCode, device_secret: dev.data.data.deviceSecret },
    })
    assert.ok(ses.ok, `前置：换设备票据失败：${ses.status}`)
    const t2 = ses.data.data.session_token
    pda2Headers = () => ({ 'X-Client': 'pda', 'X-PDA-Session': t2 })
  } catch (e) {
    console.error(`[WARN] 越权夹具创建失败，相关用例将失败：${e.message}`)
  }

  try {
    // ── S1 正常完成：回执必须带**本事务内**产生的打印任务信息 ──────────────────────
    await check('finish 正常：箱已完成、回执带本事务产生的打印任务信息', async () => {
      const t = await packedBox(150)
      const k = key('fin-ok')
      const r = await finishReq(t.pkgId, k)
      assert.ok(r.ok, `finish 失败：${r.status} ${JSON.stringify(r.data).slice(0, 240)}`)
      assert.equal(await pkgStatusOf(t.pkgId), 2, 'finish 后箱应为已完成(2)')

      const d = r.data?.data ?? {}
      assert.ok(Number(d.printJobId) > 0, `回执应带打印任务 id：${JSON.stringify(d).slice(0, 240)}`)
      assert.ok(Number(d.printJobStatus) >= 0, '回执应带打印任务状态')
      // 只读复核：回执里的 job 必须真实存在，且属于这个箱
      const [job] = await dbQuery(pool, 'SELECT id, status, ref_type, ref_id FROM print_jobs WHERE id=?', [Number(d.printJobId)])
      assert.ok(job, '回执里的打印任务应真实存在')
      assert.equal(job.ref_type, 'package', '打印任务应指向箱子')
      assert.equal(Number(job.ref_id), Number(t.pkgId), '打印任务应指向**本箱**')
    })

    // ── S2 【红】越权设备持原键重放：必须先过范围/设备仓校验，不能直接回放原回执 ──────
    await check('越权设备持原键重放 finish：应 403，而不是先命中 replay 返回原回执', async () => {
      assert.ok(pda2Headers, '前置：越权设备夹具应已就绪')
      const t = await packedBox(150)
      const k = key('fin-scope')

      const ok1 = await finishReq(t.pkgId, k)
      assert.ok(ok1.ok, `前置：合法 finish 失败：${ok1.status} ${JSON.stringify(ok1.data).slice(0, 200)}`)
      assert.equal(await pkgStatusOf(t.pkgId), 2, '前置：箱应已完成')

      const r2 = await finishReq(t.pkgId, k, pda2Headers())
      console.log(`[INFO] 越权同键重放 finish=${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.equal(r2.status, 403, `越权设备持原键重放应 403（不得先命中 replay 拿原回执），实际 ${r2.status}`)
      assert.match(String(r2.data?.message || ''), /仓库/, '拒绝理由应指向设备绑定仓库不一致')
    })

    // ── S3 同键重放（正确设备）：返回原回执，不重复入队 ────────────────────────────
    await check('同键重放 finish：返回原回执且不重复入队', async () => {
      const t = await packedBox(150)
      const k = key('fin-replay')
      const r1 = await finishReq(t.pkgId, k)
      assert.ok(r1.ok, `首次 finish 失败：${r1.status} ${JSON.stringify(r1.data).slice(0, 200)}`)

      const [before] = await dbQuery(pool,
        "SELECT COUNT(*) AS c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId])

      const r2 = await finishReq(t.pkgId, k)
      assert.ok(r2.ok, `同键重放应成功：${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.deepEqual(r2.data?.data, r1.data?.data, '同键重放应返回与首次一致的回执')

      const [after] = await dbQuery(pool,
        "SELECT COUNT(*) AS c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId])
      assert.equal(Number(after.c), Number(before.c), '同键重放不得再入队打印任务')
    })

    // ── S4 无键旧路径：照常可用（老 PDA 版本不带请求键）─────────────────────────────
    await check('无请求键的旧路径：finish 照常可用', async () => {
      const t = await packedBox(150)
      const r = await finishReq(t.pkgId, null)
      assert.ok(r.ok, `无键 finish 应照常成功：${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
      assert.equal(await pkgStatusOf(t.pkgId), 2, '无键路径也应把箱置为已完成')
    })

    // ── S5 新键 + 已完成箱：走既有「已完成」捷径，不重复入队 ────────────────────────
    await check('新键对已完成箱：走既有捷径返回，不重复入队', async () => {
      const t = await packedBox(150)
      assert.ok((await finishReq(t.pkgId, key('fin-a'))).ok, '前置：首次 finish 失败')
      const [before] = await dbQuery(pool,
        "SELECT COUNT(*) AS c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId])

      const r2 = await finishReq(t.pkgId, key('fin-b'))
      console.log(`[INFO] 新键对已完成箱=${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.ok(r2.ok, `新键对已完成箱应返回既有结果：${r2.status} ${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.equal(Number(r2.data?.data?.status), 2, '应报告已完成')

      const [after] = await dbQuery(pool,
        "SELECT COUNT(*) AS c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId])
      assert.equal(Number(after.c), Number(before.c), '新键不得重复入队打印任务')
    })

    // ── S6 事务故障注入：三种故障各自证明「要么都成、要么都不成」，且失败不留永久挡板 ──
    // 只在**测试内**包装 pool 连接（不手工改回执、不改业务代码）。包装到的每条连接都**记录原方法**，
    // 结束后逐一恢复 —— 否则连接还回池里会带着被替换的 commit/query，污染后续的原键重试与收尾。
    const withInjectedConnFailure = async (kind, sqlIncludes, fn) => {
      const db = require('../backend/src/config/db')
      const origGetConnection = db.pool.getConnection.bind(db.pool)
      const wrapped = []
      let hits = 0
      db.pool.getConnection = async (...args) => {
        const conn = await origGetConnection(...args)
        const origCommit = conn.commit.bind(conn)
        const origQuery = conn.query.bind(conn)
        conn.commit = async (...c) => {
          // **只注入第一次** commit：范围内的第一个写事务就是被测的 finish，
          // 不波及其它日志 / 审计事务。
          if (kind === 'commit' && hits === 0) { hits += 1; throw new Error('INJECTED_COMMIT_FAILURE') }
          return origCommit(...c)
        }
        conn.query = async (sql, params) => {
          if (kind === 'sql' && hits === 0 && typeof sql === 'string' && sql.includes(sqlIncludes)) {
            hits += 1
            throw new Error('INJECTED_SQL_FAILURE')
          }
          return origQuery(sql, params)
        }
        wrapped.push({ conn, origCommit, origQuery })
        return conn
      }
      try {
        return { result: await fn(), hits: () => hits }
      } finally {
        db.pool.getConnection = origGetConnection
        for (const w of wrapped) { w.conn.commit = w.origCommit; w.conn.query = w.origQuery }
      }
    }

    /** 三种注入共用的收尾核对：业务 + 回执**都**回滚，且原键重试能成功 */
    const assertRolledBackThenRetry = async (t, k, label) => {
      assert.equal(await pkgStatusOf(t.pkgId), 1, `${label}：箱应仍为打包中(1)`)
      const [jobs] = await dbQuery(pool,
        "SELECT COUNT(*) AS c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId])
      assert.equal(Number(jobs.c), 0, `${label}：不应留下打印任务`)
      const rcpts = await dbQuery(pool, 'SELECT status FROM operation_requests WHERE request_key=?', [k])
      assert.equal(rcpts.length, 0, `${label}：不应留下任何回执行（成功或失败都不是）`)

      const retry = await finishReq(t.pkgId, k)
      assert.ok(retry.ok, `${label}：原键重试应成功：${retry.status} ${JSON.stringify(retry.data).slice(0, 200)}`)
      assert.equal(await pkgStatusOf(t.pkgId), 2, `${label}：重试后箱应已完成(2)`)
      const [jobs2] = await dbQuery(pool,
        "SELECT COUNT(*) AS c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId])
      assert.ok(Number(jobs2.c) >= 1, `${label}：重试成功后应有打印任务`)
    }

    await check('故障注入 · commit 失败：业务与回执全部回滚，原键重试可成功', async () => {
      const t = await packedBox(150)
      const k = key('fin-inj-commit')
      const { result: r1, hits } = await withInjectedConnFailure('commit', null, () => finishReq(t.pkgId, k))
      assert.ok(hits() > 0, '前置：故障注入应已生效（commit 被替换）')
      assert.ok(r1 && !r1.ok, `注入 commit 失败后 finish 应失败，实际 ${r1?.status} ${JSON.stringify(r1?.data).slice(0, 160)}`)
      // 注：本夹具**未指定承运商**，`createPendingWaybillTx` 本就不建运单 ——
      // 因此这里**只能**说明「本分支仍然零运单」，**不能**据此宣称「运单与业务一起回滚」。
      const [wbs] = await dbQuery(pool, 'SELECT COUNT(*) AS c FROM logistics_waybills WHERE package_id=?', [t.pkgId])
      assert.equal(Number(wbs.c), 0, '本分支（未指定承运商）不应有运单')
      await assertRolledBackThenRetry(t, k, 'commit 失败')
    })

    await check('故障注入 · 回执写入(complete)失败：业务与回执全部回滚，原键重试可成功', async () => {
      const t = await packedBox(150)
      const k = key('fin-inj-complete')
      const { result: r1, hits } = await withInjectedConnFailure(
        'sql', 'UPDATE operation_requests', () => finishReq(t.pkgId, k),
      )
      assert.ok(hits() > 0, '前置：注入应命中 complete 的 UPDATE')
      assert.ok(r1 && !r1.ok, `回执写入失败后 finish 应失败，实际 ${r1?.status}`)
      await assertRolledBackThenRetry(t, k, '回执写入失败')
    })

    await check('故障注入 · 回执构建读失败：业务与回执全部回滚，原键重试可成功', async () => {
      const t = await packedBox(150)
      const k = key('fin-inj-read')
      const { result: r1, hits } = await withInjectedConnFailure(
        'sql', 'FROM print_jobs j LEFT JOIN printers', () => finishReq(t.pkgId, k),
      )
      assert.ok(hits() > 0, '前置：注入应命中回执构建读打印任务')
      assert.ok(r1 && !r1.ok, `回执构建读失败后 finish 应失败，实际 ${r1?.status}`)
      await assertRolledBackThenRetry(t, k, '回执构建读失败')
    })

    // ── S7 · API 成功后按原键查回执 ──────────────────────────────────────────────
    // **注意口径**：这里是 `await finishReq` 拿到**完整 200** 之后，再按原 key + scoped action 查一次回执 ——
    // 它只证明「**原键查询通路可用、且绑定原箱**」，**不构成**「丢响应 / 切目标 / 重挂」的证据：
    // 那些需要真实 GUI + 网络拦截（本轮没有该工具，见 C2/C3 交接 §7）。
    await check('API 成功后按原键查 request-status：取回原箱回执（非丢响应/切目标/重挂证据）', async () => {
      const t = await packedBox(150)
      const k = key('fin-c3')
      const r1 = await finishReq(t.pkgId, k)
      assert.ok(r1.ok, `前置：finish 失败：${r1.status} ${JSON.stringify(r1.data).slice(0, 200)}`)

      const q = await http.get(
        `/api/system/request-status/${encodeURIComponent(k)}?action=${encodeURIComponent(`package.finish.${t.pkgId}`)}`,
        { token },
      )
      console.log(`[INFO] 原键查回执=${q.status} ${JSON.stringify(q.data).slice(0, 200)}`)
      assert.ok(q.ok, `查回执失败：${q.status} ${JSON.stringify(q.data).slice(0, 200)}`)
      const d = q.data?.data ?? {}
      assert.equal(d.status, 'success', '回执应为 success')
      assert.equal(Number(d.resourceId), Number(t.pkgId), '回执必须绑定**原箱**（切目标 / 重挂后也不能认到别的箱）')
      assert.equal(Number(d.data?.id), Number(t.pkgId), '回执数据应是原箱的完成结果')
    })
  } finally {
    let cleaned = 0
    for (const { saleId, taskId } of createdSales) {
      try {
        if (taskId == null) {
          const c = await http.post(`/api/sale/${saleId}/cancel`, { token })
          if (!c.ok) { failed++; console.error(`[FAIL] 收尾：cancel sale ${saleId}（无任务）-> ${c.status}`) }
          else cleaned++
          continue
        }
        const rows = await dbQuery(pool, 'SELECT status, cancel_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
        const tk = rows[0]
        if (!tk) { failed++; console.error(`[FAIL] 收尾：task ${taskId} 不存在（sale ${saleId}）`); continue }
        const locked = await dbQuery(pool, 'SELECT id, barcode FROM inventory_containers WHERE locked_by_task_id=?', [taskId])
        const st = Number(tk.status)
        if ((st === 7 || st === 8) && locked.length === 0) { cleaned++; continue }

        if (st !== 8 && !tk.cancel_requested_at) {
          const c = await http.post(`/api/sale/${saleId}/cancel`, { token })
          if (!c.ok) { failed++; console.error(`[FAIL] 收尾：cancel sale ${saleId} -> ${c.status} ${JSON.stringify(c.data).slice(0, 120)}`); continue }
        }
        const d = await http.get(`/api/warehouse-tasks/${taskId}/cancel-return-detail`, { token })
        if (!d.ok) { failed++; console.error(`[FAIL] 收尾：cancel-return-detail task ${taskId} -> ${d.status} ${JSON.stringify(d.data).slice(0, 120)}`); continue }
        for (const c of locked) {
          const r = await http.post('/api/scan-logs/cancel-return', {
            token, headers: pdaHeaders(),
            json: { taskId, containerId: Number(c.id), barcode: c.barcode, locationId: location.id },
          })
          if (!r.ok) {
            failed++
            console.error(`[FAIL] 收尾：return task ${taskId} container ${c.barcode} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`)
          }
        }
        // 本批的箱**已完成**（status=2）：取消时它们走「受控拆箱」而不是随任务自动作废，
        // 必须逐箱再确认一次，任务才会真正 finalize 到 8。
        const donePkgs = await dbQuery(pool,
          'SELECT id, barcode FROM packages WHERE warehouse_task_id=? AND status=2 ORDER BY id', [taskId])
        for (const p of donePkgs) {
          const r = await http.post('/api/scan-logs/cancel-return/box', {
            token, headers: pdaHeaders(),
            json: { taskId, packageId: Number(p.id), barcode: p.barcode },
          })
          if (!r.ok) {
            failed++
            console.error(`[FAIL] 收尾：拆箱 task ${taskId} package ${p.barcode} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`)
          }
        }
        const st2 = Number((await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId]))[0].status)
        const left = Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_containers WHERE locked_by_task_id=?', [taskId]))[0].c ?? -1)
        if (st2 !== 8 || left !== 0) {
          failed++
          console.error(`[FAIL] 收尾核对：task ${taskId} status=${st2} 剩余锁=${left}`)
        } else cleaned++
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾 sale ${saleId}/task ${taskId} 异常：${e.message}`)
      }
    }
    console.log(`[INFO] 自建销售夹具 ${createdSales.length} 笔，收尾核对通过 ${cleaned} 笔，失败 ${createdSales.length - cleaned} 笔`)

    for (const binId of createdBins) {
      try {
        const r = await http.delete(`/api/sorting-bins/${binId}`, { token })
        if (!r.ok) console.warn(`[WARN] 收尾：自建分拣格 ${binId} 未删除、保留原状：${r.status}`)
      } catch (e) { console.warn(`[WARN] 收尾：自建分拣格 ${binId} 删除请求异常：${e.message}`) }
    }

    // 越权夹具收尾（合法接口；失败计 FAIL，只读核对，核对 SQL 异常也不得跳过后面的收口）
    let devicesOk = 0
    for (const d of createdDevices) {
      try {
        let unStatus = null
        let stStatus = null
        try {
          const un = await http.put(`/api/pda-devices/${d.id}`, { token, json: { warehouseId: null } })
          unStatus = un.status
        } catch (e) { unStatus = `ERR:${e.message}` }
        try {
          const r = await http.put(`/api/pda-devices/${d.id}/status`, { token, json: { status: 'disabled' } })
          stStatus = r.status
        } catch (e) { stStatus = `ERR:${e.message}` }

        const [dev] = await dbQuery(pool, 'SELECT warehouse_id, status FROM pda_devices WHERE id=?', [d.id])
        const [sess] = await dbQuery(pool,
          'SELECT COUNT(*) AS c FROM pda_device_sessions WHERE device_id=? AND revoked_at IS NULL AND expires_at > NOW()',
          [d.id])
        const okUnbind = dev != null && dev.warehouse_id == null
        const okDisabled = dev != null && String(dev.status) === 'disabled'
        const okNoSession = Number(sess?.c ?? -1) === 0
        if (unStatus === 200 && stStatus === 200 && okUnbind && okDisabled && okNoSession) {
          devicesOk++
        } else {
          failed++
          console.error(`[FAIL] 收尾核对：越权设备 ${d.id} unbind=${unStatus} disable=${stStatus} `
            + `warehouse_id=${dev?.warehouse_id} status=${dev?.status} 有效票据=${sess?.c}`)
        }
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾核对：越权设备 ${d.id} 核对过程异常：${e.message}`)
      }
    }

    let warehousesOk = 0
    for (const w of createdWarehouses) {
      try {
        let delStatus = null
        try {
          const r = await http.delete(`/api/warehouses/${w.id}`, { token })
          delStatus = r.status
        } catch (e) { delStatus = `ERR:${e.message}` }
        const [wh] = await dbQuery(pool, 'SELECT deleted_at FROM inventory_warehouses WHERE id=?', [w.id])
        if (delStatus === 200 && wh != null && wh.deleted_at != null) {
          warehousesOk++
        } else {
          failed++
          console.error(`[FAIL] 收尾核对：越权仓库 ${w.id} delete=${delStatus} deleted_at=${wh?.deleted_at}`)
        }
      } catch (e) {
        failed++
        console.error(`[FAIL] 收尾核对：越权仓库 ${w.id} 核对过程异常：${e.message}`)
      }
    }
    console.log(`[INFO] 自建越权夹具收尾核对：设备 ${devicesOk}/${createdDevices.length} 台（已解绑 + 已停用 + 无有效票据）、`
      + `仓库 ${warehousesOk}/${createdWarehouses.length} 个（已软删）`)

    try { await close() } catch (e) { failed++; console.error(`[FAIL] 关闭测试服务/连接池失败：${e.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e) { failed++; console.error(`[FAIL] 关闭全局连接池失败：${e.message}`) }
  }

  console.log(`\n${'='.repeat(50)}\n  ${passed} passed, ${failed} failed\n${'='.repeat(50)}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error('套件异常终止：', e); process.exitCode = 1 })
