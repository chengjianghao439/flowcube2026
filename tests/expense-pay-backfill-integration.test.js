'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/modules/finance/expense-claims.service.js')
const AppError = require('../backend/src/utils/AppError')

function loadOperations(pool) {
  const file = path.resolve(__dirname, '../backend/src/utils/operationRequest.js'), result = { exports: {} }
  const requireAt = createRequire(file)
  vm.runInThisContext(`(function(require,module){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })(id => id === '../config/db' ? { pool } : requireAt(id), result)
  return result.exports
}
const actualOperations = loadOperations({ query: async () => { throw new Error('Unexpected global pool query') } })
const fingerprint = actualOperations.creationFingerprint
function application(overrides = {}) {
  return { id: 99, application_no: 'BF99', company_id: 1, biz_type: 'expense_pay', biz_id: 81, biz_no: 'EC81',
    amount: '300.0000', applicant_id: 9, request_key: 'original', period: '202001', business_date: '2020-01-15',
    status: 0, reason: '真实历史付款补录', executed_at: null, approved_at: null, approved_date: null,
    request_snapshot: JSON.stringify({ kind: 'expense_pay', claimId: 81, body: { accountId: 12, happenedAt: '2020-01-15', remark: 'fixture' } }),
    payload_fingerprint: fingerprint({ bizType: 'expense_pay', bizId: 81, payload: { claimId: 81, amount: 300, accountId: 12 } }), ...overrides }
}
const approvedApplication = overrides => application({ status: 1, approver_id: 10, approved_at: '2026-10-07 09:00:00', approved_date: '2026-10-07', ...overrides })
const originalFund = () => ({ id: 101, account_id: 12, direction: 2, biz_type: 3, biz_id: 81, biz_no: 'EC81',
  amount: '300.0000', happened_at: '2020-01-15', voucher_date_override: '2026-10-07', backfill_id: 99, operator_id: 9 })
const originalOperation = () => ({ id: 7, request_key: 'original', action: 'expense.pay.81', user_id: 9, status: 1,
  resource_type: 'expense_claim', resource_id: 81, response_json: JSON.stringify({ id: 81, status: 4, amount: 300 }), responseData: { id: 81, status: 4, amount: 300 } })

function fixture({ closed = false, replay = false, stored = null, priorFunds = [], priorOperation = originalOperation(), realOperations = false } = {}) {
  const events = [], funds = [], applications = [], keys = []
  const query = async (sql, params) => {
    if (sql.includes('FROM operation_requests')) {
      assert.ok(sql.includes('request_key = ?') && sql.includes('action = ?') && sql.includes('user_id <=> ?'))
      assert.equal(params.length, 3)
      assert.equal(params[0], 'original')
      assert.equal(params[2], 9)
      assert.ok(['expense.pay', 'expense.pay.81'].includes(params[1]))
      return [params[1] === 'expense.pay.81' && priorOperation ? [priorOperation] : []]
    }
    if (sql.includes('INSERT INTO operation_requests')) { const error = new Error('Existing exact operation'); error.code = 'ER_DUP_ENTRY'; throw error }
    if (sql.includes('FROM finance_period_backfills')) return [stored ? [stored] : []]
    if (sql.includes('FROM finance_account_transactions')) return [priorFunds]
    if (sql.includes('FROM finance_accounts')) { if (sql === 'SELECT id FROM finance_accounts WHERE id=? FOR UPDATE') events.push('account'); return [[{ id: 12, company_id: 1 }]] }
    if (sql.includes('FROM expense_claims')) return [[{ id: 81, claim_no: 'EC81', status: stored?.executed_at || replay ? 4 : 3, total_amount: '300.0000', paid_account_id: stored?.executed_at || replay ? 12 : null, paid_at: stored?.executed_at || (replay ? '2026-10-07 10:00:00' : null) }]]
    events.push(sql.startsWith('SELECT') ? 'account' : 'update'); return [{}]
  }
  const conn = {
    beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'), release: () => events.push('release'),
    query,
  }
  const pool = {
    getConnection: async () => { events.push('connection'); return conn },
    query: async (sql, params) => { if (sql.includes('operation_requests')) throw new Error('Receipt must use the original transaction connection'); if (!sql.includes('finance_period_backfills')) events.push('preflight'); return query(sql, params) },
  }
  const stubs = {
    '../../config/db': { pool },
    '../../utils/statusTransition': {
      lockStatusRow: async borrowed => { assert.equal(borrowed, conn); events.push('claim'); return { id: 81, claim_no: 'EC81', status: 3, total_amount: '300.0000', applicant_name: 'fixture' } },
      compareAndSetStatus: async borrowed => { assert.equal(borrowed, conn); events.push('status') },
    },
    '../../utils/selfApprove': {},
    '../../utils/operationRequest': realOperations ? loadOperations(pool) : {
      ...actualOperations,
      beginResourceOperationRequest: async (borrowed, options) => { assert.equal(borrowed, conn); keys.push(options); events.push('operation'); return replay ? { enabled: true, replay: true, responseData: { id: 81, status: 4, amount: 300 } } : { enabled: true, id: 7, replay: false } },
      completeOperationRequest: async (borrowed, _state, result) => { assert.equal(borrowed, conn); events.push('receipt'); assert.equal(result.resourceId, 81) },
    },
    '../accounting/finance-period.guard': {
      assertFinancePeriodOpen: async (borrowed, date, options) => {
        assert.equal(borrowed, conn); assert.match(date, /^\d{4}-\d{2}-\d{2}$/); events.push('period')
        if (closed && !options.backfill) throw new AppError('closed', 409, 'FINANCE_PERIOD_CLOSED')
        return { voucherDateOverride: options.backfill ? '2026-10-07' : null }
      },
      tryRecordBackfillApplication: async input => { applications.push(input); events.push('application'); return { id: 99, applicationNo: 'BF99' } },
    },
    './finance-accounts.service': {
      DIRECTION: { OUT: 2 }, BIZ_TYPE: { EXPENSE: 3 },
      recordTransaction: async (borrowed, fund) => { assert.equal(borrowed, conn); events.push('fund'); funds.push(fund); priorFunds.push({ ...originalFund(), account_id: fund.accountId, happened_at: fund.happenedAt, voucher_date_override: fund.voucherDateOverride, backfill_id: fund.backfillId }); return { id: 101 } },
    },
  }
  const loaded = { exports: {} }
  const load = file => {
    const result = { exports: {} }, source = fs.readFileSync(file, 'utf8'), requireAt = createRequire(file)
    vm.runInThisContext(`(function(require,module){${source}\n})`, { filename: file })(id => Object.hasOwn(stubs, id) ? stubs[id] : id === './expense-pay.backfill' ? load(path.join(path.dirname(file), 'expense-pay.backfill.js')) : requireAt(id), result)
    return result.exports
  }
  Object.assign(loaded.exports, load(filename))
  return { service: loaded.exports, conn, events, funds, applications, keys }
}
const body = { accountId: 12, happenedAt: '2020-01-15', remark: 'fixture' }
const operator = { operatorId: 9, operatorName: 'fixture' }

test('closed expense payment stops before claim/account/fund writes', async () => {
  const f = fixture({ closed: true })
  await assert.rejects(f.service.pay(81, body, operator, 'original'), e => e.code === 'FINANCE_PERIOD_CLOSED')
  assert.equal(f.funds.length, 0)
  assert.ok(!f.events.includes('claim') && !f.events.includes('account'))
  assert.deepEqual(f.events.slice(-2), ['rollback', 'release'])
})
test('expense backfill application preserves account/date/key and does not pay', async () => {
  const f = fixture({ closed: true })
  const result = await f.service.pay(81, body, operator, 'original', { backfill: { mode: 'apply', reason: '真实历史付款补录', applicantId: 9, applicantName: 'fixture' } })
  assert.equal(result.backfillApplication.id, 99)
  assert.deepEqual(f.events, ['preflight', 'application'])
  assert.equal(f.funds.length, 0)
  assert.equal(f.applications[0].bizType, 'expense_pay')
  assert.equal(f.applications[0].requestKey, 'original')
  assert.deepEqual(f.applications[0].requestSnapshot.body, body)
})
test('approved expense backfill uses caller transaction and keeps bank date separate from voucher date', async () => {
  const f = fixture({ closed: true, stored: approvedApplication() })
  const result = await f.service.pay(81, body, operator, 'original', { conn: f.conn, backfill: { mode: 'execute', approvedId: 99, postingPeriod: '202610', postingDate: '2026-10-07' } })
  assert.equal(result.id, 81)
  assert.deepEqual(f.events, ['operation', 'period', 'claim', 'account', 'status', 'update', 'fund', 'receipt'])
  assert.equal(f.funds[0].happenedAt, '2020-01-15')
  assert.equal(f.funds[0].voucherDateOverride, '2026-10-07')
  assert.equal(f.funds[0].backfillId, 99)
  assert.equal(f.keys[0].requestKey, 'original')
  assert.equal(f.keys[0].resourceId, 81)
})
test('same expense payment key recovers original result without another fund write or inner transaction', async () => {
  const f = fixture({ closed: true, replay: true, stored: approvedApplication(), priorFunds: [originalFund()] })
  const result = await f.service.pay(81, body, operator, 'original', { conn: f.conn, backfill: { mode: 'execute', approvedId: 99, postingPeriod: '202610', postingDate: '2026-10-07' } })
  assert.equal(result.id, 81)
  assert.deepEqual(f.events, ['operation'])
  assert.equal(f.funds.length, 0)
})

for (const status of [0, 1, 2]) test(`same expense key without controls recovers application status ${status} after business period reopens`, async () => {
  const f = fixture({ stored: status === 1 ? approvedApplication() : application({ status }) })
  const result = await f.service.pay(81, body, operator, 'original')
  assert.ok(result.backfillApplication, 'must recover the existing application before any normal cash write')
  assert.equal(result.backfillApplication.id, 99)
  assert.equal(result.backfillApplication.status, status)
  assert.equal(f.funds.length, 0)
  assert.ok(!f.events.includes('begin') && !f.events.includes('claim'))
})
for (const [label, incomingBody, incomingOperator, stored] of [
  ['account', { ...body, accountId: 13 }, operator, application()],
  ['business date', { ...body, happenedAt: '2020-01-16' }, operator, application()],
  ['actor', body, { ...operator, operatorId: 11 }, application()],
  ['fingerprint', body, operator, application({ payload_fingerprint: '0'.repeat(16) })],
]) test(`expense application rejects changed ${label} before cash or receipt`, async () => {
  const f = fixture({ stored })
  await assert.rejects(f.service.pay(81, incomingBody, incomingOperator, 'original'), error => error.code === 'EXPENSE_PAY_BACKFILL_IDENTITY_CHANGED')
  assert.equal(f.funds.length, 0)
  assert.ok(!f.events.includes('begin'))
})
test('executed expense application returns exact original ACK after period closes without paying again', async () => {
  const f = fixture({ closed: true, stored: approvedApplication({ executed_at: '2026-10-07 10:00:00', executed_biz_id: 81, posting_period: '202610' }), priorFunds: [originalFund()] })
  assert.deepEqual(await f.service.pay(81, body, operator, 'original'), { id: 81, status: 4, amount: 300 })
  assert.equal(f.funds.length, 0)
  assert.ok(!f.events.includes('begin'))
})
test('executed expense pay loads only real operationRequest exports and recovers ACK on the same connection', async () => {
  assert.equal(Object.hasOwn(actualOperations, 'getOperationRequest'), false, 'private operation lookup must not be fabricated by a mock')
  const f = fixture({ realOperations: true, stored: approvedApplication({ executed_at: '2026-10-07 10:00:00', executed_biz_id: 81, posting_period: '202610' }), priorFunds: [originalFund()] })
  assert.deepEqual(await f.service.pay(81, body, operator, 'original'), { id: 81, status: 4, amount: 300 })
  assert.equal(f.funds.length, 0)
})
test('shared expense execution replay uses the real resource operation contract and exact original ACK', async () => {
  const f = fixture({ realOperations: true, replay: true, stored: approvedApplication(), priorFunds: [originalFund()] })
  assert.deepEqual(await f.service.pay(81, body, operator, 'original', { conn: f.conn, backfill: { mode: 'execute', approvedId: 99, postingPeriod: '202610', postingDate: '2026-10-07' } }), { id: 81, status: 4, amount: 300 })
  assert.equal(f.funds.length, 0)
  assert.ok(!f.events.includes('connection') && !f.events.includes('commit') && !f.events.includes('release'))
})
for (const response_json of ['{invalid', JSON.stringify({ id: 82, status: 4, amount: 300 })]) test(`actual expense receipt query rejects corrupt or unrelated raw ACK ${response_json}`, async () => {
  const f = fixture({ realOperations: true, stored: approvedApplication({ executed_at: '2026-10-07 10:00:00', executed_biz_id: 81, posting_period: '202610' }), priorFunds: [originalFund()], priorOperation: { ...originalOperation(), response_json } })
  await assert.rejects(f.service.pay(81, body, operator, 'original'), error => error.code === 'EXPENSE_PAY_BACKFILL_IDENTITY_CHANGED')
  assert.equal(f.funds.length, 0)
})
test('expense backfill execution rejects unrelated normal payment replay with no application fund', async () => {
  const f = fixture({ replay: true, stored: approvedApplication() })
  await assert.rejects(f.service.pay(81, body, operator, 'original', { conn: f.conn, backfill: { mode: 'execute', approvedId: 99, postingPeriod: '202610', postingDate: '2026-10-07' } }), error => error.code === 'EXPENSE_PAY_BACKFILL_IDENTITY_CHANGED')
  assert.equal(f.funds.length, 0)
})
test('executed expense backfill rejects an extra application fund of another business type', async () => {
  const f = fixture({ stored: approvedApplication({ executed_at: '2026-10-07 10:00:00', executed_biz_id: 81, posting_period: '202610' }), priorFunds: [originalFund(), { ...originalFund(), id: 102, biz_type: 2 }] })
  await assert.rejects(f.service.pay(81, body, operator, 'original'), error => error.code === 'EXPENSE_PAY_BACKFILL_IDENTITY_CHANGED')
  assert.equal(f.funds.length, 0)
})
for (const [field, value] of [['voucher_date_override', null], ['amount', 'invalid']]) test(`executed expense backfill rejects corrupt original fund ${field} as an identity conflict`, async () => {
  const f = fixture({ stored: approvedApplication({ executed_at: '2026-10-07 10:00:00', executed_biz_id: 81, posting_period: '202610' }), priorFunds: [{ ...originalFund(), [field]: value }] })
  await assert.rejects(f.service.pay(81, body, operator, 'original'), error => error.code === 'EXPENSE_PAY_BACKFILL_IDENTITY_CHANGED')
  assert.equal(f.funds.length, 0)
})
