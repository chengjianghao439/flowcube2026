const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const money = require('../backend/src/utils/decimalMoney')
const cash = require('../backend/src/utils/cashMoney')
const AppError = require('../backend/src/utils/AppError')

// Load the actual production functions, keeping all fixed-point logic intact.
// No DB module, app, auth credentials or connection is loaded; unknown imports/SQL fail.
function service() {
  const file = path.resolve(__dirname, '../backend/src/modules/payments/payment-receipts.service.js')
  const never = () => { throw new Error('unexpected non-allocation dependency') }
  const dependencies = {
    '../../utils/decimalMoney': money,
    '../../utils/cashMoney': cash,
    './party-identity': { assertAllocationParty: async () => {}, resolveReceiptParty: never },
    '../../config/db': { pool: { getConnection: never, query: never } },
    '../../utils/AppError': AppError,
    '../../utils/codeGenerator': { generateDailyCode: never },
    '../../utils/requestContext': { getRequestId: () => null },
    '../../utils/operationRequest': { beginCreationOperationRequest: never, beginResourceOperationRequest: never, completeOperationRequest: never },
    './payment-events.service': { PAYMENT_EVENT: { PAYMENT_RECORDED: 'payment_recorded' }, record: async () => {} },
    './reconciliation-statements.service': { ST: { DRAFT: 1 }, refreshSettlement: async () => {} },
    '../finance/finance-accounts.service': {},
    '../../utils/pagination': { normalizePagination: never },
    '../accounting/finance-period.guard': { assertFinancePeriodOpen: never, tryRecordBackfillApplication: never },
  }
  const context = { module: { exports: {} }, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `unknown require ${name}`)
    return dependencies[name]
  } }
  let source=fs.readFileSync(file, 'utf8')
  if(process.env.CASH_RECEIPT_MUTANT==='missing_record_gate')source=source.replaceAll("for (const field of ['total_amount', 'paid_amount', 'balance']) storedCashCents(record[field], `原账款${field}`)",'')
  vm.runInNewContext(source + '\nmodule.exports.__tail = { expandStatementAllocation, applyAllocations };', context, { filename: file })
  return context.module.exports.__tail
}

function fixture(balances, total) {
  const records = new Map(balances.map((balance, i) => [i + 1, {
    id: i + 1, type: 2, order_no: `AR-${i + 1}`, party_name: 'synthetic party',
    total_amount: balance, paid_amount: '0.0000', balance, status: 1,
  }]))
  const receipt = { id: 91, receipt_no: 'RC-TAIL', type: 2, party_name: 'synthetic party', amount: total, settled_amount: '0.0000', payment_date: '2026-10-14' }
  const entries = []
  let settled
  const conn = { query: async (sql, args) => {
    if (sql.startsWith('SELECT DISTINCT statement_id')) return [[]]
    if (sql.startsWith('SELECT * FROM payment_records')) return [[{ ...records.get(args[0]) }]]
    if (sql.startsWith('UPDATE payment_records')) {
      Object.assign(records.get(args[3]), { paid_amount: args[0], balance: args[1], status: args[2] }); return [{}]
    }
    if (sql.includes('INSERT INTO payment_entries')) { entries.push(args); return [{ insertId: entries.length }] }
    if (sql.startsWith('UPDATE payment_receipts')) { settled = args; return [{}] }
    throw new Error(`unhandled SQL ${sql}`)
  } }
  return { records, receipt, entries, conn, settled: () => settled }
}

