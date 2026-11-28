'use strict'
const AppError = require('../../utils/AppError')

// 采购单状态：1=草稿，4=已取消
const EXCLUDED_PURCHASE_STATUSES = [1, 4]

function parsePositiveInt(raw, label) {
  const s = String(raw ?? '').trim()
  if (!/^[1-9]\d*$/.test(s)) throw new AppError(`${label}无效`, 400, 'INVALID_PARAM')
  const n = Number(s)
  if (!Number.isSafeInteger(n)) throw new AppError(`${label}无效`, 400, 'INVALID_PARAM')
  return n
}

function formatBeijingDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')?.value || ''
  const m = parts.find(p => p.type === 'month')?.value || ''
  const day = parts.find(p => p.type === 'day')?.value || ''
  return `${y}-${m}-${day}`
}

/**
 * 查询某供应商对某商品的最近历史采购价（排除草稿与已取消采购单）。
 * 严格遵守仓库范围：空数组范围直接返回空数组，不查库。
 */
async function findSupplierPriceHistory({ supplierId, productId, limit = 1, scopeWarehouseIds = null }, db = null) {
  const sid = parsePositiveInt(supplierId, '供应商编号')
  const pid = parsePositiveInt(productId, '商品编号')
  const rawLimit = Number(limit)
  const safeLimit = Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 10) : 1

  if (Array.isArray(scopeWarehouseIds) && scopeWarehouseIds.length === 0) return []
  const executor = db || require('../../config/db').pool

  const where = [
    'po.deleted_at IS NULL',
    'po.supplier_id = ?',
    'poi.product_id = ?',
    'po.status NOT IN (?, ?)',
  ]
  const params = [sid, pid, ...EXCLUDED_PURCHASE_STATUSES]

  if (Array.isArray(scopeWarehouseIds) && scopeWarehouseIds.length > 0) {
    where.push(`po.warehouse_id IN (${scopeWarehouseIds.map(() => '?').join(',')})`)
    params.push(...scopeWarehouseIds)
  }

  params.push(safeLimit)
  const [rows] = await executor.query(
    `SELECT po.id AS order_id, po.order_no, po.created_at,
            poi.unit_price, poi.amount, poi.quantity, poi.unit,
            poi.entry_qty, poi.entry_unit
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.order_id
      WHERE ${where.join(' AND ')}
      ORDER BY po.created_at DESC, po.id DESC, poi.id DESC
      LIMIT ?`,
    params,
  )

  return rows.map((row) => {
    const entryQty = Number(row.entry_qty)
    const amount = Number(row.amount)
    const effectivePrice = Number.isFinite(entryQty) && entryQty > 0 && Number.isFinite(amount)
      ? Math.round((amount / entryQty) * 10000) / 10000
      : Number(row.unit_price || 0)
    return {
      orderId: Number(row.order_id),
      orderNo: String(row.order_no || ''),
      orderDate: formatBeijingDate(row.created_at),
      unitPrice: Number.isFinite(effectivePrice) ? effectivePrice : 0,
      quantity: Number.isFinite(entryQty) && entryQty > 0 ? entryQty : Number(row.quantity || 0),
      unit: String(row.entry_unit || row.unit || ''),
    }
  })
}

module.exports = { findSupplierPriceHistory }
