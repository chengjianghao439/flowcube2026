#!/usr/bin/env node
'use strict'

/**
 * 序列号一致性 smoke（文档 04 · §5.1/5.3/§10）
 *
 * 锁死 serial_managed 商品的核心不变量：
 *   「任一容器 remaining_qty == 挂在它上、status=1(在库) 的序列号行数」——
 *   绝不允许"序列号说有 5、容器说有 4"。全链路每一步都逐容器核对，并核对全局 Σ。
 *
 * 覆盖：
 *   1. 收货逐台登记（§5.1）：每箱扫入 SN，箱数量必须等于该箱 SN 数、本次不得重复；
 *      登记后容器 remaining_qty 天然等于其在库 SN 数。
 *   2. 收货闸门：箱数量与 SN 数不符 → SERIAL_RECEIVE_COUNT_MISMATCH；本批重复 → SERIAL_DUP_IN_BATCH；
 *      两者都在事务前拦下，一件都不入账。
 *   3. 上架留痕（§5.2）：容器随箱整体上架，逐台写 putaway 事件，不变量保持。
 *   4. 出库逐台核销（§5.3）：出库必扫 SN（不传 → SERIAL_SHIP_COUNT_MISMATCH 强制），核销后
 *      被发容器 remaining_qty==在库 SN 数；未动容器保持不变量；已发 SN 转「已出库」。
 *   5. 台账/追溯/对账：GET /serials/trace 时间线含 register→putaway→ship；
 *      GET /serials/check-consistency 全程 0 不一致。
 *   6. 激活前安全闸门：销售退货入库对 serial_managed 商品被 assertNoSerialManaged 挡住
 *      （Phase 2 未覆盖销售退货 SN 登记，宁可挡住也不放任静默不一致）。
 *
 * 运行：node tests/serial-consistency.smoke.test.js（依赖真实 MySQL，同其它 smoke）
 */

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createInboundTaskFromPurchase,
  randomRef,
} = require('./helpers/smokeTestKit')

// ── DB 探针（全部只读，直接查真值容器/序列号，不信任接口返回） ────────────
async function activeContainerSum(pool, productId, warehouseId) {
  const rows = await dbQuery(
    pool,
    'SELECT COALESCE(SUM(remaining_qty),0) AS s FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL',
    [productId, warehouseId],
  )
  return Number(rows[0].s)
}

async function inStockSerialCount(pool, productId) {
  const rows = await dbQuery(
    pool,
    'SELECT COUNT(*) AS n FROM product_serials WHERE product_id=? AND status=1',
    [productId],
  )
  return Number(rows[0].n)
}

async function containerRemaining(pool, containerId) {
  const rows = await dbQuery(pool, 'SELECT remaining_qty, status FROM inventory_containers WHERE id=?', [containerId])
  return rows.length ? { remaining: Number(rows[0].remaining_qty), status: Number(rows[0].status) } : null
}

async function containerSerialCount(pool, containerId) {
  const rows = await dbQuery(pool, 'SELECT COUNT(*) AS n FROM product_serials WHERE container_id=? AND status=1', [containerId])
  return Number(rows[0].n)
}

/** 每个 ACTIVE 容器：remaining_qty 必须等于挂在它上的在库 SN 数（核心不变量，逐容器核对） */
async function assertPerContainerInvariant(pool, log, productId, warehouseId, label) {
  const rows = await dbQuery(
    pool,
    `SELECT c.id, c.remaining_qty,
            (SELECT COUNT(*) FROM product_serials ps WHERE ps.container_id=c.id AND ps.status=1) AS sn
     FROM inventory_containers c
     WHERE c.product_id=? AND c.warehouse_id=? AND c.status=1 AND c.deleted_at IS NULL`,
    [productId, warehouseId],
  )
  const bad = rows.filter(r => Number(r.remaining_qty) !== Number(r.sn))
  log.assert(
    `${label}：每个 ACTIVE 容器 remaining_qty==在库SN数（共 ${rows.length} 个容器）`,
    bad.length === 0,
    bad.length ? JSON.stringify(bad) : '',
  )
}

