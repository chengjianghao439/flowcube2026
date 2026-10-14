const { lockStockDimension, syncStockFromContainers } = require('../../engine/containerEngine')
const { syncReservedFromLedger } = require('../../engine/reservationEngine')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')

/** Repair one dimension atomically; candidates never supply absolute values. */
async function repairDimension(pool, productId, warehouseId, scopeWarehouseIds) {
  assertInScope(scopeWarehouseIds, warehouseId, '库存缓存')
  const conn = await pool.getConnection()
  let reusable = true
  try {
    await conn.beginTransaction()
    // Existing helper locks current product policy first, then the stock row.
    // Both facts and both cache writes stay on this same connection until commit.
    await lockStockDimension(conn, productId, warehouseId)
    const quantity = await syncStockFromContainers(conn, productId, warehouseId)
    const reserved = await syncReservedFromLedger(conn, productId, warehouseId)
    await conn.commit()
    return { quantity, reserved }
  } catch (error) {
    try { await conn.rollback() } catch {
      // An uncertain rollback must not lend this connection to another request.
      reusable = false
      conn.destroy()
    }
    throw error
  } finally {
    if (reusable) conn.release()
  }
}

async function resyncDimensions(pool, drifted, scopeWarehouseIds = null) {
  const scope = scopeFilter(scopeWarehouseIds, 's.warehouse_id')
  const [reservedDrift] = await pool.query(
    `SELECT s.product_id AS productId, s.warehouse_id AS warehouseId,
            COALESCE(s.reserved, 0) AS cacheReserved, COALESCE(r.qty, 0) AS ledgerReserved
       FROM inventory_stock s
       LEFT JOIN (SELECT product_id, warehouse_id, SUM(qty) AS qty
                    FROM stock_reservations WHERE status = 1
                   GROUP BY product_id, warehouse_id) r
              ON r.product_id = s.product_id AND r.warehouse_id = s.warehouse_id
      WHERE ABS(COALESCE(s.reserved, 0) - COALESCE(r.qty, 0)) > 0.0001${scope.sql}`,
    scope.params,
  )
  const dimensions = new Map()
  for (const row of [...drifted, ...reservedDrift]) {
    const productId = Number(row.productId), warehouseId = Number(row.warehouseId)
    dimensions.set(`${productId}:${warehouseId}`, { productId, warehouseId })
  }
  const ordered = [...dimensions.values()].sort((a, b) => a.productId - b.productId || a.warehouseId - b.warehouseId)
  const repaired = new Map()
  for (const { productId, warehouseId } of ordered) {
    repaired.set(`${productId}:${warehouseId}`, await repairDimension(pool, productId, warehouseId, scopeWarehouseIds))
  }
  // Keep the original discovery counts/before fields and response shape. They
  // describe the diagnostic snapshot; only locked facts decide cache values.
  const rows = drifted.map(row => ({
    productId: row.productId, warehouseId: row.warehouseId, before: row.cacheQty,
    after: repaired.get(`${Number(row.productId)}:${Number(row.warehouseId)}`).quantity,
  }))
  const reservedRows = reservedDrift.map(row => ({
    productId: row.productId, warehouseId: row.warehouseId, before: Number(row.cacheReserved),
    after: repaired.get(`${Number(row.productId)}:${Number(row.warehouseId)}`).reserved,
  }))
  return { ok: true, fixed: rows.length, total: drifted.length, rows, reservedFixed: reservedRows.length, reservedRows }
}

module.exports = { repairDimension, resyncDimensions }
