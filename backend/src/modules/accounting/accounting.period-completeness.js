'use strict'

const AppError = require('../../utils/AppError')
const { moneyUnits } = require('../../utils/decimalMoney')
const { SOURCE_TYPES: S } = require('../../constants/voucherSource')

const TYPES = [S.RECEIPT_IN, S.PAYMENT_OUT, S.EXPENSE_PAY, S.REFUND_PAY, S.PURCHASE_SETTLE, S.MANUAL_PAYABLE, S.FREIGHT_SETTLE]
const FUND_TYPES = new Map([[1, S.RECEIPT_IN], [2, S.PAYMENT_OUT], [3, S.EXPENSE_PAY], [5, S.REFUND_PAY]])
const keyOf = (type, id) => JSON.stringify([type, Number(id)])
const inPeriod = (engine, date, period) => engine.toDateStr(date).replaceAll('-', '').slice(0, 6) === period
const legKey = leg => JSON.stringify([leg.code, Number(leg.auxType || 0), leg.auxId == null ? null : Number(leg.auxId), leg.auxName || null])

function denied(period, type, id, reason, invalid = false) {
  throw new AppError(`期间 ${period} 的 ${type} 来源 #${id} 尚不能结账：${reason}。请先核对来源并生成本期业务凭证`, 409,
    invalid ? 'ACCT_BUSINESS_SOURCE_INVALID' : 'ACCT_BUSINESS_VOUCHER_REQUIRED', { period, sourceType: type, sourceId: Number(id), reason })
}

function net(legs) {
  const amounts = new Map()
  for (const l of legs) {
    const units = moneyUnits(l.amount)
    const key = legKey(l)
    amounts.set(key, (amounts.get(key) || 0n) + (Number(l.direction) === 1 ? units : -units))
  }
  return [...amounts].filter(([, units]) => units !== 0n).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, units]) => [key, units.toString()])
}

/** Caller owns the company X gate before its first ordinary business snapshot.
 * Reuse existing builders: no new rounding, tax allocation, source dates or posting policy.
 * Business facts remain nonlocking reads; do not acquire accounts/AP after voucher locks.
 */
