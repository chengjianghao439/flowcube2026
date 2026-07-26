#!/usr/bin/env node
'use strict'

/**
 * P1 回归测试 — 锁死 2026-07 架构审计发现的库存引擎并发与一致性缺陷
 *
 * P1-1 全局 FIFO 扣减（调拨/盘点/手动出库）不得动已被拣货任务锁定的容器
 * P1-2 容器合并不得并入被拣货任务锁定的塑料盒
 * P1-6 并发占库必须以一致的加锁顺序进行，不得死锁
 * P1-9 并发上架不得丢失库存缓存更新；热点索引必须存在并被命中
 * P1-4 容器必须记录收货明细归属，上架量与移动加权成本按归属精确落账（混单不同单价）
 * P1-3 超收确认闸门必须是「比例 OR 金额」双闸门，且任何超收都留痕
 * P1-5 时间窗内的重复扫码必须被业务层拦下要求确认（幂等键只防网络重试）
 *
 * 运行：node tests/p1-regression.smoke.test.js
 */

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const containerEngine = require('../backend/src/engine/containerEngine')

async function createTestProduct(pool, label) {
  const code = randomRef(`P1-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 10, 5)",
    [code, `P1测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `P1测试商品-${label}`, unit: '个' }
}

/** 造一只在库容器（走正规两段式），返回 containerId */
async function seedContainer(pool, productId, warehouseId, qty) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const { containerId } = await containerEngine.createContainer(conn, {
      productId, warehouseId, initialQty: qty,
      sourceType: containerEngine.SOURCE_TYPE.MANUAL,
      sourceRefId: 999999,
      remark: 'P1回归测试铺底',
      containerStatus: containerEngine.CONTAINER_STATUS.PENDING_PUTAWAY,
    })
    await containerEngine.promotePendingContainerToActive(conn, containerId, productId, warehouseId)
    await conn.commit()
    return containerId
  } catch (e) {
    await conn.rollback(); throw e
  } finally { conn.release() }
}

