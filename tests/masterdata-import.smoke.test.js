#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
process.env.SENTRY_DSN = ''
process.env.LOKI_URL = ''

const express = require('../backend/node_modules/express')
const jwt = require('../backend/node_modules/jsonwebtoken')
const ExcelJS = require('../backend/node_modules/exceljs')
const { pool } = require('../backend/src/config/db')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const { SETTLEMENT_TYPE } = require('../backend/src/constants/settlementType')

async function main() {
  const mark = `IM${randomBytes(5).toString('hex')}`
  const results = []
  let server, roleId, userId
  const modules = [
    { path: 'customers', table: 'sale_customers', header: '客户编码,客户名称*,联系人,电话,结算方式,授信额度', tail: '50000' },
    { path: 'suppliers', table: 'supply_suppliers', header: '供应商编码,供应商名称*,联系人,电话,结算方式,账期（天）,采购提前期（天）,地址', tail: '30,7,测试地址' },
  ]
  const cases = [
    { value: '现结', expected: SETTLEMENT_TYPE.CASH },
    { value: '1', expected: SETTLEMENT_TYPE.CASH },
    { value: '月结', expected: SETTLEMENT_TYPE.MONTHLY },
    { value: '2', expected: SETTLEMENT_TYPE.MONTHLY },
    { value: '', expected: SETTLEMENT_TYPE.MONTHLY },
    { value: '3' },
    { value: '4' },
    { value: '预付定金' },
    { value: '货到付款' },
    { value: '未知' },
  ]
  try {
    const [[target]] = await pool.query('SELECT DATABASE() AS db')
    assert.equal(target.db, process.env.DB_NAME)
    console.log('[masterdata-import] isolated target', { host: process.env.DB_HOST, port: process.env.DB_PORT, db: target.db })
    const [used] = await pool.query('SELECT id FROM sys_roles UNION SELECT role_id AS id FROM sys_users UNION SELECT role_id AS id FROM sys_role_permissions')
    roleId = Array.from({ length: 254 }, (_, i) => 255 - i).find(id => !used.some(row => Number(row.id) === id))
    assert.ok(roleId)
    await pool.query('INSERT INTO sys_roles (id,code,name,is_system) VALUES (?,?,?,0)', [roleId, `${mark}R`, mark])
    const [user] = await pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name) VALUES (?,?,?,?,?)', [`${mark}U`, 'fixture-no-password-login', mark, roleId, mark])
    userId = user.insertId
    for (const permission of [PERMISSIONS.CUSTOMER_CREATE, PERMISSIONS.SUPPLIER_CREATE]) {
      await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [roleId, permission])
    }
    const app = express()
    app.use('/api/import', require('../backend/src/modules/import/import.routes'))
    app.use(require('../backend/src/middleware/errorHandler'))
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const endpoint = `http://127.0.0.1:${server.address().port}/api/import`
    const authorization = `Bearer ${jwt.sign({ userId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' })}`

    for (const module of modules) {
      const csv = [module.header, ...cases.map((entry, index) => {
        const code = `${mark}${module.path[0].toUpperCase()}${index}`
        const name = `${mark}${module.path[0].toUpperCase()}N${index}`
        return [code, name, '测试', '13800000000', entry.value, module.tail].join(',')
      })].join('\n')
      const form = new FormData()
      form.append('file', new Blob([csv], { type: 'text/csv' }), `${module.path}.csv`)
      const response = await fetch(`${endpoint}/${module.path}`, { method: 'POST', headers: { Authorization: authorization }, body: form, signal: AbortSignal.timeout(10000) })
      const body = await response.json()
      assert.equal(response.status, 200, `${module.path} HTTP import`)
      assert.equal(body.success, true, `${module.path} response envelope`)
      const [rows] = await pool.query(`SELECT name,settlement_type FROM ${module.table} WHERE name LIKE ?`, [`${mark}${module.path[0].toUpperCase()}N%`])
      const actual = new Map(rows.map(row => [row.name, Number(row.settlement_type)]))
      const expected = new Map(cases.filter(entry => entry.expected !== undefined).map((entry, index) => [`${mark}${module.path[0].toUpperCase()}N${index}`, entry.expected]))
      const invalidLines = cases.map((entry, index) => entry.expected === undefined ? index + 2 : null).filter(Boolean)
      const errors = body.data?.errors || []
      console.log(`[masterdata-import] ${module.path} HTTP 200, reported success=${body.data?.success}, persisted=${rows.length}, row errors=${JSON.stringify(errors)}`)
      results.push({ module: module.path, success: body.data?.success, actual, expected, errors, invalidLines })
    }

    for (const result of results) {
      assert.equal(result.success, 5, `${result.module}: only supported settlement values import`)
      assert.deepEqual(result.actual, result.expected, `${result.module}: persisted settlement types and invalid row absence`)
      assert.equal(result.errors.length, 5, `${result.module}: one error per invalid row`)
      for (const line of result.invalidLines) assert.ok(result.errors.some(error => error.includes(`第${line}行`) && error.includes('结算方式')), `${result.module}: line ${line} explains invalid settlement`)
    }

    for (const module of modules) {
      const response = await fetch(`${endpoint}/${module.path}/template`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(10000) })
      assert.equal(response.status, 200, `${module.path}: template download`)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
      const heading = String(workbook.worksheets[0].getRow(1).getCell(5).value)
      assert.match(heading, /现结.*1.*月结.*2.*空/, `${module.path}: template states accepted values and blank default`)
    }
    console.log('[masterdata-import] PASS HTTP import, persisted values, invalid row rejection, templates')
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    try {
      for (const module of modules) {
        const [rows] = await pool.query(`SELECT id FROM ${module.table} WHERE name LIKE ?`, [`${mark}${module.path[0].toUpperCase()}N%`])
        for (const row of rows) await pool.query(`DELETE FROM ${module.table} WHERE id=?`, [row.id])
        const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM ${module.table} WHERE name LIKE ?`, [`${mark}${module.path[0].toUpperCase()}N%`])
        assert.equal(Number(count), 0, `${module.path}: own rows cleaned`)
      }
      if (userId) {
        await pool.query('DELETE FROM auth_audit_logs WHERE user_id=?', [userId])
        await pool.query('DELETE FROM sys_users WHERE id=?', [userId])
      }
      if (roleId) {
        await pool.query('DELETE FROM sys_role_permissions WHERE role_id=?', [roleId])
        await pool.query('DELETE FROM sys_roles WHERE id=? AND code=?', [roleId, `${mark}R`])
      }
      console.log('[masterdata-import] cleanup verified: only this run’s fixture rows removed')
    } finally { await pool.end() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
