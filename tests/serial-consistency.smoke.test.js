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
 *   6. 销售退货 SN 回冲（文档04 Phase3）：退货收货逐台扫 SN，已出库(2)回冲为在库(1)、绑新退货容器；
 *      未扫 SN 被 SERIAL_RETURN_COUNT_MISMATCH 挡住；退货容器账实一致；追溯含 ship→return_in。
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

// ── 销售退货 SN 回冲（文档04 Phase3）：逐台扫SN，已出库→在库、绑退货容器 ─────────
async function scenarioSaleReturnSerial(ctx, log, token, product, sns) {
  log.section('§5.4 销售退货 SN 回冲：逐台扫SN，已出库转在库、绑退货容器')
  const { http, pool, warehouse, customer, pdaHeaders } = ctx
  const pid = Number(product.id)

  const srCreate = await http.post('/api/returns/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('serial-sr'),
      items: [{ productId: pid, productCode: product.code, productName: product.name, unit: product.unit, quantity: 1, unitPrice: 120 }],
    },
  })
  log.assert('创建销售退货单成功', srCreate.status === 201 && !!srCreate.data?.data?.id, `status=${srCreate.status}`)
  const srId = Number(srCreate.data?.data?.id)
  await http.post(`/api/returns/sale/${srId}/confirm`, { token })

  const [srTask] = await dbQuery(pool, "SELECT id FROM return_tasks WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 1", [srId])
  log.assert('已自动创建销售退货任务', !!srTask, JSON.stringify(srTask))

  // 不扫 SN 收货 → 被新的「必须逐台扫」闸门挡住，且未建任何容器
  const noSn = await http.post(`/api/return-tasks/${srTask.id}/receive`, {
    token, headers: pdaHeaders(), json: { productId: pid, packages: [{ qty: 1 }] },
  })
  log.assert(
    '★ serial 退货收货未扫 SN 被拒（SERIAL_RETURN_COUNT_MISMATCH）',
    noSn.status === 400 && noSn.data?.code === 'SERIAL_RETURN_COUNT_MISMATCH',
    `status=${noSn.status} code=${noSn.data?.code} msg=${noSn.data?.message}`,
  )
  const [{ n: cn0 }] = await dbQuery(pool, "SELECT COUNT(*) AS n FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=?", [srTask.id])
  log.assert('被拒后未建任何退货容器', Number(cn0) === 0, `containers=${cn0}`)

  // 扫回之前出库的 C → 收货成功，C 从已出库(2)回冲为在库(1)、绑新退货容器（PENDING_QA）
  const recv = await http.post(`/api/return-tasks/${srTask.id}/receive`, {
    token, headers: pdaHeaders(), json: { productId: pid, packages: [{ qty: 1, serialNos: [sns.C] }] },
  })
  log.assert('★ 扫 SN(C) 退货收货成功', recv.ok, JSON.stringify(recv.data).slice(0, 200))
  const newContainer = Number(recv.data?.data?.containers?.[0]?.containerId)
  const [cRow] = await dbQuery(pool, 'SELECT status, container_id, return_ref_type FROM product_serials WHERE product_id=? AND serial_no=?', [pid, sns.C])
  log.assert('★ C 从「已出库(2)」回冲为「在库(1)」、绑新退货容器、return_ref=sale_return',
    Number(cRow.status) === 1 && Number(cRow.container_id) === newContainer && cRow.return_ref_type === 'sale_return',
    JSON.stringify(cRow))
  const rem = await containerRemaining(pool, newContainer)
  const snc = await containerSerialCount(pool, newContainer)
  log.assert('★ 退货容器 remaining(1)==在库SN数(1)（账实一致）', rem?.remaining === 1 && snc === 1, `remaining=${rem?.remaining} sn=${snc}`)

  // 追溯 C 时间线现含 ship → return_in
  const trace = await http.get(`/api/serials/trace?serialNo=${encodeURIComponent(sns.C)}`, { token })
  const types = (trace.data?.data?.matches?.[0]?.events || []).map(e => e.eventType)
  log.assert('★ 追溯 C 含 ship→return_in', types.includes('ship') && types.includes('return_in'), JSON.stringify(types))
}

