const crypto = require('node:crypto')
const AppError = require('../../utils/AppError')
const { assertQtyScale } = require('../../utils/qtyPrecision')
const { roundQty } = require('../../utils/unitConversion')

function stable(value) {
  if (value instanceof Date) return JSON.stringify(value.toJSON())
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
}
const hash = value => crypto.createHash('sha256').update(stable(value)).digest('hex')
function editFingerprint(head, items, sources = null) {
  const ordered = rows => [...rows].sort((a, b) => Number(a.id) - Number(b.id))
  return hash({ head, items: ordered(items), sources: sources ? { orders: ordered(sources.orders), items: ordered(sources.items) } : null })
}
const requestFingerprint = body => hash(body)
function isDraftEditable(head, items, containerCount = 0) {
  return Number(head.status) === 1 && head.submitted_at == null && items.length > 0 && Number(containerCount) === 0
    && items.every(i => i.received_qty != null && i.putaway_qty != null && Number(i.received_qty) === 0 && Number(i.putaway_qty) === 0)
}
function normalizeEditItems(items) {
  if (!Array.isArray(items) || !items.length) throw new AppError('请至少选择一条采购明细', 400, 'INBOUND_EDIT_ITEMS_INVALID')
  const ids = new Set()
  return items.map(item => {
    if (!item || !Number.isSafeInteger(item.purchaseItemId) || item.purchaseItemId <= 0) throw new AppError('采购明细无效', 400, 'INBOUND_EDIT_ITEMS_INVALID')
    if (ids.has(item.purchaseItemId)) throw new AppError('同一采购明细不能重复选择', 400, 'INBOUND_EDIT_DUPLICATE_SOURCE')
    ids.add(item.purchaseItemId)
    if (typeof item.qty !== 'number' || !Number.isFinite(item.qty) || item.qty <= 0 || item.qty > 9999999999.99) throw new AppError('收货数量必须是有效正数', 400, 'INBOUND_EDIT_ITEMS_INVALID')
    assertQtyScale(item.qty, '应收数量')
    return { purchaseItemId: item.purchaseItemId, qty: roundQty(item.qty) }
  })
}
function isFreightAmount(value) {
  // 此域金额只记录两位；不能用数量的浮点容差，否则高位金额会被数据库静默舍入。
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 999999999999.99
    && /^\d+(?:\.\d{1,2})?$/.test(String(value))
}
function normalizeFreight(body = {}, head = {}) {
  const freightType = body.freightType === undefined ? (head.freight_type == null ? null : Number(head.freight_type)) : body.freightType
  const freightAmount = body.freightAmount === undefined ? (head.freight_amount == null ? null : Number(head.freight_amount)) : body.freightAmount
  if ((freightType !== null && ![1, 2, 3].includes(freightType))
    || (freightAmount !== null && !isFreightAmount(freightAmount))) {
    throw new AppError('运费记录格式无效：付款方式只允许寄付、到付或第三方付，金额须为非负两位小数', 400, 'INBOUND_FREIGHT_INVALID')
  }
  return { freightType, freightAmount }
}
module.exports = { editFingerprint, requestFingerprint, isDraftEditable, normalizeEditItems, isFreightAmount, normalizeFreight }
