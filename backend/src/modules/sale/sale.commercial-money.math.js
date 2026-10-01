'use strict'
const AppError = require('../../utils/AppError')
const { decimalUnits, halfUp } = require('../accounting/voucher-sale-money')

const MAX_CENTS = 999999999999n // existing sale DECIMAL(14,4), at cent precision
const MAX_QTY_UNITS = 999999999999n // quantity2
const MAX_PRICE_UNITS = 999999999999n // price4
const MAX_ID = BigInt(Number.MAX_SAFE_INTEGER)

function invalid(message) {
  throw new AppError(message, 409, 'SALE_COMMERCIAL_MONEY_INVALID')
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}无效`)
}
// Internal snapshots accept finite JSON numbers and normal DB DECIMAL strings.
// String representations are bounded to 128 characters; scientific strings
// retain decimalUnits' exponent range [-100,100], without private normalization.
function units(value, scale, maximum, label) {
  if (!['number', 'string'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value)) || String(value).length > 128) {
    invalid(`${label}必须是有效的非负十进制数`)
  }
  let result
  try {
    result = decimalUnits(value, scale)
  } catch (error) {
    if (error.code !== 'ACCT_SALE_DECIMAL_INVALID') throw error
    invalid(`${label}必须是非负数且最多${scale}位有效小数`)
  }
  if (result > maximum) invalid(`${label}超出存储范围`)
  return result
}
function quantity(value, kind, label) {
  const result = units(value, 2, MAX_QTY_UNITS, label)
  if (kind === 'kit') {
    if (result % 100n) invalid(`${label}必须是整数套`)
    return result / 100n
  }
  return result
}
function readSnapshot(snapshot) {
  object(snapshot, '商业金额快照')
  const kind = snapshot.kind
  if (kind !== 'kit' && kind !== 'ordinary') invalid('商业金额依据类型无效')
  const Q = quantity(snapshot.originalQty, kind, '原始数量')
  if (!Q) invalid('原始数量必须大于零')
  const G = units(snapshot.grossAmount, 2, MAX_CENTS, '冻结原毛额')
  if (!Array.isArray(snapshot.components) || snapshot.components.length < 1 || snapshot.components.length > 50 ||
      (kind === 'ordinary' && snapshot.components.length !== 1)) invalid('商业组件数量无效')
  const ids = new Set()
  const components = Array.from(snapshot.components, component => {
    object(component, '商业组件')
    const id = units(component.id, 0, MAX_ID, '组件ID')
    if (!id || ids.has(id)) invalid('商业组件ID无效或重复')
    ids.add(id)
    return {
      id: Number(id),
      sortNo: Number(units(component.sortNo, 0, MAX_ID, '组件顺序')),
      budget: units(component.allocatedAmount, 2, MAX_CENTS, '冻结组件金额'),
    }
  }).sort((a, b) => a.sortNo - b.sortNo || a.id - b.id)
  if (components.reduce((sum, c) => sum + c.budget, 0n) !== G) invalid('冻结组件金额之和与原毛额不一致')
  // Ordinary commercial lines use the entry-folded frozen gross. A physical
  // display unitPrice is metadata only and must never determine their revenue.
  const price = kind === 'kit' ? units(snapshot.unitPrice, 4, MAX_PRICE_UNITS, '套成交单价') : null
  if (kind === 'kit' && halfUp(price * Q, 100n) !== G) invalid('冻结原毛额与原套价及套数不一致')
  return { kind, Q, G, price, components }
}
function readRange(s, beforeQty, afterQty) {
  const before = quantity(beforeQty, s.kind, '累计前数量')
  const after = quantity(afterQty, s.kind, '累计后数量')
  if (before > after || after > s.Q) invalid('累计数量逆序或超过原始数量')
  return { before, after }
}
const min = (a, b) => a < b ? a : b

/** O(component count): count visited slots in each frozen cyclic range. */
function project(s, q) {
  const gross = s.kind === 'kit' ? halfUp(s.price * q, 100n) : halfUp(s.G * q, s.Q)
  const base = s.G / s.Q, highCount = s.G % s.Q, extra = gross - base * q
  // Parent rounding visits high slots [0,m) when an extra cent is emitted,
  // otherwise low slots [m,Q). Prefix visits are counted without enumerating Q.
  const visitedPrefix = t => t <= highCount ? min(t, extra) : extra + min(t - highCount, q - extra)
  let start = 0n
  const components = s.components.map(c => {
    const remainder = c.budget % s.Q, end = start + remainder
    const hits = end <= s.Q ? visitedPrefix(end) - visitedPrefix(start) :
      visitedPrefix(s.Q) - visitedPrefix(start) + visitedPrefix(end - s.Q)
    start = end % s.Q
    return { id: c.id, cents: c.budget / s.Q * q + hits }
  })
  return { gross, components }
}
function expose(p) {
  if (p.gross < 0n || p.gross > MAX_CENTS || p.components.some(c => c.cents < 0n || c.cents > MAX_CENTS) ||
      p.components.reduce((sum, c) => sum + c.cents, 0n) !== p.gross) invalid('商业金额投影不守恒或超界')
  return {
    grossCents: Number(p.gross), grossAmount: Number(p.gross) / 100,
    components: p.components.map(c => ({ componentId: c.id, amountCents: Number(c.cents), amount: Number(c.cents) / 100 })),
  }
}
function projectCommercialCumulative(snapshot, cumulativeQty) {
  const s = readSnapshot(snapshot)
  const { after } = readRange(s, 0, cumulativeQty)
  return expose(project(s, after))
}
function projectCommercialBatch(snapshot, range) {
  object(range, '本批数量区间')
  const s = readSnapshot(snapshot)
  const { before, after } = readRange(s, range.beforeQty, range.afterQty)
  const previous = project(s, before), next = project(s, after)
  return expose({
    gross: next.gross - previous.gross,
    components: next.components.map((c, i) => ({ id: c.id, cents: c.cents - previous.components[i].cents })),
  })
}
/** Only qualified cumulative returns supplied by the caller; no lifecycle inference. */
function projectCommercialRefund(source) {
  object(source, '退款来源')
  const B = units(source.sourceAmount, 2, MAX_CENTS, '来源组件已确认金额')
  const D = quantity(source.sourceQty, 'ordinary', '来源组件实际已发量')
  if (!D) invalid('来源组件实际已发量必须大于零')
  const before = quantity(source.beforeQualifiedQty, 'ordinary', '累计前合格退量')
  const after = quantity(source.afterQualifiedQty, 'ordinary', '累计后合格退量')
  if (before > after || after > D) invalid('合格退量逆序或超过实际已发量')
  const previous = halfUp(B * before, D), next = halfUp(B * after, D)
  return {
    refundCents: Number(next - previous), refundAmount: Number(next - previous) / 100,
    cumulativeCents: Number(next), cumulativeAmount: Number(next) / 100,
  }
}

module.exports = { projectCommercialCumulative, projectCommercialBatch, projectCommercialRefund }