async function createSerialProduct(pool, label) {
  const code = randomRef(`SER-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price, serial_managed) VALUES (?, ?, '台', 100, 60, 1)",
    [code, `序列号测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `序列号测试商品-${label}`, unit: '台' }
}

async function bindPrinter(pool, { warehouseId, printType, printerId, printerCode }) {
  await pool.query(
    `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE printer_id = VALUES(printer_id), printer_code = VALUES(printer_code)`,
    [warehouseId, printType, printerId, printerCode],
  )
}

// ── 收货登记 + 闸门 + 容器不变量 ─────────────────────────────────────────
async function scenarioReceive(ctx, log, token, product, sns) {
  log.section('§5.1 收货逐台登记：箱数量=SN数校验 + 本批查重 + 容器不变量')
  const { http, pool, warehouse, pdaHeaders, supplier } = ctx

  const poCreate = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: 3 })
  log.assert('创建采购单成功', poCreate.ok, JSON.stringify(poCreate.data).slice(0, 200))
  const poId = Number(poCreate.data?.data?.id)
  await confirmPurchaseOrder(http, token, poId)
  const inbound = await createInboundTaskFromPurchase(http, token, poId)
  const taskId = Number(inbound.data?.data?.taskId)
  await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })

  const recv = (json) => http.post(`/api/inbound-tasks/${taskId}/receive`, { token, headers: pdaHeaders(), json })

  // 闸门 1：箱数量=2 但只扫 1 个 SN → 拒绝，且一件不入账
  const mismatch = await recv({ productId: Number(product.id), packages: [{ qty: 2, serialNos: [sns.A] }] })
  log.assert(
    '★ 箱数量与 SN 数不符被拒绝（SERIAL_RECEIVE_COUNT_MISMATCH）',
    mismatch.status === 400 && mismatch.data?.code === 'SERIAL_RECEIVE_COUNT_MISMATCH',
    `status=${mismatch.status} code=${mismatch.data?.code}`,
  )

  // 闸门 2：本批重复 SN → 拒绝
  const dup = await recv({ productId: Number(product.id), packages: [{ qty: 2, serialNos: [sns.A, sns.A] }] })
  log.assert(
    '★ 本次收货重复 SN 被拒绝（SERIAL_DUP_IN_BATCH）',
    dup.status === 400 && dup.data?.code === 'SERIAL_DUP_IN_BATCH',
    `status=${dup.status} code=${dup.data?.code}`,
  )

  const [afterGate] = await dbQuery(pool, 'SELECT COALESCE(SUM(received_qty),0) AS q FROM inbound_task_items WHERE task_id=?', [taskId])
  log.assert('闸门拦下时一件都未入账（事务完整回滚）', Number(afterGate.q) === 0, `received=${afterGate.q}`)
  log.assert('闸门拦下时未登记任何序列号', (await inStockSerialCount(pool, product.id)) === 0)

  // 正常收货：第 1 箱 2 台 [A,B]，第 2 箱 1 台 [C]
  const r1 = await recv({ productId: Number(product.id), packages: [{ qty: 2, serialNos: [sns.A, sns.B] }] })
  log.assert('第 1 箱收货成功（2 台 A/B）', r1.ok, JSON.stringify(r1.data).slice(0, 200))
  const container1 = Number(r1.data?.data?.containers?.[0]?.containerId)
  const container1Code = r1.data?.data?.containers?.[0]?.containerCode

  const r2 = await recv({ productId: Number(product.id), packages: [{ qty: 1, serialNos: [sns.C] }] })
  log.assert('第 2 箱收货成功（1 台 C）', r2.ok, JSON.stringify(r2.data).slice(0, 200))
  const container2 = Number(r2.data?.data?.containers?.[0]?.containerId)
  const container2Code = r2.data?.data?.containers?.[0]?.containerCode

  // 收货后（容器仍待上架 status=4）：逐容器 remaining==挂载在库SN数
  const c1 = await containerRemaining(pool, container1)
  const c2 = await containerRemaining(pool, container2)
  log.assert('容器1 待上架(4) 且 remaining=2', c1?.status === 4 && c1?.remaining === 2, JSON.stringify(c1))
  log.assert('容器2 待上架(4) 且 remaining=1', c2?.status === 4 && c2?.remaining === 1, JSON.stringify(c2))
  log.assert('★ 容器1 remaining(2)==挂载在库SN数', (await containerSerialCount(pool, container1)) === 2)
  log.assert('★ 容器2 remaining(1)==挂载在库SN数', (await containerSerialCount(pool, container2)) === 1)
  log.assert('全局在库 SN 数 = 3（A/B/C 全部登记为在库）', (await inStockSerialCount(pool, product.id)) === 3)

  // 三台 SN 都应能查到，且状态=在库(1)、归属正确的容器
  const rows = await dbQuery(pool, 'SELECT serial_no, status, container_id FROM product_serials WHERE product_id=? ORDER BY serial_no', [product.id])
  log.assert('A/B 挂容器1、C 挂容器2，均在库(1)',
    rows.length === 3
      && rows.every(r => Number(r.status) === 1)
      && Number(rows.find(r => r.serial_no === sns.A).container_id) === container1
      && Number(rows.find(r => r.serial_no === sns.B).container_id) === container1
      && Number(rows.find(r => r.serial_no === sns.C).container_id) === container2,
    JSON.stringify(rows),
  )

  return { taskId, container1, container1Code, container2, container2Code }
}

