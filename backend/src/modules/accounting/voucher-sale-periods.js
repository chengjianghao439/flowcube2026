const AppError = require('../../utils/AppError')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { decimalUnits, halfUp, centsText } = require('./voucher-sale-money')
const { SOURCE_TYPES } = require('../../constants/voucherSource')
const SALE_TYPES = [SOURCE_TYPES.SALE_REVENUE, SOURCE_TYPES.SALE_COGS]
const keyOf = (type, id, period = '') => `${type}:${id}:${period}`

function sourceError(orderId, reason, extra = {}) {
  return new AppError(`销售单 ${orderId} 的出库会计来源不完整：${reason}，请核对原始出库记录`, 409,
    'ACCT_SALE_SOURCE_INVALID', { orderId: Number(orderId), ...extra })
}
function sourceUnits(value, scale, orderId, label) {
  try { return decimalUnits(value, scale) }
  catch { throw sourceError(orderId, `${label}无效或精度超过 ${scale} 位`) }
}

function shipmentDate(value, orderId, taskId) {
  const date = value instanceof Date ? beijingTodayYmd(value) : String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00+08:00`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw sourceError(orderId, `任务 ${taskId} 缺少有效出库日期`, { taskId: Number(taskId) })
  }
  return date
}

/** 批量读取真实出库；不存在可审计的任务事实时禁止用应收创建日猜历史。 */
async function loadSaleShipmentFacts(conn) {
  const [orders] = await conn.query(`SELECT so.id AS soId, so.order_no, so.customer_id, so.customer_name,
      so.total_amount AS orderGross, so.discount_amount AS discount
    FROM sale_orders so WHERE EXISTS (SELECT 1 FROM payment_records pr WHERE pr.type=2 AND pr.order_id=so.id)
      OR EXISTS (SELECT 1 FROM sale_order_items i WHERE i.order_id=so.id AND i.shipped_qty<>0)
      OR EXISTS (SELECT 1 FROM warehouse_tasks t WHERE t.sale_order_id=so.id AND t.task_type='sale_out' AND t.status=7 AND t.deleted_at IS NULL)`)
  const [items] = await conn.query(`SELECT id,order_id,product_id,warehouse_id,shipped_qty,unit_price,cost_snapshot FROM sale_order_items`)
  const [shipments] = await conn.query(`SELECT wt.id AS taskId, wt.sale_order_id AS soId,
      DATE_FORMAT(wt.shipped_at,'%Y-%m-%d %H:%i:%s') AS shippedAt, wti.id AS taskItemId,
      wti.picked_qty AS qty, soi.id AS saleItemId
    FROM warehouse_tasks wt
    LEFT JOIN warehouse_task_items wti ON wti.task_id=wt.id
    LEFT JOIN sale_orders so ON so.id=wt.sale_order_id
    LEFT JOIN sale_order_items soi ON soi.order_id=wt.sale_order_id AND soi.product_id=wti.product_id
      AND COALESCE(soi.warehouse_id,so.warehouse_id)=wt.warehouse_id
    WHERE wt.task_type='sale_out' AND wt.status=7 AND wt.deleted_at IS NULL
    ORDER BY wt.shipped_at,wt.id,wti.id,soi.id`)
  return { orders, items, shipments }
}

/** 每期目标采用累计值相减：折扣、整单税额和成本尾差都只分配一次。退货另记。 */
function projectSaleShipments({ orders, items, shipments }, taxBySO = new Map()) {
  const byOrder = new Map(orders.map(o => [Number(o.soId), { ...o, shipments: [] }]))
  const byItem = new Map(items.map(i => [Number(i.id), i]))
  const shipped = new Map(), seen = new Set()
  for (const s of shipments) {
    const order = byOrder.get(Number(s.soId)), item = byItem.get(Number(s.saleItemId))
    if (!order || !item || !s.taskItemId || seen.has(Number(s.taskItemId)) || Number(item.order_id) !== Number(s.soId)) {
      throw sourceError(s.soId, `任务 ${s.taskId} 无法唯一关联销售行`, { taskId: Number(s.taskId) })
    }
    seen.add(Number(s.taskItemId))
    const qty = sourceUnits(s.qty, 2, s.soId, '任务数量')
    const date = shipmentDate(s.shippedAt, s.soId, s.taskId)
    shipped.set(Number(item.id), (shipped.get(Number(item.id)) || 0n) + qty)
    order.shipments.push({ ...s, date, qty, item })
  }
  for (const item of items) {
    if (!byOrder.has(Number(item.order_id))) continue
    if ((shipped.get(Number(item.id)) || 0n) !== sourceUnits(item.shipped_qty, 2, item.order_id, '累计已发数量')) {
      throw sourceError(item.order_id, `销售行 ${item.id} 的累计已发量与出库任务不一致`, { itemId: Number(item.id) })
    }
  }
  const specs = []
  for (const order of byOrder.values()) {
    order.shipments.sort((a, b) => a.date.localeCompare(b.date) || Number(a.taskId) - Number(b.taskId) || Number(a.taskItemId) - Number(b.taskItemId))
    const periods = new Map()
    let gross = 0n, cost = 0n, previousNet = 0n, previousTax = 0n, previousCost = 0n
    const orderGross = sourceUnits(order.orderGross ?? 0, 4, order.soId, '整单原值')
    const discount = sourceUnits(order.discount ?? 0, 4, order.soId, '整单折扣')
    const orderTax = sourceUnits(taxBySO.get(Number(order.soId)) ?? 0, 2, order.soId, '销项税额')
    for (const s of order.shipments) {
      // 数量为百分单位；迁移187的单价保留八位，成本快照保留四位。
      gross += s.qty * sourceUnits(s.item.unit_price, 8, order.soId, '销售单价')
      cost += s.qty * sourceUnits(s.item.cost_snapshot ?? 0, 4, order.soId, '成本快照')
      const grossCents = halfUp(gross, 100000000n)
      // 与原会计计算阶段一致：先毛额两位，再按比例分摊折扣四位，再净额两位。
      const allocated = orderGross > 0n ? halfUp(discount * grossCents * 100n, orderGross) : 0n
      const discountApplied = allocated < discount ? allocated : discount
      const netUnits = grossCents * 100n - discountApplied
      const net = netUnits > 0n ? halfUp(netUnits, 100n) : 0n
      const tax = orderTax < net ? orderTax : net
      const cogs = halfUp(cost, 10000n), period = s.date.replace(/-/g, '').slice(0, 6)
      const p = periods.get(period) || { period, date: s.date, net: 0n, tax: 0n, cost: 0n }
      p.date = s.date
      p.net += net - previousNet
      p.tax += tax - previousTax
      p.cost += cogs - previousCost
      periods.set(period, p)
      previousNet = net; previousTax = tax; previousCost = cogs
    }
    for (const p of periods.values()) {
      const base = { sourceId: order.soId, sourceNo: order.order_no, sourcePeriod: p.period, voucherDate: p.date }
      if (p.net > 0n) specs.push({ ...base, sourceType: SOURCE_TYPES.SALE_REVENUE, summary: `销售出库确认收入 ${order.order_no}`, legs: [
        { code: '1122', direction: 1, amount: centsText(p.net), auxType: 1, auxId: order.customer_id || null, auxName: order.customer_name || null, summary: '应收账款' },
        { code: '6001', direction: 2, amount: centsText(p.net - p.tax), summary: '主营业务收入' },
        { code: '222102', direction: 2, amount: centsText(p.tax), summary: '销项税额' },
      ].filter(l => l.amount !== '0.00') })
      if (p.cost > 0n) specs.push({ ...base, sourceType: SOURCE_TYPES.SALE_COGS, summary: `销售出库结转成本 ${order.order_no}`, legs: [
        { code: '6401', direction: 1, amount: centsText(p.cost), summary: '主营业务成本' },
        { code: '1405', direction: 2, amount: centsText(p.cost), summary: '库存商品' },
      ] })
    }
  }
  return specs
}

function netLegs(legs) {
  const map = new Map()
  for (const l of legs) {
    const key = JSON.stringify([l.code, l.auxType || 0, l.auxId || null, l.auxName || null])
    const old = map.get(key) || { ...l, cents: 0n }
    old.cents += (Number(l.direction) === 1 ? 1n : -1n) * decimalUnits(l.amount, 2)
    map.set(key, old)
  }
  return [...map.values()].filter(l => l.cents).sort((a,b) => JSON.stringify([a.code,a.auxId,a.auxName]).localeCompare(JSON.stringify([b.code,b.auxId,b.auxName])))
    .map(({ cents, ...l }) => ({ ...l, direction: cents > 0n ? 1 : 2, amount: centsText(cents < 0n ? -cents : cents) }))
}
const subtractLegs = (target, booked) => netLegs([...target, ...booked.map(l => ({ ...l, direction: Number(l.direction) === 1 ? 2 : 1 }))])

/** 旧累计根保持原样，新期间只投影目标减该期间的旧累计分录。先对账闭期，再由引擎筛期间。 */
async function reconcileSalePeriods(conn, targets, { companyId = 1, closedPeriods = new Set(), requireCurrentPeriod = null, orderIds = null } = {}) {
  // 账套锁后使用当前锁定读；调用方可能已经建立旧 RR 快照，不能漏抵扣刚提交的旧根。
  const [vouchers] = await conn.query(`SELECT id,source_type,source_id,source_period,source_root_id,reversed_id,is_reversal,status,period,voucher_date,source_no
    FROM acct_vouchers WHERE company_id=? AND (source_type IN ('sale_revenue','sale_cogs') OR reversed_id IS NOT NULL) FOR UPDATE`, [companyId])
  const [entries] = await conn.query(`SELECT e.voucher_id,e.account_code AS code,e.direction,e.amount,e.aux_type AS auxType,e.aux_id AS auxId,e.aux_name AS auxName,e.summary
    FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id
    WHERE v.company_id=? AND (v.source_type IN ('sale_revenue','sale_cogs') OR v.reversed_id IS NOT NULL) FOR UPDATE`, [companyId])
  const [closed] = await conn.query('SELECT period FROM acct_periods WHERE company_id=? AND status=2 FOR UPDATE', [companyId])
  const closedSet = new Set([...closedPeriods, ...closed.map(p => p.period)])
  const byId = new Map(vouchers.map(v => [Number(v.id), v]))
  const roots = vouchers.filter(v => v.source_id != null && SALE_TYPES.includes(v.source_type))
  if (orderIds) for (const root of roots) {
    if (!orderIds.has(Number(root.source_id))) throw sourceError(root.source_id, '凭证对应的销售来源不存在')
  }
  const reversedIds = new Set(vouchers.filter(v => v.reversed_id).map(v => Number(v.reversed_id)))
  const groups = new Map(roots.map(r => [Number(r.id), { root: r, entries: new Map(), manual: false }]))
  const entryMap = new Map()
  for (const e of entries) { const list = entryMap.get(Number(e.voucher_id)) || []; list.push(e); entryMap.set(Number(e.voucher_id), list) }
  for (const v of vouchers) {
    const reversed = byId.get(Number(v.reversed_id))
    const rootId = Number(v.source_root_id || (v.source_id != null ? v.id : reversed?.source_root_id || reversed?.id))
    const group = groups.get(rootId)
    if (!group) continue
    if (v.source_type === 'manual' && v.reversed_id) group.manual = true
    // 无关联的旧 status=3 也保守视为人工停止，禁止复活。
    if (Number(v.status) === 3 && !reversedIds.has(Number(v.id))) group.manual = true
    const list = group.entries.get(v.period) || []
    list.push(...(entryMap.get(Number(v.id)) || [])); group.entries.set(v.period, list)
  }
  const suppressed = new Set(), suppressedPeriods = new Set(), legacy = new Map(), current = new Map(), specs = new Map()
  for (const t of targets) specs.set(keyOf(t.sourceType,t.sourceId,t.sourcePeriod), t)
  for (const g of groups.values()) {
    const r = g.root, base = keyOf(r.source_type,r.source_id)
    if (g.manual) {
      if (!r.source_period) suppressed.add(base)
      else suppressedPeriods.add(keyOf(r.source_type,r.source_id,r.source_period))
    }
    for (const [period, legs] of g.entries) {
      const key = keyOf(r.source_type,r.source_id,period)
      const map = r.source_period ? current : legacy
      map.set(key, [...(map.get(key) || []), ...legs])
      if (!specs.has(key)) specs.set(key, { sourceType: r.source_type, sourceId: r.source_id, sourceNo: r.source_no,
        sourcePeriod: period, voucherDate: `${period.slice(0,4)}-${period.slice(4)}-01`, summary: `销售来源期间调整 ${r.source_no || ''}`, legs: [] })
    }
  }
  const out = []
  for (const [key, spec] of specs) {
    if (suppressed.has(keyOf(spec.sourceType,spec.sourceId)) || suppressedPeriods.has(key)) continue
    const residual = subtractLegs(spec.legs, legacy.get(key) || [])
    const difference = subtractLegs(residual, current.get(key) || [])
    if (difference.length && (closedSet.has(spec.sourcePeriod) || requireCurrentPeriod === spec.sourcePeriod)) {
      const closedConflict = closedSet.has(spec.sourcePeriod)
      throw new AppError(`销售单 ${spec.sourceNo || spec.sourceId} 在期间 ${spec.sourcePeriod} 的出库事实与已记凭证不一致，${closedConflict ? '请先核对并反结账后重算' : '请先生成本期业务凭证再结账'}`, 409,
        closedConflict ? 'ACCT_SALE_CLOSED_PERIOD_CONFLICT' : 'ACCT_SALE_VOUCHER_REQUIRED',
        { orderId: Number(spec.sourceId), period: spec.sourcePeriod, sourceType: spec.sourceType })
    }
    out.push({ ...spec, legs: residual })
  }
  return out
}
module.exports = { SALE_TYPES, loadSaleShipmentFacts, projectSaleShipments, reconcileSalePeriods }