async function assertPeriodComplete(conn, period, companyId, engine) {
  // Current accounting reads also cover a caller that waited for a previous voucher writer.
  const [headers] = await conn.query(
    `SELECT id,company_id,source_type,source_id,source_period,source_root_id,reversed_id,is_reversal,status,
            period,voucher_date,source_hash,total_debit,total_credit
       FROM acct_vouchers
      WHERE company_id=? AND (source_type IN (?) OR reversed_id IS NOT NULL OR source_root_id IS NOT NULL)
      FOR UPDATE`, [companyId, TYPES])
  const [entries] = await conn.query(
    `SELECT e.voucher_id,e.account_id,e.account_code AS code,e.direction,e.amount,e.aux_type AS auxType,e.aux_id AS auxId,e.aux_name AS auxName
       FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id
      WHERE v.company_id=? AND (v.source_type IN (?) OR v.reversed_id IS NOT NULL OR v.source_root_id IS NOT NULL)
      FOR UPDATE`, [companyId, TYPES])
  const [funds] = await conn.query(
    `SELECT t.id,t.biz_type,t.direction,t.amount,t.happened_at,t.voucher_date_override,fa.id AS source_account_id,fa.type AS source_account_type
       FROM finance_account_transactions t LEFT JOIN finance_accounts fa ON fa.id=t.account_id
      WHERE t.biz_type IN (1,2,3,5)`)
  const [payables] = await conn.query(
    `SELECT pr.id,pr.order_id,pr.created_at,pr.debit_account_code,po.id AS source_order_id,
            EXISTS(SELECT 1 FROM logistics_freight_settlements fs WHERE fs.payment_record_id=pr.id) AS is_freight
       FROM payment_records pr LEFT JOIN purchase_orders po ON po.id=pr.order_id
      WHERE pr.type=1`)
  const anchors = new Map()
  for (const f of funds) anchors.set(keyOf(FUND_TYPES.get(Number(f.biz_type)), f.id), {
    date: f.voucher_date_override || f.happened_at, valid: f.source_account_id != null
      && [1, 2, 3, 4, 5].includes(Number(f.source_account_type)) && moneyUnits(f.amount) > 0n
      && Number(f.direction) === (Number(f.biz_type) === 1 ? 1 : 2),
  })
  for (const p of payables) anchors.set(keyOf(p.order_id != null ? S.PURCHASE_SETTLE : Number(p.is_freight) === 1 ? S.FREIGHT_SETTLE : S.MANUAL_PAYABLE,
    p.order_id == null ? p.id : p.order_id), { date: p.created_at, valid: p.order_id == null || p.source_order_id != null })
  for (const [key, a] of anchors) {
    if (!a.valid && inPeriod(engine, a.date, period)) {
      const [type, id] = JSON.parse(key); denied(period, type, id, '业务来源的资金账户或采购单缺失', true)
    }
  }
  const byId = new Map(headers.map(v => [Number(v.id), v]))
  const purchaseOrderIds = new Set(payables.filter(p => p.order_id != null && inPeriod(engine, p.created_at, period)).map(p => Number(p.order_id)))
  // 日期被移动的来源仍可能影响本期根/修订/人工红字，必须沿本期凭证回溯原锚点。
  // 先限定来源再运行原完整性断言，不能让无关外期脏源阻断本期，也不能吞掉本期错误。
  for (const voucher of headers.filter(v => v.period === period)) {
    let related = voucher
    const seen = new Set()
    while (related && !seen.has(Number(related.id))) {
      seen.add(Number(related.id))
      if (related.source_type === S.PURCHASE_SETTLE && related.source_id != null) purchaseOrderIds.add(Number(related.source_id))
      related = byId.get(Number(related.source_root_id ?? related.reversed_id))
    }
  }
  const { taxByPO } = await engine.loadTaxMaps(conn, companyId)
  const specs = [...await engine.buildFundVouchers(conn), ...await engine.buildPurchaseSettle(conn, taxByPO, { orderIds: [...purchaseOrderIds] }), ...await engine.buildUnbilledPayable(conn)]
  const expected = new Map()
  for (const spec of specs) {
    if (!inPeriod(engine, spec.voucherDate, period)) continue
    const key = keyOf(spec.sourceType, spec.sourceId)
    if (expected.has(key)) denied(period, spec.sourceType, spec.sourceId, '业务来源不唯一', true)
    expected.set(key, spec)
  }
  const groups = new Map(), membership = new Map()
  for (const v of headers) {
    if (!TYPES.includes(v.source_type) || v.source_id == null) continue
    const key = keyOf(v.source_type, v.source_id)
    if (groups.has(key)) denied(period, v.source_type, v.source_id, '来源根凭证不唯一', true)
    groups.set(key, { root: v, headers: [] }); membership.set(Number(v.id), key)
  }
  // Automatic revisions point to the immutable root; manual red entries point to a concrete version.
  for (const v of headers) {
    if (membership.has(Number(v.id))) continue
    const root = byId.get(Number(v.source_root_id))
    if (root && membership.has(Number(root.id))) {
      if (v.source_type !== root.source_type || v.source_id != null) denied(period, root.source_type, root.source_id, '自动修订来源身份不符', true)
      membership.set(Number(v.id), membership.get(Number(root.id)))
    }
  }
  for (const v of headers) {
    if (membership.has(Number(v.id))) continue
    const target = byId.get(Number(v.reversed_id))
    if (target && membership.has(Number(target.id))) {
      const group = groups.get(membership.get(Number(target.id)))
      if (v.source_type !== S.MANUAL || Number(v.is_reversal) !== 1 || v.source_id != null) denied(period, group.root.source_type, group.root.source_id, '人工红字来源身份不符', true)
      membership.set(Number(v.id), membership.get(Number(target.id)))
    }
    else if (TYPES.includes(v.source_type) && v.period === period) denied(period, v.source_type, v.source_id, '凭证缺少可验证的来源根', true)
  }
  for (const v of headers) {
    const key = membership.get(Number(v.id))
    if (key) groups.get(key).headers.push(v)
  }
  const byVoucher = new Map()
  for (const e of entries) {
    const list = byVoucher.get(Number(e.voucher_id)) || []
    list.push(e); byVoucher.set(Number(e.voucher_id), list)
  }
  const accountMap = await engine.loadAccountMap(conn, companyId)
  const keys = new Set([...expected.keys(), ...[...groups].filter(([, g]) => g.headers.some(v => v.period === period)).map(([key]) => key)])
  for (const key of keys) {
    const [type, id] = JSON.parse(key), spec = expected.get(key), group = groups.get(key), anchor = anchors.get(key)
    // Purchase disappearance has an existing explicit zero/revision contract. Fund disappearance does not.
    if ((!anchor && type !== S.PURCHASE_SETTLE) || anchor && !anchor.valid) denied(period, type, id, '原业务来源已不存在或不完整', true)
    const booked = []
    for (const v of group?.headers || []) {
      if (v.period !== period) continue
      if (v.source_period !== '' || ![1, 2, 3].includes(Number(v.status)) || ![0, 1].includes(Number(v.is_reversal)) || !inPeriod(engine, v.voucher_date, period)) denied(period, type, id, '凭证期间或状态不完整', true)
      if (Number(v.is_reversal) === 1 && !group.headers.some(r => Number(r.id) === Number(v.reversed_id))
        || Number(v.is_reversal) === 0 && v.reversed_id != null) denied(period, type, id, '红字关联不完整', true)
      const legs = byVoucher.get(Number(v.id)) || []
      let debit = 0n, credit = 0n
      for (const leg of legs) {
        const units = moneyUnits(leg.amount)
        if (units <= 0n || units % 100n !== 0n || ![1, 2].includes(Number(leg.direction))
          || Number(accountMap.get(leg.code)?.id) !== Number(leg.account_id) || leg.auxType == null) denied(period, type, id, '凭证分录或科目归属不完整', true)
        if (Number(leg.direction) === 1) debit += units; else credit += units
      }
      if (legs.length < 2 || debit !== credit || debit !== moneyUnits(v.total_debit) || credit !== moneyUnits(v.total_credit)) denied(period, type, id, '凭证缺腿或借贷合计不符')
      if (Number(v.status) === 3 && !group.headers.some(r => Number(r.reversed_id) === Number(v.id))) denied(period, type, id, '已冲销凭证缺少关联红字', true)
      booked.push(...legs)
    }
    const target = (spec?.legs || []).map(l => ({ ...l, amount: engine.round2(l.amount) })).filter(l => l.amount > 0)
    if (JSON.stringify(net(target)) !== JSON.stringify(net(booked))) denied(period, type, id, '业务事实与已记凭证净投影不一致')
    if (target.length) {
      const active = (group?.headers || []).filter(v => v.period === period && Number(v.is_reversal) === 0 && [1, 2].includes(Number(v.status)))
      if (active.length !== 1 || active[0].source_hash !== engine.hashSpec(engine.toDateStr(spec.voucherDate), target)) denied(period, type, id, '有效来源凭证缺失或已陈旧')
    }
  }
}

module.exports = { assertPeriodComplete }