// ── 上架 + 一致性对账 ────────────────────────────────────────────────────
async function scenarioPutaway(ctx, log, token, product, recv) {
  log.section('§5.2 上架留痕 + §8 一致性对账（0 不一致）')
  const { http, pool, warehouse, location, pdaHeaders } = ctx

  const putaway = (containerId) => http.post(`/api/inbound-tasks/${recv.taskId}/putaway`, {
    token, headers: pdaHeaders(), json: { containerId, locationId: Number(location.id) },
  })
  const p1 = await putaway(recv.container1)
  log.assert('容器1 上架成功', p1.ok, JSON.stringify(p1.data).slice(0, 200))
  const p2 = await putaway(recv.container2)
  log.assert('容器2 上架成功', p2.ok, JSON.stringify(p2.data).slice(0, 200))

  const c1 = await containerRemaining(pool, recv.container1)
  const c2 = await containerRemaining(pool, recv.container2)
  log.assert('容器1 已 ACTIVE(1) 且 remaining=2', c1?.status === 1 && c1?.remaining === 2, JSON.stringify(c1))
  log.assert('容器2 已 ACTIVE(1) 且 remaining=1', c2?.status === 1 && c2?.remaining === 1, JSON.stringify(c2))

  await assertPerContainerInvariant(pool, log, product.id, warehouse.id, '上架后')

  // putaway 留痕：每台写一条 putaway 事件（共 3 台）
  const [{ n: putawayEvents }] = await dbQuery(
    pool,
    `SELECT COUNT(*) AS n FROM serial_events se
     JOIN product_serials ps ON ps.id = se.serial_id
     WHERE ps.product_id=? AND se.event_type='putaway'`,
    [product.id],
  )
  log.assert('★ 上架为每台写 putaway 事件（3 条）', Number(putawayEvents) === 3, `events=${putawayEvents}`)

  // 全局 Σ：ACTIVE 容器合计(3) == 在库 SN 数(3)
  log.assert('★ 全局 ACTIVE 容器合计(3)==在库SN数(3)',
    (await activeContainerSum(pool, product.id, warehouse.id)) === 3 && (await inStockSerialCount(pool, product.id)) === 3)

  // 接口对账：check-consistency 应 0 不一致
  const cc = await http.get(`/api/serials/check-consistency?warehouseId=${warehouse.id}`, { token })
  log.assert('GET /serials/check-consistency 返回成功', cc.ok, `status=${cc.status}`)
  log.assert('★ 对账：一致（mismatchCount=0, consistent=true）',
    cc.data?.data?.consistent === true && Number(cc.data?.data?.mismatchCount) === 0,
    JSON.stringify(cc.data?.data).slice(0, 300))
}

