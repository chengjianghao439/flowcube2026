/**
 * Reservation Engine — 库存预占引擎
 *
 * 规则：
 *  1. 销售单确认时调用 reserve()，检查可用库存并增加 reserved
 *  2. 出库时由 inventoryEngine.moveStock() 自动调用 markFulfilled()
 *  3. 取消已确认的销售单时调用 releaseByRef() 释放预占
 *  4. 所有操作在调用方提供的已开启事务的连接中执行
 *
 *  可用库存公式：available = on_hand (quantity) - reserved
 */

const AppError = require('../utils/AppError')
const logger = require('../utils/logger')
const { getAvailableStockForDecision, lockStockDimension } = require('./containerEngine')
const { getExpectedStock, reduceExpectedBindings } = require('../utils/expectedStock')

/**
 * 收敛截断留痕：reserved 的 GREATEST/LEAST 兜底是防负数扩散的正确手段，
 * 但真的触发即意味着上游存在预占记录与 reserved 计数漂移，必须留下告警痕迹
 * 供监控抓取，不允许静默自愈（否则漂移根因永远无人知晓）。
 */
function logReservedClamp(context, detail) {
  logger.error(`[GUARD] reserved 收敛截断：${context}`, null, detail, 'StockClampGuard')
}

/**
 * 预占库存
 * 校验可用库存 >= qty，然后增加 reserved 并写入 stock_reservations 记录
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.productId
 * @param {string} params.productName   - 用于错误提示
 * @param {number} params.warehouseId
 * @param {number} params.qty           - 预占数量（正数）
 * @param {string} params.refType       - 固定为 'sale_order'
 * @param {number} params.refId         - 销售单 ID
 * @param {number} [params.refItemId]   - 销售单明细行 id（在途绑定时记录）
 * @param {string} params.refNo         - 销售单编号
 * @param {boolean} [params.includeExpected=false] - 是否把采购单预计到货量算进可用（仅销售占库用）
 */
async function reserve(conn, { productId, productName = '该商品', warehouseId, qty,
  refType, refId, refItemId = null, refNo, includeExpected = false }) {
  const { quantity: onHand, reserved, available } = await getAvailableStockForDecision(conn, {
    productId,
    warehouseId,
    lock: true,
    includeExpected,
  })

  if (available < qty) {
    throw new AppError(
      `商品「${productName}」可用库存不足，` +
      `实际库存 ${onHand}，已预占 ${reserved}，可用 ${available}，需要 ${qty}`,
      400
    )
  }

  // 采购/库存锁内重新读取，不能复用调用方占库前的 expectedItems 快照。
  const expected = includeExpected
    ? await getExpectedStock(conn, [{ productId, warehouseId }], { lock: true })
    : null
  const bound = expected?.boundByPair.get(`${Number(productId)}:${Number(warehouseId)}`) || 0
  const physicalReserved = Math.max(0, Number(reserved) - bound)
  const fromExpected = Math.max(0, Number(qty) - Math.max(0, Number(onHand) - physicalReserved))
  if (includeExpected && fromExpected > 1e-6 && (refType !== 'sale_order' || refItemId == null)) {
    throw new AppError('预计量占库必须指定销售明细', 400)
  }

  // 增加 reserved。quantity 是容器汇总缓存，只能由 syncStockFromContainers() 写入；
  // 此处仅确保 stock 行存在，不能把容器投影 onHand 回写到 quantity。
  await conn.query(
    `INSERT INTO inventory_stock (product_id, warehouse_id, quantity, reserved) VALUES (?,?,0,?)
     ON DUPLICATE KEY UPDATE reserved = reserved + VALUES(reserved)`,
    [productId, warehouseId, qty]
  )

  // 写入预占记录，供取消时释放使用
  await conn.query(
    `INSERT INTO stock_reservations (product_id, warehouse_id, qty, ref_type, ref_id, ref_no, status) VALUES (?,?,?,?,?,?,1)`,
    [productId, warehouseId, qty, refType, refId, refNo]
  )

  // 现货只减去现货预占；已绑定预计量的其它销售不能再次吞掉未占用的现货。
  if (includeExpected && refItemId != null) {
    if (fromExpected > 0) {
      let remaining = fromExpected
      for (const it of expected.items) {
        if (remaining <= 1e-6) break
        const take = Math.min(Number(it.burnable), remaining)
        if (take <= 1e-6) continue
        await conn.query(
          `INSERT INTO sale_order_expected_bindings
             (sale_order_id, sale_order_item_id, purchase_order_id, purchase_item_id, product_id, warehouse_id, qty)
           VALUES (?,?,?,?,?,?,?)`,
          [refId, refItemId, it.purchase_order_id, it.purchase_item_id, productId, warehouseId, take],
        )
        remaining = Math.round((remaining - take) * 10000) / 10000
      }
      if (remaining > 1e-6) throw new AppError('采购预计可绑定量不足，请刷新后重试', 409)
    }
  }
}

