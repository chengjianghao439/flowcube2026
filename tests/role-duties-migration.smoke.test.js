'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const mysql = require('../backend/node_modules/mysql2/promise')
const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const baseline = require('./fixtures/role-defaults-v0136.json').roles
const statements = splitSqlStatements(fs.readFileSync(path.join(__dirname, '../backend/src/database/295_role_duties_approval.sql'), 'utf8'))
const delta = {
  warehouse_manager: { remove: ['finance.account.view', 'payment.create', 'payment.execute', 'payment.view'], add: ['product.view'] },
  purchaser: { remove: ['logistics.manage', 'sale.credit.override', 'sale.credit.override.apply', 'sale.credit.override.view'], add: [] },
  sales: { remove: ['accounting.account.manage', 'accounting.account.view', 'accounting.ledger.view', 'accounting.period.manage', 'accounting.voucher.export', 'accounting.voucher.manage', 'accounting.voucher.view', 'finance.account.view', 'invoice.manage', 'logistics.freight.reconcile', 'payment.create', 'payment.execute', 'sale.credit.override'], add: ['sale.credit.override.apply', 'sale.credit.override.view'] },
  viewer: { remove: ['finance.account.view', 'payment.view'], add: [] },
  preset_warehouse_operator: { remove: [], add: ['warehouse.task.ship'] },
  preset_finance_specialist: { remove: [], add: ['approval.task.view', 'sale.credit.view', 'sale.credit.override.view', 'sale.credit.override.approve'] },
}
const roleId = code => baseline.find(r => r.code === code).id

// Each case shadows the three synthetic database tables with connection-local
// temporary tables of the REAL schema. No existing role/user/grant is changed.
async function scenario(fn, idMap = id => id) {
  const cfg = validateTestEnvironment()
  const conn = await mysql.createConnection({ ...cfg, charset: 'utf8mb4_unicode_ci' })
  try {
    await conn.query(statements[0])
    for (const table of ['sys_roles', 'sys_role_permissions', 'sys_role_default_revisions']) {
      const [[schema]] = await conn.query(`SHOW CREATE TABLE ${table}`)
      await conn.query(schema['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE'))
    }
    await conn.query('INSERT INTO sys_roles (id,code,name,remark,is_system) VALUES ?', [baseline.map(r => [idMap(r.id), r.code, r.name, r.remark, r.is_system])])
    await conn.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [baseline.flatMap(r => r.permissions.map(p => [idMap(r.id), p]))])
    await fn(conn)
  } finally {
    await conn.rollback()
    await conn.end() // Closing removes only this connection's temporary fixtures.
  }
}
async function replay(conn) { for (const sql of statements) await conn.query(sql) }
async function snapshot(conn) {
  const [roles] = await conn.query('SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id')
  const [permissions] = await conn.query('SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,permission')
  return { roles, permissions }
}
async function grants(conn, id) {
  const [rows] = await conn.query('SELECT permission FROM sys_role_permissions WHERE role_id=? ORDER BY permission', [id])
  return rows.map(r => r.permission).sort()
}
async function revisions(conn) { const [rows] = await conn.query('SELECT * FROM sys_role_default_revisions ORDER BY role_code'); return rows }
async function expected(conn, idMap = id => id) {
  for (const role of baseline) {
    const change = delta[role.code]
    const after = change ? [...role.permissions.filter(p => !change.remove.includes(p)), ...change.add].sort() : role.permissions
    assert.deepEqual(await grants(conn, idMap(role.id)), after, role.code)
    // Historical inert grants (e.g. page:inbound) remain exactly as projected;
    // every newly introduced grant must be registered, never a new legacy code.
    assert.ok(after.filter(p => !role.permissions.includes(p)).every(p => Object.values(PERMISSIONS).includes(p)), 'newly granted permission must be registered')
  }
}

test('默认角色只执行已批准差量、全12角色准确；原始迁移重复执行不追加', async () => scenario(async conn => {
  const before = await snapshot(conn)
  assert.equal(before.permissions.length, 310)
  await replay(conn); await expected(conn)
  const after = await snapshot(conn), recorded = await revisions(conn)
  assert.deepEqual(after.roles, before.roles)
  assert.equal(after.permissions.length, 295)
  assert.equal(recorded.length, 6)
  assert.ok(recorded.every(r => r.outcome === 'applied' && r.recorded_at))
  for (const r of recorded) assert.equal(r.after_count, (await grants(conn, r.role_id)).length)
  const finance = await grants(conn, roleId('preset_finance_specialist'))
  assert.ok(finance.includes('sale.credit.override.approve'))
  assert.ok(!finance.includes('sale.credit.override.apply'))
  await replay(conn)
  assert.deepEqual(await snapshot(conn), after)
  assert.deepEqual(await revisions(conn), recorded)
}))

