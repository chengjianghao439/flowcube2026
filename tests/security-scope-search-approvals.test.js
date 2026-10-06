'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const { PERMISSIONS: P } = require('../backend/src/constants/permissions')
function load(rel, mocks) {
  const file = path.join(root, rel), module = { exports: {} }, real = createRequire(file)
  const source = process.env.SECURITY_SCOPE_BASELINE ? require('node:child_process').execFileSync('git', ['show', `${process.env.SECURITY_SCOPE_BASELINE}:${rel}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(file, 'utf8')
  vm.runInNewContext(source, { module, exports: module.exports, require: n => Object.hasOwn(mocks, n) ? mocks[n] : real(n) }, { filename: file })
  return module.exports
}
function search() {
  const calls = [], pool = { query: async (sql, params) => { calls.push({ sql, params }); return [[]] } }
  return { calls, svc: load('backend/src/modules/search/search.service.js', { '../../config/db': { pool } }) }
}
test('dashboard-only user cannot search any independently permissioned resource', async () => {
  const h = search()
  const got = await h.svc.searchGlobal('单', null, { user: { roleId: 2, userId: 8, permissions: [P.DASHBOARD_VIEW] } })
  assert.equal(got.data.length, 0)
  assert.equal(h.calls.length, 0)
})
test('only resource types with canonical view permission are queried, including typed cursor requests', async () => {
  const h = search(), user = { userId: 8, roleId: 2, permissions: [P.CUSTOMER_VIEW] }
  await h.svc.searchGlobal('客户', null, { user })
  assert.equal(h.calls.length, 1)
  assert.match(h.calls[0].sql, /FROM sale_customers/)
  await h.svc.searchGlobal('发票', null, { type: 'invoice', beforeId: 9, user })
  assert.equal(h.calls.length, 1)
})
test('expense search applies applicant ownership and invoice search applies current company context', async () => {
  const h = search(), user = { userId: 8, roleId: 2, permissions: [P.FINANCE_EXPENSE_VIEW, P.INVOICE_VIEW] }
  await h.svc.searchGlobal('测试', null, { user, companyId: 3 })
  const expense = h.calls.find(c => c.sql.includes('FROM expense_claims'))
  const invoice = h.calls.find(c => c.sql.includes('FROM fin_invoices'))
  assert.match(expense.sql, /applicant_id = \?/); assert.ok(expense.params.includes(8))
  assert.match(invoice.sql, /company_id = \?/); assert.ok(invoice.params.includes(3))
})
test('view-all expense and superadmin retain permitted company-wide visibility', async () => {
  const h = search()
  await h.svc.searchGlobal('报销', [2], { type: 'expense', user: { roleId: 2, userId: 8, permissions: [P.FINANCE_EXPENSE_VIEW, P.FINANCE_EXPENSE_VIEW_ALL] } })
  assert.doesNotMatch(h.calls[0].sql, /applicant_id =/)
  await h.svc.searchGlobal('单', null, { user: { roleId: 1, userId: 1 }, companyId: 2 })
  assert.equal(h.calls.length, 17)
  assert.match(h.calls.find(c => c.sql.includes('FROM fin_invoices')).sql, /company_id = \?/)
})
test('sale, refund and credit search respect full linked order warehouse scope; empty scope fails closed', async () => {
  const user = { roleId: 1, userId: 1 }
  for (const type of ['sale', 'refund', 'creditOverride']) {
    const h = search()
    await h.svc.searchGlobal('单', [2], { type, user })
    assert.match(h.calls[0].sql, /sale_order_items/)
    assert.match(h.calls[0].sql, /warehouse_id.*IN/)
    const empty = search()
    await empty.svc.searchGlobal('单', [], { type, user })
    assert.match(empty.calls[0].sql, /1=0/)
  }
})
function approvals({ applicant = 9, viewAll = false, present = true } = {}) {
  const calls = [], conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, query: async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('sys_role_permissions')) return [[params[1] !== P.FINANCE_EXPENSE_VIEW_ALL || viewAll ? { ok: 1 } : undefined].filter(Boolean)]
    if (sql.includes('expense_claims')) return [present ? [{ applicant_id: applicant }] : []]
    throw new Error(`Unexpected SQL ${sql}`)
  } }, pool = { getConnection: async () => conn }
  return { calls, svc: load('backend/src/modules/approvals/approvals.service.js', {
    '../../config/db': { pool }, '../../utils/warehouseScope': {},
    '../../engine/approvalEngine': { getLatestInstanceByBiz: async () => { calls.push('approval'); return { instance: {}, tasks: [] } } },
  }) }
}
test('approval lookup denies another applicant before reading approval contents', async () => {
  const h = approvals()
  await assert.rejects(() => h.svc.getBizApproval({ bizType: 'expense_claim', bizId: 1, user: { roleId: 2, userId: 8 } }), e => e.statusCode === 403)
  assert.ok(!h.calls.includes('approval'))
})
test('own expense, view-all expense and superadmin can read expense approval', async () => {
  for (const [config, user] of [[{ applicant: 8 }, { roleId: 2, userId: 8 }], [{ viewAll: true }, { roleId: 2, userId: 8 }], [{}, { roleId: 1, userId: 1 }]]) {
    const h = approvals(config)
    await h.svc.getBizApproval({ bizType: 'expense_claim', bizId: 1, user })
    assert.ok(h.calls.includes('approval'))
  }
})
test('expense approval missing resource fails closed', async () => {
  const h = approvals({ present: false })
  await assert.rejects(() => h.svc.getBizApproval({ bizType: 'expense_claim', bizId: 1, user: { roleId: 2, userId: 8 } }), e => e.statusCode === 404)
  assert.ok(!h.calls.includes('approval'))
})

test('search controller passes trusted identity/company and all entity permissions are registered', async () => {
  let opts
  const h = search()
  for (const ent of h.svc.ENTITIES) assert.ok(Object.values(P).includes(ent.permission), ent.type)
  const controller = load('backend/src/modules/search/search.controller.js', {
    './search.service': { searchGlobal: async (q, scope, options) => { opts = options; return { data: [] } } },
    '../../utils/response': { successResponse: () => {} },
  })
  const user = { roleId: 2, userId: 8, warehouseIds: [2], permissions: [P.INVOICE_VIEW] }
  await controller.searchGlobal({ query: { q: '测试', companyId: 9, user: {} }, user, companyId: 3 }, {}, e => { throw e })
  assert.equal(opts.user,user); assert.equal(opts.companyId,3)
})
