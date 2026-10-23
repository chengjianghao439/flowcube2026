// Real service functions with a bounded SQL double; native HTTP/MySQL evidence is separate.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const money = require('../backend/src/utils/decimalMoney')
const cash = require('../backend/src/utils/cashMoney')
const settlement = require('../backend/src/constants/settlementType')
const root = path.resolve(__dirname, '../backend/src')
function load(file, deps, transform = source => source) {
  const filename = path.join(root, file), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, Date, require: name => {
    assert.ok(Object.hasOwn(deps, name), `Unstubbed dependency ${name}`)
    return deps[name]
  } }, { filename })
  return module.exports
}
function fixture({ total = '0.3000', paid = '0.1000', replay = false, settlementType = 1, type = 2, lockedSettlementType = settlementType, transform } = {}) {
  const writes = [], events = [], calls = [], items = []
  let acquired = 0
  const conn = {
    async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (/^(INSERT|UPDATE|DELETE)/.test(sql)) {
        writes.push({ sql, params })
        if (sql.startsWith('DELETE FROM expense_claim_items')) items.length = 0
        if (sql.startsWith('INSERT INTO expense_claim_items')) items.push(BigInt(Math.round(Number(params[3]) * 10000))) // SQL-double DECIMAL(14,4), not the service's guard.
        return [{ insertId: 21, affectedRows: 1 }]
      }
      if (/FROM payment_records WHERE id\s*=/.test(sql)) return [[{ settlement_type: sql.includes('FOR UPDATE') ? lockedSettlementType : settlementType, id: 5, type, order_no: 'SYNTHETIC-AR5', total_amount: total, paid_amount: paid, balance: money.moneyText(money.moneyUnits(total) - money.moneyUnits(paid)), status: 1, confirm_status: 1 }]]
      if (sql.includes('statement_id FROM reconciliation_statement_items')) return [[]]
      if (sql.includes('SELECT id FROM finance_accounts')) return [[{ id: 8 }]]
      if (sql.includes('FROM expense_categories')) return [[{ id: 3, name: 'SYNTHETIC-CATEGORY' }]]
      if (sql.includes('SUM(amount)')) return [[{ total: money.moneyText(items.reduce((a, b) => a + b, 0n)) }]]
      throw Error(`Unstubbed SQL: ${sql}`)
    },
  }
  const pool = { async getConnection() { acquired++; return conn }, query: conn.query.bind(conn) }
  const common = {
    '../../config/db': { pool }, '../../utils/AppError': AppError, '../../utils/decimalMoney': money, '../../utils/cashMoney': cash,
    '../../utils/pagination': {}, '../../utils/requestContext': { getRequestId: () => null },
    '../../utils/operationRequest': {
      async beginCreationOperationRequest() { return { enabled: false, replay, responseData: { id: 7, original: true } } },
      async beginResourceOperationRequest() { return { enabled: false, replay, responseData: { original: true } } },
      async completeOperationRequest(_conn, _state, data) { events.push({ receipt: data }) },
    },
    '../accounting/finance-period.guard': { async assertFinancePeriodOpen() { events.push('period'); return {} }, async tryRecordBackfillApplication() { events.push('backfill') } },
  }
  const payments = load('modules/payments/payments.service.js', {
    ...common, '../../constants/settlementType': settlement,
    './payment-events.service': { PAYMENT_EVENT: { CREATED: 'created', PAYMENT_RECORDED: 'paid' }, async record(_conn, event) { events.push({ paymentEvent: event }) } },
    './reconciliation-statements.service': { async refreshSettlement() { events.push('statement') } },
    '../finance/finance-accounts.service': { DIRECTION: { IN: 1, OUT: 2 }, BIZ_TYPE: { RECEIPT: 1, PAYMENT: 2 }, async recordTransaction(_conn, data) { events.push({ account: data }) } },
  }, transform)
  const claims = load('modules/finance/expense-claims.service.js', {
    ...common, '../../utils/backendTime': {}, '../../utils/codeGenerator': { async generateDailyCode() { return 'SYNTHETIC-EX21' } },
    '../../constants/documentStatusRules': { assertStatusAction() { return { from: [1], to: 1 } } },
    '../../utils/statusTransition': { async lockStatusRow() { return { id: 21, status: 1, applicant_id: 7 } } },
    '../../utils/selfApprove': {}, './finance-accounts.service': {},
  }, transform)
  return { payments, claims, writes, events, calls, acquired: () => acquired }
}
const operator = { operatorId: 7, operatorName: 'SYNTHETIC', roleId: 2 }
const manual = amount => ({ type: 2, orderNo: 'SYNTHETIC-AR', partyName: 'SYNTHETIC', totalAmount: amount, dueDate: '2026-10-14', settlementType: 1 })
const pay = (f, amount, accountId) => f.payments.recordPayment(5, { amount, paymentDate: '2026-10-14', accountId }, operator, 'original-key')
const claim = amounts => ({ title: 'SYNTHETIC', items: amounts.map(amount => ({ categoryId: 3, amount, happenedAt: '2026-10-14' })) })
const invalidPrecision = e => e.statusCode === 400 && e.code === 'CASH_PRECISION_INVALID'
test('手工账款非分有效小数在任何SQL写入/回执前400', async () => {
  for (const value of [12.3456, 0.0001, 12.34567, 0.00004]) {
    const f = fixture(); await assert.rejects(f.payments.createManual(manual(value), operator, 'key'), invalidPrecision)
    assert.equal(f.writes.length, 0); assert.ok(!f.events.some(e => e.receipt))
  }
})
test('旧直付账户有无都拒非分金额；不写账款、entry、事件、资金或回执', async () => {
  for (const accountId of [undefined, 8]) {
    const f = fixture(); await assert.rejects(pay(f, 0.00004, accountId), invalidPrecision)
    assert.equal(f.writes.length, 0); assert.ok(!f.events.some(e => e.paymentEvent || e.account || e.receipt))
  }
})
test('直付0.1+0.2精确清零，SQL四位文本/API数值/事件与回执一致', async () => {
  const f = fixture(), result = await pay(f, 0.2)
  assert.equal(result.newPaid, 0.3); assert.equal(result.newBalance, 0); assert.equal(result.status, 3)
  const update = f.writes.find(x => x.sql.startsWith('UPDATE payment_records'))
  assert.deepEqual(Array.from(update.params.slice(0, 3)), ['0.3000', '0.0000', 3])
  assert.equal(f.writes.find(x => x.sql.startsWith('INSERT INTO payment_entries')).params[1], '0.2000')
  const event = f.events.find(x => x.paymentEvent).paymentEvent.payload
  assert.equal(event.newPaid, result.newPaid); assert.equal(event.newBalance, result.newBalance)
})
test('旧四位末额拒绝为新现金，合法分也不能静默清旧fractional账', async () => {
  for (const accountId of [undefined, 8]) {
    const f = fixture({ total: '12.3456', paid: '12.3455' })
    await assert.rejects(pay(f, 0.0001, accountId), invalidPrecision)
    assert.equal(f.writes.length, 0)
    await assert.rejects(pay(f, 0.01, accountId), e => e.statusCode === 409 && e.code === 'CASH_LEGACY_PRECISION_REVIEW_REQUIRED')
    assert.equal(f.writes.length, 0)
  }
})
test('合法分末额.01结清12.34，有/无账户同值且原资金路径保持', async () => {
  for (const accountId of [undefined, 8]) {
    const f = fixture({ total: '12.3400', paid: '12.3300' }), result = await pay(f, 0.01, accountId)
    assert.equal(result.newPaid, 12.34); assert.equal(result.newBalance, 0)
    assert.equal(f.writes.find(x => x.sql.startsWith('INSERT INTO payment_entries')).params[1], '0.0100')
    assert.equal(f.events.filter(x => x.account).length, accountId ? 1 : 0)
  }
})
test('合法手工金额12.34/.01保留兼容四位存储文本而实际值为分', async () => {
  for (const amount of [12.34, 0.01]) {
    const f = fixture(); await f.payments.createManual(manual(amount), operator, null)
    const insert = f.writes.find(x => x.sql.startsWith('INSERT INTO payment_records'))
    assert.equal(insert.params[3], money.moneyText(money.moneyUnits(amount))); assert.equal(insert.params[4], insert.params[3])
  }
})
test('报销新建所有明细先验，第二行五位也没有单头/明细写入', async () => {
  const f = fixture(); await assert.rejects(f.claims.create(claim([1, 0.00004]), operator), invalidPrecision)
  assert.equal(f.writes.length, 0)
})
test('报销草稿编辑金额拒绝先于title更新/旧明细删除', async () => {
  const f = fixture(); await assert.rejects(f.claims.update(21, claim([12.34567]), operator), invalidPrecision)
  assert.equal(f.writes.length, 0)
})
test('报销合法分明细与精确SUM文本同事务保存，API保留数字', async () => {
  const f = fixture(), result = await f.claims.create(claim([12.34, 0.01]), operator)
  assert.equal(result.totalAmount, 12.35)
  assert.deepEqual(f.writes.filter(x => x.sql.startsWith('INSERT INTO expense_claim_items')).map(x => x.params[3]), ['12.3400', '0.0100'])
  assert.equal(f.writes.find(x => x.sql.startsWith('UPDATE expense_claims SET total_amount')).params[0], '12.3500')
})
test('反向验证删实际现金分闸门会丢失第三四位输入拒绝', async () => {
  const f = fixture({ transform: source => source.replace("cashCents(totalAmount, { label: '账款总额' })", '') })
  await assert.rejects(async () => assert.rejects(f.payments.createManual(manual(12.3456), operator, 'key'), invalidPrecision), e => e.code === 'ERR_ASSERTION' && /Missing expected rejection/.test(e.message))
  assert.ok(f.writes.length > 0)
})
test('反向验证恢复浮点累计会拒绝合法0.1+.2，证明固定点计算必要', async () => {
  const f = fixture({ transform: source => source.replace('const newPaidUnits = moneyUnits(record.paid_amount) + amountUnits', 'const newPaidUnits = moneyUnits(Number(record.paid_amount) + amount)') })
  await assert.rejects(pay(f, 0.2), e => e.statusCode === 400 && e.code === 'MONEY_PRECISION_INVALID')
  assert.equal(f.writes.length, 0)
})
test('反向删报销输入分闸门会先写错误明细才被合计后卫409拦住', async () => {
  const f = fixture({ transform: source => source.replace("cashCents(it.amount, { label: '报销明细金额' })", '') })
  await assert.rejects(f.claims.create(claim([12.3456]), operator), e => e.statusCode === 409 && e.code === 'CASH_LEGACY_PRECISION_REVIEW_REQUIRED')
  assert.ok(f.writes.length > 0)
})