// ── B-full 复用助手：真实收货+上架得到序列号 ACTIVE 容器；建单→占库→出库→逐容器拣货 ────
async function receiveAndPutaway(ctx, token, product, packages) {
  const { http, warehouse, location, pdaHeaders, supplier } = ctx
  const totalQty = packages.reduce((s, p) => s + p.qty, 0)
  const poCreate = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: totalQty })
  const poId = Number(poCreate.data?.data?.id)
  await confirmPurchaseOrder(http, token, poId)
  const inbound = await createInboundTaskFromPurchase(http, token, poId)
  const taskId = Number(inbound.data?.data?.taskId)
  await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })
  const containers = []
  for (const p of packages) {
    const r = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
      token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: p.qty, serialNos: p.serialNos }] },
    })
    if (!r.ok) throw new Error(`receive failed: ${JSON.stringify(r.data)}`)
    const cid = Number(r.data?.data?.containers?.[0]?.containerId)
    const barcode = r.data?.data?.containers?.[0]?.containerCode
    const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
      token, headers: pdaHeaders(), json: { containerId: cid, locationId: Number(location.id) },
    })
    if (!put.ok) throw new Error(`putaway failed: ${JSON.stringify(put.data)}`)
    containers.push({ containerId: cid, barcode, qty: p.qty })
  }
  return containers
}

async function createSaleReserveShipPick(ctx, token, product, quantity, containers) {
  const { http, pool, warehouse, customer, pdaHeaders } = ctx
  const pid = Number(product.id)
  const saleCreate = await http.post('/api/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('adj-sale'),
      items: [{ productId: pid, productCode: product.code, productName: product.name, unit: product.unit, quantity, unitPrice: 120 }],
    },
  })
  const saleId = Number(saleCreate.data?.data?.id)
  await http.post(`/api/sale/${saleId}/reserve`, { token })
  await http.post(`/api/sale/${saleId}/ship`, { token })
  const [saleRow] = await dbQuery(pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
  const taskId = Number(saleRow.task_id)
  const [itemRow] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])
  for (const c of containers) {
    const pick = await http.post('/api/scan-logs', {
      token, headers: pdaHeaders(),
      json: { taskId, itemId: itemRow.id, containerId: c.containerId, barcode: c.barcode, productId: pid, qty: c.qty, scanMode: '整件' },
    })
    if (!pick.ok) throw new Error(`pick failed: ${JSON.stringify(pick.data)}`)
  }
  return { saleId, taskId, itemId: Number(itemRow.id) }
}

// 整表替换明细提交改单（沿用现有客户/仓库）
async function adjustSaleTo(ctx, token, saleId, product, newQty) {
  const detail = await ctx.http.get(`/api/sale/${saleId}`, { token })
  const order = detail.data.data
  return ctx.http.put(`/api/sale/${saleId}/adjust`, {
    token,
    json: {
      customerId: order.customerId, customerName: order.customerName,
      warehouseId: order.warehouseId, warehouseName: order.warehouseName,
      remark: order.remark || '',
      items: [{ productId: Number(product.id), productCode: product.code, productName: product.name, unit: product.unit, quantity: newQty, unitPrice: 120 }],
    },
  })
}

// 把单容器单台的任务走完出库（复核→打包→箱贴核销→出库，出库逐台扫 SN）
async function finishAndShipSingle(ctx, token, taskId, product, containerBarcode, shipSn) {
  const { http, pdaHeaders } = ctx
  await http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: pdaHeaders() })
  await http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: pdaHeaders(), json: {} })
  await http.post('/api/scan-logs/check', { token, headers: pdaHeaders(), json: { taskId, barcode: containerBarcode } })
  const pkg = await http.post('/api/packages', { token, headers: pdaHeaders(), json: { warehouseTaskId: taskId } })
  const pkgId = Number(pkg.data?.data?.id)
  await http.post(`/api/packages/${pkgId}/add-item`, { token, headers: pdaHeaders(), json: { productCode: product.code, qty: 1 } })
  const finish = await http.put(`/api/packages/${pkgId}/finish`, { token, headers: pdaHeaders() })
  const printJobId = Number(finish.data?.data?.printJobId)
  await http.post(`/api/print-jobs/${printJobId}/complete-local`, { token, json: {} })
  await http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token, headers: pdaHeaders() })
  return http.put(`/api/warehouse-tasks/${taskId}/ship`, { token, headers: pdaHeaders(), json: { serialNosByProduct: { [Number(product.id)]: [shipSn] } } })
}

