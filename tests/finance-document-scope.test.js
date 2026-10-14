// 真实 controller/service + 严格数据库边界 stub；不代替 HTTP/MySQL 验收。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const base = path.join(__dirname, '../backend/src')
function load(relative, deps, transform = source => source) {
  const filename = path.join(base, relative), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    if(name==='../../utils/cashMoney')return require('../backend/src/utils/cashMoney')
    throw Error(`未 stub 依赖 ${name}`)
  } }, { filename })
  return module.exports
}
const warehouseScope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const helperPath = path.join(base, 'utils/saleDocumentScope.js')
const saleScope = fs.existsSync(helperPath) ? load('utils/saleDocumentScope.js', { './AppError': AppError, './warehouseScope': warehouseScope, './sqlIdentifier': require('../backend/src/utils/sqlIdentifier') }) : {}
const copy = value => JSON.parse(JSON.stringify(value))
const actor = { userId: 9, operatorId: 9, realName: '合成人员', operatorName: '合成人员', roleId: 2 }
function fixture({ lines = [1, 2], header = 1, replay = false, status = 1, missingSale = false, periodClosed = false, paid = 100, owner = 9, zeroQuantity = false } = {}) {
  const events = [], queries = []
  const sale = { id: 11, sale_order_id: 11, order_no: 'SO11', warehouse_id: header, customer_id: 3, customer_name: '合成客户', total_amount: 100, discount_amount: 0, credit_limit:10, paid_amount:paid, balance:100-paid, payment_record_id: 41, status: 1 }
  const refund = { id: 21, refund_no: 'RF21', sale_order_id: 11, sale_order_no: 'SO11', warehouse_id: header, customer_name: '合成客户', status, amount: 10, payment_record_id: 41, account_id: null, refund_date: '2026-10-13' }
  const credit = { id: 31, override_no: 'CO31', sale_order_id: 11, sale_order_no: 'SO11', customer_id: 3, customer_name: '合成客户', status, applicant_id: owner, this_amount: 100, over_amount: 90, credit_limit: 10, used_credit: 0 }
  const db = {
    async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
    async query(sql, params = []) {
      queries.push({ sql, params: copy(params) })
      if (/COUNT\(\*\)/.test(sql)) return [[{ total: 1 }]]
      if (/FROM sale_orders/.test(sql)) return [missingSale ? [] : [sale]]
      if (/FROM sale_order_items/.test(sql)) return [lines.map(warehouse_id => ({ warehouse_id, quantity: zeroQuantity ? 0 : 1 }))]
      if (/SELECT.*FROM refund_orders/.test(sql)) return [[refund]]
      if (/SELECT.*FROM sale_credit_overrides/.test(sql)) return sql.includes('status IN') ? [[]] : [[credit]]
      if (/FROM reconciliation_statement_items/.test(sql)) return [[]]
      if (/FROM payment_records/.test(sql)) return [[{ id: 41, order_no: 'SO11', total_amount:100, paid_amount:paid, balance:100-paid }]]
      if (/INSERT INTO refund_orders/.test(sql)) { events.push('refund-create'); return [{ insertId: 21 }] }
      if (/INSERT INTO sale_credit_overrides/.test(sql)) { events.push('credit-create'); return [{ insertId: 31 }] }
      if (/INSERT|UPDATE/.test(sql)) { events.push('write'); return [{ affectedRows: 1 }] }
      throw Error(`未 stub SQL ${sql}`)
    },
  }
  const pool = { query: db.query.bind(db), async getConnection() { return db } }
  const statusTransition = {
    async lockStatusRow(_db, { table }) { events.push('lock-' + table); return table === 'refund_orders' ? refund : credit },
    async compareAndSetStatus() { events.push('status-write') },
  }
  const rules = { assertStatusAction(_type, action, current) {
    if (action === 'execute' && current !== 2) throw new AppError('状态不允许', 409)
    return { from: [current], to: action === 'execute' ? 3 : 2 }
  } }
  const refundSvc = load('modules/refunds/refund-orders.service.js', {
    '../../config/db': { pool }, '../../utils/AppError': AppError,
    '../../utils/backendTime': { beijingTodayYmd: () => '2026-10-13' }, '../../utils/codeGenerator': { async generateDailyCode() { events.push('number'); return 'RF21' } },
    '../../utils/statusTransition': statusTransition, '../../constants/documentStatusRules': rules, '../../utils/requestContext': { getRequestId: () => null },
    '../../utils/operationRequest': { async beginResourceOperationRequest() { events.push('request'); return { replay, responseData: { id: 21, refundNo: 'RF21', amount: 10 } } }, async completeOperationRequest() { events.push('receipt') } },
    '../payments/payment-events.service': { PAYMENT_EVENT: { REFUND: 'refund' }, async record() { events.push('payment-event') } },
    '../payments/reconciliation-statements.service': { async refreshSettlement() {} }, '../finance/finance-accounts.service': {},
    '../../utils/pagination': { normalizePagination: ({ page = 1, pageSize = 20 }) => ({ page, pageSize, offset: (page - 1) * pageSize }) },
    '../../utils/warehouseScope': warehouseScope, '../../utils/saleDocumentScope': saleScope,
    '../accounting/finance-period.guard': { async assertFinancePeriodOpen() { events.push('period'); if (periodClosed) throw new AppError('期间已结账', 409, 'FINANCE_PERIOD_CLOSED'); return {} }, async tryRecordBackfillApplication() { events.push('backfill'); return { id: 91 } } },
  })
  const creditSvc = load('modules/credit-overrides/credit-overrides.service.js', {
    '../../config/db': { pool }, '../../utils/AppError': AppError, '../../utils/codeGenerator': { async generateDailyCode() { events.push('number'); return 'CO31' } },
    '../../utils/creditExposure': { async getCustomerCreditUsed() { return 0 } }, '../sale/sale.contracts': { getNetOrderAmount: (total, discount) => total - discount, isApprovedOverrideApplicable: () => true },
    '../../constants/documentStatusRules': rules, '../../utils/statusTransition': statusTransition,
    '../../utils/pagination': { normalizePagination: ({ page = 1, pageSize = 20 }) => ({ page, pageSize, offset: (page - 1) * pageSize }) },
    '../../utils/saleDocumentScope': saleScope,
    '../../engine/approvalEngine': { INSTANCE_STATUS: { APPROVED: 3 }, async getLatestInstanceByBiz() { events.push('approval-read'); return null }, async startApproval() { events.push('approval-write'); return { instanceId: 61 } }, async getActiveInstanceByBiz() { return null } },
    '../../utils/selfApprove': { async assertNotSelfApproval(applicantId, actorId) { if (applicantId === actorId) throw new AppError('不能自批', 403) } },
  })
  return { db, pool, queries, events, refundSvc, creditSvc }
}
const denied = e => e.statusCode === 403 && e.code === 'WAREHOUSE_SCOPE_DENIED'
function noBusinessWrite(f) { assert.ok(f.events.every(e => !['refund-create', 'credit-create', 'number', 'write', 'status-write', 'payment-event', 'receipt', 'backfill', 'commit'].includes(e)), f.events.join(',')) }
test('退款详情按全部保存明细仓：A头+A/B明细对A范围拒绝', async () => {
  const f = fixture()
  await assert.rejects(f.refundSvc.findById(21, [1]), denied)
  noBusinessWrite(f)
})
test('退款创建/确认/取消/执行及补录申请拒绝外仓明细，业务和原回执不写', async () => {
  for (const action of ['create', 'submit', 'cancel', 'execute', 'backfill']) {
    const f = fixture({ status: action === 'execute' || action === 'backfill' ? 2 : 1 })
    const call = action === 'create' ? () => f.refundSvc.create({ saleOrderId: 11, amount: 10 }, actor, [1])
      : action === 'cancel' ? () => f.refundSvc.cancel(21, [1])
        : action === 'backfill' ? () => f.refundSvc.execute(21, actor, [1], 'original-key', { backfill: { mode: 'apply' } })
          : () => f.refundSvc[action](21, actor, [1], 'original-key')
    await assert.rejects(call(), denied)
    noBusinessWrite(f)
    assert.ok(!f.events.includes('request'), `${action}拒绝不进入原键`)
  }
})
test('退款成功原键先核当前全SO范围，终态原键仍可回原结果而不再写业务', async () => {
  for (const scope of [[1, 2], null]) {
    const f = fixture({ replay: true, status: 3 })
    assert.equal((await f.refundSvc.execute(21, actor, scope, 'original-key')).id, 21)
    noBusinessWrite(f)
    assert.ok(f.events.indexOf('lock-refund_orders') < f.events.indexOf('request'))
  }
  const revoked = fixture({ replay: true, status: 3 })
  await assert.rejects(revoked.refundSvc.execute(21, actor, [1], 'original-key'), denied)
  assert.ok(!revoked.events.includes('request')); noBusinessWrite(revoked)
})
test('退款原期间闸门/金额上限保留，scope授权不能放开财务闸门', async () => {
  const period = fixture({ lines: [1], status: 2, periodClosed: true })
  await assert.rejects(period.refundSvc.execute(21, actor, [1], 'new-key'), e => e.code === 'FINANCE_PERIOD_CLOSED')
  noBusinessWrite(period)
  const amount = fixture({ lines: [1], paid: 5 })
  await assert.rejects(amount.refundSvc.create({ saleOrderId: 11, amount: 10 }, actor, [1]), e => e.code === 'REFUND_EXCEED_PAID')
  noBusinessWrite(amount)
})
test('信用列表/COUNT共享SO整单谓词和参数，不先分页再裁剪；空scope拒绝全部', async () => {
  for (const scopeWarehouseIds of [[1, 2], [], null]) {
    const f = fixture()
    await f.creditSvc.findAll({ keyword: '合成', startDate: '2026-10-01', endDate: '2026-10-13', scopeWarehouseIds })
    const qs = f.queries.filter(q => q.sql.includes('FROM sale_credit_overrides c'))
    assert.equal(qs.length, 2)
    if (scopeWarehouseIds === null) { assert.ok(qs.every(q => !q.sql.includes('scope_order'))); continue }
    if (!scopeWarehouseIds.length) { assert.ok(qs.every(q => /AND 1=0/.test(q.sql))); continue }
    assert.ok(qs.every(q => /EXISTS \(SELECT 1 FROM sale_orders scope_order/.test(q.sql) && /NOT EXISTS \(SELECT 1 FROM sale_order_items scope_item/.test(q.sql) && /COALESCE\(scope_item\.warehouse_id,\s*scope_order\.warehouse_id\)/.test(q.sql)))
    assert.deepEqual(qs[0].params.slice(0, -2), qs[1].params)
    assert.deepEqual(qs[1].params.slice(-2), [scopeWarehouseIds, scopeWarehouseIds])
  }
})
test('退款列表与COUNT共享整单仓谓词、日期绑定顺序，空/null范围维持合同', async () => {
  for (const scopeWarehouseIds of [[1, 2], [], null]) {
    const f = fixture()
    await f.refundSvc.findAll({ keyword: '合成', startDate: '2026-10-01', endDate: '2026-10-13', scopeWarehouseIds })
    const qs = f.queries.filter(q => q.sql.includes('FROM refund_orders ro'))
    assert.equal(qs.length, 2)
    if (scopeWarehouseIds === null) { assert.ok(qs.every(q => !q.sql.includes('scope_order'))); continue }
    if (!scopeWarehouseIds.length) { assert.ok(qs.every(q => /AND 1=0/.test(q.sql))); continue }
    assert.ok(qs.every(q => /EXISTS \(SELECT 1 FROM sale_orders scope_order/.test(q.sql) && /COALESCE\(scope_item\.warehouse_id,\s*scope_order\.warehouse_id\)/.test(q.sql)))
    assert.deepEqual(qs[1].params.slice(0, -2), qs[0].params)
    assert.deepEqual(qs[0].params.slice(-2), [scopeWarehouseIds, scopeWarehouseIds])
  }
})
test('信用详情越仓拒绝先于审批资料读取；创建越仓不写信用快照/取号', async () => {
  const detail = fixture()
  await assert.rejects(detail.creditSvc.findById(31, [1]), denied)
  assert.ok(!detail.events.includes('approval-read'))
  const create = fixture()
  await assert.rejects(create.creditSvc.create({ saleOrderId: 11, reason: '合成原因' }, actor, [1]), denied)
  noBusinessWrite(create)
})
test('同仓/多仓/null允许信用创建与退款草稿，NULL行沿头仓', async () => {
  for (const scope of [[1, 2], null]) {
    const f = fixture()
    assert.equal((await f.creditSvc.create({ saleOrderId: 11 }, actor, scope)).id, 31)
    assert.equal((await f.refundSvc.create({ saleOrderId: 11, amount: 10 }, actor, scope)).id, 21)
  }
  const fallback = fixture({ lines: [null, 1] })
  assert.equal((await fallback.creditSvc.findById(31, [1])).id, 31)
  for (const service of ['refundSvc', 'creditSvc']) {
    const empty = fixture({ lines: [1] })
    await assert.rejects(empty[service].findById(service === 'refundSvc' ? 21 : 31, []), denied)
  }
})
test('数量0的保存外仓行也拒绝，写事务用当前共享读，详情不加写锁', async () => {
  const zero = fixture({ zeroQuantity: true })
  await assert.rejects(zero.creditSvc.findById(31, [1]), denied)
  assert.ok(zero.queries.some(q => /FROM sale_order_items/.test(q.sql)))
  assert.ok(zero.queries.every(q => !/FOR SHARE|FOR UPDATE/.test(q.sql)))
  const write = fixture({ lines: [1] })
  await write.creditSvc.create({ saleOrderId: 11 }, actor, [1])
  const auth = write.queries.filter(q => /SELECT id, warehouse_id FROM sale_orders|SELECT warehouse_id FROM sale_order_items/.test(q.sql))
  assert.equal(auth.length, 2); assert.ok(auth.every(q => /FOR SHARE$/.test(q.sql)))
})
const receipt = { status: 'success', resourceType: 'refund_order', resourceId: 21, data: { id: 21, refundNo: 'RF21', amount: 10 } }
const receiptModule = transform => load('modules/refunds/refund-orders.scope.js', { '../../utils/AppError': AppError, '../../utils/saleDocumentScope': saleScope }, transform)
test('本人退款GET实际命中action核原资源与全SO范围，exact/base/宽prefix仍同范围且只读', async () => {
  for (const requestedAction of ['refund.execute.21', 'refund.execute', 'refund']) {
    const f = fixture(), context = { requestedAction, matchedAction: 'refund.execute.21' }
    await receiptModule().assertRefundReceipt(f.db, receipt, [1, 2], context)
    await receiptModule().assertRefundReceipt(f.db, receipt, null, context)
    await assert.rejects(receiptModule().assertRefundReceipt(f.db, receipt, [1], context), denied)
    assert.ok(f.queries.every(q => /^SELECT/.test(q.sql) && !/FOR SHARE|FOR UPDATE|sys_role|permission/.test(q.sql)))
  }
})
test('本人退款GET身份矛盾/强转伪ID拒绝且不读资料，pending/notfound/非实际命中域不虚构资源', async () => {
  for (const changed of [{ resourceType: 'sale_order' }, { resourceId: true }, { resourceId: '21.0' }, { data: { id: 22 } }, { data: { id: true } }]) {
    const f = fixture()
    await assert.rejects(receiptModule().assertRefundReceipt(f.db, { ...receipt, ...changed }, [1, 2], { matchedAction: 'refund.execute.21' }), e => e.code === 'REFUND_RECEIPT_INVALID')
    assert.equal(f.queries.length, 0)
  }
  const action = fixture()
  await assert.rejects(receiptModule().assertRefundReceipt(action.db, receipt, null, { matchedAction: 'refund.execute.22' }), e => e.code === 'REFUND_RECEIPT_INVALID')
  assert.equal(action.queries.length, 0)
  for (const [data, context] of [[{ status: 'pending' }, { matchedAction: 'refund.execute.21' }], [{ status: 'not_found' }, { matchedAction: 'refund.execute.21' }], [receipt, { requestedAction: 'refund.execute', matchedAction: 'sale.reserve.21' }]]) {
    const f = fixture(); await receiptModule().assertRefundReceipt(f.db, data, [1], context); assert.equal(f.queries.length, 0)
  }
})
test('缺来源只在纯模型failclosed，不构造实际孤儿历史；同款helper保护动态列名', async () => {
  const f = fixture({ missingSale: true })
  await assert.rejects(f.refundSvc.findById(21, [1]), denied)
  await assert.rejects(f.creditSvc.findById(31, [1]), denied)
  assert.throws(() => saleScope.saleDocumentScopeFilter([1], 'c.sale_order_id) OR 1=1'), e => e.code === 'INTERNAL_CONFIG')
})
test('反向移除本人回执scope门，既定越仓反例立即无法拒绝', async () => {
  const transformed = receiptModule(source => source.replace("  await assertSaleDocumentInScope(db, scopeWarehouseIds, refund.sale_order_id, { entityName: '退款单' })", ''))
  const f = fixture()
  await assert.rejects(async () => { await assert.rejects(transformed.assertRefundReceipt(f.db, receipt, [1], { matchedAction: 'refund.execute.21' }), denied) }, e => e.code === 'ERR_ASSERTION' && e.message.includes('Missing expected rejection'))
})
test('信用controller只用认证用户仓范围，不接受query/body自称scope', async () => {
  const calls = [], service = { async findAll(...a) { calls.push(['list', ...a]); return {} }, async findById(...a) { calls.push(['detail', ...a]); return {} }, async create(...a) { calls.push(['create', ...a]); return {} } }
  const ctrl = load('modules/credit-overrides/credit-overrides.controller.js', { './credit-overrides.service': service, '../../utils/response': { successResponse() {} }, '../../utils/operator': { getOperatorFromRequest: () => actor } })
  for (const warehouseIds of [[1], [], null]) {
    await ctrl.list({ query: { scopeWarehouseIds: null }, user: { warehouseIds } }, {}, e => { throw e })
    await ctrl.detail({ params: { id: 31 }, user: { warehouseIds } }, {}, e => { throw e })
    await ctrl.create({ body: { saleOrderId: 11, scopeWarehouseIds: null }, user: { warehouseIds } }, {}, e => { throw e })
    assert.deepEqual(calls.at(-3)[1].scopeWarehouseIds, warehouseIds)
    assert.deepEqual(calls.at(-2)[2], warehouseIds)
    assert.deepEqual(calls.at(-1)[3], warehouseIds)
  }
})
test('既有credit submit/cancel本人门、自批门未被scope修复替代', async () => {
  for (const action of ['submit', 'cancel']) {
    const f = fixture({ owner: 8 })
    await assert.rejects(f.creditSvc[action](31, actor), e => e.statusCode === 403)
    noBusinessWrite(f)
  }
  for (const action of ['approve', 'reject']) {
    const f = fixture()
    await assert.rejects(action === 'reject' ? f.creditSvc.reject(31, { reason: '合成驳回' }, actor) : f.creditSvc.approve(31, actor), e => e.statusCode === 403)
    noBusinessWrite(f)
  }
})
