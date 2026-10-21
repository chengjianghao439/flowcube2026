'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const mysql = require('../backend/node_modules/mysql2/promise')
const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
const { httpFixture } = require('./helpers/qaRoleHttpFixture')
const roles = require('./fixtures/qa-roles-approved-20261021.json').roles
const revisionKey = 'qa_roles_20261021_v2'
const migrationFile = path.join(__dirname, '../backend/src/database/296_qa_role_permissions.sql')
const role = code => roles.find(r => r.code === code)
const removed = roles.flatMap(r => r.before.filter(p => !r.after.includes(p)).map(permission => ({ role: r.code, permission })))
const added = roles.flatMap(r => r.after.filter(p => !r.before.includes(p)).map(permission => ({ role: r.code, permission })))

// Every case owns a connection and three temporary shadows of the actual schema.
// It never changes real roles/users. Closing the connection removes all fixtures.
async function scenario(fn) {
  const conn = await mysql.createConnection({ ...validateTestEnvironment(), charset: 'utf8mb4_unicode_ci' })
  try {
    for (const table of ['sys_roles', 'sys_role_permissions', 'sys_role_default_revisions']) {
      const [[schema]] = await conn.query(`SHOW CREATE TABLE ${table}`)
      await conn.query(schema['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE'))
    }
    await conn.query('INSERT INTO sys_roles (id,code,name,remark,is_system) VALUES ?', [roles.map(r => [r.id, r.code, r.name, r.remark, r.is_system])])
    await conn.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [roles.flatMap(r => r.before.map(p => [r.id, p]))])
    await fn(conn)
  } finally {
    await conn.rollback()
    await conn.end()
  }
}

// Match migrate.js: execute split statements one by one, inspect ALL diagnostic
// rows, and stop before any later mutation. A SQL/injected error also rolls back.
async function applySql(conn, { sql = fs.readFileSync(migrationFile, 'utf8'), afterStatement } = {}) {
  try {
    for (const statement of splitSqlStatements(sql)) {
      const [rows] = await conn.query(statement)
      const diagnostics = Array.isArray(rows) ? rows.filter(row => row.migration_error != null).map(row => String(row.migration_error)) : []
      if (diagnostics.length) {
        const error = new Error(diagnostics.join('\n'))
        error.code = 'MIGRATION_PREFLIGHT_FAILED'
        throw error
      }
      if (afterStatement) await afterStatement(statement)
    }
  } catch (error) {
    await conn.rollback()
    throw error
  }
}

async function snapshot(conn) {
  const [metadata] = await conn.query('SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id')
  const [permissions] = await conn.query('SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,BINARY permission')
  const [revisions] = await conn.query('SELECT * FROM sys_role_default_revisions ORDER BY revision_key,BINARY role_code')
  return { roles: metadata, permissions, revisions }
}
async function assertProjection(conn, phase) {
  const actual = await snapshot(conn)
  assert.deepEqual(actual.roles.map(r => ({ ...r, id: Number(r.id), is_system: Number(r.is_system) })), roles.map(r => ({ id: r.id, code: r.code, name: r.name, remark: r.remark, is_system: r.is_system })))
  for (const r of roles) assert.deepEqual(actual.permissions.filter(p => Number(p.role_id) === r.id).map(p => p.permission).sort(), [...r[phase]].sort(), `${r.id}/${r.code}: exact complete ${phase} permissions`)
  assert.equal(actual.permissions.length, phase === 'before' ? 351 : 319)
  return actual
}
function deny(result, permission) {
  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'PERMISSION_DENIED')
  assert.equal(result.body.data.permission, permission)
  assert.equal(result.calls.length, 0, 'permission denial must precede successful business controller')
  assert.equal(result.permissionQueries.length, 1, 'real loader must query migrated connection-local permissions')
}
function allow(result) {
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.data.fixtureControllerReached, true)
  assert.equal(result.calls.length, 1)
  assert.equal(result.permissionQueries.length, 1)
}
const reportsSource = fs.readFileSync(path.join(__dirname, '../backend/src/modules/reports/reports.routes.js'), 'utf8')
const reportRoutes = [...reportsSource.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)].map(m => ({ method: m[1].toUpperCase(), path: `/api/reports${m[2]}` }))
const reportRoles = roles.filter(r => r.before.includes('report.view') && !r.after.includes('report.view'))