for (const kind of ['extra', 'missing', 'same-count', 'permission-case', 'name', 'remark', 'custom-flag', 'code-case']) {
  test(`自定义例外 ${kind} 完整保留，不撤销也不自动补权`, async () => scenario(async conn => {
    const id = roleId('sales')
    if (kind === 'extra') await conn.query("INSERT INTO sys_role_permissions VALUES (?,'user.update')", [id])
    if (['missing', 'same-count', 'permission-case'].includes(kind)) await conn.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='dashboard.view'", [id])
    if (kind === 'same-count') await conn.query("INSERT INTO sys_role_permissions VALUES (?,'user.update')", [id])
    if (kind === 'permission-case') await conn.query("INSERT INTO sys_role_permissions VALUES (?,'Dashboard.view')", [id])
    if (kind === 'name') await conn.query("UPDATE sys_roles SET name='自定义销售' WHERE id=?", [id])
    if (kind === 'remark') await conn.query("UPDATE sys_roles SET remark='销售业务例外' WHERE id=?", [id])
    if (kind === 'custom-flag') await conn.query('UPDATE sys_roles SET is_system=0 WHERE id=?', [id])
    if (kind === 'code-case') await conn.query("UPDATE sys_roles SET code='Sales' WHERE id=?", [id])
    const before = await grants(conn, id), originalRoles = (await snapshot(conn)).roles
    await replay(conn)
    assert.deepEqual(await grants(conn, id), before)
    assert.deepEqual((await snapshot(conn)).roles, originalRoles)
    const recorded = (await revisions(conn)).find(r => r.role_code === 'sales')
    assert.equal(recorded.outcome, 'preserved_custom')
    assert.equal(recorded.before_count, recorded.after_count)
    assert.equal((await revisions(conn)).filter(r => r.outcome === 'applied').length, 5)
  }))
}

test('缺少的岗位只记录缺失，不能创建角色或悬空授权', async () => scenario(async conn => {
  const id = roleId('viewer')
  await conn.query('DELETE FROM sys_role_permissions WHERE role_id=?', [id])
  await conn.query('DELETE FROM sys_roles WHERE id=?', [id])
  await replay(conn)
  assert.equal((await snapshot(conn)).roles.length, 11)
  assert.deepEqual(await grants(conn, id), [])
  const recorded = (await revisions(conn)).find(r => r.role_code === 'viewer')
  assert.equal(recorded.outcome, 'missing'); assert.equal(recorded.role_id, null)
}))

test('全部角色ID变化后仍按稳定编码准确授权', async () => scenario(async conn => {
  await replay(conn); await expected(conn, id => id + 100)
}, id => id + 100))

test('角色ID1即使意外变成销售编码也保持保护', async () => scenario(async conn => {
  const before = await grants(conn, 1)
  await replay(conn)
  assert.deepEqual(await grants(conn, 1), before)
  assert.equal((await revisions(conn)).find(r => r.role_code === 'sales').outcome, 'preserved_custom')
}, id => id === 1 ? 4 : id === 4 ? 1 : id))

test('迁移后人工撤权/加权不因原始SQL重放被补回或清除', async () => scenario(async conn => {
  await replay(conn)
  await conn.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='sale.credit.override.approve'", [roleId('preset_finance_specialist')])
  await conn.query("INSERT INTO sys_role_permissions VALUES (?,'user.update')", [roleId('sales')])
  const before = await snapshot(conn), recorded = await revisions(conn)
  await replay(conn)
  assert.deepEqual(await snapshot(conn), before)
  assert.deepEqual(await revisions(conn), recorded)
}))

test('曾保留的自定义岗位以后恢复基线也须人工复核，不自动套用', async () => scenario(async conn => {
  const id = roleId('sales')
  await conn.query("INSERT INTO sys_role_permissions VALUES (?,'user.update')", [id])
  await replay(conn)
  await conn.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='user.update'", [id])
  const before = await snapshot(conn)
  await replay(conn)
  assert.deepEqual(await snapshot(conn), before)
  assert.equal((await revisions(conn)).find(r => r.role_code === 'sales').outcome, 'preserved_custom')
}))

test('撤权后故障回滚保持原完整权限，不能留下半次修正', async () => scenario(async conn => {
  const before = await snapshot(conn)
  let injected = false
  try {
    for (const sql of statements) {
      await conn.query(sql)
      if (/^DELETE p FROM sys_role_permissions/.test(sql)) { injected = true; throw new Error('synthetic migration interruption') }
    }
    assert.fail('interruption must execute')
  } catch (error) {
    assert.equal(error.message, 'synthetic migration interruption')
    await conn.rollback()
  }
  assert.equal(injected, true)
  assert.deepEqual(await snapshot(conn), before)
  assert.deepEqual(await revisions(conn), [])
}))
