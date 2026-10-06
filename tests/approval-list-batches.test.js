const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const sandbox = {module:{exports:{}}, require:name=>name==='../utils/AppError'?require('../backend/src/utils/AppError'):{canSelfApprove:()=>false}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/src/engine/approvalEngine.js'),'utf8'),sandbox)
const engine = sandbox.module.exports
test('审批列表以真实总数读取超过 100 条待办，批次稳定且按当前用户过滤', async () => {
  const calls=[]
  const db={query:async(sql,params)=>{calls.push({sql,params});return sql.includes('COUNT(*)')?[[{total:205}]]:[[]]}}
  assert.equal(await engine.countPendingTasks(db,{userId:7}),205)
  await engine.listPendingTasks(db,{userId:7,page:3,pageSize:100})
  assert.match(calls[1].sql,/ORDER BY i.created_at DESC, i.id DESC, t.id DESC/)
  assert.deepEqual(Array.from(calls[1].params),[7,100,200])
  assert.ok(calls.every(c=>c.sql.includes('a.user_id=? AND t.status=1 AND t.step_order=i.current_step')))
})

function loadService(db) {
  const context = { module: { exports: {} }, require: name => {
    if (name === '../../config/db') return { pool: db }
    if (name === '../../engine/approvalEngine') return engine
    if (name === '../../utils/warehouseScope') {
      const scopeContext = { module: { exports: {} }, require: n => n === '../config/db' ? { pool: db } : require('../backend/src/utils/AppError') }
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend/src/utils/warehouseScope.js'), 'utf8'), scopeContext)
      return scopeContext.module.exports
    }
    return require(path.join(__dirname, '../backend/src/modules/approvals', name))
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend/src/modules/approvals/approvals.service.js'), 'utf8'), context)
  return context.module.exports
}
function pendingFixture({ permissions = Object.values(require('../backend/src/constants/permissions').PERMISSIONS), flag = 0, rows = [], total = rows.length, failPage = false } = {}) {
  const calls = [], events = []
  const conn = { query: async (sql, params = []) => {
    calls.push({ sql, params: JSON.parse(JSON.stringify(params)) })
    if (/^SET |^START /.test(sql)) return [[]]
    if (sql.includes('SELECT permission FROM sys_role_permissions')) return [permissions.map(permission => ({ permission }))]
    if (sql.startsWith('SELECT id, role_id, real_name')) return [[{ id: 7, role_id: 5, real_name: 'fixture', is_active: 1, deleted_at: null, allow_self_approve: flag }]]
    if (sql.startsWith('SELECT id FROM sys_roles')) return [[{ id: 5 }]]
    if (sql.startsWith('SELECT warehouse_id FROM user_warehouse_scope')) return [[{ warehouse_id: 8 }]]
    if (sql.includes('SELECT allow_self_approve')) return [[{ allow_self_approve: flag }]]
    if (sql.includes('COUNT(*)')) return [[{ total }]]
    if (sql.includes('LIMIT ? OFFSET ?')) { if (failPage) throw new Error('offline page failed'); return [rows] }
    throw new Error(`Unexpected SQL: ${sql}`)
  }, commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release') }
  const pool = { getConnection: async () => { events.push('connect'); return conn }, query: () => { throw new Error('读取必须使用同一个只读快照连接') } }
  return { calls, events, service: loadService(pool), user: { userId: 7, roleId: 5, warehouseIds: [8] } }
}
const engineRow = (biz_type = 'purchase_requisition', id = 21) => ({ source_kind: 'engine', instance_id: 1, task_id: 11, biz_type, biz_id: id, no: `原单${id}`, title: '原因', status: 2, amount: '12.3456', applicant_id: 2, applicant_name: '申请人', flow_id: 1, current_step: 2, created_at: '2026-10-04 10:00:00', submitted_at: '2026-10-04 10:00:00', time_kind: 'submitted' })
const documentRow = (biz_type, id) => ({ ...engineRow(biz_type, id), source_kind: 'document', instance_id: null, task_id: null, flow_id: null, current_step: null, status: biz_type === 'purchase_order' ? 5 : 2, time_kind: biz_type === 'expense_claim' ? 'submitted' : 'created', submitted_at: biz_type === 'expense_claim' ? '2026-10-04 11:00:00' : null })
const pendingQueries = f => f.calls.filter(c => c.sql.includes('FROM ('))
test('混合引擎与原单级来源保持真实身份金额/时间，同一显式RR只读快照count/page并批量授权', async () => {
  const f = pendingFixture({ rows: [engineRow(), documentRow('purchase_order', 21), documentRow('inventory_disposal', 21), documentRow('expense_claim', 21)], total: 24 })
  const data = await f.service.listPending({ page: 2, pageSize: 20 }, f.user)
  assert.equal(data.pagination.total, 24)
  assert.deepEqual(Array.from(data.list, r => r.sourceKind), ['engine', 'document', 'document', 'document'])
  assert.equal(new Set(data.list.map(r => r.entryKey)).size, 4)
  assert.equal(data.list[0].taskId, 11); assert.equal(data.list[0].currentStep, 2)
  for (const row of data.list.slice(1)) for (const field of ['instanceId', 'taskId', 'flowId', 'currentStep']) assert.equal(row[field], null)
  assert.ok(data.list.every(r => r.amount === 12.3456)); assert.equal(data.list[1].timeKind, 'created'); assert.equal(data.list[3].submittedAt, '2026-10-04 11:00:00')
  assert.match(f.calls[0].sql, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/)
  assert.match(f.calls[1].sql, /START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY/)
  assert.deepEqual(f.events, ['connect', 'commit', 'release'])
  assert.equal(f.calls.length, 10, '旧授权四读+RF当前user/role/permissions/scope四读+同源count与page')
  assert.ok(f.calls.every(c => !/FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE .*SET|DELETE FROM/.test(c.sql)))
  const [count, page] = pendingQueries(f)
  const from = sql => sql.slice(sql.indexOf('FROM (')).split('\n      ORDER BY')[0]
  assert.equal(from(count.sql), from(page.sql)); assert.deepEqual(page.params.slice(-2), [20, 20])
  assert.match(page.sql, /ORDER BY pending.pending_at DESC/)
  assert.equal((page.sql.match(/WHERE a.user_id=\?/g) || []).length, 6)
  assert.equal((page.sql.match(/JOIN [a-z_]+ d ON d.id=i.biz_id/g) || []).length, 6)
})
test('原单待审状态/原查看动作权/自批/完整范围及活动引擎排重在count和LIMIT之前', async () => {
  const f = pendingFixture()
  await f.service.listPending({}, f.user)
  const [count, page] = pendingQueries(f)
  for (const query of [count, page]) {
    assert.equal((query.sql.match(/d\.status=\?/g) || []).length, 4)
    assert.ok(query.params.includes(5)); assert.equal(query.params.filter(v => v === 2).length, 2)
    assert.equal((query.sql.match(/NOT EXISTS \(SELECT 1 FROM approval_instances active/g) || []).length, 3)
    assert.match(query.sql, /active\.biz_id=d\.id AND active\.status=1/)
    assert.match(query.sql, /d\.operator_id<>\?/); assert.match(query.sql, /d\.applicant_id<>\?/)
    assert.match(query.sql, /d\.warehouse_id IN \(\?\)/)
    assert.ok(query.params.includes(7) && query.params.some(v => Array.isArray(v) && v.includes(8)))
  }
  assert.ok(f.calls[2].params[1].includes('purchase.order.approve') && f.calls[2].params[1].includes('finance.expense.view.all'))
  assert.deepEqual(f.calls[3].params, [7]); assert.match(f.calls[3].sql, /deleted_at IS NULL/)
})
test('仅单级审核权限不能借新菜单看到engine；缺原VIEW或动作权的来源分支不可见', async () => {
  const f = pendingFixture({ permissions: ['purchase.order.view', 'purchase.order.approve'] })
  await f.service.listPending({}, { ...f.user, permissions: ['*'] })
  const sql = pendingQueries(f)[0].sql
  assert.equal((sql.match(/WHERE a.user_id=\?.*1=0/g) || []).length, 6)
  const docs = sql.split("'document' AS source_kind").slice(1)
  assert.ok(!docs[0].split('UNION ALL')[0].includes('1=0'))
  assert.ok(docs[1].split('UNION ALL')[0].includes('1=0') && docs[2].includes('1=0'))
  for (const permissions of [['purchase.order.view'], ['purchase.order.approve'], ['approval.task.view']]) {
    const g = pendingFixture({ permissions }); await g.service.listPending({}, g.user)
    assert.ok(pendingQueries(g)[0].sql.split("'document' AS source_kind").slice(1).every(s => s.split('UNION ALL')[0].includes('1=0')))
  }
})
test('报销沿本人/view_all；自批仅真实flag=1，超管不自动豁免，空仓仍可看公司级来源', async () => {
  const limited = pendingFixture({ permissions: ['finance.expense.view', 'finance.expense.approve'] })
  await limited.service.listPending({}, { ...limited.user, warehouseIds: [] })
  assert.match(pendingQueries(limited)[0].sql, /d\.applicant_id=\?/)
  assert.match(pendingQueries(limited)[0].sql, /1=0/)
  const superAdmin = pendingFixture({ permissions: [], flag: 0 })
  await superAdmin.service.listPending({}, { ...superAdmin.user, roleId: 1, warehouseIds: [] })
  assert.ok(pendingQueries(superAdmin)[0].params.includes(0), '超管仍按flag0自批条件过滤')
  const enabled = pendingFixture({ flag: 1 })
  await enabled.service.listPending({}, enabled.user)
  assert.ok(pendingQueries(enabled)[0].params.includes(1)); assert.equal(enabled.calls[3].params[0], 7)
})
test('原guard允许历史NULL/0制单人，SQL及DTO保持未知身份而不吞掉待审', async () => {
  const f = pendingFixture({ rows: [{ ...documentRow('purchase_order', 31), applicant_id: null }, { ...documentRow('inventory_disposal', 32), applicant_id: 0 }] })
  const data = await f.service.listPending({}, f.user)
  assert.equal(data.list[0].applicantId, null); assert.equal(data.list[1].applicantId, 0)
  assert.match(pendingQueries(f)[0].sql, /d\.operator_id IS NULL OR d\.operator_id<>\?/)
  assert.match(pendingQueries(f)[0].sql, /d\.applicant_id IS NULL OR d\.applicant_id<>\?/)
})
test('身份、分页归一化和只读失败释放；首页brief与页面来自同一授权集合', async () => {
  const f = pendingFixture()
  await assert.rejects(f.service.listPending({}, null), e => e.statusCode === 401); assert.equal(f.calls.length, 0)
  const page = await f.service.listPending({ page: Infinity, pageSize: Infinity }, f.user)
  assert.equal(page.pagination.page, 1); assert.equal(page.pagination.pageSize, 20)
  const full = pendingQueries(f)[0].sql
  const brief = pendingFixture(); await brief.service.listPending({ page: 1, pageSize: 5 }, brief.user)
  assert.equal(pendingQueries(brief)[0].sql, full)
  const failing = pendingFixture({ failPage: true })
  await assert.rejects(failing.service.listPending({}, failing.user), /offline page failed/)
  assert.deepEqual(failing.events, ['connect', 'rollback', 'release'])
})
test('pending入口任一原审核权可进，biz历史仍要求原APPROVAL_TASK_VIEW', () => {
  const registered = []
  const context = { module: { exports: {} }, require: name => {
    if (name === 'express') return { Router: () => Object.fromEntries(['use', 'get', 'post', 'put', 'delete'].map(method => [method, (...args) => registered.push({ method, args })])) }
    if (name === 'zod') return require('../backend/node_modules/zod')
    if (name === './approvals.controller') return {}
    if (name === '../../middleware/auth') return { authMiddleware: 'auth', requirePermission: code => ({ code }), requireAnyPermission: codes => ({ codes }) }
    return require(path.join(__dirname, '../backend/src/modules/approvals', name))
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend/src/modules/approvals/approvals.routes.js'), 'utf8'), context)
  const pending = registered.find(r => r.args[0] === '/pending').args[1]
  assert.deepEqual(Array.from(pending.codes), ['approval.task.view', 'purchase.order.approve', 'inventory.disposal.approve', 'finance.expense.approve', 'supplier.refund.confirm'])
  assert.equal(registered.find(r => r.args[0] === '/biz/:bizType/:bizId').args[1].code, 'approval.task.view')
})
test('继承的对象键也属于未知业务，不应读取审批历史', async () => {
  const service = loadService({ getConnection: () => { throw new Error('不应读取未知原单') } })
  await assert.rejects(service.getBizApproval({ bizType: '__proto__', bizId: 1 }), e => e.statusCode === 400 || e.status === 400)
})