test('未迁移基线真实包含351条授权且7角色仍可打开所有报表接口', async () => scenario(async conn => {
  await assertProjection(conn, 'before')
  assert.equal(reportRoutes.length, 12, 'enumerate all actual reports.routes.js endpoints')
  assert.equal(reportRoles.length, 7)
  await httpFixture(conn, roles, async ({ request }) => {
    for (const r of reportRoles) for (const route of reportRoutes) allow(await request(r.id, route))
  })
}))

test('完整13角色精确351→319；差集严格35撤3增；完整回执与after才可重放', async () => scenario(async conn => {
  await assertProjection(conn, 'before')
  await applySql(conn)
  const after = await assertProjection(conn, 'after')
  const pairs = phase => roles.flatMap(r => r[phase].map(p => `${r.id}:${p}`)).sort()
  const beforePairs = pairs('before'), afterPairs = after.permissions.map(p => `${p.role_id}:${p.permission}`).sort()
  assert.deepEqual(beforePairs.filter(p => !afterPairs.includes(p)), removed.map(x => `${role(x.role).id}:${x.permission}`).sort())
  assert.deepEqual(afterPairs.filter(p => !beforePairs.includes(p)), added.map(x => `${role(x.role).id}:${x.permission}`).sort())
  assert.equal(removed.length, 35); assert.equal(added.length, 3)
  const receipts = after.revisions.filter(r => r.revision_key === revisionKey)
  assert.equal(receipts.length, 13, 'unchanged approved roles also belong to the complete receipt')
  for (const r of roles) {
    const receipt = receipts.find(x => x.role_code === r.code)
    assert.ok(receipt, r.code)
    assert.equal(Number(receipt.role_id), r.id)
    assert.equal(receipt.outcome, 'applied')
    assert.equal(Number(receipt.before_count), r.before.length)
    assert.equal(Number(receipt.after_count), r.after.length)
    assert.ok(receipt.recorded_at)
  }
  await applySql(conn)
  assert.deepEqual(await snapshot(conn), after, 'replay cannot rewrite metadata, permissions or original receipts')
}))

