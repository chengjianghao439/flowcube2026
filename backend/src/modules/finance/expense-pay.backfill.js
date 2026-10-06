'use strict'
const AppError = require('../../utils/AppError')
const { moneyUnits: decimalUnits } = require('../../utils/decimalMoney')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { creationFingerprint, stableStringify } = require('../../utils/operationRequest')
const { APPLICATION_NO_SQL } = require('../accounting/finance-period.guard')

const conflict = () => new AppError('原报销补录申请、载荷或资金依据已变化，请保留原请求核对', 409, 'EXPENSE_PAY_BACKFILL_IDENTITY_CHANGED')
const check = value => { if (!value) throw conflict() }
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
const moneyUnits = value => { try { return decimalUnits(value) } catch { throw conflict() } }
function date(value) {
  try {
    const text = typeof value === 'string' ? value : value instanceof Date && Number.isFinite(value.getTime()) ? beijingTodayYmd(value) : ''
    check(/^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text)
    return text
  } catch { throw conflict() }
}
const businessDate = value => date(value instanceof Date ? value : String(value ?? '').slice(0, 10))

function parse(row, { claimId, body, operator, requestKey, backfill }) {
  try {
    const snapshot = typeof row.request_snapshot === 'string' ? JSON.parse(row.request_snapshot) : row.request_snapshot
    check(snapshot && snapshot.kind === 'expense_pay' && snapshot.claimId === Number(claimId)
      && Object.keys(snapshot).sort().join(',') === 'body,claimId,kind')
    const frozen = snapshot.body
    check(frozen && Object.keys(frozen).sort().join(',') === 'accountId,happenedAt,remark' && positiveId(frozen.accountId)
      && typeof frozen.happenedAt === 'string' && (frozen.remark === null || typeof frozen.remark === 'string'))
    const incoming = { accountId: Number(body.accountId), happenedAt: body.happenedAt || frozen.happenedAt, remark: body.remark || null }
    check(stableStringify(incoming) === stableStringify(frozen)
      && positiveId(row.id) && Number(row.company_id) === 1 && row.biz_type === 'expense_pay'
      && Number(row.biz_id) === Number(claimId) && row.biz_no && row.request_key === requestKey
      && positiveId(row.applicant_id) && Number(row.applicant_id) === Number(operator.operatorId)
      && moneyUnits(row.amount) > 0n && businessDate(row.business_date) === businessDate(frozen.happenedAt)
      && row.period === businessDate(row.business_date).replaceAll('-', '').slice(0, 6))
    const fingerprint = creationFingerprint({ bizType: 'expense_pay', bizId: Number(claimId),
      payload: { claimId: Number(claimId), amount: Number(row.amount), accountId: Number(frozen.accountId) } })
    check(row.payload_fingerprint === fingerprint)
    if (backfill?.mode === 'apply') check(row.reason === backfill.reason)
    if (backfill?.mode === 'execute') check(Number(backfill.approvedId) === Number(row.id))
    const status = Number(row.status)
    if (status === 4) throw new AppError('原报销补录申请已作废，请核对原申请后重新发起', 409, 'FINANCE_BACKFILL_VOIDED')
    check([0, 1, 2].includes(status))
    let postingDate = null, postingPeriod = null
    if (status === 1) {
      postingDate = date(row.approved_date)
      postingPeriod = postingDate.replaceAll('-', '').slice(0, 6)
      check(row.approved_at && positiveId(row.approver_id) && Number(row.approver_id) !== Number(row.applicant_id))
    }
    if (backfill?.mode === 'execute') check(status === 1 && backfill.postingDate === postingDate && backfill.postingPeriod === postingPeriod)
    if (row.executed_at) check(status === 1 && Number(row.executed_biz_id) === Number(claimId) && row.posting_period === postingPeriod)
    return { row, snapshot, postingDate, postingPeriod, claimId: Number(claimId), requestKey, actorId: Number(row.applicant_id) }
  } catch (error) { if (error.code === 'FINANCE_BACKFILL_VOIDED') throw error; throw conflict() }
}