// ───────────────────────────────────────────────────────────────────────────
// P1-1：拣货锁定的容器不能被调拨/盘点/手动出库经全局 FIFO 扣走
// ───────────────────────────────────────────────────────────────────────────
async function scenarioLockedContainersAreSkipped(ctx, log) {
  log.section('P1-1 全局 FIFO 扣减必须避让拣货任务锁定的容器')
  const { pool, warehouse } = ctx
  const product = await createTestProduct(pool, 'lock')

  const lockedId = await seedContainer(pool, product.id, warehouse.id, 50)
  await seedContainer(pool, product.id, warehouse.id, 50)

  // 造一个真实仓库任务并把第一只容器锁给它（模拟拣货员已把货拣进料箱）
  const [taskRes] = await pool.query(
    `INSERT INTO warehouse_tasks (task_no, task_type, customer_name, warehouse_id, warehouse_name, status)
     VALUES (?, 'sale', 'P1回归测试', ?, ?, 2)`,
    [randomRef('P1WT').slice(0, 30), warehouse.id, warehouse.name],
  )
  const taskId = taskRes.insertId
  await pool.query(
    'UPDATE inventory_containers SET locked_by_task_id=?, locked_at=NOW() WHERE id=?',
    [taskId, lockedId],
  )

  // 手动出库 60：物理上只有未锁定的 50 可动用
  let err = null
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await containerEngine.adjustContainerStock(conn, {
      productId: product.id, productName: product.name, warehouseId: warehouse.id,
      qty: -60,
      sourceType: containerEngine.SOURCE_TYPE.MANUAL, sourceRefId: 999998,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback(); err = e
  } finally { conn.release() }

  log.assert(
    '★P1-1 超出可动用量的出库被拒绝（修复前会把锁定容器的货一起扣走）',
    !!err,
    err ? '' : '未抛错，说明锁定容器被误扣',
  )
  log.assert(
    '★P1-1 错误信息说明被任务占用的数量，便于现场判断',
    !!err && /正被拣货任务占用/.test(err.message),
    err ? err.message : '',
  )

  const [lockedAfter] = await dbQuery(pool, 'SELECT remaining_qty FROM inventory_containers WHERE id=?', [lockedId])
  log.assert(
    '★P1-1 锁定容器数量分毫未动，仍为 50',
    Number(lockedAfter.remaining_qty) === 50,
    `实际=${lockedAfter.remaining_qty}`,
  )

  // 在可动用范围内出库应当正常成功
  const conn2 = await pool.getConnection()
  let ok = true
  try {
    await conn2.beginTransaction()
    await containerEngine.adjustContainerStock(conn2, {
      productId: product.id, productName: product.name, warehouseId: warehouse.id,
      qty: -40,
      sourceType: containerEngine.SOURCE_TYPE.MANUAL, sourceRefId: 999997,
    })
    await conn2.commit()
  } catch (e) {
    await conn2.rollback(); ok = false
    log.assert('可动用范围内出库不应报错', false, e.message)
  } finally { conn2.release() }
  if (ok) log.assert('可动用范围内（40 ≤ 50）出库正常成功', true)

  const [lockedFinal] = await dbQuery(pool, 'SELECT remaining_qty FROM inventory_containers WHERE id=?', [lockedId])
  log.assert('成功出库后锁定容器依然完好', Number(lockedFinal.remaining_qty) === 50, `实际=${lockedFinal.remaining_qty}`)
}

// ───────────────────────────────────────────────────────────────────────────
// P1-2：不能把货并入被拣货任务锁定的塑料盒
// ───────────────────────────────────────────────────────────────────────────
async function scenarioCannotMergeIntoLockedBox(ctx, log) {
  log.section('P1-2 容器合并不得并入被任务锁定的塑料盒')
  const { pool, warehouse } = ctx
  const product = await createTestProduct(pool, 'merge')
  const sourceId = await seedContainer(pool, product.id, warehouse.id, 100)

  // 先正常拆出一只塑料盒（B 条码）
  let box = null
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    box = await containerEngine.splitContainer(conn, { containerId: sourceId, qty: 10 })
    await conn.commit()
  } finally { conn.release() }
  log.assert('前置：成功拆出一只塑料盒', !!box?.newContainerId, JSON.stringify(box || {}))

  // 把这只盒子锁给一个仓库任务
  const [taskRes] = await pool.query(
    `INSERT INTO warehouse_tasks (task_no, task_type, customer_name, warehouse_id, warehouse_name, status)
     VALUES (?, 'sale', 'P1回归测试', ?, ?, 2)`,
    [randomRef('P1BOX').slice(0, 30), warehouse.id, warehouse.name],
  )
  await pool.query(
    'UPDATE inventory_containers SET locked_by_task_id=?, locked_at=NOW() WHERE id=?',
    [taskRes.insertId, box.newContainerId],
  )

  const boxQtyBefore = 10
  let err = null
  const conn2 = await pool.getConnection()
  try {
    await conn2.beginTransaction()
    await containerEngine.splitContainer(conn2, {
      containerId: sourceId, qty: 5, targetContainerId: box.newContainerId,
    })
    await conn2.commit()
  } catch (e) {
    await conn2.rollback(); err = e
  } finally { conn2.release() }

  log.assert(
    '★P1-2 并入被锁定塑料盒被拒绝（修复前会让任务锁定量凭空增加 → 出库多扣）',
    !!err,
    err ? '' : '未抛错，说明并货成功了',
  )
  log.assert('★P1-2 错误提示明确指向锁定原因', !!err && /锁定/.test(err.message), err ? err.message : '')

  const [boxAfter] = await dbQuery(pool, 'SELECT remaining_qty FROM inventory_containers WHERE id=?', [box.newContainerId])
  log.assert(
    '★P1-2 被锁定塑料盒数量未被改动',
    Number(boxAfter.remaining_qty) === boxQtyBefore,
    `实际=${boxAfter.remaining_qty} 期望=${boxQtyBefore}`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
// P1-6：商品顺序相反的两张订单并发占库不得死锁
// ───────────────────────────────────────────────────────────────────────────
async function scenarioConcurrentReserveNoDeadlock(ctx, log, token) {
  log.section('P1-6 并发占库（商品顺序相反）不得死锁')
  const { http, pool, warehouse, customer } = ctx

  const pA = await createTestProduct(pool, 'dlA')
  const pB = await createTestProduct(pool, 'dlB')

  const ROUNDS = 8
  await seedContainer(pool, pA.id, warehouse.id, ROUNDS * 10)
  await seedContainer(pool, pB.id, warehouse.id, ROUNDS * 10)

  const mkOrder = async (first, second) => {
    const resp = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('p1-dl'),
        items: [first, second].map(p => ({
          productId: Number(p.id), productCode: p.code, productName: p.name,
          unit: p.unit, quantity: 1, unitPrice: 10,
        })),
      },
    })
    return Number(resp.data?.data?.id)
  }

  let deadlocks = 0
  let failures = []
  for (let i = 0; i < ROUNDS; i++) {
    // 两张订单的明细录入顺序相反 —— 修复前会按各自的 id 顺序加锁，方向相反即死锁
    const [idAB, idBA] = await Promise.all([mkOrder(pA, pB), mkOrder(pB, pA)])
    const results = await Promise.all([
      http.post(`/api/sale/${idAB}/reserve`, { token }),
      http.post(`/api/sale/${idBA}/reserve`, { token }),
    ])
    for (const r of results) {
      if (r.ok) continue
      const msg = JSON.stringify(r.data)
      // InnoDB 死锁经 errorHandler 会被统一包装成 INTERNAL_ERROR / 「服务器内部错误」，
      // ER_LOCK_DEADLOCK 不会透传到响应体，只匹配 deadlock 字样会漏判（实测回退代码后
      // 7 次死锁全部显示为 INTERNAL_ERROR）。这里把非业务错误一律计入死锁嫌疑；
      // 真正的业务错误（库存不足、状态不符等）另计到 failures。
      if (/[Dd]eadlock|死锁|ER_LOCK_DEADLOCK|INTERNAL_ERROR|服务器内部错误/.test(msg)) deadlocks++
      else failures.push(msg.slice(0, 160))
    }
  }

  log.assert(
    `★P1-6 ${ROUNDS} 轮反向并发占库零死锁（修复前加锁顺序相反，会随机报占库失败）`,
    deadlocks === 0,
    `死锁次数=${deadlocks}`,
  )
  log.assert(
    '并发占库无其它异常失败',
    failures.length === 0,
    failures.slice(0, 3).join(' | '),
  )

  const stock = await dbQuery(
    pool,
    'SELECT product_id, quantity, reserved FROM inventory_stock WHERE product_id IN (?,?) AND warehouse_id=?',
    [pA.id, pB.id, warehouse.id],
  )
  log.assert(
    '并发结束后 reserved 恰好等于成功占用的订单数（每商品每轮 2 单各 1 件）',
    stock.length === 2 && stock.every(s => Number(s.reserved) === ROUNDS * 2),
    JSON.stringify(stock),
  )
  log.assert(
    '并发过程中未出现 reserved 超过在库量',
    stock.every(s => Number(s.reserved) <= Number(s.quantity)),
    JSON.stringify(stock),
  )
}