const driftCases = [
  ['多余权限', async c => c.query("INSERT INTO sys_role_permissions VALUES (?,'user.update')", [role('sales').id]), ['sales', 'user.update']],
  ['缺少权限', async c => c.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='dashboard.view'", [role('sales').id]), ['sales', 'dashboard.view']],
  ['同数量换权', async c => { await c.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='dashboard.view'", [role('sales').id]); await c.query("INSERT INTO sys_role_permissions VALUES (?,'user.update')", [role('sales').id]) }, ['sales', 'dashboard.view', 'user.update']],
  ['权限大小写', async c => c.query("UPDATE sys_role_permissions SET permission='Dashboard.view' WHERE role_id=? AND permission='dashboard.view'", [role('sales').id]), ['sales', 'dashboard.view', 'Dashboard.view']],
  ['code', async c => c.query("UPDATE sys_roles SET code='Sales' WHERE id=?", [role('sales').id]), ['sales', 'Sales', 'code']],
  ['name', async c => c.query("UPDATE sys_roles SET name='自定义销售' WHERE id=?", [role('sales').id]), ['sales', '自定义销售', 'name']],
  ['remark', async c => c.query("UPDATE sys_roles SET remark='自定义备注' WHERE id=?", [role('sales').id]), ['sales', '自定义备注', 'remark']],
  ['is_system', async c => c.query('UPDATE sys_roles SET is_system=0 WHERE id=?', [role('sales').id]), ['sales', 'is_system']],
  ['ID缺失', async c => { await c.query('DELETE FROM sys_role_permissions WHERE role_id=?', [role('sales').id]); await c.query('DELETE FROM sys_roles WHERE id=?', [role('sales').id]) }, ['sales']],
  ['ID改绑', async c => { await c.query('UPDATE sys_role_permissions SET role_id=104 WHERE role_id=4'); await c.query('UPDATE sys_roles SET id=104 WHERE id=4') }, ['sales', '104']],
  ['额外角色', async c => c.query("INSERT INTO sys_roles(id,code,name,remark,is_system) VALUES(104,'extra_role','额外角色','额外角色',0)"), ['104', 'extra_role']],
  ['未改角色漂移', async c => c.query("INSERT INTO sys_role_permissions VALUES (?,'user.update')", [role('preset_accountant').id]), ['preset_accountant', 'user.update']],
  ['多角色多项漂移', async c => {
    await c.query("INSERT INTO sys_role_permissions VALUES (?,'user.update'),(?,'user.create'),(?,'system.config'),(?,'user.delete')", [4, 4, 12, 13])
    await c.query("DELETE FROM sys_role_permissions WHERE role_id IN (2,3,8) AND permission='dashboard.view'")
    await c.query("UPDATE sys_roles SET name='销售自定名', remark='销售自定备注', is_system=0 WHERE id=4")
  }, ['sales', 'preset_accountant', 'preset_customer_service', 'warehouse', 'purchaser', 'preset_stock_controller', 'user.update', 'user.create', 'system.config', 'user.delete', 'dashboard.view', '销售自定名', '销售自定备注', 'is_system']],
]
for (const [name, mutate, diagnostics] of driftCases) {
  test(`完整基线预检拒绝${name}，全角色/授权/回执均保持原样并列完整差异`, async () => scenario(async conn => {
    await mutate(conn)
    const before = await snapshot(conn)
    await assert.rejects(applySql(conn), error => {
      assert.equal(error.code, 'MIGRATION_PREFLIGHT_FAILED')
      for (const text of diagnostics) assert.ok(error.message.includes(text), `missing diagnostic ${text}: ${error.message}`)
      for (const r of roles) {
        const prefix = `role=${r.id}/${r.code}/${r.name}`
        if (error.message.includes(prefix)) {
          const actualCount = before.permissions.filter(p => Number(p.role_id) === r.id).length
          assert.ok(error.message.includes(`${prefix} expected_count=${r.before.length} actual_count=${actualCount} `), 'every drifting role must include both counts, even when equal')
        }
      }
      return true
    })
    assert.deepEqual(await snapshot(conn), before)
  }))
}

test('13角色351条缺权与26条多权诊断逐条列全，不截断差异', async () => scenario(async conn => {
  await conn.query('DELETE FROM sys_role_permissions')
  const extra = roles.flatMap(r => [0, 1].map(i => [r.id, `qa.drift.${r.id}.${i}`]))
  await conn.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES ?', [extra])
  const before = await snapshot(conn)
  await assert.rejects(applySql(conn), error => {
    assert.equal(error.code, 'MIGRATION_PREFLIGHT_FAILED')
    const lines = error.message.split('\n')
    for (const r of roles) {
      for (const permission of r.before) assert.ok(lines.some(line => line.includes(`role=${r.id}/${r.code}/`) && line.includes('missing_permission') && line.endsWith(`: ${permission}`)), `${r.code}: missing ${permission}`)
      for (const [, permission] of extra.filter(([id]) => id === r.id)) assert.ok(lines.some(line => line.includes(`role=${r.id}/${r.code}/`) && line.includes('extra_permission') && line.endsWith(`: ${permission}`)), `${r.code}: extra ${permission}`)
    }
    return true
  })
  assert.deepEqual(await snapshot(conn), before)
}))

for (const state of ['half-permissions', 'after-without-receipts', 'receipt-missing', 'receipt-count', 'receipt-before-count', 'receipt-role-id', 'receipt-outcome', 'receipt-reason', 'receipt-extra', 'after-drift', 'after-metadata']) {
  test(`半应用/坏回执${state}整体拒绝且不改任何状态`, async () => scenario(async conn => {
    if (state === 'half-permissions') await conn.query("DELETE FROM sys_role_permissions WHERE role_id=4 AND permission='report.view'")
    else {
      await applySql(conn)
      if (state === 'after-without-receipts') await conn.query('DELETE FROM sys_role_default_revisions WHERE revision_key=?', [revisionKey])
      if (state === 'receipt-missing') await conn.query("DELETE FROM sys_role_default_revisions WHERE revision_key=? AND role_code='sales'", [revisionKey])
      if (state === 'receipt-count') await conn.query("UPDATE sys_role_default_revisions SET after_count=after_count+1 WHERE revision_key=? AND role_code='sales'", [revisionKey])
      if (state === 'receipt-before-count') await conn.query("UPDATE sys_role_default_revisions SET before_count=before_count+1 WHERE revision_key=? AND role_code='sales'", [revisionKey])
      if (state === 'receipt-role-id') await conn.query("UPDATE sys_role_default_revisions SET role_id=9999 WHERE revision_key=? AND role_code='sales'", [revisionKey])
      if (state === 'receipt-outcome') await conn.query("UPDATE sys_role_default_revisions SET outcome='preserved_custom' WHERE revision_key=? AND role_code='sales'", [revisionKey])
      if (state === 'receipt-reason') await conn.query("UPDATE sys_role_default_revisions SET reason='unapproved receipt' WHERE revision_key=? AND role_code='sales'", [revisionKey])
      if (state === 'receipt-extra') await conn.query("INSERT INTO sys_role_default_revisions(revision_key,role_code,role_id,outcome,before_count,after_count,reason) VALUES(?,'extra_role',9999,'applied',0,0,'unapproved receipt')", [revisionKey])
      if (state === 'after-drift') await conn.query("INSERT INTO sys_role_permissions VALUES (4,'user.update')")
      if (state === 'after-metadata') await conn.query("UPDATE sys_roles SET remark='迁移后人工变更' WHERE id=12")
    }
    const before = await snapshot(conn)
    await assert.rejects(applySql(conn), error => error.code === 'MIGRATION_PREFLIGHT_FAILED')
    assert.deepEqual(await snapshot(conn), before)
  }))
}

for (const phase of ['delete', 'insert', 'receipt']) {
  test(`首次${phase}写入后注入故障，事务回滚完整351与零回执`, async () => scenario(async conn => {
    const before = await snapshot(conn)
    let injected = false
    const failure = new Error(`synthetic ${phase} failure`)
    await assert.rejects(applySql(conn, { afterStatement: sql => {
      const executable = sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim()
      const hit = phase === 'delete' ? /^DELETE\b[\s\S]*\bsys_role_permissions\b/i.test(executable)
        : phase === 'insert' ? /^INSERT\s+INTO\s+sys_role_permissions\b/i.test(executable)
          : /^INSERT\s+INTO\s+sys_role_default_revisions\b/i.test(executable)
      if (hit) { injected = true; throw failure }
    } }), error => error === failure)
    assert.equal(injected, true, `${phase} fault must occur after a real mutation`)
    assert.deepEqual(await snapshot(conn), before)
  }))
}

test('迁移后7角色调用真实reports全部接口均403且不进入业务controller', async () => scenario(async conn => {
  await applySql(conn)
  await httpFixture(conn, roles, async ({ request }) => {
    for (const r of reportRoles) for (const route of reportRoutes) deny(await request(r.id, route), 'report.view')
  })
}))

const permissionRoutes = {
  'finance.account.view': { path: '/api/finance/accounts' },
  'finance.expense.view': { path: '/api/finance/expense-claims' },
  'payment.view': { path: '/api/payments' },
  'payment.create': { path: '/api/payments/debit-account-options' },
  'payment.execute': { method: 'POST', path: '/api/payments/1/pay', body: { amount: 1, paymentDate: '2026-10-21' } },
  'logistics.manage': { method: 'POST', path: '/api/logistics/1/retry' },
  'logistics.freight.reconcile': { path: '/api/logistics/freight/bills' },
  'accounting.account.manage': { method: 'DELETE', path: '/api/accounting/accounts/1' },
  'accounting.account.view': { path: '/api/accounting/accounts/tree' },
  'accounting.ledger.view': { path: '/api/accounting/ledger/trial-balance' },
  'accounting.period.manage': { method: 'POST', path: '/api/accounting/periods/close', body: {} },
  'accounting.voucher.export': { path: '/api/accounting/vouchers/export' },
  'accounting.voucher.manage': { method: 'DELETE', path: '/api/accounting/vouchers/1' },
  'accounting.voucher.view': { path: '/api/accounting/vouchers' },
  'invoice.manage': { method: 'DELETE', path: '/api/accounting/invoices/1' },
  'invoice.view': { path: '/api/accounting/invoices' },
  'audit.log.view': { path: '/api/oplogs' },
  'sale.credit.override.apply': { method: 'POST', path: '/api/credit-overrides', body: { saleOrderId: 1, reason: '回归申请' } },
  'sale.credit.override.view': { path: '/api/credit-overrides' },
  'report.view': reportRoutes[0],
}

test('每条有效撤权映射真实路由：迁移前200→迁移后403，旧直放码无活跃接口不伪造', async () => scenario(async conn => {
  const activeRemoved = removed.filter(x => x.permission !== 'sale.credit.override')
  assert.equal(activeRemoved.length, 33)
  assert.deepEqual(removed.filter(x => x.permission === 'sale.credit.override').map(x => x.role).sort(), ['purchaser', 'sales'])
  // Legacy SALE_CREDIT_OVERRIDE is not used by any active route middleware.
  const routeFiles = fs.readdirSync(path.join(__dirname, '../backend/src/modules'), { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d => fs.readdirSync(path.join(__dirname, '../backend/src/modules', d.name)).filter(f => f.endsWith('.routes.js')).map(f => path.join(__dirname, '../backend/src/modules', d.name, f)))
  for (const file of routeFiles) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /requirePermission\(PERMISSIONS\.SALE_CREDIT_OVERRIDE\s*\)/)
  await httpFixture(conn, roles, async ({ request }) => {
    for (const item of activeRemoved) {
      assert.ok(permissionRoutes[item.permission], `unmapped real permission: ${item.permission}`)
      allow(await request(item.role, permissionRoutes[item.permission]))
    }
    await applySql(conn)
    for (const item of activeRemoved) deny(await request(item.role, permissionRoutes[item.permission]), item.permission)
  })
}))

test('保留财务/会计/管理员和原岗位业务读取；新增销售可申请查看但不可审批，采购不可申请', async () => scenario(async conn => {
  await applySql(conn)
  await httpFixture(conn, roles, async ({ request }) => {
    for (const r of ['preset_finance_specialist', 'preset_accountant', 'admin']) for (const route of reportRoutes) allow(await request(r, route))
    for (const [r, route] of [
      ['preset_finance_specialist', permissionRoutes['finance.account.view']],
      ['preset_finance_specialist', permissionRoutes['payment.execute']],
      ['preset_finance_specialist', permissionRoutes['invoice.manage']],
      ['preset_accountant', permissionRoutes['accounting.ledger.view']],
      ['preset_accountant', permissionRoutes['accounting.voucher.manage']],
      ['warehouse', { path: '/api/inventory/stock' }], ['viewer', { path: '/api/inventory/stock' }],
      ['preset_stock_controller', { path: '/api/inventory/stock' }],
      ['purchaser', { path: '/api/purchase' }], ['preset_purchase_manager', { path: '/api/purchase' }],
      ['sales', { path: '/api/sale' }], ['preset_sales_manager', { path: '/api/sale' }],
      ['warehouse', { path: '/api/products' }],
      ['sales', permissionRoutes['sale.credit.override.apply']], ['sales', permissionRoutes['sale.credit.override.view']],
    ]) allow(await request(r, route))
    deny(await request('sales', { method: 'POST', path: '/api/credit-overrides/1/approve', body: {} }), 'sale.credit.override.approve')
    deny(await request('purchaser', permissionRoutes['sale.credit.override.apply']), 'sale.credit.override.apply')
  })
}))