for (const amount of ['12.3400', '0.0100', '9999999999.9900']) {
  test(`actual applyAllocations settles exact cents ${amount}`, async () => {
    const f = fixture([amount], amount)
    const result = await service().applyAllocations(f.conn, f.receipt, [{ recordId: 1, amount: Number(amount) }], {})
    assert.equal(result.receiptBalance, 0)
    assert.equal(f.records.get(1).paid_amount, amount)
    assert.equal(f.records.get(1).balance, '0.0000')
    assert.equal(f.records.get(1).status, 3)
    assert.equal(f.entries[0][3], amount)
    assert.deepEqual(Array.from(f.settled()), [amount, '0.0000', 3, 91])
  })
}
test('actual allocation sums original .1/.2/.01 exact cent values to .31', async () => {
  const balances=['0.1000','0.2000','0.0100'],f=fixture(balances,'0.3100')
  const result=await service().applyAllocations(f.conn,f.receipt,balances.map((b,i)=>({recordId:i+1,amount:Number(b)})),{})
  assert.equal(result.allocatedTotal,.31);assert.equal(result.receiptBalance,0)
  assert.equal(f.entries.reduce((sum,e)=>sum+money.moneyUnits(e[3]),0n),3100n)
})
test('new cash allocations with original four-place amounts reject before any entry',async()=>{
 for(const amount of [12.3456,.0001,12.34567,.1+.2]){
  const f=fixture(['20.0000'],'20.0000')
  await assert.rejects(service().applyAllocations(f.conn,f.receipt,[{recordId:1,amount}],{}),e=>e.statusCode===400&&e.code==='CASH_PRECISION_INVALID')
  assert.equal(f.entries.length,0)
 }
})
test('cent request and balance do not authorize fractional stored principal/paid source',async()=>{
 const f=fixture(['0.0100'],'0.0100');Object.assign(f.records.get(1),{total_amount:'1.0067',paid_amount:'0.9967',status:2})
 await assert.rejects(service().applyAllocations(f.conn,f.receipt,[{recordId:1,amount:.01}],{}),e=>e.statusCode===409&&e.code==='CASH_LEGACY_PRECISION_REVIEW_REQUIRED')
 assert.equal(f.entries.length,0);assert.equal(f.records.get(1).paid_amount,'0.9967')
})
function statementFixture(parts,total){
 const queries=[],conn={query:async(sql,args)=>{
  queries.push({sql,args})
  if(sql.startsWith('SELECT * FROM reconciliation_statements'))return [[{type:2,party_name:'synthetic party',status:2,total_amount:total,settled_amount:'0.0000',balance:total}]]
  if(sql.includes('JOIN payment_records'))return [parts.map((balance,i)=>({id:i+1,total_amount:balance,paid_amount:'0.0000',balance}))]
  throw Error('unexpected SQL '+sql)
 }};return{conn,queries}
}
test('actual statement expansion uses exact-cent records and preserves exact total',async()=>{
 const f=statementFixture(['12.3300','0.0100'],'12.3400')
 const parts=await service().expandStatementAllocation(f.conn,7,12.34,{type:2,party_name:'synthetic party'})
 assert.deepEqual(Array.from(parts,p=>({...p})),[{recordId:1,amount:12.33,statementId:7},{recordId:2,amount:.01,statementId:7}])
 assert.equal(parts.reduce((sum,p)=>sum+cash.cashCents(p.amount),0n),1234n)
})
test('top-level .01 statement budget cannot internally allocate historical .0067/.0033',async()=>{
 const f=statementFixture(['0.0067','0.0033'],'0.0100')
 await assert.rejects(service().expandStatementAllocation(f.conn,7,.01,{type:2,party_name:'synthetic party'}),e=>e.statusCode===409&&e.code==='CASH_LEGACY_PRECISION_REVIEW_REQUIRED')
 assert.ok(f.queries.every(q=>!/^INSERT|^UPDATE/.test(q.sql)))
})
test('actual allocation rejects exact-cent overbalance without side effects',async()=>{
 const f=fixture(['12.3400'],'20.0000')
 await assert.rejects(service().applyAllocations(f.conn,f.receipt,[{recordId:1,amount:12.35}],{}),e=>e.statusCode===400)
 assert.equal(f.entries.length,0)
})

