'use strict'
// Real HTTP/auth/database, virtual printers only. Only exact IDs created here are removed.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { prepareSmokeContext, login, randomRef } = require('./helpers/smokeTestKit')
const bcrypt = require('../backend/node_modules/bcryptjs')
const { PERMISSIONS: P } = require('../backend/src/constants/permissions')
const { pool: appPool } = require('../backend/src/config/db')

async function main() {
  const ctx = await prepareSmokeContext({ requestTimeoutMs: 15000 })
  const { pool, http } = ctx
  const created = { warehouses: [], printers: [], clients: [], users: [], roles: [], templates: [] }
  const suffix = randomRef('SEC-PRINT').slice(0, 24)
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log(`[PASS] ${name}`) }
  const expect = (r, status) => assert.equal(r.status, status, `expected HTTP ${status}; got ${r.status} ${r.data?.code || ''}`)
  const data = r => r.data?.data
  try {
    const admin = (await login(http, 'smoke_admin', 'SmokeAdmin123!')).token
    assert.ok(admin)
    for (const letter of ['A', 'B']) {
      const [r] = await pool.query('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [`${suffix}-${letter}`, `安全测试仓${letter}`])
      created.warehouses.push(r.insertId)
    }
    const [a, b] = created.warehouses
    async function user(name, permissions, warehouseId) {
      const [role] = await pool.query('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)', [`${suffix}-${name}`, name])
      created.roles.push(role.insertId)
      if (permissions.length) await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [permissions.map(p => [role.insertId, p])])
      const password = crypto.randomBytes(18).toString('hex')
      const username = `${suffix}-${name}`
      const [r] = await pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)', [username, bcrypt.hashSync(password, 10), name, role.insertId, name])
      created.users.push(r.insertId)
      await pool.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)', [r.insertId, warehouseId])
      const token = (await login(http, username, password)).token
      assert.ok(token)
      return token
    }
    const permissions = [P.PRINT_PRINTER_VIEW, P.PRINT_PRINTER_MANAGE, P.PRINT_CLIENT_CONSUME, P.PRINT_JOB_VIEW, P.PRINT_JOB_CREATE, P.PRINT_JOB_RETRY]
    const manager = await user('manager', permissions, a)
    const consumer = await user('consumer', [P.PRINT_CLIENT_CONSUME, P.PRINT_JOB_VIEW], a)
    async function register(token, wh) {
      const clientId = `desktop:${crypto.randomUUID()}`
      const result = await http.post('/api/printers/clients/register', { token, json: { clientId, hostname: 'virtual-only', warehouseId: wh } })
      expect(result, 201); created.clients.push(clientId)
      const client = data(result)
      assert.match(client.credential, /^[a-f0-9]{64}$/)
      return { ...client, headers: { 'X-Client-Id': clientId, 'X-Print-Client-Credential': client.credential } }
    }
    const ca = await register(manager, a)
    const cb = await register(admin, b)
    const impersonator = await register(manager, a)
    async function printer(token, wh, client, name = '同名虚拟机') {
      const r = await http.post('/api/printers', { token, json: { name, code: `${suffix}-${created.printers.length}`, type: 1, warehouseId: wh, clientId: client?.clientId } })
      expect(r, 201); created.printers.push(data(r).id); return data(r)
    }
    const pa = await printer(manager, a, ca)
    const pb = await printer(admin, b, cb)
    const pg = await printer(admin, null, null)
    await check('消费权限不能注册，不能覆盖另一工作站凭据或注册跨仓/全局设备', async () => {
      expect(await http.post('/api/printers/clients/register', { token: consumer, json: { clientId: `desktop:${crypto.randomUUID()}`, hostname: 'X', warehouseId: a } }), 403)
      expect(await http.post('/api/printers/clients/register', { token: manager, json: { clientId: ca.clientId, hostname: 'X', warehouseId: a } }), 409)
      for (const wh of [b, null]) expect(await http.post('/api/printers/clients/register', { token: manager, json: { clientId: `desktop:${crypto.randomUUID()}`, hostname: 'X', warehouseId: wh } }), 403)
    })
    await check('数据库仅保存凭据哈希，列表和详情不回传凭据', async () => {
      const [[row]] = await pool.query('SELECT credential_hash FROM print_clients WHERE client_id=?', [ca.clientId])
      assert.notEqual(row.credential_hash, ca.credential)
      const list = await http.get('/api/printers/all-clients', { token: manager }); expect(list, 200)
      assert.ok(data(list).some(c => c.clientId === ca.clientId))
      assert.ok(!data(list).some(c => c.clientId === cb.clientId))
      assert.ok(!JSON.stringify(list.data).includes(ca.credential))
      assert.ok(!JSON.stringify(list.data).includes('credential_hash'))
    })
    await check('限仓打印机列表、创建、迁移、详情、删除、绑定完整拒绝外仓及全局', async () => {
      const list = await http.get('/api/printers', { token: manager }); expect(list, 200)
      assert.ok(data(list).some(p => p.id === pa.id))
      assert.ok(!data(list).some(p => [pb.id, pg.id].includes(p.id)))
      for (const id of [pb.id, pg.id]) {
        expect(await http.get(`/api/printers/${id}`, { token: manager }), 403)
        expect(await http.put(`/api/printers/${id}`, { token: manager, json: { status: 0 } }), 403)
        expect(await http.delete(`/api/printers/${id}`, { token: manager }), 403)
        expect(await http.put('/api/printer-bindings/product_label', { token: manager, json: { printerId: id, warehouseId: a } }), 403)
      }
      for (const warehouseId of [b, null]) {
        expect(await http.put(`/api/printers/${pa.id}`, { token: manager, json: { warehouseId } }), 403)
        expect(await http.post('/api/printers', { token: manager, json: { name: 'X', code: `${suffix}-DENIED`, type: 1, warehouseId } }), 403)
      }
    })
    await check('未认证心跳和公开ID领取拒绝；认证心跳不会按同名抢占外仓打印机', async () => {
      expect(await http.post('/api/printers/client-heartbeat', { token: consumer, json: { clientId: ca.clientId, hostname: 'X', printers: [pb.name] } }), 401)
      expect(await http.post('/api/print-jobs/claim-client', { token: consumer, headers: { 'X-Client-Id': ca.clientId }, json: { clientId: ca.clientId } }), 401)
      expect(await http.post('/api/printers/client-heartbeat', { token: consumer, headers: ca.headers, json: { hostname: 'X', printers: [pb.name] } }), 200)
      const [[row]] = await pool.query('SELECT client_id FROM printers WHERE id=?', [pb.id]); assert.equal(row.client_id, cb.clientId)
    })
    async function job(printerId, warehouseId) {
      const r = await http.post('/api/print-jobs', { token: admin, json: { printerId, warehouseId, title: 'virtual test', contentType: 'zpl', content: '^XA^FDTEST^FS^XZ' } })
      expect(r, 201); return data(r)
    }
    const ja = await job(pa.id, a)
    const jb = await job(pb.id, b)
    await check('本机完成不能绕过领取；知道工作站ID或printer code也不能完成', async () => {
      expect(await http.post(`/api/print-jobs/${ja.id}/complete-local`, { token: consumer, headers: ca.headers, json: {} }), 403)
      for (const headers of [{ 'X-Client-Id': ca.clientId }, { 'X-Printer-Code': pa.code }]) expect(await http.post(`/api/print-jobs/${ja.id}/complete-client`, { token: consumer, headers, json: { ackToken: 'public' } }), 401)
    })
    let claimed
    await check('合法工作站只领取自身任务并保留scope，不能伪造body的其他clientId', async () => {
      const none = await http.post('/api/print-jobs/claim-client', { token: consumer, headers: impersonator.headers, json: { clientId: ca.clientId, limit: 10 } }); expect(none, 200); assert.deepEqual(data(none), [])
      const claim = await http.post('/api/print-jobs/claim-client', { token: consumer, headers: ca.headers, json: { limit: 10 } }); expect(claim, 200)
      claimed = data(claim).find(j => j.id === ja.id); assert.ok(claimed?.ackToken)
      assert.ok(!data(claim).some(j => j.id === jb.id))
      expect(await http.post('/api/print-jobs/claim-client', { token: consumer, headers: cb.headers, json: { limit: 10 } }), 403)
    })
    await check('ack绑定工作站；合法本机claim+ack可核销；错误及重复令牌均拒绝', async () => {
      expect(await http.post(`/api/print-jobs/${ja.id}/complete-client`, { token: consumer, headers: impersonator.headers, json: { ackToken: claimed.ackToken } }), 403)
      expect(await http.post(`/api/print-jobs/${ja.id}/complete-local`, { token: consumer, headers: ca.headers, json: { ackToken: 'wrong' } }), 409)
      expect(await http.post(`/api/print-jobs/${ja.id}/complete-local`, { token: consumer, headers: ca.headers, json: { ackToken: claimed.ackToken } }), 200)
      expect(await http.post(`/api/print-jobs/${ja.id}/complete-client`, { token: consumer, headers: ca.headers, json: { ackToken: claimed.ackToken } }), 409)
    })
    await check('失败、重试和新令牌保持已有队列语义，旧令牌不能覆盖新领取', async () => {
      const j = await job(pa.id, a)
      const claim = async () => data(await http.post('/api/print-jobs/claim-client', { token: consumer, headers: ca.headers, json: { limit: 10 } })).find(x => x.id === j.id)
      const first = await claim()
      expect(await http.post(`/api/print-jobs/${j.id}/fail-client`, { token: consumer, headers: ca.headers, json: { ackToken: first.ackToken, errorMessage: 'virtual failure' } }), 200)
      expect(await http.post(`/api/print-jobs/${j.id}/retry`, { token: manager, json: {} }), 200)
      const second = await claim(); assert.notEqual(first.ackToken, second.ackToken)
      expect(await http.post(`/api/print-jobs/${j.id}/complete-client`, { token: consumer, headers: ca.headers, json: { ackToken: first.ackToken } }), 409)
      expect(await http.post(`/api/print-jobs/${j.id}/complete-client`, { token: consumer, headers: ca.headers, json: { ackToken: second.ackToken } }), 200)
    })
    await check('统计、健康、客户端管理只作用于本仓，未知global fail-closed', async () => {
      const r = await http.get('/api/print-jobs/stats', { token: consumer }); expect(r, 200)
      const [[counts]] = await pool.query('SELECT SUM(status=0) AS pending,SUM(status=3) AS failed FROM print_jobs WHERE warehouse_id=?', [a])
      assert.deepEqual(data(r), { pending: Number(counts.pending), failed: Number(counts.failed) })
      await pool.query('INSERT INTO printer_health_stats (printer_id,error_rate,avg_latency_ms,sample_count) VALUES (?,0,1,1),(?,0,1,1),(?,0,1,1) ON DUPLICATE KEY UPDATE error_rate=0,avg_latency_ms=1,sample_count=1', [pa.id, pb.id, pg.id])
      const health = await http.get('/api/print-jobs/printer-health', { token: consumer }); expect(health, 200)
      assert.ok(data(health).some(h => h.printerId === pa.id)); assert.ok(!data(health).some(h => [pb.id, pg.id].includes(h.printerId)))
      expect(await http.put(`/api/printers/clients/${cb.clientId}/alias`, { token: manager, json: { aliasName: 'X' } }), 403)
      expect(await http.post(`/api/printers/clients/${cb.clientId}/revoke`, { token: manager, json: {} }), 403)
    })
    await check('撤销立即阻止heartbeat/claim和已领任务完成', async () => {
      const j = await job(pa.id, a)
      const claim = await http.post('/api/print-jobs/claim-client', { token: consumer, headers: ca.headers, json: { limit: 10 } }); expect(claim, 200)
      const ack = data(claim).find(x => x.id === j.id).ackToken
      expect(await http.post(`/api/printers/clients/${ca.clientId}/revoke`, { token: manager, json: {} }), 200)
      expect(await http.post('/api/printers/client-heartbeat', { token: consumer, headers: ca.headers, json: { hostname: 'X' } }), 401)
      expect(await http.post('/api/print-jobs/claim-client', { token: consumer, headers: ca.headers, json: {} }), 401)
      expect(await http.post(`/api/print-jobs/${j.id}/complete-client`, { token: consumer, headers: ca.headers, json: { ackToken: ack } }), 401)
      const [[row]] = await pool.query('SELECT status FROM print_jobs WHERE id=?', [j.id]); assert.equal(row.status, 1)
    })
    await check('单据模板写入schema拒绝超界结构', async () => {
      const el = { id: 'x', type: 'text', fieldKey: 'name', label: '', x: 0, y: 0, width: 100, height: 10, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false }
      for (const layout of [{ elements: Array(129).fill(el) }, { elements: [{ ...el, type: 'table', tableColumns: Array(11).fill('name') }] }, { elements: [{ ...el, x: Infinity }] }]) expect(await http.post('/api/print-templates', { token: admin, json: { name: 'bad', type: 1, layout } }), 400)
      const r = await http.post('/api/print-templates', { token: admin, json: { name: `${suffix}-valid`, type: 1, layout: { elements: [el] } } }); expect(r, 201); created.templates.push(data(r).id)
    })
    console.log(`[SECURITY-PRINT] ${checks} scenarios passed; virtual HTTP receipts do not prove physical paper output`)
  } finally {
    if (created.printers.length) {
      await pool.query('DELETE FROM print_jobs WHERE printer_id IN (?)', [created.printers])
      await pool.query('DELETE FROM printer_bindings WHERE printer_id IN (?)', [created.printers])
      await pool.query('DELETE FROM printer_health_stats WHERE printer_id IN (?)', [created.printers])
      await pool.query('DELETE FROM printers WHERE id IN (?)', [created.printers])
    }
    if (created.clients.length) await pool.query('DELETE FROM print_clients WHERE client_id IN (?)', [created.clients])
    if (created.templates.length) await pool.query('DELETE FROM print_templates WHERE id IN (?)', [created.templates])
    if (created.users.length) {
      await pool.query('DELETE FROM refresh_token_sessions WHERE user_id IN (?)', [created.users])
      await pool.query('DELETE FROM auth_session_families WHERE user_id IN (?)', [created.users])
      await pool.query('DELETE FROM user_warehouse_scope WHERE user_id IN (?)', [created.users])
      await pool.query('DELETE FROM sys_users WHERE id IN (?)', [created.users])
    }
    if (created.roles.length) { await pool.query('DELETE FROM sys_role_permissions WHERE role_id IN (?)', [created.roles]); await pool.query('DELETE FROM sys_roles WHERE id IN (?)', [created.roles]) }
    if (created.warehouses.length) await pool.query('DELETE FROM inventory_warehouses WHERE id IN (?)', [created.warehouses])
    await ctx.close(); await appPool.end()
  }
}
main().catch(e => { console.error('[SECURITY-PRINT] failure:', e.message); process.exitCode = 1 })