/**
 * 释放预占（取消销售单时调用）
 * 将该单据的所有 active 预占标记为 released，并减少 inventory_stock.reserved
 *
 * @param {object} conn
 * @param {string} refType   - 'sale_order'
 * @param {number} refId     - 销售单 ID
 */
async function releaseByRef(conn, refType, refId) {
  // 先锁所有库存维度，才能锁预占/预计绑定。否则首行释放提前锁住其它商品绑定，
  // 与后者的上架（库存→绑定）或出库（库存→预占）形成 ABBA。
  const [dimensions] = await conn.query(
    `SELECT DISTINCT product_id,warehouse_id FROM stock_reservations
     WHERE ref_type=? AND ref_id=? AND status=1 ORDER BY product_id,warehouse_id`,
    [refType, refId],
  )
  for (const dimension of dimensions) await lockStockDimension(conn, dimension.product_id, dimension.warehouse_id)
  const [rows] = await conn.query(
    'SELECT * FROM stock_reservations WHERE ref_type=? AND ref_id=? AND status=1 FOR UPDATE',
    [refType, refId]
  )

  const lockedDimensions = new Set(dimensions.map(d => `${Number(d.product_id)}:${Number(d.warehouse_id)}`))
  if (rows.some(r => !lockedDimensions.has(`${Number(r.product_id)}:${Number(r.warehouse_id)}`))) {
    // 调用者旧 RR 快照可能漏掉刚新增的维度；不能持着预占行锁再补取该库存锁。
    throw new AppError('预占维度已变化，请刷新后重试释放库存', 409)
  }

  for (const r of rows) {
    // 减少 reserved（使用 GREATEST 保证不低于 0；截断即告警，见 logReservedClamp）
    const [[stockRow]] = await conn.query(
      'SELECT reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
      [r.product_id, r.warehouse_id]
    )
    const curReserved = Number(stockRow?.reserved ?? 0)
    if (curReserved < Number(r.qty)) {
      logReservedClamp('释放预占时 reserved 小于预占记录量', {
        refType, refId, productId: r.product_id, warehouseId: r.warehouse_id,
        releaseQty: Number(r.qty), reserved: curReserved,
      })
    }
    await conn.query(
      'UPDATE inventory_stock SET reserved = GREATEST(0, reserved - ?) WHERE product_id=? AND warehouse_id=?',
      [Number(r.qty), r.product_id, r.warehouse_id]
    )
    // 标记为已释放
    await conn.query('UPDATE stock_reservations SET status=3 WHERE id=?', [r.id])
  }
  // 全部维度预占核销后统一关闭依赖；也能清理旧版本履约后残留的本单绑定。
  if (refType === 'sale_order') {
    await conn.query(
      'UPDATE sale_order_expected_bindings SET released_at=NOW() WHERE sale_order_id=? AND released_at IS NULL',
      [refId],
    )
  }
}

/**
 * 按量核销预占（出库时由 inventoryEngine 调用）
 * 仅更新 stock_reservations 状态，reserved 字段由 inventoryEngine 在同一操作中同步减少
 *
 * 必须按本次实际出库量 first-fit 核销，不能把该 (单据,商品,仓库) 下所有 status=1 记录
 * 一次性标记为已履行：分批发货（迁移 123/125）下同一组合会经历多次部分出库，整组标记会让
 * 后续 releaseByRef 找不到 status=1 记录而静默跳过，剩余预占永久泄漏——货在货架上却永远
 * 不可用，且没有任何自愈路径（GREATEST/LEAST 收敛都不会触发），只能人工改库。
 *
 * 部分履行时把已履行的量拆成一条独立的 status=2 记录，剩余量留在原记录继续预占，
 * 保证「预占记录合计 = reserved」这个不变量在任何出库进度下都成立。
 *
 * @param {object} conn
 * @param {string} refType    - 'sale_order'
 * @param {number} refId      - 销售单 ID
 * @param {number} productId
 * @param {number} warehouseId
 * @param {number} [qty]      - 本次实际出库量；不传则退化为整组核销（兼容旧调用，现已无此类调用）
 */