// Run the real statement list/detail/projection against exact DECIMAL rows.
// The final cash parser is unchanged: a floating artifact must never be excused.
function statementService(parts, { status = 2 } = {}) {
  const row = { id: 7, statement_no: 'ST-CENTS', type: 2, party_name: 'synthetic party', status }
  const total = parts.reduce((n, r) => n + money.moneyUnits(r.total_amount), 0n)
  const paid = parts.reduce((n, r) => n + money.moneyUnits(r.paid_amount), 0n)
  const queries = [], updates = []
  const conn = { query: async (sql, args = []) => {
    queries.push({ sql, args })
    if (sql.startsWith('SELECT s.*')) return [[{ ...row, real_total: money.moneyText(total), real_paid: money.moneyText(paid) }]]
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 1 }]]
    if (sql.startsWith('SELECT * FROM reconciliation_statements')) return [[{ ...row }]]
    if (sql.startsWith('SELECT i.record_id') || sql.startsWith('SELECT r.total_amount')) return [parts.map((r, i) => ({ ...r, record_id: i + 1 }))]
    if (sql.includes('COALESCE(SUM(r.total_amount)')) return [[{ total: money.moneyText(total), paid: money.moneyText(paid) }]]
    if (sql.startsWith('SELECT status FROM reconciliation_statements')) return [[{ status }]]
    if (sql.startsWith('UPDATE reconciliation_statements')) { updates.push(args); return [{ affectedRows: 1 }] }
    throw Error('Unexpected statement SQL ' + sql)
  } }
  const file = path.resolve(__dirname, '../backend/src/modules/payments/reconciliation-statements.service.js')
  const deps = {
    '../../utils/cashMoney': cash, '../../utils/decimalMoney': money, '../../config/db': { pool: conn },
    '../../utils/AppError': AppError, '../../utils/codeGenerator': {}, '../../constants/settlementType': {},
    '../../utils/pagination': { normalizePagination: () => ({ page: 1, pageSize: 20, offset: 0 }) },
  }
  let source = fs.readFileSync(file, 'utf8')
  if (process.env.STATEMENT_CASH_MUTANT === 'float_projection') source = source.replace('const realBalance = totalUnits > paidUnits ? totalUnits - paidUnits : 0n', 'const realBalance = moneyUnits(Number(total) - Number(paid))')
  if (process.env.STATEMENT_CASH_MUTANT === 'float_detail_sum') source = source.replace('const realTotal = items.reduce((a, x) => a + moneyUnits(x.total_amount ?? 0), 0n)', 'const realTotal = moneyUnits(items.reduce((a, x) => a + Number(x.total_amount || 0), 0))')
  const module = { exports: {} }
  vm.runInNewContext(source, { module, require: name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name] } }, { filename: file })
  return { api: module.exports, conn, queries, updates }
}
for (const [label, parts, expected] of [
  ['.30 minus .10', [{ total_amount: '0.3000', paid_amount: '0.1000', balance: '0.2000' }], .2],
  ['three .10 members', Array.from({ length: 3 }, () => ({ total_amount: '0.1000', paid_amount: '0.0000', balance: '0.1000' })), .3],
  ['stored subcent remains raw', [{ total_amount: '0.0067', paid_amount: '0.0033', balance: '0.0034' }], .0034],
]) test('real statement list/detail/refresh preserves exact projection: ' + label, async () => {
  for (const status of [1, 2]) {
    const f = statementService(parts, { status })
    const list = (await f.api.findAll()).list[0], detail = await f.api.findById(7)
    assert.equal(list.balance, expected); assert.equal(detail.balance, expected)
    assert.equal(detail.status, status); assert.equal(list.status, status)
    if (label === 'stored subcent remains raw') assert.throws(() => cash.cashCents(detail.balance), e => e.code === 'CASH_PRECISION_INVALID')
    else assert.equal(cash.cashCents(detail.balance), cash.cashCents(expected))
    for (const options of [{}, { currentRead: true }, { currentRead: true, exactMoney: true }]) {
      const projection = await f.api.refreshSettlement(f.conn, 7, options)
      assert.equal(money.moneyUnits(projection.balance), money.moneyUnits(expected))
      assert.equal(money.moneyUnits(f.updates.at(-1)[2]), money.moneyUnits(expected))
      assert.equal(projection.status, status)
    }
  }
})