// 把销售单从建单推进到「待出库(6)」：占库 → 发起出库 → 拣(整容器) → ready → sort → check → 打包 → pack-done
async function advanceSaleToShipping(ctx, token, { saleId, product, container }) {
  const { http, pool, pdaHeaders } = ctx
  await http.post(`/api/sale/${saleId}/reserve`, { token })
  await http.post(`/api/sale/${saleId}/ship`, { token })
  const [saleRow] = await dbQuery(pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
  const taskId = Number(saleRow.task_id)
  const [itemRow] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])

  const pick = await http.post('/api/scan-logs', {
    token, headers: pdaHeaders(),
    json: { taskId, itemId: itemRow.id, containerId: container.id, barcode: container.barcode, productId: Number(product.id), qty: 1, scanMode: '整件' },
  })
  if (!pick.ok) throw new Error(`pick failed: ${JSON.stringify(pick.data)}`)
  const ready = await http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: pdaHeaders() })
  if (!ready.ok) throw new Error(`ready failed: ${JSON.stringify(ready.data)}`)
  const sortDone = await http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: pdaHeaders(), json: {} })
  if (!sortDone.ok) throw new Error(`sort-done failed: ${JSON.stringify(sortDone.data)}`)
  // 复核扫码：单台扫满即自动收口进 PACKING
  const checkScan = await http.post('/api/scan-logs/check', { token, headers: pdaHeaders(), json: { taskId, barcode: container.barcode } })
  if (!checkScan.ok) throw new Error(`check scan failed: ${JSON.stringify(checkScan.data)}`)
  // 打包：建箱 → 装 1 台 → 完成（出箱贴打印任务）→ 本机核销打印 → pack-done
  const pkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: taskId } })
  const pkgId = Number(pkg.data?.data?.id)
  await http.post(`/api/packages/${pkgId}/add-item`, { token, headers: pdaHeaders(), json: { productCode: product.code, qty: 1 } })
  const finish = await http.put(`/api/packages/${pkgId}/finish`, { token, headers: pdaHeaders() })
  if (!finish.ok) throw new Error(`package finish failed: ${JSON.stringify(finish.data)}`)
  const printJobId = Number(finish.data?.data?.printJobId)
  await http.post(`/api/print-jobs/${printJobId}/complete-local`, { token, json: {} })
  const packDone = await http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token, headers: pdaHeaders() })
  if (!packDone.ok) throw new Error(`pack-done failed: ${JSON.stringify(packDone.data)}`)
  return taskId
}