// ── B-full ①：已拣货序列号「部分」减量 → defer 拆分 + PDA 逐台扫 SN 归还 ──────────
async function scenarioSerialReduceAdjustPartial(ctx, log, token) {
  log.section('B-full ① 序列号已拣减量·部分归还：请求时不拆容器，PDA 逐台扫 SN 才拆分归还')
  const { http, pool, warehouse } = ctx
  const product = await createSerialProduct(pool, 'adjP')
  const suffix = randomRef('SP').slice(-8)
  const sns = { D: `SPD-${suffix}`, E: `SPE-${suffix}`, F: `SPF-${suffix}` }
  const pid = Number(product.id)

  const [cont] = await receiveAndPutaway(ctx, token, product, [{ qty: 3, serialNos: [sns.D, sns.E, sns.F] }])
  const { saleId, taskId, itemId } = await createSaleReserveShipPick(ctx, token, product, 3, [cont])

  // 改单 3→1：减 2 全部命中已拣 → B-full 放行、需物理确认（此前被 SERIAL_ADJUST_REDUCE_UNSUPPORTED 挡死）
  const adjResp = await adjustSaleTo(ctx, token, saleId, product, 1)
  log.assert('★ 序列号已拣减量不再被拒、需物理确认(pending=true)',
    adjResp.ok && adjResp.data?.data?.pending === true, JSON.stringify(adjResp.data).slice(0, 200))
  const adjustmentId = Number(adjResp.data?.data?.adjustmentId)

  // 改单请求时点：容器未被拆（remaining 仍 3、3 台在库），核心不变量成立
  log.assert('★ 请求时未拆容器：源容器 remaining=3 且挂 3 台在库SN（延迟拆分）',
    (await containerRemaining(pool, cont.containerId))?.remaining === 3 && (await containerSerialCount(pool, cont.containerId)) === 3)

  // 详情：待归还项 needsSerialScan=true、qty=2、带容器在库SN清单(3)
  const detail = await http.get(`/api/warehouse-tasks/adjustments/${adjustmentId}`, { token })
  const ret = detail.data?.data?.items?.[0]?.containerReturns?.[0]
  log.assert('★ 待归还项 needsSerialScan=true、qty=2、返回容器在库SN清单(3台)',
    ret?.needsSerialScan === true && Number(ret?.qty) === 2 && ret?.serials?.length === 3, JSON.stringify(ret))
  const returnId = ret.id
  const [cRow] = await dbQuery(pool, 'SELECT location_id FROM inventory_containers WHERE id=?', [cont.containerId])
  const locId = Number(cRow.location_id)
  const confirm = (json) => http.post(`/api/warehouse-tasks/adjustments/container-returns/${returnId}/confirm`, { token, headers: ctx.pdaHeaders(), json })

  // 闸门：不扫 SN / 扫台数不符 / 扫不在容器的台 → 全部被拒，且失败事务回滚（容器仍完整未拆）
  const noSn = await confirm({ targetLocationId: locId })
  log.assert('★ 未扫SN归还被拒(SERIAL_RETURN_SCAN_COUNT_MISMATCH)',
    noSn.status === 400 && noSn.data?.code === 'SERIAL_RETURN_SCAN_COUNT_MISMATCH', `status=${noSn.status} code=${noSn.data?.code}`)
  const wrongCount = await confirm({ targetLocationId: locId, serialNos: [sns.D] })
  log.assert('★ 扫SN台数不符被拒', wrongCount.status === 400 && wrongCount.data?.code === 'SERIAL_RETURN_SCAN_COUNT_MISMATCH', `status=${wrongCount.status}`)
  const notInCont = await confirm({ targetLocationId: locId, serialNos: [sns.D, `NOPE-${suffix}`] })
  log.assert('★ 扫不在容器的SN被拒(SERIAL_SPLIT_NOT_IN_CONTAINER)',
    notInCont.status === 409 && notInCont.data?.code === 'SERIAL_SPLIT_NOT_IN_CONTAINER', `status=${notInCont.status} code=${notInCont.data?.code}`)
  log.assert('★ 多次被拒后源容器仍完整(remaining=3、3台在库)——失败事务完整回滚',
    (await containerRemaining(pool, cont.containerId))?.remaining === 3 && (await containerSerialCount(pool, cont.containerId)) === 3)

  // 正确扫 [D,E] + 原库位 → 成功 finalize
  const ok1 = await confirm({ targetLocationId: locId, serialNos: [sns.D, sns.E] })
  log.assert('★ 扫[D,E]+原库位归还成功且finalize=true', ok1.ok && ok1.data?.data?.finalized === true, JSON.stringify(ok1.data).slice(0, 200))

  // 拆分后：源容器 remaining=1(F)；新容器 remaining=2(D,E) 已解锁至原库位；两容器不变量
  log.assert('★ 拆分后源容器 remaining=1==在库SN数1',
    (await containerRemaining(pool, cont.containerId))?.remaining === 1 && (await containerSerialCount(pool, cont.containerId)) === 1)
  const [newC] = await dbQuery(pool, "SELECT id, remaining_qty, location_id, locked_by_task_id FROM inventory_containers WHERE parent_id=? AND source_ref_type='sale_order_adjustment_return'", [cont.containerId])
  log.assert('★ 新容器 remaining=2==在库SN数2、已解锁、在原库位',
    newC && Number(newC.remaining_qty) === 2 && (await containerSerialCount(pool, newC.id)) === 2 && newC.locked_by_task_id === null && Number(newC.location_id) === locId, JSON.stringify(newC))
  const snRows = await dbQuery(pool, 'SELECT serial_no, container_id, status FROM product_serials WHERE product_id=? ORDER BY serial_no', [pid])
  log.assert('★ D/E 挂新容器、F 留源容器，均在库(1)',
    snRows.length === 3 && snRows.every(r => Number(r.status) === 1)
      && Number(snRows.find(r => r.serial_no === sns.D).container_id) === Number(newC.id)
      && Number(snRows.find(r => r.serial_no === sns.E).container_id) === Number(newC.id)
      && Number(snRows.find(r => r.serial_no === sns.F).container_id) === cont.containerId, JSON.stringify(snRows))

  const [itemFinal] = await dbQuery(pool, 'SELECT required_qty, picked_qty FROM warehouse_task_items WHERE id=?', [itemId])
  log.assert('picked_qty/required 已降到1', Number(itemFinal.picked_qty) === 1 && Number(itemFinal.required_qty) === 1, JSON.stringify(itemFinal))
  const [resv] = await dbQuery(pool, "SELECT COALESCE(SUM(qty),0) AS t FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1", [saleId])
  log.assert('预占已释放到1', Number(resv.t) === 1, JSON.stringify(resv))
  await assertPerContainerInvariant(pool, log, pid, warehouse.id, 'B-full部分归还后')
  const cc = await http.get(`/api/serials/check-consistency?warehouseId=${warehouse.id}`, { token })
  log.assert('★ 部分归还后对账仍0不一致', cc.data?.data?.consistent === true && Number(cc.data?.data?.mismatchCount) === 0, JSON.stringify(cc.data?.data).slice(0, 300))

  // 端到端收尾：归还后剩余 1 台(F) 必须能完整走完出库（证明拆分后剩余锁定容器可正常核销）
  const shipResp = await finishAndShipSingle(ctx, token, taskId, product, cont.barcode, sns.F)
  log.assert('★ 归还后剩余1台(F) 完整走完出库', shipResp.ok, `status=${shipResp.status} ${JSON.stringify(shipResp.data?.message || shipResp.data?.code || '')}`)
  const [fRow] = await dbQuery(pool, 'SELECT status, container_id FROM product_serials WHERE product_id=? AND serial_no=?', [pid, sns.F])
  log.assert('★ F 已出库(2)、脱离容器；D/E 仍在库(2台)', Number(fRow.status) === 2 && fRow.container_id === null && (await inStockSerialCount(pool, pid)) === 2, JSON.stringify(fRow))
  const cc2 = await http.get(`/api/serials/check-consistency?warehouseId=${warehouse.id}`, { token })
  log.assert('★ 剩余台出库后对账仍0不一致', cc2.data?.data?.consistent === true && Number(cc2.data?.data?.mismatchCount) === 0, JSON.stringify(cc2.data?.data).slice(0, 300))
}