async function read(conn, input) {
  const [rows] = await conn.query(`SELECT *,${APPLICATION_NO_SQL} AS application_no,DATE_FORMAT(approved_at,'%Y-%m-%d') AS approved_date
    FROM finance_period_backfills WHERE company_id=1 AND biz_type='expense_pay' AND request_key=? ORDER BY id`, [input.requestKey])
  if (!rows.length) { if (input.backfill?.mode === 'execute') throw conflict(); return null }
  check(rows.length === 1)
  return parse(rows[0], input)
}

async function assertClaim(conn, context) {
  const [[claim]] = await conn.query('SELECT id,claim_no,total_amount,status,paid_account_id,paid_at FROM expense_claims WHERE id=?', [context.claimId])
  check(claim && Number(claim.id) === context.claimId && claim.claim_no === context.row.biz_no && moneyUnits(claim.total_amount) === moneyUnits(context.row.amount))
  return claim
}
async function assertFunds(conn, context, { fundId = null } = {}) {
  // Include every business type: an unrelated extra fund must not be hidden by a biz_type filter.
  const [funds] = await conn.query('SELECT * FROM finance_account_transactions WHERE backfill_id=? ORDER BY id', [context.row.id])
  check(funds.length === 1)
  const fund = funds[0], frozen = context.snapshot.body
  check(positiveId(fund.id) && (fundId === null || Number(fund.id) === Number(fundId))
    && Number(fund.backfill_id) === Number(context.row.id) && Number(fund.biz_type) === 3 && Number(fund.direction) === 2
    && Number(fund.biz_id) === context.claimId && fund.biz_no === context.row.biz_no && Number(fund.account_id) === Number(frozen.accountId)
    && Number(fund.operator_id) === context.actorId && moneyUnits(fund.amount) === moneyUnits(context.row.amount)
    && businessDate(fund.happened_at) === businessDate(context.row.business_date) && date(fund.voucher_date_override) === context.postingDate)
  const [[account]] = await conn.query('SELECT id,company_id FROM finance_accounts WHERE id=?', [frozen.accountId])
  check(account && Number(account.id) === Number(frozen.accountId) && Number(account.company_id) === 1)
  return fund
}
async function receipt(conn, context) {
  const claim = await assertClaim(conn, context)
  check(Number(claim.status) === 4 && claim.paid_at && Number(claim.paid_account_id) === Number(context.snapshot.body.accountId))
  await assertFunds(conn, context)
  const action = `expense.pay.${context.claimId}`
  // Public status lookups read the global pool. This proof must stay on the caller's
  // snapshot/transaction and inspect the exact action/key/actor rather than a scoped fallback.
  const [operations] = await conn.query(`SELECT request_key,action,user_id,status,resource_type,resource_id,response_json
    FROM operation_requests WHERE request_key = ? AND action = ? AND user_id <=> ?`, [context.requestKey, action, context.actorId])
  check(operations.length === 1)
  const operation = operations[0]
  let ack
  try { ack = typeof operation.response_json === 'string' ? JSON.parse(operation.response_json) : operation.response_json } catch { throw conflict() }
  const expected = { id: context.claimId, status: 4, amount: Number(context.row.amount) }
  check(operation && operation.action === action && operation.request_key === context.requestKey && Number(operation.user_id) === context.actorId
    && Number(operation.status) === 1 && operation.resource_type === 'expense_claim' && Number(operation.resource_id) === context.claimId
    && stableStringify(ack) === stableStringify(expected))
  return ack
}
function applicationResult({ row }) {
  return { id: Number(row.id), applicationNo: row.application_no, reused: true, status: Number(row.status), executed: !!row.executed_at,
    rejected: Number(row.status) === 2, period: row.period, businessDate: businessDate(row.business_date) }
}
async function lookup(pool, input) {
  if (!input.requestKey) { if (input.backfill) throw conflict(); return null }
  const found = await read(pool, input)
  if (!found) return null
  const conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION READ ONLY')
    const context = await read(conn, input)
    check(context)
    const result = context.row.executed_at ? await receipt(conn, context) : { backfillApplication: applicationResult(context) }
    await conn.commit()
    return result
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
module.exports = { lookup, read, receipt, assertFunds, conflict }