const monthlyDirectError = e => e.statusCode === 409 && e.code === 'MONTHLY_PAYMENT_REQUIRES_STATEMENT' && e.message === '月结账款请通过对账单核销付款'
test('月结快照拒绝200/300逐笔付款，不能写账款、entry、事件、资金或回执', async () => {
  for (const type of [1, 2]) for (const settlementType of [2, '2']) for (const amount of [200, 300]) {
    const f = fixture({ total: '1000.0000', paid: '0.0000', settlementType, type })
    await assert.rejects(pay(f, amount, 8), monthlyDirectError)
    assert.equal(f.writes.length, 0)
    assert.equal(f.events.length, 0, '月结在事务/幂等回执/资金写入前拒绝')
  }
})
test('月结旧成功键也不能绕过直付限制；不改写历史回执', async () => {
  const f = fixture({ settlementType: 2, replay: true })
  await assert.rejects(pay(f, 0.2, 8), monthlyDirectError)
  assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0)
})
test('月结跨期补录申请与批准执行也拒绝直付', async () => {
  for (const mode of ['apply', 'execute']) {
    const f = fixture({ settlementType: 2 })
    await assert.rejects(f.payments.recordPayment(5, { amount: 0.2, paymentDate: '2026-10-14', accountId: 8 }, operator, 'key', { backfill: { mode } }), monthlyDirectError)
    assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0)
  }
})
test('锁内复核结算快照，预检后变月结仍然拒绝且回滚', async () => {
  const f = fixture({ settlementType: 1, lockedSettlementType: 2 })
  await assert.rejects(pay(f, 0.2, 8), monthlyDirectError)
  assert.equal(f.writes.length, 0); assert.ok(f.events.includes('rollback'))
  assert.ok(!f.events.some(e => e.paymentEvent || e.account || e.receipt))
})

test('现结应付仍可逐笔付款，账户/账款/entry与事件正常写入', async () => {
  const f = fixture({ type: 1 }), result = await pay(f, 0.2, 8)
  assert.equal(result.newBalance, 0); assert.equal(result.status, 3)
  assert.equal(f.writes.filter(x => x.sql.startsWith('INSERT INTO payment_entries')).length, 1)
  assert.equal(f.events.filter(x => x.account).length, 1)
  assert.equal(f.events.filter(x => x.paymentEvent).length, 1)
})