// ── B-full ②：已拣货序列号「整只」减量 → 无需逐台扫，直接解锁整容器归还 ──────────
async function scenarioSerialReduceAdjustWhole(ctx, log, token) {
  log.section('B-full ② 序列号已拣减量·整只归还：命中整容器时无需逐台扫SN')
  const { http, pool, warehouse } = ctx
  const product = await createSerialProduct(pool, 'adjW')
  const suffix = randomRef('SW').slice(-8)
  const sns = { D: `SWD-${suffix}`, E: `SWE-${suffix}`, F: `SWF-${suffix}` }
  const pid = Number(product.id)

  // 两容器：c1=[D,E]（先收，id 较小 → FIFO 先归还）、c2=[F]
  const [c1, c2] = await receiveAndPutaway(ctx, token, product, [{ qty: 2, serialNos: [sns.D, sns.E] }, { qty: 1, serialNos: [sns.F] }])
  const { saleId, taskId } = await createSaleReserveShipPick(ctx, token, product, 3, [c1, c2])

  // 改单 3→1：减 2 恰好吃掉整只 c1 → 整只归还，无需逐台扫
  const adjResp = await adjustSaleTo(ctx, token, saleId, product, 1)
  log.assert('整只归还场景改单 pending=true', adjResp.ok && adjResp.data?.data?.pending === true, JSON.stringify(adjResp.data).slice(0, 200))
  const adjustmentId = Number(adjResp.data?.data?.adjustmentId)
  const detail = await http.get(`/api/warehouse-tasks/adjustments/${adjustmentId}`, { token })
  const ret = detail.data?.data?.items?.[0]?.containerReturns?.[0]
  log.assert('★ 整只归还项 needsSerialScan=false、qty=2、containerId=c1',
    ret?.needsSerialScan === false && Number(ret?.qty) === 2 && Number(ret?.containerId) === c1.containerId, JSON.stringify(ret))

  const [c1Row] = await dbQuery(pool, 'SELECT location_id FROM inventory_containers WHERE id=?', [c1.containerId])
  const locId = Number(c1Row.location_id)
  // 不带 serialNos，扫原库位即可归还整只容器
  const ok1 = await http.post(`/api/warehouse-tasks/adjustments/container-returns/${ret.id}/confirm`, {
    token, headers: ctx.pdaHeaders(), json: { targetLocationId: locId },
  })
  log.assert('★ 整只归还无需扫SN、扫原库位成功且finalize=true', ok1.ok && ok1.data?.data?.finalized === true, JSON.stringify(ok1.data).slice(0, 200))

  // c1(D,E) 已解锁（D/E 仍挂 c1、在库）；c2(F) 仍锁定于任务；两容器不变量
  const [c1After] = await dbQuery(pool, 'SELECT remaining_qty, locked_by_task_id FROM inventory_containers WHERE id=?', [c1.containerId])
  log.assert('★ c1 已解锁、remaining=2==在库SN数2（D/E 随容器整体归还）',
    Number(c1After.remaining_qty) === 2 && c1After.locked_by_task_id === null && (await containerSerialCount(pool, c1.containerId)) === 2, JSON.stringify(c1After))
  const [c2After] = await dbQuery(pool, 'SELECT locked_by_task_id FROM inventory_containers WHERE id=?', [c2.containerId])
  log.assert('★ c2(F) 仍锁定于任务、remaining=1==在库SN数1',
    Number(c2After.locked_by_task_id) === taskId && (await containerRemaining(pool, c2.containerId))?.remaining === 1 && (await containerSerialCount(pool, c2.containerId)) === 1, JSON.stringify(c2After))
  const snRows = await dbQuery(pool, 'SELECT serial_no, status FROM product_serials WHERE product_id=?', [pid])
  log.assert('★ D/E/F 全部仍在库(1)', snRows.length === 3 && snRows.every(r => Number(r.status) === 1), JSON.stringify(snRows))
  await assertPerContainerInvariant(pool, log, pid, warehouse.id, 'B-full整只归还后')
  const cc = await http.get(`/api/serials/check-consistency?warehouseId=${warehouse.id}`, { token })
  log.assert('★ 整只归还后对账仍0不一致', cc.data?.data?.consistent === true && Number(cc.data?.data?.mismatchCount) === 0, JSON.stringify(cc.data?.data).slice(0, 300))
}