// ── 出库逐台核销 + 强制扫 SN + 不变量 ────────────────────────────────────
async function scenarioShip(ctx, log, token, product, sns, recv) {
  log.section('§5.3 出库逐台核销：强制扫 SN + 容器不变量 + 已发转「已出库」')
  const { http, pool, warehouse, customer } = ctx

  // 销售 1 台（发货仓即收货仓），只发容器2 的 C，留 A/B 在库验证「未动容器不变量保持」
  const saleCreate = await http.post('/api/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('serial-sale'),
      items: [{ productId: Number(product.id), productCode: product.code, productName: product.name, unit: product.unit, quantity: 1, unitPrice: 120 }],
    },
  })
  log.assert('创建销售单成功', saleCreate.ok, JSON.stringify(saleCreate.data).slice(0, 200))
  const saleId = Number(saleCreate.data?.data?.id)

  const container2 = { id: recv.container2, barcode: recv.container2Code, location_id: ctx.location.id }
  const taskId = await advanceSaleToShipping(ctx, token, { saleId, product, container: container2 })
  const [taskAtShipping] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已到待出库(6)', Number(taskAtShipping.status) === 6, JSON.stringify(taskAtShipping))

  const pid = Number(product.id)

  // 强制扫 SN：不传 serialNosByProduct 出库 → 数量不符被拒，且事务回滚（容器未扣、任务仍在 6）
  const noSn = await http.put(`/api/warehouse-tasks/${taskId}/ship`, { token, headers: ctx.pdaHeaders() })
  log.assert(
    '★ serial 商品出库未传 SN 被拒绝（SERIAL_SHIP_COUNT_MISMATCH）',
    noSn.status === 409 && noSn.data?.code === 'SERIAL_SHIP_COUNT_MISMATCH',
    `status=${noSn.status} code=${noSn.data?.code} msg=${noSn.data?.message}`,
  )
  const c2AfterFail = await containerRemaining(pool, recv.container2)
  log.assert('被拒后容器2 未被扣减（remaining 仍为 1、仍 ACTIVE）', c2AfterFail?.remaining === 1 && c2AfterFail?.status === 1, JSON.stringify(c2AfterFail))
  const [taskAfterFail] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('被拒后任务仍在待出库(6)', Number(taskAfterFail.status) === 6, JSON.stringify(taskAfterFail))

  // 错台防护：扫一个不属于本次锁定容器的 SN（A 挂在容器1，本次只锁了容器2）→ 被拒
  const wrongSn = await http.put(`/api/warehouse-tasks/${taskId}/ship`, {
    token, headers: ctx.pdaHeaders(), json: { serialNosByProduct: { [pid]: [sns.A] } },
  })
  log.assert(
    '★ 扫非本次锁定容器的 SN 被拒绝（SERIAL_CONTAINER_MISMATCH）',
    wrongSn.status === 409 && wrongSn.data?.code === 'SERIAL_CONTAINER_MISMATCH',
    `status=${wrongSn.status} code=${wrongSn.data?.code} msg=${wrongSn.data?.message}`,
  )

  // 正确出库：扫 C 出库
  const ship = await http.put(`/api/warehouse-tasks/${taskId}/ship`, {
    token, headers: ctx.pdaHeaders(), json: { serialNosByProduct: { [pid]: [sns.C] } },
  })
  log.assert('扫 SN(C) 出库成功', ship.ok, JSON.stringify(ship.data).slice(0, 200))

  // 核销后：C 转「已出库(2)」、脱离容器、带 warehouse_task_id；容器2 已扣空
  const [cRow] = await dbQuery(pool, 'SELECT status, container_id, warehouse_task_id, sale_order_id FROM product_serials WHERE product_id=? AND serial_no=?', [pid, sns.C])
  log.assert('★ C 已转「已出库(2)」、container_id 置空、带 warehouse_task_id',
    Number(cRow.status) === 2 && cRow.container_id === null && Number(cRow.warehouse_task_id) === taskId,
    JSON.stringify(cRow))
  const c2After = await containerRemaining(pool, recv.container2)
  log.assert('容器2 已扣空（remaining=0，不再 ACTIVE）', c2After?.remaining === 0 && c2After?.status !== 1, JSON.stringify(c2After))

  // 未动的容器1（A/B）不变量保持；全局对账仍一致
  log.assert('★ 未动容器1 remaining(2)==挂载在库SN数(2)',
    (await containerRemaining(pool, recv.container1))?.remaining === 2 && (await containerSerialCount(pool, recv.container1)) === 2)
  await assertPerContainerInvariant(pool, log, product.id, warehouse.id, '出库后')
  log.assert('★ 全局 ACTIVE 容器合计(2)==在库SN数(2)',
    (await activeContainerSum(pool, product.id, warehouse.id)) === 2 && (await inStockSerialCount(pool, product.id)) === 2)

  const cc = await http.get(`/api/serials/check-consistency?warehouseId=${warehouse.id}`, { token })
  log.assert('★ 出库后对账仍 0 不一致', cc.data?.data?.consistent === true && Number(cc.data?.data?.mismatchCount) === 0, JSON.stringify(cc.data?.data).slice(0, 300))

  // 追溯：C 的时间线应含 register → putaway → ship
  const trace = await http.get(`/api/serials/trace?serialNo=${encodeURIComponent(sns.C)}`, { token })
  const events = trace.data?.data?.matches?.[0]?.events || []
  const types = events.map(e => e.eventType)
  log.assert('★ 追溯 C 时间线含 register→putaway→ship',
    types.includes('register') && types.includes('putaway') && types.includes('ship'),
    JSON.stringify(types))
}

