'use strict'

/**
 * 批 C4 · 首项：`pack-done`（打包完成 5→6）的**原键重放**。
 *
 * 静态事实（本文件用真实 API 验证，不预判结论）：
 *   `backend/src/modules/warehouse-tasks/warehouse-tasks.pack.js` 里
 *   `assertWarehouseTaskAction('packDone', status)`（只允许 PACKING(5)）排在
 *   `beginResourceOperationRequest` **之前**，因此状态推进到 6 之后，
 *   **同一个 X-Request-Key 重放会先被状态规则挡下**，`replay` 分支到不了 ⇒ 拿不回原回执。
 *
 * 断言口径（两条**互相区别**、不能互相代替）：
 *   P1【正确语义】原 key 重放 ⇒ **200 且回原回执**（同 taskId / status）。
 *   P2【既有语义】新 key 对已推进的旧状态 ⇒ **仍按状态拒绝**（不因修 P1 而放开）。
 *
 * 环境：**只允许**在显式回环独立测试库运行（不符即失败）。
 * 初始化**不调用** `prepareSmokeContext()`（它会 upsert 共享 `SMOKE-PRN` 并删除其待打印任务，
 * 与本批「不核销他人历史 job」的边界冲突）；本文件自建本批独立仓 / 库位 / 主数据 / 打印机 /
 * 客户端绑定 / PDA 设备，全部走真实业务 API，收尾同样走合法 API。
 */
const assert = require('node:assert/strict')

const EXPECTED_DB = 'flowcube_plastic_box_20260929_test'
assert.equal(process.env.DB_NAME, EXPECTED_DB, `本批用例只允许在 ${EXPECTED_DB} 运行，实际 ${process.env.DB_NAME}`)
assert.equal(process.env.DB_HOST, '127.0.0.1', '必须走本机回环')
assert.equal(Number(process.env.DB_PORT), 3307, '必须走本机 3307')

require('./helpers/testEnvironment').validateTestEnvironment()

const app = require('../backend/src/app')
const { pool } = require('../backend/src/config/db')

const rnd = () => Math.random().toString(36).slice(2, 10)
const key = (p) => `${p}-${rnd()}`