// ── C-full ①：序列号级盘点 —— 盘亏必须扣「丢失台所在的那只容器」，不能走 FIFO ──────
// 这是 C-full 最关键的正确性点：造两只容器（c1 先建=FIFO 首选，c2 后建），只让 c2 里的台"丢失"。
// 若实现退回 FIFO，会去扣 c1 → c1「数量少了、序列号还挂着」+ c2「数量对、台却已标丢失」，双双破不变量。
async function scenarioSerialStocktakeLoss(ctx, log, token) {
  log.section('C-full ① 序列号级盘点·盘亏：精确扣丢失台所在容器（不走 FIFO）')
  const { http, pool, warehouse, location } = ctx
  const product = await createSerialProduct(pool, 'ckL')
  const suffix = randomRef('CL').slice(-8)
  const sns = { A: `CLA-${suffix}`, B: `CLB-${suffix}`, C: `CLC-${suffix}` }
  const pid = Number(product.id)

  // c1=[A,B] 先建（FIFO 首选），c2=[C] 后建
  const [c1, c2] = await receiveAndPutaway(ctx, token, product, [{ qty: 2, serialNos: [sns.A, sns.B] }, { qty: 1, serialNos: [sns.C] }])

  const create = await http.post('/api/stockcheck', {
    token, json: { warehouseId: Number(warehouse.id), warehouseName: warehouse.name, remark: randomRef('sc-serial'),
      checkType: 2, scopeType: 'manual', scopeValue: 'smoke', productIds: [pid] },
  })
  log.assert('创建盘点单成功', create.status === 201, JSON.stringify(create.data).slice(0, 200))
  const checkId = Number(create.data?.data?.id)
  const [itemRow] = await dbQuery(pool, 'SELECT id, book_qty FROM inventory_check_items WHERE check_id=? AND product_id=?', [checkId, pid])
  log.assert('盘点明细账面=3台', !!itemRow && Number(itemRow.book_qty) === 3, JSON.stringify(itemRow))

  // 手填实盘数必须被拒（序列号商品只能扫码派生）
  const manual = await http.put(`/api/stockcheck/${checkId}/items`, { token, json: { items: [{ id: Number(itemRow.id), actualQty: 2 }] } })
  log.assert('★ 序列号商品手填实盘数被拒(SERIAL_ACTUAL_QTY_MANUAL_FORBIDDEN)',
    manual.status === 400 && manual.data?.code === 'SERIAL_ACTUAL_QTY_MANUAL_FORBIDDEN', `status=${manual.status} code=${manual.data?.code}`)

  const scan = (serialNos) => http.post(`/api/stockcheck/${checkId}/items/${itemRow.id}/serials`, { token, headers: ctx.pdaHeaders(), json: { serialNos } })

  // PDA 任务池能看到该单
  const pending = await http.get('/api/stockcheck/serial/pending', { token })
  log.assert('PDA 盘点任务池能查到该单', (pending.data?.data || []).some(t => Number(t.id) === checkId), JSON.stringify(pending.data?.data).slice(0, 200))

  // 现场只扫到 A、B —— C 丢了（C 在 c2 里，FIFO 首选却是 c1）
  const s1 = await scan([sns.A, sns.B])
  log.assert('★ 扫到2台，实盘数派生=2、差异=-1', s1.ok && s1.data?.data?.scannedCount === 2 && s1.data?.data?.diffQty === -1, JSON.stringify(s1.data).slice(0, 200))

  // 详情预览：盘亏应精确指出是 C
  const detail = await http.get(`/api/stockcheck/${checkId}`, { token })
  const dItem = (detail.data?.data?.items || []).find(i => Number(i.productId) === pid)
  log.assert('★ 详情预览盘亏=[C]、盘盈=[]', dItem?.missingSerials?.length === 1 && dItem.missingSerials[0] === sns.C && dItem.surplusSerials?.length === 0, JSON.stringify(dItem).slice(0, 300))

  const submit = await http.post(`/api/stockcheck/${checkId}/submit`, { token })
  log.assert('盘点提交成功', submit.ok, JSON.stringify(submit.data).slice(0, 200))

  // ★核心：扣的是 c2（C 所在容器），c1 分毫未动
  const c1After = await containerRemaining(pool, c1.containerId)
  const c2After = await containerRemaining(pool, c2.containerId)
  log.assert('★★ 盘亏精确扣 c2（C所在容器）remaining 1→0，未误扣 FIFO 首选的 c1',
    c1After?.remaining === 2 && c2After?.remaining === 0, `c1=${JSON.stringify(c1After)} c2=${JSON.stringify(c2After)}`)
  log.assert('★ c1 仍 remaining=2==在库SN数2（A/B 未受影响）',
    (await containerSerialCount(pool, c1.containerId)) === 2 && c1After?.remaining === 2)
  log.assert('★ c2 remaining=0==在库SN数0', (await containerSerialCount(pool, c2.containerId)) === 0)

  const [cRow] = await dbQuery(pool, 'SELECT status, container_id FROM product_serials WHERE product_id=? AND serial_no=?', [pid, sns.C])
  log.assert('★ C 已标记盘亏丢失(status=4)、脱离容器、行仍保留可追溯',
    Number(cRow.status) === 4 && cRow.container_id === null, JSON.stringify(cRow))
  const [[{ n: lossEvents }]] = [await dbQuery(pool, `SELECT COUNT(*) AS n FROM serial_events se JOIN product_serials ps ON ps.id=se.serial_id WHERE ps.product_id=? AND se.event_type='stockcheck_loss'`, [pid])]
  log.assert('★ 写了 stockcheck_loss 事件(1条)', Number(lossEvents) === 1, `events=${lossEvents}`)

  log.assert('全局在库SN数=2（A/B）', (await inStockSerialCount(pool, pid)) === 2)
  log.assert('★ ACTIVE容器合计(2)==在库SN数(2)', (await activeContainerSum(pool, pid, warehouse.id)) === 2)
  await assertPerContainerInvariant(pool, log, pid, warehouse.id, 'C-full盘亏后')
  const cc = await http.get(`/api/serials/check-consistency?warehouseId=${warehouse.id}`, { token })
  log.assert('★ 盘亏后对账0不一致', cc.data?.data?.consistent === true && Number(cc.data?.data?.mismatchCount) === 0, JSON.stringify(cc.data?.data).slice(0, 300))
  return { product, sns, c1, location }
}