// ── 激活前安全闸门：销售退货入库挡住 serial 商品 ─────────────────────────
async function scenarioSaleReturnBlocked(ctx, log, token, product) {
  log.section('激活前安全闸门：销售退货入库对 serial 商品被挡住（assertNoSerialManaged）')
  const { http, pool, warehouse, customer, pdaHeaders } = ctx

  const srCreate = await http.post('/api/returns/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('serial-sr'),
      items: [{ productId: Number(product.id), productCode: product.code, productName: product.name, unit: product.unit, quantity: 1, unitPrice: 120 }],
    },
  })
  log.assert('创建销售退货单成功', srCreate.status === 201 && !!srCreate.data?.data?.id, `status=${srCreate.status}`)
  const srId = Number(srCreate.data?.data?.id)
  await http.post(`/api/returns/sale/${srId}/confirm`, { token })

  const [srTask] = await dbQuery(pool, "SELECT id FROM return_tasks WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 1", [srId])
  log.assert('已自动创建销售退货任务', !!srTask, JSON.stringify(srTask))

  const recv = await http.post(`/api/return-tasks/${srTask.id}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: 1 }] },
  })
  log.assert(
    '★ serial 商品销售退货入库被挡住（SERIAL_REVERSE_UNSUPPORTED）',
    recv.status === 400 && recv.data?.code === 'SERIAL_REVERSE_UNSUPPORTED',
    `status=${recv.status} code=${recv.data?.code} msg=${recv.data?.message}`,
  )
  // 被挡后未建任何容器、未登记任何新序列号
  const [{ n: containerN }] = await dbQuery(pool, "SELECT COUNT(*) AS n FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=?", [srTask.id])
  log.assert('被挡后未建任何销售退货容器', Number(containerN) === 0, `containers=${containerN}`)
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行序列号一致性 smoke')

    // 打包/箱贴打印闭合需要打印机绑定（pack-done 要求箱贴打印任务已收口）
    for (const printType of ['container_label', 'rack_label', 'package_label']) {
      await bindPrinter(ctx.pool, { warehouseId: Number(ctx.warehouse.id), printType, printerId: Number(ctx.printer.id), printerCode: ctx.printer.code })
    }

    const product = await createSerialProduct(ctx.pool, 'main')
    const suffix = randomRef('SN').slice(-8)
    const sns = { A: `SNA-${suffix}`, B: `SNB-${suffix}`, C: `SNC-${suffix}` }

    const recv = await scenarioReceive(ctx, log, token, product, sns)
    await scenarioPutaway(ctx, log, token, product, recv)
    await scenarioShip(ctx, log, token, product, sns, recv)
    await scenarioSaleReturnBlocked(ctx, log, token, product)
  } finally {
    const summary = log.summary()
    await ctx.close()
    process.exit(summary.failed > 0 ? 1 : 0)
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