async function markFulfilled(conn, refType, refId, productId, warehouseId, qty = null) {
  if (qty == null) {
    await conn.query(
      `UPDATE stock_reservations SET status=2
       WHERE ref_type=? AND ref_id=? AND product_id=? AND warehouse_id=? AND status=1`,
      [refType, refId, productId, warehouseId],
    )
    if (refType === 'sale_order') await reduceExpectedBindings(conn, { saleOrderId: refId, productId, warehouseId }, Number.MAX_SAFE_INTEGER / 10000)
    return
  }

  let remaining = Number(qty)
  if (!(remaining > 0)) return

  const [rows] = await conn.query(
    `SELECT id, qty FROM stock_reservations
     WHERE ref_type=? AND ref_id=? AND product_id=? AND warehouse_id=? AND status=1
     ORDER BY id ASC FOR UPDATE`,
    [refType, refId, productId, warehouseId],
  )

  for (const r of rows) {
    if (remaining <= 0) break
    const rowQty = Number(r.qty)
    const take = Math.min(rowQty, remaining)
    if (take >= rowQty) {
      await conn.query('UPDATE stock_reservations SET status=2 WHERE id=?', [r.id])
    } else {
      await conn.query('UPDATE stock_reservations SET qty = qty - ? WHERE id=?', [take, r.id])
      await conn.query(
        `INSERT INTO stock_reservations (product_id, warehouse_id, qty, ref_type, ref_id, ref_no, status)
         SELECT product_id, warehouse_id, ?, ref_type, ref_id, ref_no, 2
         FROM stock_reservations WHERE id = ?`,
        [take, r.id],
      )
    }
    remaining = Math.round((remaining - take) * 10000) / 10000
  }

  if (refType === 'sale_order') {
    const [[active]] = await conn.query(
      `SELECT COALESCE(SUM(qty),0) AS qty FROM stock_reservations
       WHERE ref_type=? AND ref_id=? AND product_id=? AND warehouse_id=? AND status=1 FOR UPDATE`,
      [refType, refId, productId, warehouseId],
    )
    const [[binding]] = await conn.query(
      `SELECT COALESCE(SUM(qty),0) AS qty FROM sale_order_expected_bindings
       WHERE sale_order_id=? AND product_id=? AND warehouse_id=? AND released_at IS NULL FOR UPDATE`,
      [refId, productId, warehouseId],
    )
    // 先履行现货部分，只有超出剩余预占的绑定才解除；不能提前抹掉仍依赖采购的尾量。
    await reduceExpectedBindings(conn, { saleOrderId: refId, productId, warehouseId },
      Math.max(0, Number(binding.qty) - Number(active.qty)))
  }

  // 出库量超过在册预占（预占计数已漂移，或出库走了未预占的路径）——不阻断出库，
  // 但必须留痕，否则漂移根因无从追查（与 logReservedClamp 同口径）。
  if (remaining > 0) {
    logReservedClamp('核销预占时在册预占不足，超出部分未能核销', {
      refType, refId, productId, warehouseId, fulfillQty: Number(qty), unmatched: remaining,
    })
  }
}

/**
 * 按商品部分释放预占（改单减量专用）
 * 与 releaseByRef 的区别：releaseByRef 是整单一次性全释放；本函数只按
 * (refType,refId,productId,warehouseId) 释放指定数量，first-fit 消耗该组合下
 * status=1 的预占记录，不影响该单下其它商品的预占。
 *
 * @param {object} conn
 * @param {object} params
 * @param {string} params.refType
 * @param {number} params.refId
 * @param {number} params.productId
 * @param {number} params.warehouseId
 * @param {number} params.qty - 要释放的数量（正数）
 */
async function partialReleaseByProduct(conn, { refType, refId, productId, warehouseId, qty }) {
  let remaining = Number(qty)
  if (!(remaining > 0)) return

  await lockStockDimension(conn, productId, warehouseId)

  const [rows] = await conn.query(
    `SELECT id, qty FROM stock_reservations
     WHERE ref_type=? AND ref_id=? AND product_id=? AND warehouse_id=? AND status=1
     ORDER BY id ASC FOR UPDATE`,
    [refType, refId, productId, warehouseId],
  )

  for (const r of rows) {
    if (remaining <= 0) break
    const rowQty = Number(r.qty)
    const take = Math.min(rowQty, remaining)
    if (take >= rowQty) {
      await conn.query('UPDATE stock_reservations SET status=3 WHERE id=?', [r.id])
    } else {
      await conn.query('UPDATE stock_reservations SET qty = qty - ? WHERE id=?', [take, r.id])
    }
    remaining = Math.round((remaining - take) * 10000) / 10000
  }

  const released = Number(qty) - remaining
  if (released > 0) {
    const [[stockRow]] = await conn.query(
      'SELECT reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
      [productId, warehouseId],
    )
    const curReserved = Number(stockRow?.reserved ?? 0)
    if (curReserved < released) {
      logReservedClamp('部分释放预占时 reserved 小于待释放量', {
        refType, refId, productId, warehouseId, releaseQty: released, reserved: curReserved,
      })
    }
    await conn.query(
      'UPDATE inventory_stock SET reserved = GREATEST(0, reserved - ?) WHERE product_id=? AND warehouse_id=?',
      [released, productId, warehouseId],
    )
  }
  if (remaining > 0) {
    throw new AppError(`商品预占记录不足，无法释放 ${qty} 中的剩余 ${remaining}`, 409)
  }
  if (refType === 'sale_order' && released > 0) {
    await reduceExpectedBindings(conn, { saleOrderId: refId, productId, warehouseId }, released)
  }
}

module.exports = { reserve, releaseByRef, markFulfilled, partialReleaseByProduct }