function makeHttp(baseUrl) {
  async function request(method, p, opts = {}) {
    const headers = { ...(opts.headers || {}) }
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`
    let body
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json) }
    const res = await fetch(`${baseUrl}${p}`, { method, headers, body })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, ok: res.ok, data }
  }
  return {
    get: (p, o) => request('GET', p, o),
    post: (p, o) => request('POST', p, o),
    put: (p, o) => request('PUT', p, o),
    del: (p, o) => request('DELETE', p, o),
  }
}

async function main() {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const http = makeHttp(baseUrl)

  const q = async (sql, params) => (await pool.query(sql, params || []))[0]

  let token = null
  // finally 里要用到的夹具句柄必须在外层声明：try 块内 `const` 在 finally 中不可见，
  // 而初始化**半失败**（建了仓、库位就抛错）时也必须能收尾已创建的资源。
  let location = null
  let pdaHeaders = () => ({})
  let clientId = null
  const created = {
    warehouses: [], devices: [], printers: [], bins: [], sales: [], users: [],
    // 主数据无「合法删除入口」时按用户口径**保留并登记**（不为了收尾全 0 强删）
    categories: [], suppliers: [], customers: [], products: [],
  }

  let passed = 0
  let failed = 0
  let skipped = 0
  const check = async (title, fn) => {
    try {
      // 用例可以返回 'skip' 表示「前提不成立，本项未验证」——必须**单独计数**，
      // 不能因为函数正常返回就 passed++（那会把「没验」写成「已验」）。
      const r = await fn()
      if (r === 'skip') { skipped++; console.log(`[SKIP] ${title}`); return }
      passed++; console.log(`[PASS] ${title}`)
    } catch (e) { failed++; console.error(`[FAIL] ${title}\n        ${e.message}`) }
  }
  // 收尾失败**必须**计入 failed 并让进程非 0——只打印警告会让「收尾没做完」被 2/2 exit0 掩盖
  const cleanupFail = (label, msg) => { failed++; console.error(`[FAIL] 收尾 ${label}：${msg}`) }

  const must = (res, label) => {
    if (!res.ok) throw new Error(`${label} 失败 ${res.status} ${JSON.stringify(res.data).slice(0, 240)}`)
    return res.data?.data
  }

  try {
    const login = await http.post('/api/auth/login', { json: { username: 'smoke_admin', password: 'SmokeAdmin123!' } })
    assert.ok(login.ok, `管理员登录失败 ${login.status} ${JSON.stringify(login.data).slice(0, 200)}`)
    token = login.data?.data?.token
    assert.ok(token, '管理员应登录成功')
    const adminUserId = Number(login.data?.data?.user?.id)
    assert.ok(Number.isInteger(adminUserId) && adminUserId > 0, '应拿到当前用户 id（PL5/PL6 只查本人历史）')

    // ── 本批独立主数据（全部真实 API 创建）────────────────────────────────────
    const suffix = rnd().toUpperCase()
    const whName = `PB-C4-仓-${suffix}`
    const warehouse = must(await http.post('/api/warehouses', {
      token, json: { name: whName, type: 1 },
    }), '建独立仓')
    created.warehouses.push(Number(warehouse.id))

    // 库位 code 是**全库唯一**（uk_location_code 不含 warehouse_id），故 zone 必须随机化
    location = must(await http.post('/api/locations', {
      token, json: {
        warehouseId: Number(warehouse.id), zone: `C4${suffix.slice(0, 3)}`,
        aisle: 1, rack: 1, level: 1, position: 1,
      },
    }), '建库位')
    const category = must(await http.post('/api/categories', {
      token, json: { name: `PB-C4-分类-${suffix}` },
    }), '建分类')
    created.categories.push(Number(category.id))
    const supName = `PB-C4供应商${suffix.slice(0, 4)}`
    const supplier = must(await http.post('/api/suppliers', {
      token, json: { code: `PB-C4-SUP-${suffix}`, name: supName },
    }), '建供应商')
    created.suppliers.push(Number(supplier.id))
    const cusName = `PB-C4客户${suffix.slice(0, 4)}`
    const customer = must(await http.post('/api/customers', {
      token, json: { code: `PB-C4-CUS-${suffix}`, name: cusName },
    }), '建客户')
    created.customers.push(Number(customer.id))
    // 商品 code 显式指定：不依赖创建响应的字段齐备（下单 payload 需要它，拿 undefined 会 400）
    const productCode = `PB-C4-P-${suffix}`
    const productName = `PB-C4商品${suffix.slice(0, 4)}`
    const product = must(await http.post('/api/products', {
      token, json: {
        code: productCode, name: productName, categoryId: Number(category.id), supplierId: Number(supplier.id),
        unit: '个', spec: '标准', color: '白', costPrice: 10, salePriceA: 10,
      },
    }), '建商品')
    created.products.push(Number(product.id))

    // 分拣格（新仓自建）：任务在「待打包」期间**持续占用**分拣格，pack-done 才释放。
    // 用例里会同时有多个未 pack-done 的任务（如 PL1 的 A/B 两箱），单格会让后一个任务
    // 撞 `SORTING_BIN_REQUIRED`——那是夹具不足，不是产品缺陷。批量建 6 个。
    const binBatch = must(await http.post('/api/sorting-bins/batch', {
      token, json: { warehouseId: Number(warehouse.id), prefix: `C4${suffix.slice(0, 3)}`, from: 1, to: 6 },
    }), '批量建分拣格')
    const binIds = (binBatch?.ids ?? binBatch?.created ?? []).map(Number)
    if (binIds.length) created.bins.push(...binIds)
    else {
      const list = await q('SELECT id FROM sorting_bins WHERE warehouse_id=?', [warehouse.id])
      created.bins.push(...list.map((r) => Number(r.id)))
    }
    console.log(`[env] 分拣格 ${created.bins.length} 个`)

    // 本批独立打印机 + 客户端 + package_label 绑定
    clientId = `pb-c4-client-${rnd()}`
    const printer = must(await http.post('/api/printers', {
      token, json: {
        name: `PB-C4打印机${suffix.slice(0, 4)}`, code: `PB-C4-PRN-${suffix}`, type: 1,
        warehouseId: Number(warehouse.id), clientId,
      },
    }), '建打印机')
    created.printers.push(Number(printer.id))
    must(await http.put('/api/printer-bindings/package_label', {
      token, json: { printerId: Number(printer.id), warehouseId: Number(warehouse.id) },
    }), '绑定箱贴打印机')

    // 本批独立 PDA 设备（绑本批作业仓）
    const device = must(await http.post('/api/pda-devices', {
      token, json: { deviceName: `PB-C4-设备-${suffix}`, warehouseId: Number(warehouse.id) },
    }), '登记设备')
    created.devices.push(Number(device.id))
    const session = must(await http.post('/api/pda/sessions', {
      token, json: { device_code: device.deviceCode, device_secret: device.deviceSecret },
    }), '换设备票据')
    pdaHeaders = (extra = {}) => ({ 'X-Client': 'pda', 'X-PDA-Session': session.session_token, ...extra })

    console.log(`[env] 仓=${warehouse.id} 库位=${location.id} 商品=${product.id} 打印机=${printer.id}/${clientId} 设备=${device.id}`)

    // ── 业务链路：采购→入库→上架→放货→销售→取货→ready→分拣→复核→建箱→装箱→finish ──
    async function makeWholeContainer(qty) {
      const po = must(await http.post('/api/purchase', {
        token, json: {
          supplierId: Number(supplier.id), supplierName: supName,
          warehouseId: Number(warehouse.id), warehouseName: whName,
          items: [{
            productId: Number(product.id), productCode, productName,
            unit: '个', quantity: qty, unitPrice: 10,
          }],
        },
      }), '建采购单')
      must(await http.post(`/api/purchase/${po.id}/confirm`, { token }), '确认采购')
      const it = must(await http.post('/api/inbound-tasks', { token, json: { poId: Number(po.id) } }), '建入库任务')
      const tid = it.taskId ?? it.id
      must(await http.post(`/api/inbound-tasks/${tid}/submit`, { token }), '提交入库')
      const recv = must(await http.post(`/api/inbound-tasks/${tid}/receive`, {
        token, headers: pdaHeaders(), json: { productId: Number(product.id), qty },
      }), '收货')
      must(await http.post(`/api/inbound-tasks/${tid}/putaway`, {
        token, headers: pdaHeaders(), json: { containerId: recv.containerId, locationId: Number(location?.id) },
      }), '上架')
      return recv.containerId
    }

    /** 造一个到「待打包(5) + 已装箱 + 箱已 finish（产生箱贴 job）」的任务 */
    async function packedTask(qty) {
      const src = await makeWholeContainer(qty)
      const box = must(await http.post('/api/plastic-boxes', {
        token, json: { productId: Number(product.id), warehouseId: Number(warehouse.id), locationId: Number(location?.id) },
      }), '建盒').id
      must(await http.post(`/api/plastic-boxes/${box}/fill`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('fill') }, json: { sourceContainerId: src },
      }), '放货')
      const [boxRow] = await q('SELECT barcode FROM inventory_containers WHERE id=?', [box])

      const sale = must(await http.post('/api/sale', {
        token, json: {
          customerId: Number(customer.id), customerName: cusName,
          warehouseId: Number(warehouse.id), warehouseName: whName, remark: `pb-c4-${rnd()}`,
          items: [{
            productId: Number(product.id), productCode, productName,
            unit: '个', quantity: qty, unitPrice: 10,
          }],
        },
      }), '建销售单')
      created.sales.push(Number(sale.id))
      must(await http.post(`/api/sale/${sale.id}/reserve`, { token }), '占库')
      must(await http.post(`/api/sale/${sale.id}/ship`, { token }), '发货')
      const [so] = await q('SELECT task_id FROM sale_orders WHERE id=?', [sale.id])
      const taskId = Number(so.task_id)
      const [wti] = await q('SELECT id FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])

      must(await http.post('/api/scan-logs', {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('pick') },
        json: {
          taskId, itemId: Number(wti.id), containerId: Number(box), barcode: boxRow.barcode,
          productId: Number(product.id), qty, scanMode: '整件',
        },
      }), '扫盒取货')
      must(await http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: pdaHeaders() }), 'ready')

      const [newI] = await q(
        "SELECT id, barcode FROM inventory_containers WHERE source_ref_type='plastic_box_pick' AND source_ref_id=? ORDER BY id DESC LIMIT 1",
        [box])
      assert.ok(newI, '前置：应生成取货码')
      const [tk] = await q('SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [taskId])
      must(await http.put(`/api/warehouse-tasks/${taskId}/sort-done`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('sort') },
        json: { items: [{ containerId: Number(newI.id), binCode: tk.sorting_bin_code }] },
      }), '分拣')

      const locked = await q('SELECT barcode FROM inventory_containers WHERE locked_by_task_id=?', [taskId])
      for (const c of locked) {
        must(await http.post('/api/scan-logs/check', {
          token, headers: { ...pdaHeaders(), 'X-Request-Key': key('chk') }, json: { taskId, barcode: c.barcode },
        }), `复核 ${c.barcode}`)
      }
      const [tk5] = await q('SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
      assert.equal(Number(tk5.status), 5, `前置：应进入待打包(5)，实际 ${tk5.status}`)

      const pkg = must(await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: taskId } }), '建箱')
      must(await http.post(`/api/packages/${pkg.id}/add-item`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('add') }, json: { labelBarcode: newI.barcode },
      }), '装箱')
      const finished = must(await http.put(`/api/packages/${pkg.id}/finish`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('fin') }, json: {},
      }), '完成箱子')
      assert.ok(Number(finished.printJobId) > 0, `finish 应产生箱贴打印任务：${JSON.stringify(finished).slice(0, 200)}`)
      return { taskId, saleId: Number(sale.id), pkgId: Number(pkg.id), printJobId: Number(finished.printJobId) }
    }

    /** 用**本批独立打印机/客户端**走真实 claim → complete 核销箱贴（不碰任何他人 job） */
    async function consumePackageLabelJob(jobId) {
      const claimed = must(await http.post('/api/print-jobs/claim-client', { token, json: { clientId, limit: 10 } }), '领取打印任务')
      const mine = claimed.find((j) => Number(j.id) === Number(jobId))
      assert.ok(mine, `本批客户端应领到本批箱贴任务 ${jobId}，实得 ${JSON.stringify(claimed.map((j) => j.id))}`)
      assert.ok(mine.ackToken, '领取应返回 ackToken')
      must(await http.post(`/api/print-jobs/${jobId}/complete-client`, {
        token, headers: { 'X-Client-Id': clientId }, json: { ackToken: mine.ackToken },
      }), '核销打印任务')
      const [row] = await q('SELECT status FROM print_jobs WHERE id=?', [jobId])
      assert.equal(Number(row.status), 2, '核销后打印任务应为已完成(2)')
    }

    const packDoneReq = (taskId, k) =>
      http.put(`/api/warehouse-tasks/${taskId}/pack-done`, {
        token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) }, json: {},
      })
    const printLabelReq = (pkgId, k) =>
      http.post(`/api/packages/${pkgId}/print-label`, {
        token, headers: { ...pdaHeaders(), ...(k ? { 'X-Request-Key': k } : {}) }, json: {},
      })
    const taskStatusOf = async (taskId) => Number((await q('SELECT status FROM warehouse_tasks WHERE id=?', [taskId]))[0].status)

    // ══ P1【正确语义】原 key 重放 ⇒ 200 且回原回执 ══════════════════════════
    await check('P1 pack-done 原 key 重放应返回原回执（同 taskId/status）', async () => {
      const t = await packedTask(120)
      await consumePackageLabelJob(t.printJobId)

      const k1 = key('packdone')
      const first = await packDoneReq(t.taskId, k1)
      assert.ok(first.ok, `首次 pack-done 应成功：${first.status} ${JSON.stringify(first.data).slice(0, 240)}`)
      assert.equal(await taskStatusOf(t.taskId), 6, '首次 pack-done 后任务应为待出库(6)')
      const firstPayload = first.data?.data
      console.log(`        [证据] 首次 pack-done ${first.status} → ${JSON.stringify(firstPayload).slice(0, 160)}`)

      // 首次之后立刻记基线，重放后再比对——否则两次都在重放后查，等于没比
      const evBefore = Number((await q(
        "SELECT COUNT(*) c FROM warehouse_task_events WHERE task_id=? AND event_type='PACK_DONE'", [t.taskId]))[0].c)
      const wbBefore = Number((await q(
        'SELECT COUNT(*) c FROM logistics_waybills WHERE warehouse_task_id=?', [t.taskId]))[0].c)

      const replay = await packDoneReq(t.taskId, k1)
      console.log(`        [证据] 原 key 重放 → HTTP ${replay.status} ${JSON.stringify(replay.data).slice(0, 200)}`)
      assert.equal(replay.status, 200, `原 key 重放应 200 回原回执，实际 ${replay.status}`)
      assert.deepEqual(replay.data?.data, firstPayload, '重放回执应与首次一致')
      assert.equal(await taskStatusOf(t.taskId), 6, '重放不得改变任务状态')

      // 回执对还不够：重放**不得**再落一次副作用（事件 / 直接运单）
      const evAfter = Number((await q(
        "SELECT COUNT(*) c FROM warehouse_task_events WHERE task_id=? AND event_type='PACK_DONE'", [t.taskId]))[0].c)
      const wbAfter = Number((await q(
        'SELECT COUNT(*) c FROM logistics_waybills WHERE warehouse_task_id=?', [t.taskId]))[0].c)
      console.log(`        [证据] PACK_DONE 事件 ${evBefore}→${evAfter}；直接运单 ${wbBefore}→${wbAfter}`)
      assert.equal(evAfter, evBefore, `原 key 重放不得重复记录 PACK_DONE 事件（${evBefore}→${evAfter}）`)
      assert.equal(wbAfter, wbBefore, `原 key 重放不得新增运单（${wbBefore}→${wbAfter}）`)
    })

    // ══ P2【既有语义】新 key 对已推进状态 ⇒ 仍拒绝 ══════════════════════════
    await check('P2 pack-done 新 key 对已推进状态仍应拒绝', async () => {
      const t = await packedTask(80)
      await consumePackageLabelJob(t.printJobId)

      const k1 = key('packdone')
      const first = await packDoneReq(t.taskId, k1)
      assert.ok(first.ok, `首次 pack-done 应成功：${first.status} ${JSON.stringify(first.data).slice(0, 240)}`)
      assert.equal(await taskStatusOf(t.taskId), 6, '首次 pack-done 后任务应为待出库(6)')

      const k2 = key('packdone')
      const fresh = await packDoneReq(t.taskId, k2)
      console.log(`        [证据] 新 key 对 status=6 → HTTP ${fresh.status} ${JSON.stringify(fresh.data).slice(0, 200)}`)
      assert.equal(fresh.status, 400, `新 key 对已推进状态应 400，实际 ${fresh.status}`)
      assert.equal(await taskStatusOf(t.taskId), 6, '拒绝后状态不应变化')

      // 被拒的请求**不得**在库里留下半截回执行（begin 插入 PENDING，随后 rollback）
      const leftover = await q(
        'SELECT id, status, action FROM operation_requests WHERE request_key=?', [k2])
      console.log(`        [证据] 新 key 失败后 operation_requests 残留 = ${leftover.length} 行`)
      assert.equal(leftover.length, 0, `新 key 被拒后不应残留回执行，实际 ${JSON.stringify(leftover)}`)
    })

    // ══ PL1【红】箱贴 print-label 同 requestKey 跨箱不得串号 ═════════════════════
    // 静态事实：controller 用 `jobUniqueKey = package_label:<requestKey>`，**不含 packageId**；
    // `print-jobs.command.js` 的 createRecord 对同 key + 同仓 + 同 jobType 的活跃 job
    // **直接返回既有 job**（第 103-110 行）。于是把同一个 key 用在 B 箱上，会拿到 A 箱的 job。
    await check('PL1 箱贴同 requestKey 跨箱应指向本箱，不得回 A 的 job', async () => {
      const a = await packedTask(60)
      const b = await packedTask(60)   // 必须同仓：findExistingActiveJob 带 warehouseId 条件
      const k = key('plabel')

      const ra = await printLabelReq(a.pkgId, k)
      assert.ok(ra.ok, `A 箱补打应成功：${ra.status} ${JSON.stringify(ra.data).slice(0, 240)}`)
      const ja = ra.data?.data?.job
      assert.ok(ja, `A 箱应返回打印任务：${JSON.stringify(ra.data).slice(0, 240)}`)
      console.log(`        [证据] A 箱 → job ${ja.id} refId=${ja.refId} refCode=${ja.refCode}`)

      const rb = await printLabelReq(b.pkgId, k)
      console.log(`        [证据] B 箱同 key → HTTP ${rb.status} ${JSON.stringify(rb.data).slice(0, 240)}`)
      assert.ok(rb.ok, `B 箱补打应成功：${rb.status} ${JSON.stringify(rb.data).slice(0, 240)}`)
      const jb = rb.data?.data?.job
      assert.ok(jb, 'B 箱应返回打印任务')
      assert.equal(Number(jb.refId), Number(b.pkgId), `B 箱的打印任务必须指向 B 箱(${b.pkgId})，实际 refId=${jb.refId}`)

      // 核心契约一：**同 key 重放**必须回**原 job**，且不新增打印任务
      const jobsOf = async (pkgId) => Number((await q(
        "SELECT COUNT(*) c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [pkgId]))[0].c)
      const before = await jobsOf(a.pkgId)
      const replay = await printLabelReq(a.pkgId, k)
      assert.ok(replay.ok, `同 key 重放应成功：${replay.status}`)
      assert.equal(Number(replay.data?.data?.job?.id), Number(ja.id), '同 key 重放应回**原**打印任务')
      assert.equal(await jobsOf(a.pkgId), before, `同 key 重放不得新增打印任务（${before}→${await jobsOf(a.pkgId)}）`)
      console.log(`        [证据] 同 key 重放 → job ${replay.data?.data?.job?.id}（原 ${ja.id}）；该箱 job 数 ${before}→${await jobsOf(a.pkgId)}`)

      // 核心契约二：**新 key** 再次补打是**合法的新一次打印**，必须产生**新 job**
      const again = await printLabelReq(a.pkgId, key('plabel'))
      assert.ok(again.ok, `新 key 补打应成功：${again.status} ${JSON.stringify(again.data).slice(0, 200)}`)
      const newJobId = Number(again.data?.data?.job?.id)
      assert.ok(newJobId > 0, '新 key 应返回打印任务')
      assert.notEqual(newJobId, Number(ja.id), '新 key 应产生**新的**打印任务，而不是回原 job')
      assert.equal(await jobsOf(a.pkgId), before + 1, '新 key 补打应恰好新增一个打印任务')
      console.log(`        [证据] 新 key 补打 → job ${newJobId}（≠ ${ja.id}）；该箱 job 数 ${before}→${await jobsOf(a.pkgId)}`)
    })

    // ══ PL3【红】缺箱必须在 begin **之前**失败：不留回执行，原键可直接重试 ═══════════
    // 现状缺陷不是「没写 FAILED」，而是「失败在 begin **之后**、且回执停在 PENDING(0)」：
    // 该 request_key 之后再怎么重试都被 begin 的 PENDING 分支挡成「上次提交结果仍待确认」，
    // 现场只能换个 key。正确语义：缺箱 → 明确 404，**回执 0 行 / 队列 0 行**，原键随时可重试。
    await check('PL3 缺箱应在 begin 之前 404：无回执行、原键可重试', async () => {
      const missingId = 99999999
      const k = key('plabel-fail')
      const r = await printLabelReq(missingId, k)
      console.log(`        [证据] 对不存在箱补打 → HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`)
      assert.equal(r.status, 404, `对不存在的箱应 404，实际 ${r.status}`)

      const rows = await q('SELECT id, status, action FROM operation_requests WHERE request_key=?', [k])
      console.log(`        [证据] 回执行 = ${JSON.stringify(rows)}`)
      assert.equal(rows.length, 0, `缺箱应在 begin 之前失败：不得留下回执行，实际 ${JSON.stringify(rows)}`)

      // 原键重试：必须还能真的再发起（而不是被「仍待确认」永久挡住）
      const retry = await printLabelReq(missingId, k)
      console.log(`        [证据] 原键重试 → HTTP ${retry.status} ${JSON.stringify(retry.data).slice(0, 160)}`)
      assert.equal(retry.status, 404, `原键重试应仍得 404（说明没被残留回执挡住），实际 ${retry.status}`)
      assert.ok(!/仍待确认/.test(String(retry.data?.message)), `原键重试不应被「仍待确认」挡住：${retry.data?.message}`)
    })

    // ══ PL5【红】历史错误回执（B 的 action + A 的 job）重放：必须 409 要求核对 ══════
    // 本批修复前跑 PL1 红测时，真实落库过一批「B 箱的 scoped 成功回执里塞着 A 箱的 job」的行。
    // 这些历史行**不改写、不删除**；但入口不能再照旧把它们回放出去（B 箱会以为已入队）。
    // 本用例**只读**找出这种行，用它的原 key + 原箱走真实 API 重放，验收拒绝。
    await check('PL5 历史回执指向别箱时，原键重放应 409 要求核对', async () => {
      // 只查**本批**历史：JOIN 到该箱所属任务的仓库，限定 `PB-C4-%`（本批自建仓）+ 当前用户。
      // 不读别的批次、不猜 key（request_key 是随机的，只有本人 + 本批仓这两条限定才能锁住范围）。
      const rows = await q(
        "SELECT o.request_key, o.action, o.resource_id, o.response_json "
        + "FROM operation_requests o "
        + "JOIN packages p ON p.id = o.resource_id "
        + "JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id "
        + "JOIN inventory_warehouses w ON w.id = wt.warehouse_id "
        + "WHERE o.action LIKE 'package.print-label.%' AND o.status=1 "
        + "  AND o.user_id=? AND w.name LIKE 'PB-C4-%' "
        + "ORDER BY o.id DESC LIMIT 200",
        [adminUserId])
      const bad = rows.find((r) => {
        let d = null
        try { d = r.response_json ? JSON.parse(r.response_json) : null } catch { d = null }
        const j = d?.job
        return j && (j.refType !== 'package' || Number(j.refId) !== Number(r.resource_id))
      })
      // 找不到历史行时是 **SKIP**（本项未验证），绝不能当成 PASS
      if (!bad) return 'skip'
      const pid = Number(bad.resource_id)
      console.log(`        [证据] 历史不一致回执 key=${bad.request_key} action=${bad.action} resourceId=${pid}`)
      // 走**纯 PC 路径**（不带 PDA 头）：历史箱属于早期那次运行的仓，带本批设备头会先撞设备仓校验，
      // 那样验的就不是「回放窄校验」这一条
      const r = await http.post(`/api/packages/${pid}/print-label`, {
        token, headers: { 'X-Request-Key': bad.request_key }, json: {},
      })
      console.log(`        [证据] 原 key 重放 → HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`)
      assert.equal(r.status, 409, `历史错误回执重放应 409（不得照旧回放），实际 ${r.status}`)
      assert.equal(r.data?.code, 'PACKAGE_LABEL_RECEIPT_MISMATCH', `应给出核对提示，实际 code=${r.data?.code}`)

      // ── PL6：**查询回执**入口（前端恢复靠它，不是靠写重放）同样不得把别箱的 job 当本次结果 ──
      // 公共 hook 一看到 `status === 'success'` 就会清 pending、走 onConfirmed，`resolveServerState`
      // 之后不会再拦 —— 所以只在写重放上校验挡不住这条恢复路径。
      const scopedQuery = await http.get(
        `/api/system/request-status/${encodeURIComponent(bad.request_key)}?action=${encodeURIComponent(`package.print-label.${pid}`)}`,
        { token })
      console.log(`        [证据] GET request-status (scoped) → HTTP ${scopedQuery.status} ${JSON.stringify(scopedQuery.data).slice(0, 200)}`)
      assert.equal(scopedQuery.status, 409, `scoped 查询历史错误回执应 409 要求人工核对，实际 ${scopedQuery.status}`)
      assert.equal(scopedQuery.data?.code, 'PACKAGE_LABEL_RECEIPT_MISMATCH', `应给出核对提示，实际 code=${scopedQuery.data?.code}`)

      const baseQuery = await http.get(
        `/api/system/request-status/${encodeURIComponent(bad.request_key)}?action=package.print-label`,
        { token })
      console.log(`        [证据] GET request-status (base) → HTTP ${baseQuery.status} status=${baseQuery.data?.data?.status}`)
      assert.notEqual(
        baseQuery.data?.data?.status, 'success',
        'base 查询同样不得把历史错误回执判为 success（前端一看到 success 就会清 pending 当成功）')
    })

    // ══ PF1【红】入队已成功但回执未落：必须整体回滚，不能留「队列有 job、回执没有」════
    // 静态事实（旧实现）：begin 走 pool（自动提交）、入队在另一条连接、complete 又在 pool ——
    // 中间任何一步失败都会留下半成功状态。正确语义：同一 conn 同一事务，任一环节抛错整体回滚，
    // 原 key 在故障消除后可直接重试（且重试后只有**一个** job）。
    await check('PF1 回执写入失败应整体回滚：队列无残留、原键可重试', async () => {
      const t = await packedTask(40)
      const k = key('plabel-fault')
      const before = Number((await q(
        "SELECT COUNT(*) c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId]))[0].c)

      // 故障注入：只让**第一次** `UPDATE operation_requests`（即 completeOperationRequest）抛错。
      // 记录每条连接的原 query 并在结束前逐一恢复，避免污染连接池里已 release 的连接。
      const originals = []
      const origGet = pool.getConnection.bind(pool)
      let injected = false
      pool.getConnection = async function patched() {
        const conn = await origGet()
        const origQuery = conn.query.bind(conn)
        originals.push({ conn, origQuery })
        conn.query = function patchedQuery(sql, params) {
          if (!injected && /UPDATE operation_requests\s+SET status/.test(String(sql))) {
            injected = true
            return Promise.reject(new Error('INJECTED: complete receipt failure'))
          }
          return origQuery(sql, params)
        }
        return conn
      }

      let failed500 = false
      try {
        const r = await printLabelReq(t.pkgId, k)
        console.log(`        [证据] 注入回执写失败后 → HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`)
        failed500 = r.status >= 500
      } finally {
        pool.getConnection = origGet
        for (const o of originals) o.conn.query = o.origQuery
      }
      assert.ok(injected, '故障注入未命中 completeOperationRequest')
      assert.ok(failed500, '回执写入失败时应以 5xx 失败（而不是假装成功）')

      const after = Number((await q(
        "SELECT COUNT(*) c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId]))[0].c)
      const rows = await q('SELECT id, status FROM operation_requests WHERE request_key=?', [k])
      console.log(`        [证据] 队列 job 数 ${before}→${after}；回执行 ${rows.length} 条`)
      assert.equal(after, before, `回执失败必须整体回滚：不得留下已入队 job（${before}→${after}）`)
      assert.equal(rows.length, 0, `回执失败不得残留回执行，实际 ${JSON.stringify(rows)}`)

      // 故障消除后原 key 重试应成功，且只产生**一个**新 job
      const retry = await printLabelReq(t.pkgId, k)
      console.log(`        [证据] 故障消除后原键重试 → HTTP ${retry.status} job=${retry.data?.data?.job?.id}`)
      assert.ok(retry.ok, `故障消除后原键重试应成功：${retry.status} ${JSON.stringify(retry.data).slice(0, 200)}`)
      const retryCount = Number((await q(
        "SELECT COUNT(*) c FROM print_jobs WHERE ref_type='package' AND ref_id=?", [t.pkgId]))[0].c)
      assert.equal(retryCount, before + 1, `重试后应只多出一个 job，实际 ${before}→${retryCount}`)
    })

    // ══ PL2【红】设备仓与箱所属仓不匹配的 PDA 不得补打 ═════════════════════════
    // 现状：`print-label` 路由只挂 requirePermission，既无 scope 也无设备会话校验；
    // controller 也没传 scopeWarehouseIds / pdaWarehouseId → 拿着 A 仓的 PDA 能给 B 仓的箱补打。
    await check('PL2 设备仓与箱所属仓不匹配时补打应被拒（403）', async () => {
      const t = await packedTask(40)
      const w2 = must(await http.post('/api/warehouses', {
        token, json: { name: `PB-C4-异仓-${rnd().toUpperCase()}`, type: 1 },
      }), '建异仓')
      created.warehouses.push(Number(w2.id))
      const d2 = must(await http.post('/api/pda-devices', {
        token, json: { deviceName: `PB-C4-异仓设备-${rnd()}`, warehouseId: Number(w2.id) },
      }), '登记异仓设备')
      created.devices.push(Number(d2.id))
      const s2 = must(await http.post('/api/pda/sessions', {
        token, json: { device_code: d2.deviceCode, device_secret: d2.deviceSecret },
      }), '换异仓票据')

      const r = await http.post(`/api/packages/${t.pkgId}/print-label`, {
        token,
        headers: {
          'X-Client': 'pda', 'X-PDA-Session': s2.session_token, 'X-Request-Key': key('plabel-scope'),
        },
        json: {},
      })
      console.log(`        [证据] 异仓(仓 ${w2.id})设备补打本仓箱 ${t.pkgId} → HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 180)}`)
      assert.equal(r.status, 403, `设备仓不匹配应 403，实际 ${r.status}`)
      assert.equal(r.data?.code, 'PDA_WAREHOUSE_MISMATCH', `应为设备仓不匹配，实际 code=${r.data?.code}`)

      // 补 1：带 PDA 标记但**缺票**必须被拒 —— 不能因为「没票就当 PC」把设备身份放行
      const noTok = await http.post(`/api/packages/${t.pkgId}/print-label`, {
        token, headers: { 'X-Client': 'pda', 'X-Request-Key': key('plabel-notoken') }, json: {},
      })
      console.log(`        [证据] 带 PDA 标记但缺票 → HTTP ${noTok.status} ${JSON.stringify(noTok.data).slice(0, 140)}`)
      assert.equal(noTok.status, 403, `PDA 标记 + 缺票应 403，实际 ${noTok.status}`)
      assert.equal(noTok.data?.code, 'PDA_SESSION_REQUIRED', `应为缺票拒绝，实际 code=${noTok.data?.code}`)

      // 补 2：**无 PDA 标记**的 ERP 路径必须合法可用（补打是打印动作，ERP 端也该能发起）
      const erp = await http.post(`/api/packages/${t.pkgId}/print-label`, {
        token, headers: { 'X-Request-Key': key('plabel-erp') }, json: {},
      })
      console.log(`        [证据] 无 PDA 标记(ERP)补打 → HTTP ${erp.status} ${JSON.stringify(erp.data).slice(0, 160)}`)
      assert.ok(erp.ok, `ERP（无 PDA 标记）补打应成功：${erp.status} ${JSON.stringify(erp.data).slice(0, 200)}`)
    })

    // ══ PL4【红】限仓用户不得补打数据范围外仓库的箱 ═════════════════════════════
    // AGENTS §0.1 明确要求「print-jobs 列表与条码补打」覆盖范围校验；`print-label` 此前
    // 既不传 scopeWarehouseIds 也没在 service 里校验 → 只被授权 A 仓的账号能给 B 仓的箱补打。
    await check('PL4 限仓用户不得补打范围外仓库的箱（403）', async () => {
      const t = await packedTask(40)
      const w2 = must(await http.post('/api/warehouses', {
        token, json: { name: `PB-C4-范围仓-${rnd().toUpperCase()}`, type: 1 },
      }), '建范围外仓')
      created.warehouses.push(Number(w2.id))

      const uname = `pb_c4_scope_${rnd()}`.slice(0, 30)
      const pwd = `P4${rnd()}${rnd()}`            // 只在本次内存里用，不打印、不落盘
      const u = must(await http.post('/api/users', {
        token, json: { username: uname, password: pwd, realName: 'PB-C4限仓', roleId: 2 },
      }), '建限仓用户')
      created.users.push(Number(u.id))
      must(await http.put(`/api/users/${u.id}/warehouse-scope`, {
        token, json: { warehouseIds: [Number(w2.id)] },
      }), '设仓库范围')

      // ① 先把范围设成**本批作业仓**，用真实补打证明这个账号**确实有打印权限** ——
      //    否则下面那个 403 可能是「权限不足」而不是「范围保护」，等于假绿。
      must(await http.put(`/api/users/${u.id}/warehouse-scope`, {
        token, json: { warehouseIds: [Number(warehouse.id)] },
      }), '设范围=本批作业仓')
      const l1 = await http.post('/api/auth/login', { json: { username: uname, password: pwd } })
      assert.ok(l1.ok, `限仓用户应能登录：${l1.status}`)
      const t1 = l1.data?.data?.token
      const kIn = key('plabel-scope-in')
      const inScope = await http.post(`/api/packages/${t.pkgId}/print-label`, {
        token: t1, headers: { 'X-Request-Key': kIn }, json: {},
      })
      console.log(`        [证据] 限仓用户(范围=作业仓 ${warehouse.id})补打本仓箱 → HTTP ${inScope.status} ${JSON.stringify(inScope.data).slice(0, 160)}`)
      assert.ok(inScope.ok, `范围内本应有打印权限（否则 403 只是权限不足，不是范围证据）：${inScope.status} ${JSON.stringify(inScope.data).slice(0, 200)}`)

      // ② 改范围到异仓（不含本批作业仓），**重新登录**让新范围生效
      must(await http.put(`/api/users/${u.id}/warehouse-scope`, {
        token, json: { warehouseIds: [Number(w2.id)] },
      }), '设范围=异仓')
      const l2 = await http.post('/api/auth/login', { json: { username: uname, password: pwd } })
      assert.ok(l2.ok, `重新登录应成功：${l2.status}`)
      const t2 = l2.data?.data?.token

      // ③ 原 key 重放必须被范围挡下（不能因为「上次成功过」就放行）
      const replay = await http.post(`/api/packages/${t.pkgId}/print-label`, {
        token: t2, headers: { 'X-Request-Key': kIn }, json: {},
      })
      console.log(`        [证据] 改范围后**原 key 重放** → HTTP ${replay.status} ${JSON.stringify(replay.data).slice(0, 180)}`)
      assert.equal(replay.status, 403, `范围外原 key 重放应 403，实际 ${replay.status}`)
      assert.equal(replay.data?.code, 'WAREHOUSE_SCOPE_DENIED', `应为仓库范围拒绝，实际 code=${replay.data?.code}`)

      // ④ 新 key 首次同样必须被挡
      const fresh = await http.post(`/api/packages/${t.pkgId}/print-label`, {
        token: t2, headers: { 'X-Request-Key': key('plabel-scope-new') }, json: {},
      })
      console.log(`        [证据] 改范围后**新 key 首次** → HTTP ${fresh.status} ${JSON.stringify(fresh.data).slice(0, 180)}`)
      assert.equal(fresh.status, 403, `范围外新 key 应 403，实际 ${fresh.status}`)
      assert.equal(fresh.data?.code, 'WAREHOUSE_SCOPE_DENIED', `应为仓库范围拒绝，实际 code=${fresh.data?.code}`)
    })
  } finally {
    // 收尾整体再包一层 try/finally：收尾里**任何**未预期异常（含只读 q 抛错）都不得
    // 跳过 server/pool 的关闭，否则进程会挂住不退出。
    try {
    // ── 收尾：全部走合法 API（不物理删历史）────────────────────────────────────
    console.log('[cleanup] 开始合法收尾')
    if (!token) console.error('[cleanup] 无有效登录票据，跳过需要鉴权的收尾（仅关本进程 server/pool）')
    for (const saleId of token ? created.sales : []) {
      try {
        const [so] = await q('SELECT task_id FROM sale_orders WHERE id=?', [saleId])
        const taskId = so?.task_id == null ? null : Number(so.task_id)
        if (taskId == null) { await http.post(`/api/sale/${saleId}/cancel`, { token }); continue }
        const [tk] = await q('SELECT status, cancel_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
        const [left] = await q('SELECT COUNT(*) c FROM inventory_containers WHERE locked_by_task_id=?', [taskId])
        if (Number(tk?.status) === 8 && Number(left.c) === 0) { console.log(`[cleanup] 任务 ${taskId} 已 8/锁0`); continue }
        if (Number(tk.status) !== 8 && !tk.cancel_requested_at) await http.post(`/api/sale/${saleId}/cancel`, { token })
        const locked = await q('SELECT id, barcode FROM inventory_containers WHERE locked_by_task_id=?', [taskId])
        for (const c of locked) {
          await http.post('/api/scan-logs/cancel-return', {
            token, headers: pdaHeaders(), json: { taskId, containerId: Number(c.id), barcode: c.barcode, locationId: Number(location?.id) },
          })
        }
        const done = await q('SELECT id, barcode FROM packages WHERE warehouse_task_id=? AND status=2 ORDER BY id', [taskId])
        for (const p of done) {
          await http.post('/api/scan-logs/cancel-return/box', {
            token, headers: pdaHeaders(), json: { taskId, packageId: Number(p.id), barcode: p.barcode },
          })
        }
        const [tk2] = await q('SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
        const [left2] = await q('SELECT COUNT(*) c FROM inventory_containers WHERE locked_by_task_id=?', [taskId])
        const ok = Number(tk2.status) === 8 && Number(left2.c) === 0
        if (ok) console.log(`[OK] 任务 ${taskId} → status=${tk2.status} 锁=${left2.c}`)
        else cleanupFail(`任务 ${taskId}`, `应为 status=8 且锁 0，实际 status=${tk2.status} 锁=${left2.c}`)
      } catch (e) { cleanupFail(`销售 ${saleId}`, e.message) }
    }
    for (const id of token ? created.devices : []) {
      try {
        await http.put(`/api/pda-devices/${id}`, { token, json: { warehouseId: null } })
        await http.put(`/api/pda-devices/${id}/status`, { token, json: { status: 'disabled' } })
        const d = (await q('SELECT warehouse_id, status FROM pda_devices WHERE id=?', [id]))[0]
        const t = (await q('SELECT COUNT(*) c FROM pda_device_sessions WHERE device_id=? AND revoked_at IS NULL', [id]))[0]
        console.log(`[cleanup] 设备 ${id} → 仓=${d?.warehouse_id} 状态=${d?.status} 有效票据=${t?.c}`)
        assert.ok(d?.warehouse_id == null && d?.status === 'disabled' && Number(t?.c) === 0,
          `设备 ${id} 应为 未绑仓 + disabled + 有效票据 0，实际 ${JSON.stringify(d)} 票据=${t?.c}`)
      } catch (e) { cleanupFail(`设备 ${id}`, e.message) }
    }
    // 打印机**不 DELETE**（当前 DELETE 会物理删打印机，并牵连其 jobs/receipt 历史）：
    // 先解绑 package_label 用途，再停用（status=0），打印机 / client / job 历史全部保留。
    for (const id of token ? created.printers : []) {
      try {
        const unbind = await http.del(`/api/printer-bindings/package_label?warehouseId=${created.warehouses[0] ?? 0}`, { token })
        const off = await http.put(`/api/printers/${id}`, { token, json: { status: 0 } })
        const p = (await q('SELECT status, client_id FROM printers WHERE id=?', [id]))[0]
        console.log(`[cleanup] 打印机 ${id} 解绑=${unbind.status} 停用=${off.status} → status=${p?.status} client=${p?.client_id}`)
        assert.ok(unbind.ok, `打印机 ${id} 解绑 package_label 应成功，实际 ${unbind.status}`)
        assert.ok(Number(p?.status) === 0, `打印机 ${id} 应停用(status=0)，实际 ${p?.status}`)
        const bind = (await q('SELECT COUNT(*) c FROM printer_bindings WHERE print_type=? AND warehouse_id=?',
          ['package_label', created.warehouses[0] ?? 0]))[0]
        assert.ok(Number(bind?.c) === 0, `package_label 绑定应已清空，实际 ${bind?.c} 条`)
      } catch (e) { cleanupFail(`打印机 ${id}`, e.message) }
    }
    // 限仓用户：停用保留（不物理删历史账号）
    for (const id of token ? created.users : []) {
      try {
        const u = await q('SELECT username, real_name FROM sys_users WHERE id=?', [id])
        const off = await http.put(`/api/users/${id}`, {
          token, json: { realName: u[0]?.real_name || 'PB-C4限仓', isActive: false },
        })
        const after = (await q('SELECT is_active FROM sys_users WHERE id=?', [id]))[0]
        console.log(`[cleanup] 用户 ${id}(${u[0]?.username}) 停用=${off.status} → is_active=${after?.is_active}`)
        assert.ok(Number(after?.is_active) === 0, `用户 ${id} 应停用，实际 is_active=${after?.is_active}`)
      } catch (e) { cleanupFail(`用户 ${id}`, e.message) }
    }
    // 仓：被库位/库存/任务引用时 API 明确 409「禁止删除，请改为停用」——按设计**停用**，
    // 不绕过。库存：只走真实取消归还/受控拆箱；归还后若仍有自建库存残留，**保留并登记**，
    // 不手改不删除（用户口径：不为「收尾全 0」动数据）。
    for (const whId of created.warehouses) {
      try {
        const left = await q(
          'SELECT status, COUNT(*) c FROM inventory_containers WHERE warehouse_id=? GROUP BY status', [whId])
        const alive = left.filter((r) => Number(r.status) !== 3)
        const desc = left.map((r) => `status=${r.status}:${r.c}`).join(' ')
        if (alive.length) console.log(`[cleanup] [保留] 仓 ${whId} 残留容器（${desc}）——无合法清理入口，登记保留`)
        const [wh] = await q('SELECT name FROM inventory_warehouses WHERE id=?', [whId])
        const off = await http.put(`/api/warehouses/${whId}`, {
          token, json: { name: wh?.name || `PB-C4-仓-${whId}`, type: 1, isActive: false },
        })
        const after = (await q('SELECT is_active FROM inventory_warehouses WHERE id=?', [whId]))[0]
        console.log(`[cleanup] 仓 ${whId} 停用=${off.status} → is_active=${after?.is_active}`)
        assert.ok(Number(after?.is_active) === 0, `仓 ${whId} 应停用，实际 is_active=${after?.is_active}`)
      } catch (e) { cleanupFail(`仓 ${whId}`, e.message) }
    }

    // 主数据 ledger：这些对象没有「合法删除入口」，按用户口径登记保留，不为了全 0 强删
    console.log(`[cleanup] ledger 保留：分类 ${created.categories.join(',') || '-'}；`
      + `供应商 ${created.suppliers.join(',') || '-'}；客户 ${created.customers.join(',') || '-'}；`
      + `商品 ${created.products.join(',') || '-'}；分拣格 ${created.bins.join(',') || '-'}；`
      + `销售 ${created.sales.join(',') || '-'}；仓 ${created.warehouses.join(',') || '-'}；`
      + `限仓用户 ${created.users.join(',') || '-'}`)
    } catch (e) {
      cleanupFail('收尾过程', e?.message || String(e))
    } finally {
      console.log(`\n结果：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`)
      if (failed > 0) process.exitCode = 1
      try { await new Promise((r) => server.close(r)) } catch { /* ignore */ }
      try { await pool.end() } catch { /* ignore */ }
    }
  }
}

main().catch(async (e) => {
  console.error('SUITE_ERR:', e?.stack || e?.message || String(e))
  try { await pool.end() } catch { /* ignore */ }
  process.exitCode = 1
})