// ───────────────────────────────────────────────────────────────────────────
// P1-9：并发上架同一商品的不同容器，库存缓存不得相互覆盖
// ───────────────────────────────────────────────────────────────────────────
async function scenarioConcurrentPutawayNoLostUpdate(ctx, log) {
  log.section('P1-9 并发上架同一商品的多只容器，inventory_stock 不得丢失更新')
  const { pool, warehouse } = ctx
  const product = await createTestProduct(pool, 'sync')

  const PARALLEL = 8
  const QTY_EACH = 10

  // 先造 8 只「待上架」容器（此时不计入可用库存）
  const pendingIds = []
  for (let i = 0; i < PARALLEL; i++) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const { containerId } = await containerEngine.createContainer(conn, {
        productId: product.id, warehouseId: warehouse.id, initialQty: QTY_EACH,
        sourceType: containerEngine.SOURCE_TYPE.MANUAL, sourceRefId: 999996,
        remark: 'P1并发上架测试',
        containerStatus: containerEngine.CONTAINER_STATUS.PENDING_PUTAWAY,
      })
      await conn.commit()
      pendingIds.push(containerId)
    } catch (e) {
      await conn.rollback(); throw e
    } finally { conn.release() }
  }

  const [pre] = await dbQuery(
    pool, 'SELECT COALESCE(quantity,0) q FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, warehouse.id],
  )
  log.assert('前置：待上架容器不计入库存缓存', Number(pre?.q ?? 0) === 0, JSON.stringify(pre || {}))

  // 8 个上架员同时扫码上架各自的容器 —— 每人一个独立事务
  const results = await Promise.allSettled(pendingIds.map(async (cid) => {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await containerEngine.promotePendingContainerToActive(conn, cid, product.id, warehouse.id)
      await conn.commit()
    } catch (e) {
      await conn.rollback(); throw e
    } finally { conn.release() }
  }))

  const rejected = results.filter(r => r.status === 'rejected')
  log.assert(
    `${PARALLEL} 个并发上架全部成功`,
    rejected.length === 0,
    rejected.slice(0, 2).map(r => r.reason?.message).join(' | '),
  )

  const [stock] = await dbQuery(
    pool, 'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, warehouse.id],
  )
  const [containers] = await dbQuery(
    pool,
    'SELECT COALESCE(SUM(remaining_qty),0) s FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL',
    [product.id, warehouse.id],
  )
  log.assert(
    `★P1-9 库存缓存等于 ${PARALLEL}×${QTY_EACH}=${PARALLEL * QTY_EACH}（修复前汇总在加锁之前完成，并发上架会互相覆盖 → 缓存偏小）`,
    Number(stock?.quantity) === PARALLEL * QTY_EACH,
    `实际 quantity=${stock?.quantity}`,
  )
  log.assert(
    '★P1-9 库存缓存与容器实际总和严格一致（系统核心不变量）',
    Number(stock?.quantity) === Number(containers?.s ?? containers),
    `缓存=${stock?.quantity} 容器合计=${JSON.stringify(containers)}`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
// P1-9：热点索引必须存在且被出库查询实际命中
// ───────────────────────────────────────────────────────────────────────────
async function scenarioHotIndexInPlace(ctx, log) {
  log.section('P1-9 库存热点复合索引必须存在并被实际命中')
  const { pool } = ctx

  const idx = await dbQuery(
    pool,
    `SELECT COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name='inventory_containers'
       AND index_name='idx_container_hot' ORDER BY SEQ_IN_INDEX`,
  )
  log.assert(
    '★P1-9 idx_container_hot 存在且列顺序为 product_id,warehouse_id,status,deleted_at',
    idx.map(r => r.COLUMN_NAME).join(',') === 'product_id,warehouse_id,status,deleted_at',
    JSON.stringify(idx.map(r => r.COLUMN_NAME)),
  )

  const plan = await dbQuery(
    pool,
    `EXPLAIN SELECT COALESCE(SUM(remaining_qty),0) t FROM inventory_containers
     WHERE product_id=1 AND warehouse_id=1 AND status=1 AND deleted_at IS NULL`,
  )
  const planText = JSON.stringify(plan)
  log.assert(
    '★P1-9 库存汇总查询实际走 idx_container_hot（status/deleted_at 在索引层过滤，EMPTY 历史容器不再进入锁范围）',
    /idx_container_hot/.test(planText),
    planText.slice(0, 300),
  )
}

// ───────────────────────────────────────────────────────────────────────────
// 收货侧场景的公共装配：建采购单（可指定单价）→ 确认 → 取明细行
// ───────────────────────────────────────────────────────────────────────────
/** payload_json 是 JSON 列，驱动可能已经解析成对象，也可能仍是字符串 */
function readPayload(row) {
  const raw = row?.payload_json
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw)) } catch { return null }
}