// ── C-full ②：盘盈 + 净差为0的"换台"（丢A补X）—— 数量看不出变化，台账必须更正 ────────
async function scenarioSerialStocktakeSurplusAndSwap(ctx, log, token) {
  log.section('C-full ② 序列号级盘点·盘盈 + 净差0换台（丢1台补1台）')
  const { http, pool, warehouse } = ctx
  const product = await createSerialProduct(pool, 'ckS')
  const suffix = randomRef('CS').slice(-8)
  const sns = { A: `CSA-${suffix}`, B: `CSB-${suffix}`, X: `CSX-${suffix}` }
  const pid = Number(product.id)

  const [c1] = await receiveAndPutaway(ctx, token, product, [{ qty: 2, serialNos: [sns.A, sns.B] }])

  const create = await http.post('/api/stockcheck', {
    token, json: { warehouseId: Number(warehouse.id), warehouseName: warehouse.name, remark: randomRef('sc-swap'),
      checkType: 2, scopeType: 'manual', scopeValue: 'smoke', productIds: [pid] },
  })
  const checkId = Number(create.data?.data?.id)
  const [itemRow] = await dbQuery(pool, 'SELECT id FROM inventory_check_items WHERE check_id=? AND product_id=?', [checkId, pid])
  const scan = (serialNos) => http.post(`/api/stockcheck/${checkId}/items/${itemRow.id}/serials`, { token, headers: ctx.pdaHeaders(), json: { serialNos } })

  // 现场扫到 A 和一台系统不知道的 X —— B 丢了。台数 2==2，净差 0，但换了台！
  const s1 = await scan([sns.A, sns.X])
  log.assert('扫到2台(A,X)：实盘=2、净差=0', s1.ok && s1.data?.data?.scannedCount === 2 && s1.data?.data?.diffQty === 0, JSON.stringify(s1.data).slice(0, 200))

  const detail = await http.get(`/api/stockcheck/${checkId}`, { token })
  const dItem = (detail.data?.data?.items || []).find(i => Number(i.productId) === pid)
  log.assert('★ 详情预览：盘亏=[B]、盘盈=[X]（净差0也要看得见）',
    dItem?.missingSerials?.[0] === sns.B && dItem?.surplusSerials?.[0] === sns.X, JSON.stringify(dItem).slice(0, 300))

  const submit = await http.post(`/api/stockcheck/${checkId}/submit`, { token })
  log.assert('★ 净差为0的换台仍被提交处理（未因 diff===0 跳过）', submit.ok, JSON.stringify(submit.data).slice(0, 200))

  const [bRow] = await dbQuery(pool, 'SELECT status, container_id FROM product_serials WHERE product_id=? AND serial_no=?', [pid, sns.B])
  log.assert('★ B 已标记丢失(4)、脱离容器', Number(bRow.status) === 4 && bRow.container_id === null, JSON.stringify(bRow))
  const [xRow] = await dbQuery(pool, 'SELECT status, container_id FROM product_serials WHERE product_id=? AND serial_no=?', [pid, sns.X])
  log.assert('★ X 已登记为在库(1)、绑到盘盈新容器', Number(xRow.status) === 1 && xRow.container_id != null && Number(xRow.container_id) !== c1.containerId, JSON.stringify(xRow))
  log.assert('★ 原容器 c1 remaining=1==在库SN数1（B被扣、A还在）',
    (await containerRemaining(pool, c1.containerId))?.remaining === 1 && (await containerSerialCount(pool, c1.containerId)) === 1)
  log.assert('★ 盘盈容器 remaining=1==在库SN数1',
    (await containerRemaining(pool, Number(xRow.container_id)))?.remaining === 1 && (await containerSerialCount(pool, Number(xRow.container_id))) === 1)

  log.assert('全局在库SN数仍=2（A/X）', (await inStockSerialCount(pool, pid)) === 2)
  log.assert('★ ACTIVE容器合计(2)==在库SN数(2)', (await activeContainerSum(pool, pid, warehouse.id)) === 2)
  await assertPerContainerInvariant(pool, log, pid, warehouse.id, 'C-full换台后')
  const cc = await http.get(`/api/serials/check-consistency?warehouseId=${warehouse.id}`, { token })
  log.assert('★ 换台后对账0不一致', cc.data?.data?.consistent === true && Number(cc.data?.data?.mismatchCount) === 0, JSON.stringify(cc.data?.data).slice(0, 300))

  // 盘盈登记的 X 必须能正常出库（证明盘盈台是"真在库"、不是挂账）
  const { taskId } = await createSaleReserveShipPick(ctx, token, product, 1, [{ containerId: Number(xRow.container_id), barcode: (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [Number(xRow.container_id)]))[0].barcode, qty: 1 }])
  const [xc] = await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [Number(xRow.container_id)])
  const shipResp = await finishAndShipSingle(ctx, token, taskId, product, xc.barcode, sns.X)
  log.assert('★ 盘盈登记的 X 能完整走完出库（真在库，非挂账）', shipResp.ok, `status=${shipResp.status} ${JSON.stringify(shipResp.data?.message || shipResp.data?.code || '')}`)
}

