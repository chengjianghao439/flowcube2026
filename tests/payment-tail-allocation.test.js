const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const money = require('../backend/src/utils/decimalMoney')
const cash = require('../backend/src/utils/cashMoney')
const AppError = require('../backend/src/utils/AppError')

// Load the actual production functions, keeping all fixed-point logic intact.
// No DB module, app, auth credentials or connection is loaded; unknown imports/SQL fail.
function service(skipLedgerCheck = false) {
  const file = path.resolve(__dirname, '../backend/src/modules/payments/payment-receipts.service.js')
  const never = () => { throw new Error('unexpected non-allocation dependency') }
  const dependencies = {
    'node:crypto': crypto,
    '../../utils/decimalMoney': money,
    '../../utils/cashMoney': cash,
    '../../constants/settlementType': require('../backend/src/constants/settlementType'),
    './party-identity': { assertAllocationParty: async () => {}, resolveReceiptParty: never },
    '../../config/db': { pool: { getConnection: never, query: never } },
    '../../utils/AppError': AppError,
    '../../utils/codeGenerator': { generateDailyCode: never },
    '../../utils/requestContext': { getRequestId: () => null },
    '../../utils/operationRequest': { beginCreationOperationRequest: never, beginResourceOperationRequest: never, completeOperationRequest: never },
    './payment-reapply-batches': require('../backend/src/modules/payments/payment-reapply-batches'),
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
  if (skipLedgerCheck) source = source.replace('if (fingerprint !== ledgerFingerprint) throw allocationPreviewConflict()', '')
  if(process.env.CASH_RECEIPT_MUTANT==='missing_record_gate')source=source.replaceAll("for (const field of ['total_amount', 'paid_amount', 'balance']) storedCashCents(record[field], `原账款${field}`)",'')
  vm.runInNewContext(source + '\nmodule.exports.__tail = { expandStatementAllocation, applyAllocations };', context, { filename: file })
  return context.module.exports.__tail
}

function fixture(balances, total, existingEntries = []) {
  const records = new Map(balances.map((balance, i) => [i + 1, {
    id: i + 1, type: 2, order_no: `AR-${i + 1}`, party_name: 'synthetic party',
    total_amount: balance, paid_amount: '0.0000', balance, status: 1,
  }]))
  const receipt = { id: 91, receipt_no: 'RC-TAIL', type: 2, party_name: 'synthetic party', amount: total, settled_amount: '0.0000', payment_date: '2026-10-14' }
  const entries = []
  let settled, directIds, lockedIds, membershipChecked = false
  const conn = { query: async (sql, args) => {
    if (sql.startsWith('SELECT DISTINCT statement_id')) {
      directIds = Array.from(args[0])
      assert.ok(directIds.every(id => records.has(id)))
      return [[]]
    }
    if (sql === 'SELECT id FROM payment_records FORCE INDEX (PRIMARY) WHERE id IN (?) ORDER BY id FOR UPDATE') {
      lockedIds = Array.from(args[0])
      assert.deepEqual(lockedIds, [...new Set(directIds)].sort((a, b) => a - b))
      return [lockedIds.map(id => ({ id }))]
    }
    if (sql === 'SELECT statement_id FROM reconciliation_statement_items WHERE record_id IN (?) ORDER BY record_id FOR SHARE') {
      assert.ok(lockedIds)
      assert.deepEqual(Array.from(args[0]), directIds)
      membershipChecked = true
      return [[]]
    }
    if (sql.startsWith('SELECT * FROM payment_records')) {
      assert.ok(membershipChecked && lockedIds.includes(args[0]))
      return [[{ ...records.get(args[0]) }]]
    }
    if (sql.startsWith('SELECT id, record_id, statement_id, amount FROM payment_entries')) {
      assert.equal(args[0], receipt.id)
      assert.match(sql, /ORDER BY id FOR SHARE$/)
      return [existingEntries]
    }
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
  const result=await service().applyAllocations(f.conn,f.receipt,balances.map((b,i)=>({recordId:i+1,amount:Number(b)})).reverse(),{})
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

test('重核销逐次分录校验会拦住余额相同但有新分录的旧预览', async () => {
  const saved = [[31, 1, 0, '300'], [32, 1, 0, '-100']]
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(saved)).digest('hex')
  const ledger = [...saved, [33, 1, 0, '100'], [34, 1, 0, '-100']].map(([id, record_id, statement_id, cents]) => ({
    id, record_id, statement_id, amount: Number(cents) / 100,
  }))
  const original = fixture(['10.0000'], '10.0000', ledger.slice(0, 2))
  const stale = fixture(['10.0000'], '10.0000', ledger)
  const allocation = [{ recordId: 1, amount: 1 }]
  assert.equal((await service().applyAllocations(original.conn, original.receipt, allocation, {}, null, null, fingerprint)).allocatedTotal, 1)
  const rejectStale = target => assert.rejects(target.applyAllocations(stale.conn, stale.receipt, allocation, {}, null, null, fingerprint),
    error => error.code === 'RECEIPT_ALLOCATION_PREVIEW_CONFLICT')
  await rejectStale(service())
  assert.equal(stale.entries.length, 0)
  await assert.rejects(rejectStale(service(true)), { code: 'ERR_ASSERTION' })
})

test('同一冲回分次补核销跨账号按各分录回执守住剩余额度', async () => {
  const { reversalBatches } = require('../backend/src/modules/payments/payment-reapply-batches')
  const row = (id, amount) => ({ id, amount, record_id: 5, order_no: 'SL20261122052' })
  const rows = [row(1, 10), row(2, -6), row(3, 1), row(4, 2)]
  const event = (entryId, amount, actor) => ({ created_by: actor, created_by_name: '同事' + actor, payment_record_id: 5,
    order_no: rows[0].order_no, payload_json: { reapply: { entryId, reversalId: 2, amount, receiptId: 100 + entryId } } })
  const buildReceipt = (entryId, amount, actor) => ({ id: 100 + entryId, user_id: actor, status: 1, action: 'payment.receipt.settle.91',
    resource_type: 'payment_receipt', resource_id: 91, response_json: { id: 91, reversalEntryId: 2,
      applied: [{ entryId, amount, recordId: 5, orderNo: rows[0].order_no }] } })
  const events = [event(3, 1, 7), event(4, 2, 8)]
  const a = buildReceipt(3, 1, 7), b = buildReceipt(4, 2, 8)
  async function read(receipts) {
    return (await reversalBatches({ query: async sql => {
      assert.match(sql, /FOR SHARE/)
      return [sql.includes('operation_requests') ? receipts : events]
    } }, 91, rows, true))[0]
  }
  const valid = await read([a, b])
  assert.equal(valid.originalEntryId, 1)
  assert.equal(valid.open, 300)
  assert.deepEqual(valid.posted.map(post => [post.id, post.cents]), [[3, 100], [4, 200]])
  for (const receipts of [[b], [{ ...a, status: 0 }, b], [{ ...a, resource_id: 92 }, b], [buildReceipt(3, 5, 7), b]]) {
    const issue = await read(receipts)
    assert.deepEqual(issue.issue, { id: 3, reason: 'receipt', movementCents: 100,
      check: receipts.some(row => row.id === a.id && row.status === 1) ? 'mismatch' : 'missing' })
    assert.equal(issue.open, null)
    assert.deepEqual(issue.posted.map(post => post.id), [4])
  }
})

test('批次疑点隔离 核销分录的持久来源圈定缺失或金额错配的原冲回', async () => {
  const { reversalBatches } = require('../backend/src/modules/payments/payment-reapply-batches')
  const row = (id, amount) => ({ id, amount, record_id: 5, order_no: 'SL20261122052' })
  const rows = [row(1, 10), row(2, -4), row(3, -5), row(4, 1), row(5, 2)]
  const marker = (id, source, amount, actor) => ({ created_by: actor, created_by_name: '财务' + actor, payment_record_id: 5,
    order_no: rows[0].order_no, payload_json: { reapply: { entryId: id, reversalId: source, amount, receiptId: 100 + id } } })
  const ack = (id, source, amount, actor) => ({ id: 100 + id, user_id: actor, status: 1, action: 'payment.receipt.settle.91',
    resource_type: 'payment_receipt', resource_id: 91, response_json: { id: 91, reversalEntryId: source,
      applied: [{ entryId: id, amount, recordId: 5, orderNo: rows[0].order_no }] } })
  const good = ack(5, 3, 2, 8)
  const flags = [marker(4, 2, 1, 7), marker(5, 3, 2, 8)]
  const read = (receipts, events = flags) => reversalBatches({ query: async sql => [sql.includes('operation_requests') ? receipts : events] }, 91, rows, true)
  for (const first of [null, ack(4, 2, 2, 7)]) {
    const [a, b] = await read([good, ...(first ? [first] : [])])
    assert.deepEqual(a.issue, { id: 4, reason: 'receipt', check: first ? 'mismatch' : 'missing', movementCents: 100 })
    assert.equal(a.open, null)
    assert.deepEqual(b.posted.map(row => row.id), [5])
    assert.equal(b.open, 300)
  }
  assert.deepEqual((await read([good, ack(4, 3, 1, 7)])).map(row => row.issue?.id), [4, 4])
  assert.deepEqual((await read([good], flags.slice(1))).map(row => row.issue?.id), [4, 4])
})

test('交叉更正 核销逐笔保留疑点和已办分录，识别倒序和超出原批金额', async () => {
  const { reversalBatches } = require('../backend/src/modules/payments/payment-reapply-batches')
  const row = (id, amount) => ({ id, amount, record_id: 5, order_no: 'SL20261122052' })
  const orderNo = row(1, 0).order_no
  const event = (entryId, reversalId, amount, actor = 7) => ({ created_by: actor, created_by_name: '财务' + actor,
    payment_record_id: 5, order_no: orderNo, payload_json: { reapply: { entryId, reversalId, amount, receiptId: 100 + entryId } } })
  const ack = (entryId, reversalId, amount, actor = 7) => ({ id: 100 + entryId, user_id: actor, status: 1,
    action: 'payment.receipt.settle.91', resource_type: 'payment_receipt', resource_id: 91,
    response_json: { id: 91, reversalEntryId: reversalId, applied: [{ entryId, amount, recordId: 5, orderNo }] } })
  const rows = [row(1, 10), row(2, -3), row(3, -3), row(4, -3), row(5, 2), row(6, 2), row(7, 2), row(8, 1)]
  const events = [event(5, 2, 2), event(6, 2, 2), event(7, 2, 2, 8), event(8, 4, 1, 9)]
  const independent = [ack(7, 2, 2, 8), ack(8, 4, 1, 9)]
  const check = (receipts, flags = events, entries = rows) => reversalBatches({ query: async sql =>
    [sql.includes('operation_requests') ? receipts : flags] }, 91, entries, true)
  const [a, b, c] = await check([ack(5, 3, 2), ack(6, 3, 2), ...independent])
  assert.deepEqual([a, b, c].map(batch => batch.issues?.map(issue => [issue.id, issue.reason]) ?? []),
    [[[5, 'conflict'], [6, 'conflict']], [[5, 'conflict'], [6, 'conflict']], []])
  assert.deepEqual(a.posted.map(post => post.id), [7])
  assert.equal(a.open, null)
  assert.equal(c.open, 200)
  const [a2] = await check([ack(5, 3, 2), ...independent])
  assert.notEqual(a2.proofVersion, a.proofVersion)
  assert.match(a.posted[0].proofVersion, /^[0-9a-f]{64}$/)
  assert.equal(a2.posted[0].proofVersion, a.posted[0].proofVersion)
  const [overfull] = await check([ack(5, 2, 2), ...independent])
  assert.deepEqual(overfull.issues.map(issue => [issue.id, issue.reason]), [[5, 'capacity'], [6, 'receipt'], [7, 'capacity']])
  assert.deepEqual(overfull.posted, [])
  const future = await check([ack(3, 4, 2)], [event(3, 4, 2)], [row(1, 10), row(2, -3), row(3, 2), row(4, -3)])
  assert.deepEqual(future.map(batch => batch.issues.find(issue => issue.id === 3)?.reason), ['sequence', 'sequence'])
})

test('完批改归 核销保留已确认分录，超额回执隔离且同收款其他冲回仍可核实', async () => {
  const { reversalBatches } = require('../backend/src/modules/payments/payment-reapply-batches')
  const orderNo = 'SL20261122052'
  const row = (id, amount) => ({ id, amount, record_id: 5, order_no: orderNo })
  const marker = (id, batch, amount, revision) => ({ created_by: 7, created_by_name: '财务同事', payment_record_id: 5,
    order_no: orderNo, batch_proof_revision: revision,
    payload_json: { reapply: { entryId: id, reversalId: batch, amount, receiptId: 100 + id } } })
  const ack = (id, batch, amount, revision) => ({ id: 100 + id, user_id: 7, status: 1, action: 'payment.receipt.settle.91',
    resource_type: 'payment_receipt', resource_id: 91, batch_proof_revision: revision,
    response_json: { id: 91, reversalEntryId: batch, applied: [{ entryId: id, amount, recordId: 5, orderNo }] } })
  const entries = [row(1, 10), row(2, -3), row(3, -3), row(5, 2), row(6, 1)]
  const stable = [marker(5, 2, 2, 0), marker(6, 2, 1, 0)]
  const stableAcks = [ack(5, 2, 2, 1), ack(6, 2, 1, 1)]
  const read = (batch, amount, edits = stable, hasAck = true) => reversalBatches({ query: async sql =>
    [sql.includes('operation_requests') ? (hasAck ? [...stableAcks, ack(4, batch, amount, 3)] : stableAcks)
      : [marker(4, batch, amount, 1), ...edits]] },
  91, [...entries, row(4, amount)], true)
  for (const amount of [1, 4]) {
    const [closed, available] = await read(2, amount)
    assert.deepEqual(closed.issues.map(issue => issue.id), [4])
    assert.equal(closed.issue.excessCents, amount * 100)
    assert.equal(closed.issue.movementCents, amount * 100)
    assert.match(closed.issue.proofVersion, /^[0-9a-f]{64}$/)
    assert.deepEqual(closed.posted.map(movement => movement.id), [5, 6])
    assert.equal(closed.open, null)
    assert.equal(closed.confirmedOpen, 0)
    assert.equal(available.open, 300)
  }
  const [larger] = await read(2, 2)
  const [smaller] = await read(2, 1)
  assert.notEqual(larger.issue.proofVersion, smaller.issue.proofVersion)
  const [recovered, next] = await read(3, 1)
  assert.equal(recovered.open, 0)
  assert.deepEqual(next.posted.map(movement => movement.id), [4])
  assert.equal(next.open, 200)
  const [multi] = await read(2, 1, [{ ...stable[0], batch_proof_revision: 2 }, stable[1]])
  assert.deepEqual(multi.issues.map(issue => issue.id), [4, 5])
  assert.deepEqual(multi.posted.map(movement => movement.id), [6])
  const otherWithNoProof = await read(2, 4, undefined, false)
  assert.deepEqual(otherWithNoProof.map(batch => batch.issue?.id), [4, 4])
})