async function seedPurchase(http, token, { supplier, warehouse, product, quantity, unitPrice }) {
  const resp = await http.post('/api/purchase', {
    token,
    json: {
      supplierId: supplier.id,
      supplierName: supplier.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      items: [{
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPrice,
      }],
    },
  })
  const poId = Number(resp.data?.data?.id)
  await http.post(`/api/purchase/${poId}/confirm`, { token })
  return poId
}

// ───────────────────────────────────────────────────────────────────────────
// P1-4：混单收货（同商品两张采购单、不同单价）时，容器必须记住自己属于哪一行，
//       上架量与移动加权成本按归属精确落账，而不是按 id 顺序 first-fit 猜
// ───────────────────────────────────────────────────────────────────────────
async function scenarioContainerCarriesPurchaseOwnership(ctx, log, token) {
  log.section('P1-4 混单收货：容器归属决定上架落账与移动加权成本')
  const { http, pool, warehouse, location, supplier, pdaHeaders } = ctx
  const product = await createTestProduct(pool, 'owner')

  // 同一商品来自两张采购单：便宜的 10 元/件，贵的 30 元/件
  const poCheap = await seedPurchase(http, token, { supplier, warehouse, product, quantity: 5, unitPrice: 10 })
  const poPricey = await seedPurchase(http, token, { supplier, warehouse, product, quantity: 15, unitPrice: 30 })
  const [cheapItem] = await dbQuery(pool, 'SELECT id FROM purchase_order_items WHERE order_id=?', [poCheap])
  const [priceyItem] = await dbQuery(pool, 'SELECT id FROM purchase_order_items WHERE order_id=?', [poPricey])

  // 混单建收货订单（系统明确支持，见 createManualTask）
  const taskResp = await http.post('/api/inbound-tasks', {
    token,
    json: {
      supplierId: supplier.id,
      supplierName: supplier.name,
      items: [
        { purchaseItemId: Number(cheapItem.id), qty: 5 },
        { purchaseItemId: Number(priceyItem.id), qty: 15 },
      ],
    },
  })
  const taskId = Number(taskResp.data?.data?.taskId)
  log.assert('混单收货订单创建成功', Number.isFinite(taskId) && taskId > 0, JSON.stringify(taskResp.data).slice(0, 200))
  await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })

  const [lineCheap] = await dbQuery(
    pool, 'SELECT id FROM inbound_task_items WHERE task_id=? AND purchase_item_id=?', [taskId, cheapItem.id],
  )
  const [linePricey] = await dbQuery(
    pool, 'SELECT id FROM inbound_task_items WHERE task_id=? AND purchase_item_id=?', [taskId, priceyItem.id],
  )

  // 第一箱 5 件填满便宜行；第二箱 10 件全部落在贵的那行（短装：贵的行应到 15 只来了 10）
  const r1 = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: 5 }] },
  })
  log.assert('第一箱收货成功', r1.ok, JSON.stringify(r1.data).slice(0, 200))
  const r2 = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: 10 }] },
  })
  log.assert('第二箱收货成功', r2.ok, JSON.stringify(r2.data).slice(0, 200))

  const containers = await dbQuery(
    pool,
    `SELECT id, remaining_qty, inbound_task_item_id FROM inventory_containers
     WHERE inbound_task_id=? AND deleted_at IS NULL ORDER BY id`,
    [taskId],
  )
  const boxCheap = containers.find(c => Number(c.remaining_qty) === 5)
  const boxPricey = containers.find(c => Number(c.remaining_qty) === 10)
  log.assert(
    '★P1-4 5 件那箱记住了自己属于 10 元的采购明细（修复前容器不记归属，字段为空）',
    Number(boxCheap?.inbound_task_item_id) === Number(lineCheap.id),
    `容器归属=${boxCheap?.inbound_task_item_id} 期望=${lineCheap.id}`,
  )
  log.assert(
    '★P1-4 10 件那箱记住了自己属于 30 元的采购明细',
    Number(boxPricey?.inbound_task_item_id) === Number(linePricey.id),
    `容器归属=${boxPricey?.inbound_task_item_id} 期望=${linePricey.id}`,
  )

  // 现场先扫到哪箱就先上哪箱——这里先上贵的那箱，正是 first-fit 会错配的顺序：
  // 按 id 顺序它会把这 10 件记到便宜行头上（便宜行 cap=5，先吃满 5，剩 5 才给贵行）
  const putPricey = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
    token, headers: pdaHeaders(), json: { containerId: Number(boxPricey.id), locationId: Number(location.id) },
  })
  log.assert('贵的那箱上架成功', putPricey.ok, JSON.stringify(putPricey.data).slice(0, 200))

  const midLines = await dbQuery(
    pool, 'SELECT id, putaway_qty FROM inbound_task_items WHERE task_id=? ORDER BY id', [taskId],
  )
  const midCheap = midLines.find(r => Number(r.id) === Number(lineCheap.id))
  const midPricey = midLines.find(r => Number(r.id) === Number(linePricey.id))
  log.assert(
    '★P1-4 这 10 件全部落在 30 元那行（修复前 first-fit 会先把 5 件记到 10 元行头上）',
    Number(midPricey?.putaway_qty) === 10 && Number(midCheap?.putaway_qty) === 0,
    `10元行=${midCheap?.putaway_qty} 30元行=${midPricey?.putaway_qty}`,
  )

  // 移动加权成本：这 10 件必须按它真实的 30 元入账。修复前单价取 `ORDER BY iti.id LIMIT 1`
  // ——永远是第一行的 10 元，贵的货按便宜价计入均价，且这个错误不会被后续上架收敛修正。
  const [prodRow] = await dbQuery(pool, 'SELECT avg_cost FROM product_items WHERE id=?', [product.id])
  log.assert(
    '★P1-4 移动加权成本按容器归属的 30 元计价（修复前恒取第一行的 10 元 → 成本永久性偏低）',
    Math.abs(Number(prodRow?.avg_cost) - 30) < 0.01,
    `avg_cost=${prodRow?.avg_cost}`,
  )

  const [logRow] = await dbQuery(
    pool,
    `SELECT unit_price FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=? AND container_id=?`,
    [taskId, boxPricey.id],
  )
  log.assert(
    '★P1-4 出入库日志里的单价快照同样是 30 元（成本追溯的唯一依据）',
    Math.abs(Number(logRow?.unit_price) - 30) < 0.01,
    `日志单价=${logRow?.unit_price}`,
  )

  // 再上便宜那箱，确认总量守恒——精确归属不能破坏"上架总量 = 实收总量"这个不变量
  await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
    token, headers: pdaHeaders(), json: { containerId: Number(boxCheap.id), locationId: Number(location.id) },
  })
  const finalLines = await dbQuery(
    pool, 'SELECT received_qty, putaway_qty FROM inbound_task_items WHERE task_id=?', [taskId],
  )
  const totalRecv = finalLines.reduce((s, r) => s + Number(r.received_qty), 0)
  const totalPut = finalLines.reduce((s, r) => s + Number(r.putaway_qty), 0)
  log.assert(
    '★P1-4 全部上架后上架总量守恒（15=15），归属分配未凭空增减数量',
    totalRecv === 15 && totalPut === 15,
    `实收=${totalRecv} 上架=${totalPut}`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
// P1-3：超收闸门必须是「比例 OR 金额」双闸门；任何超收都要留痕
// ───────────────────────────────────────────────────────────────────────────
async function scenarioOverReceiveDualGate(ctx, log, token) {
  log.section('P1-3 超收：比例 OR 金额双闸门 + 全量留痕')
  const { http, pool, warehouse, supplier, pdaHeaders } = ctx

  // 贵重商品：应到 100 件 × 100 元。超收 10 件 = 10%，低于 20% 比例闸门，
  // 但金额 1000 元远超默认 500 元闸门——这正是纯比例阈值放行的危险区间。
  const pricey = await createTestProduct(pool, 'overamt')
  const poId = await seedPurchase(http, token, { supplier, warehouse, product: pricey, quantity: 100, unitPrice: 100 })
  const taskResp = await http.post('/api/inbound-tasks', { token, json: { poId } })
  const taskId = Number(taskResp.data?.data?.taskId)
  await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })

  const blocked = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(pricey.id), packages: [{ qty: 110 }] },
  })
  log.assert(
    '★P1-3 超收 10%（低于比例闸门）但金额 1000 元时被拦下要求确认（修复前静默放行并自动计入应付）',
    blocked.status === 409 && blocked.data?.code === 'OVER_RECEIVE_CONFIRM_REQUIRED',
    `status=${blocked.status} code=${blocked.data?.code} msg=${blocked.data?.message}`,
  )
  log.assert(
    '★P1-3 拦截信息里带出金额影响，便于现场判断是不是真多送了这么多货',
    Number(blocked.data?.data?.overAmount) === 1000 && (blocked.data?.data?.reasons || []).includes('amount'),
    JSON.stringify(blocked.data?.data),
  )

  const [beforeCount] = await dbQuery(
    pool, 'SELECT COALESCE(SUM(received_qty),0) AS q FROM inbound_task_items WHERE task_id=?', [taskId],
  )
  log.assert('被拦下时一件都没入账（事务完整回滚）', Number(beforeCount.q) === 0, `received=${beforeCount.q}`)

  const confirmed = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(),
    json: { productId: Number(pricey.id), packages: [{ qty: 110 }], confirmOverReceive: true },
  })
  log.assert('确认后可以正常收货', confirmed.ok, JSON.stringify(confirmed.data).slice(0, 200))

  const events = await dbQuery(
    pool,
    `SELECT payload_json FROM inbound_task_events WHERE task_id=? AND event_type='over_receive'`,
    [taskId],
  )
  const payload = readPayload(events[0])
  log.assert(
    '★P1-3 超收写入独立事件留痕，含数量/金额/闸门原因（修复前单据上不留任何异常痕迹）',
    events.length === 1 && Number(payload?.overQty) === 10 && Number(payload?.overAmount) === 1000
      && payload?.confirmed === true,
    JSON.stringify(payload),
  )

  // 小额超收：既不到比例闸门也不到金额闸门 → 不打断现场，但同样要留痕
  const cheap = await createTestProduct(pool, 'overlow')
  const poId2 = await seedPurchase(http, token, { supplier, warehouse, product: cheap, quantity: 100, unitPrice: 1 })
  const taskResp2 = await http.post('/api/inbound-tasks', { token, json: { poId: poId2 } })
  const taskId2 = Number(taskResp2.data?.data?.taskId)
  await http.post(`/api/inbound-tasks/${taskId2}/submit`, { token })
  const smallOver = await http.post(`/api/inbound-tasks/${taskId2}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(cheap.id), packages: [{ qty: 110 }] },
  })
  log.assert(
    '小额超收（10 件 × 1 元）不打断现场作业，直接放行',
    smallOver.ok,
    `status=${smallOver.status} ${JSON.stringify(smallOver.data).slice(0, 160)}`,
  )
  const events2 = await dbQuery(
    pool,
    `SELECT payload_json FROM inbound_task_events WHERE task_id=? AND event_type='over_receive'`,
    [taskId2],
  )
  const payload2 = readPayload(events2[0])
  log.assert(
    '★P1-3 未触发闸门的超收也留痕（gateTriggered=false），财务日终能捞到全部超收',
    events2.length === 1 && Number(payload2?.overQty) === 10 && payload2?.gateTriggered === false,
    JSON.stringify(payload2),
  )
}

// ───────────────────────────────────────────────────────────────────────────
// P1-5：时间窗内重复扫码必须被业务层拦下（幂等键只能防网络重试，防不住人手抖）
// ───────────────────────────────────────────────────────────────────────────
async function scenarioDuplicateScanGuard(ctx, log, token) {
  log.section('P1-5 重复扫码：业务级时间窗防重')
  const { http, pool, warehouse, supplier, pdaHeaders } = ctx
  const product = await createTestProduct(pool, 'dup')

  const poId = await seedPurchase(http, token, { supplier, warehouse, product, quantity: 100, unitPrice: 1 })
  const taskResp = await http.post('/api/inbound-tasks', { token, json: { poId } })
  const taskId = Number(taskResp.data?.data?.taskId)
  await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })

  const first = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: 10 }] },
  })
  log.assert('首次收货成功', first.ok, JSON.stringify(first.data).slice(0, 160))

  // 员工把同一箱又扫了一遍：新的 requestKey，幂等键完全防不住
  const dup = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: 10 }] },
  })
  log.assert(
    '★P1-5 时间窗内同商品同箱型的重复提交被拦下要求确认（修复前直接重复入账，凭空多出一个容器和一批库存）',
    dup.status === 409 && dup.data?.code === 'DUPLICATE_SCAN_CONFIRM_REQUIRED',
    `status=${dup.status} code=${dup.data?.code} msg=${dup.data?.message}`,
  )

  const [afterDup] = await dbQuery(
    pool, 'SELECT COALESCE(SUM(received_qty),0) AS q FROM inbound_task_items WHERE task_id=?', [taskId],
  )
  log.assert('被拦下时没有产生第二笔入账', Number(afterDup.q) === 10, `received=${afterDup.q}`)

  // 数量不同 → 是另一箱货，不能误伤
  const different = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: 12 }] },
  })
  log.assert(
    '★P1-5 数量不同的后续收货不被误伤（防重只针对完全相同的箱型组合）',
    different.ok,
    `status=${different.status} ${JSON.stringify(different.data).slice(0, 160)}`,
  )

  // 确实是另一批一模一样的货 → 确认后放行
  const confirmed = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(),
    json: { productId: Number(product.id), packages: [{ qty: 10 }], confirmDuplicate: true },
  })
  log.assert('确认后可以正常收货（真实场景里连收两批相同的货是可能的）', confirmed.ok, JSON.stringify(confirmed.data).slice(0, 160))

  const [final] = await dbQuery(
    pool, 'SELECT COALESCE(SUM(received_qty),0) AS q FROM inbound_task_items WHERE task_id=?', [taskId],
  )
  log.assert('最终入账 = 10 + 12 + 10 = 32（被拦那次没留下痕迹）', Number(final.q) === 32, `received=${final.q}`)
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行 P1 回归测试')

    await scenarioLockedContainersAreSkipped(ctx, log)
    await scenarioCannotMergeIntoLockedBox(ctx, log)
    await scenarioConcurrentReserveNoDeadlock(ctx, log, token)
    await scenarioConcurrentPutawayNoLostUpdate(ctx, log)
    await scenarioHotIndexInPlace(ctx, log)
    await scenarioContainerCarriesPurchaseOwnership(ctx, log, token)
    await scenarioOverReceiveDualGate(ctx, log, token)
    await scenarioDuplicateScanGuard(ctx, log, token)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[P1-REGRESSION] 未捕获异常：', e)
  process.exit(1)
})
