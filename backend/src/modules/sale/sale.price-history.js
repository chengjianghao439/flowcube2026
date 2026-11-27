'use strict'
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { SALE_STATUS } = require('../../constants/saleOrderStatus')

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
 * 查询某客户对某商品的最近历史成交价（排除草稿与已取消销售单）。
 * 严格遵守仓库范围：空数组范围直接返回空数组，不查库。
 */
async function findCustomerPriceHistory({ customerId, productId, limit = 3, scopeWarehouseIds = null }, db = pool) {
  const cid = parsePositiveInt(customerId, '客户编号')
  const pid = parsePositiveInt(productId, '商品编号')
  const rawLimit = Number(limit)
  const safeLimit = Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 10) : 3

  if (Array.isArray(scopeWarehouseIds) && scopeWarehouseIds.length === 0) return []

  const where = [
    'so.deleted_at IS NULL',
    'so.customer_id = ?',
    'soi.product_id = ?',
    'so.status NOT IN (?, ?)',
  ]
  const params = [cid, pid, SALE_STATUS.DRAFT, SALE_STATUS.CANCELLED]

  if (Array.isArray(scopeWarehouseIds) && scopeWarehouseIds.length > 0) {
    where.push(`COALESCE(soi.warehouse_id, so.warehouse_id) IN (${scopeWarehouseIds.map(() => '?').join(',')})`)
    params.push(...scopeWarehouseIds)
  }

  params.push(safeLimit)
  const [rows] = await db.query(
    `SELECT so.id AS order_id, so.order_no, so.created_at,
            soi.unit_price, soi.amount, soi.quantity, soi.unit,
            soi.entry_qty, soi.entry_unit
       FROM sale_order_items soi
       JOIN sale_orders so ON so.id = soi.order_id
      WHERE ${where.join(' AND ')}
      ORDER BY so.created_at DESC, so.id DESC, soi.id DESC
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

module.exports = { findCustomerPriceHistory }
