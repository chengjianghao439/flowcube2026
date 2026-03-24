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
 * @param {string} params.refNo         - 销售单编号
 */
async function reserve(conn, { productId, productName = '该商品', warehouseId, qty, refType, refId, refNo }) {
  // 加行锁，读取 on_hand 和 reserved
  const [[row]] = await conn.query(
    'SELECT quantity, reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
    [productId, warehouseId]
  )
  const onHand   = row ? Number(row.quantity) : 0
  const reserved = row ? Number(row.reserved)  : 0
  const available = onHand - reserved

  if (available < qty) {
    throw new AppError(
      `商品「${productName}」可用库存不足，` +
      `实际库存 ${onHand}，已预占 ${reserved}，可用 ${available}，需要 ${qty}`,
      400
    )
  }

  // 增加 reserved（行不存在时先 insert，这种情况 onHand=0 available=0 会在上面被拦截）
  await conn.query(
    `INSERT INTO inventory_stock (product_id, warehouse_id, quantity, reserved) VALUES (?,?,0,?)
     ON DUPLICATE KEY UPDATE reserved = reserved + ?`,
    [productId, warehouseId, qty, qty]
  )

  // 写入预占记录，供取消时释放使用
  await conn.query(
    `INSERT INTO stock_reservations (product_id, warehouse_id, qty, ref_type, ref_id, ref_no, status) VALUES (?,?,?,?,?,?,1)`,
    [productId, warehouseId, qty, refType, refId, refNo]
  )
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
  const [rows] = await conn.query(
    'SELECT * FROM stock_reservations WHERE ref_type=? AND ref_id=? AND status=1',
    [refType, refId]
  )
  if (!rows.length) return   // 无有效预占，可能未曾确认过

  for (const r of rows) {
    // 减少 reserved（使用 GREATEST 保证不低于 0）
    await conn.query(
      'UPDATE inventory_stock SET reserved = GREATEST(0, reserved - ?) WHERE product_id=? AND warehouse_id=?',
      [Number(r.qty), r.product_id, r.warehouse_id]
    )
    // 标记为已释放
    await conn.query('UPDATE stock_reservations SET status=3 WHERE id=?', [r.id])
  }
}

/**
 * 标记预占为已履行（出库时由 inventoryEngine 调用）
 * 仅更新 stock_reservations 状态，reserved 字段由 inventoryEngine 在同一操作中同步减少
 *
 * @param {object} conn
 * @param {string} refType    - 'sale_order'
 * @param {number} refId      - 销售单 ID
 * @param {number} productId
 * @param {number} warehouseId
 */
async function markFulfilled(conn, refType, refId, productId, warehouseId) {
  await conn.query(
    `UPDATE stock_reservations SET status=2
     WHERE ref_type=? AND ref_id=? AND product_id=? AND warehouse_id=? AND status=1`,
    [refType, refId, productId, warehouseId]
  )
}

module.exports = { reserve, releaseByRef, markFulfilled }