// ── C-full ③：闸门 —— 扫到已被别处认领为在库的 SN 必须早失败 ────────────────────
async function scenarioSerialStocktakeGuards(ctx, log, token) {
  log.section('C-full ③ 闸门：扫到已在库(别的容器/仓)的 SN 被拒 + 本批重复扫被拒')
  const { http, pool, warehouse } = ctx
  const product = await createSerialProduct(pool, 'ckG')
  const suffix = randomRef('CG').slice(-8)
  const sns = { A: `CGA-${suffix}`, B: `CGB-${suffix}` }
  const pid = Number(product.id)
  // 两只容器各一台；盘点单只针对该商品，A/B 都在账面内
  const [, c2] = await receiveAndPutaway(ctx, token, product, [{ qty: 1, serialNos: [sns.A] }, { qty: 1, serialNos: [sns.B] }])

  const create = await http.post('/api/stockcheck', {
    token, json: { warehouseId: Number(warehouse.id), warehouseName: warehouse.name, remark: randomRef('sc-guard'),
      checkType: 2, scopeType: 'manual', scopeValue: 'smoke', productIds: [pid] },
  })
  const checkId = Number(create.data?.data?.id)
  const [itemRow] = await dbQuery(pool, 'SELECT id FROM inventory_check_items WHERE check_id=? AND product_id=?', [checkId, pid])
  const scan = (serialNos) => http.post(`/api/stockcheck/${checkId}/items/${itemRow.id}/serials`, { token, headers: ctx.pdaHeaders(), json: { serialNos } })

  const dup = await scan([sns.A, sns.A])
  log.assert('★ 本批重复扫同一台被拒(SERIAL_DUP_IN_BATCH)', dup.status === 400 && dup.data?.code === 'SERIAL_DUP_IN_BATCH', `status=${dup.status} code=${dup.data?.code}`)

  // 把 c2 的容器挪成 PENDING_QA（模拟"该台已被别处账面认领"），它就不在本仓 ACTIVE 账面集里了，
  // 再扫到它 → 属于盘盈候选，但它 status=1 已在库 → 必须早失败，而不是留到提交时才炸
  await pool.query('UPDATE inventory_containers SET status=5 WHERE id=?', [c2.containerId])
  const claimed = await scan([sns.A, sns.B])
  log.assert('★ 扫到已被别处认领为在库的台被拒(SERIAL_ALREADY_IN_STOCK)',
    claimed.status === 409 && claimed.data?.code === 'SERIAL_ALREADY_IN_STOCK', `status=${claimed.status} code=${claimed.data?.code}`)
  const [{ n: savedCnt }] = await dbQuery(pool, 'SELECT COUNT(*) AS n FROM inventory_check_item_serials WHERE check_item_id=?', [itemRow.id])
  log.assert('★ 被拒时一台都没落库（事务完整回滚）', Number(savedCnt) === 0, `saved=${savedCnt}`)
  await pool.query('UPDATE inventory_containers SET status=1 WHERE id=?', [c2.containerId])

  // 扫码整行替换语义：连扫两次，结果以最后一次为准、不累加（天然幂等）
  await scan([sns.A])
  const again = await scan([sns.A, sns.B])
  log.assert('★ 重复提交扫码集为整行替换、不累加（幂等）', again.ok && again.data?.data?.scannedCount === 2, JSON.stringify(again.data).slice(0, 200))
  const [{ n: finalCnt }] = await dbQuery(pool, 'SELECT COUNT(*) AS n FROM inventory_check_item_serials WHERE check_item_id=?', [itemRow.id])
  log.assert('落库扫码记录=2条（非3条）', Number(finalCnt) === 2, `rows=${finalCnt}`)

  // 刷新账面应清空已扫台（账面变了，之前那轮不可信）
  const refresh = await http.post(`/api/stockcheck/${checkId}/items/${itemRow.id}/refresh`, { token })
  log.assert('刷新账面成功', refresh.ok, JSON.stringify(refresh.data).slice(0, 150))
  const [{ n: afterRefresh }] = await dbQuery(pool, 'SELECT COUNT(*) AS n FROM inventory_check_item_serials WHERE check_item_id=?', [itemRow.id])
  log.assert('★ 刷新账面后已扫台被清空（必须重扫）', Number(afterRefresh) === 0, `rows=${afterRefresh}`)
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
    await scenarioSaleReturnSerial(ctx, log, token, product, sns)
    await scenarioSerialReduceAdjustPartial(ctx, log, token)
    await scenarioSerialReduceAdjustWhole(ctx, log, token)
    await scenarioSerialStocktakeLoss(ctx, log, token)
    await scenarioSerialStocktakeSurplusAndSwap(ctx, log, token)
    await scenarioSerialStocktakeGuards(ctx, log, token)
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
