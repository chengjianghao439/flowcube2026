'use strict'
// Explicit synthetic fixture preparation for CI/owned empty test databases.
// Production migrations never call this file or recognize an alternate baseline.
const assert = require('node:assert/strict')
const { configureTestEnvironment, validateTestEnvironment } = require('./testEnvironment')
const approved = require('../fixtures/qa-roles-approved-20261021.json').roles
const seeds = require('../fixtures/role-defaults-v0136.json').roles
const migration = '296_qa_role_permissions.sql'
const previousDelta = {
  warehouse_manager: { remove: ['finance.account.view', 'payment.create', 'payment.execute', 'payment.view'], add: ['product.view'] },
  purchaser: { remove: ['logistics.manage', 'sale.credit.override', 'sale.credit.override.apply', 'sale.credit.override.view'], add: [] },
  sales: { remove: ['accounting.account.manage', 'accounting.account.view', 'accounting.ledger.view', 'accounting.period.manage', 'accounting.voucher.export', 'accounting.voucher.manage', 'accounting.voucher.view', 'finance.account.view', 'invoice.manage', 'logistics.freight.reconcile', 'payment.create', 'payment.execute', 'sale.credit.override'], add: ['sale.credit.override.apply', 'sale.credit.override.view'] },
  viewer: { remove: ['finance.account.view', 'payment.view'], add: [] },
  preset_warehouse_operator: { remove: [], add: ['warehouse.task.ship'] },
  preset_finance_specialist: { remove: [], add: ['approval.task.view', 'sale.credit.view', 'sale.credit.override.view', 'sale.credit.override.approve'] },
}
async function prepareQaRoleTestDatabase() {
  configureTestEnvironment()
  const cfg = validateTestEnvironment()
  const mysql = require('../../backend/node_modules/mysql2/promise')
  const { runMigrations } = require('../../backend/src/database/migrate')
  await runMigrations({ through: '295_role_duties_approval.sql' })
  const conn = await mysql.createConnection(cfg)
  try {
    const [done] = await conn.query('SELECT filename FROM db_migrations WHERE filename=?', [migration])
    // No fixture reset once 296 exists; later migrations still run below.
    if (!done.length) {
      await conn.beginTransaction()
      const [actualRoles] = await conn.query('SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id FOR UPDATE')
      const [actualGrants] = await conn.query('SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,permission FOR UPDATE')
      const [users] = await conn.query('SELECT id,username,role_id,is_active FROM sys_users ORDER BY id FOR UPDATE')
      assert.deepEqual(users.map(r => ({ ...r, id: Number(r.id), role_id: Number(r.role_id) })), [{ id: 1, username: 'admin', role_id: 1, is_active: 0 }], 'test fixture requires only the inactive seed administrator')
      // Business facts must be absent. Never reinterpret a populated test database.
      for (const table of ['sale_orders', 'purchase_orders', 'inventory_containers', 'payment_records', 'expense_claims']) {
        const [[row]] = await conn.query('SELECT COUNT(*) n FROM ??', [table])
        assert.equal(Number(row.n), 0, `test fixture requires empty ${table}`)
      }
      const expected = seeds.map(r => {
        const d = previousDelta[r.code] || { remove: [], add: [] }
        return { ...r, permissions: [...r.permissions.filter(p => !d.remove.includes(p)), ...d.add].sort() }
      })
      const actual = actualRoles.map(r => ({ ...r, id: Number(r.id), permissions: actualGrants.filter(g => Number(g.role_id) === Number(r.id)).map(g => g.permission).sort() }))
      assert.deepEqual(actual, expected, 'test fixture refuses a customized pre-296 role baseline')
      await conn.query('DELETE FROM sys_role_permissions')
      await conn.query('DELETE FROM sys_roles')
      await conn.query('INSERT INTO sys_roles (id,code,name,remark,is_system) VALUES ?', [approved.map(r => [r.id,r.code,r.name,r.remark,r.is_system])])
      await conn.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [approved.flatMap(r => r.before.map(p => [r.id,p]))])
      await conn.commit()
      console.log('[test-db] installed the explicitly approved synthetic 13-role before-state; strict migration 296 follows')
    }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { await conn.end() }
  await runMigrations()
}
if (require.main === module) prepareQaRoleTestDatabase().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { prepareQaRoleTestDatabase }
