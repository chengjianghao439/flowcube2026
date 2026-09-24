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
const { pool } = require('../backend/src/config/db')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const { WT_STATUS } = require('../backend/src/constants/warehouseTaskStatus')
const { hashToken } = require('../backend/src/modules/pda/pda.sessions.service')

async function main() {
  const mark = `SB${randomBytes(5).toString('hex')}`
  const owned = new Map()
  let server, actor, reader, scoped
  const remember = (table, id) => {
    if (!owned.has(table)) owned.set(table, [])
    owned.get(table).push(Number(id))
    return Number(id)
  }
  const insert = async (table, row) => {
    const [result] = await pool.query(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row))
    return remember(table, result.insertId)
  }
  const row = async (table, id) => (await pool.query(`SELECT * FROM ${table} WHERE id=?`, [id]))[0][0]
  try {
    const [[target]] = await pool.query('SELECT DATABASE() AS db')
    assert.equal(target.db, process.env.DB_NAME)
    console.log('[sorting-bin-recovery] isolated target', { host: process.env.DB_HOST, port: process.env.DB_PORT, db: target.db })
    const [used] = await pool.query('SELECT id FROM sys_roles UNION SELECT role_id AS id FROM sys_users UNION SELECT role_id AS id FROM sys_role_permissions')
    const roles = Array.from({ length: 254 }, (_, i) => 255 - i).filter(id => !used.some(item => Number(item.id) === id)).slice(0, 3)
    assert.equal(roles.length, 3)
    for (const [index, id] of roles.entries()) {
      remember('sys_roles', id)
      await pool.query('INSERT INTO sys_roles (id,code,name,is_system) VALUES (?,?,?,0)', [id, `${mark}R${index}`, mark])
      const userId = await insert('sys_users', { username: `${mark}U${index}`, password: 'fixture-no-password-login', real_name: mark, role_id: id, role_name: mark })
      if (index === 0) actor = userId
      if (index === 1) reader = userId
      if (index === 2) scoped = userId
      const permissions = index === 1
        ? [PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.SORTING_BIN_VIEW]
        : [PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_ASSIGN, PERMISSIONS.WAREHOUSE_TASK_SORT, PERMISSIONS.SORTING_BIN_VIEW, PERMISSIONS.SORTING_BIN_MANAGE]
      for (const permission of permissions) await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [id, permission])
    }
    const whA = await insert('inventory_warehouses', { code: `${mark}A`, name: `${mark}A` })
    const whB = await insert('inventory_warehouses', { code: `${mark}B`, name: `${mark}B` })
    const pdaToken = `${mark}-pda-session`
    const device = await insert('pda_devices', { device_code: `${mark}PDA`, device_name: mark, warehouse_id: whA, secret_hash: 'fixture-not-used' })
    await insert('pda_device_sessions', { device_id: device, user_id: actor, session_token_hash: hashToken(pdaToken), scopes: JSON.stringify(['pda:sort']), warehouse_id: whA, expires_at: new Date(Date.now() + 600000) })
    await pool.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)', [scoped, whA])
    const makeTask = (suffix, warehouseId = whA, status = WT_STATUS.PICKING, extra = {}) => insert('warehouse_tasks', {
      task_no: `${mark}${suffix}`, warehouse_id: warehouseId, warehouse_name: `${mark}${warehouseId}`, customer_name: mark, status, ...extra,
    })
    const bin1 = await insert('sorting_bins', { code: `${mark}B1`, warehouse_id: whA })
    const bin2 = await insert('sorting_bins', { code: `${mark}B2`, warehouse_id: whA })
    const task1 = await makeTask('T1')
    const task2 = await makeTask('T2', whA, WT_STATUS.SORTING)
    const checking = await makeTask('TC', whA, WT_STATUS.CHECKING)
    const cancelling = await makeTask('TX', whA, WT_STATUS.PICKING, { cancel_requested_at: new Date() })
    const adjusting = await makeTask('TA', whA, WT_STATUS.SORTING, { adjustment_requested_at: new Date() })
    const returnTask = await makeTask('TR', whA, WT_STATUS.PICKING, { task_type: 'purchase_return' })
    const otherWarehouseTask = await makeTask('TB', whB)
    const alreadyBound = await makeTask('TD', whA, WT_STATUS.PICKING, { sorting_bin_id: bin2, sorting_bin_code: `${mark}B2` })
    await pool.query('UPDATE sorting_bins SET status=2,current_task_id=? WHERE id=?', [alreadyBound, bin2])

    const app = express()
    app.use(express.json())
    app.use('/api/warehouse-tasks', require('../backend/src/modules/warehouse-tasks/warehouse-tasks.routes'))
    app.use('/api/sorting-bins', require('../backend/src/modules/sorting-bins/sorting-bins.routes'))
    app.use(require('../backend/src/middleware/errorHandler'))
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const request = async (path, { method = 'GET', userId = actor, key, body, extraHeaders = {} } = {}) => {
      const headers = { 'Content-Type': 'application/json' }
      if (userId) headers.Authorization = `Bearer ${jwt.sign({ userId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' })}`
      if (key) headers['X-Request-Key'] = key
      Object.assign(headers, extraHeaders)
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
      return { status: response.status, payload: await response.json() }
    }
    const assign = (taskId, key, userId = actor) => request(`/warehouse-tasks/${taskId}/assign-sorting-bin`, { method: 'POST', key, userId, body: {} })
    const pendingPath = `/warehouse-tasks/sorting-bin-pending?warehouseId=${whA}`
    const pending = await request(pendingPath)
    console.log('[sorting-bin-recovery] initial pending HTTP', pending.status)
    assert.equal(pending.status, 200, 'supervisor can list tasks awaiting a sorting bin')
    assert.deepEqual(pending.payload.data.list.map(item => item.id).sort((a, b) => a - b), [task1, task2].sort((a, b) => a - b))
    const bypass = await request(`/warehouse-tasks/${task2}/sort-done`, { method: 'PUT', key: `${mark}-sort-no-bin`, body: {}, extraHeaders: { 'X-Client': 'pda', 'X-PDA-Session': pdaToken } })
    assert.equal(bypass.status, 409, 'PDA HTTP cannot complete sorting without a bound bin')
    assert.match(bypass.payload.message || '', /分拣格|主管/, 'PDA receives an actionable no-bin error')
    assert.equal((await row('warehouse_tasks', task2)).status, WT_STATUS.SORTING)
    const scopedOtherWarehouse = await request(`/warehouse-tasks/sorting-bin-pending?warehouseId=${whB}`, { userId: scoped })
    assert.deepEqual(scopedOtherWarehouse.payload.data.list, [], 'scoped supervisor cannot list other warehouse tasks')
    assert.equal((await request(pendingPath, { userId: reader })).status, 403, 'read-only user cannot list assignable tasks')
    assert.equal((await request(pendingPath, { userId: null })).status, 401, 'anonymous cannot list assignable tasks')
    assert.equal((await assign(task1, `${mark}-reader`, reader)).status, 403, 'read-only user cannot assign')
    assert.equal((await assign(otherWarehouseTask, `${mark}-scope`, scoped)).status, 403, 'warehouse scope protects target task')
    assert.equal((await assign(task1, null)).status, 400, 'stable request key required')
    for (const taskId of [checking, cancelling, adjusting, returnTask, alreadyBound]) {
      assert.equal((await assign(taskId, `${mark}-invalid-${taskId}`)).status, 409, `ineligible task ${taskId} rejected`)
    }
    const first = await assign(task1, `${mark}-first`)
    assert.equal(first.status, 200, 'available bin assigned')
    assert.deepEqual(first.payload.data, { taskId: task1, binId: bin1, binCode: `${mark}B1` })
    assert.equal((await row('warehouse_tasks', task1)).sorting_bin_id, bin1)
    assert.deepEqual([(await row('sorting_bins', bin1)).status, (await row('sorting_bins', bin1)).current_task_id], [2, task1])
    const replay = await assign(task1, `${mark}-first`)
    assert.equal(replay.status, 200, 'same request key replays success')
    assert.deepEqual(replay.payload.data, first.payload.data)
    const [[{ events }]] = await pool.query("SELECT COUNT(*) AS events FROM warehouse_task_events WHERE task_id=? AND event_type='SORTING_BIN_ASSIGNED'", [task1])
    assert.equal(Number(events), 1, 'replay does not duplicate task event')
    assert.equal((await assign(task2, `${mark}-none`)).status, 409, 'no free bin returns controlled conflict')

    const release = await request(`/sorting-bins/${bin1}/release`, { method: 'POST', body: {} })
    assert.equal(release.status, 200, 'supervisor can release an assigned bin')
    assert.deepEqual([(await row('warehouse_tasks', task1)).sorting_bin_id, (await row('warehouse_tasks', task1)).sorting_bin_code], [null, null])
    assert.deepEqual([(await row('sorting_bins', bin1)).status, (await row('sorting_bins', bin1)).current_task_id], [1, null])

    const differentTaskSameKey = await assign(task2, `${mark}-first`)
    assert.equal(differentTaskSameKey.status, 200, 'same key on a different task is a distinct operation')
    assert.equal(differentTaskSameKey.payload.data.taskId, task2)
    await request(`/sorting-bins/${bin1}/release`, { method: 'POST', body: {} })

    const competing = await Promise.all([assign(task1, `${mark}-race-1`), assign(task2, `${mark}-race-2`)])
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409], 'one free bin cannot be assigned twice')
    const bound = (await pool.query('SELECT id,sorting_bin_id FROM warehouse_tasks WHERE id IN (?) AND sorting_bin_id IS NOT NULL', [[task1, task2]]))[0]
    assert.equal(bound.length, 1)
    assert.equal(Number(bound[0].sorting_bin_id), bin1)
    assert.equal(Number((await row('sorting_bins', bin1)).current_task_id), Number(bound[0].id), 'bidirectional binding remains consistent after race')
    console.log('[sorting-bin-recovery] PASS permissions, scope, states, replay, release, and real HTTP contention')
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    try {
      const ids = table => owned.get(table) || []
      if (ids('warehouse_tasks').length) {
        await pool.query('DELETE FROM warehouse_task_events WHERE task_id IN (?)', [ids('warehouse_tasks')])
        await pool.query('DELETE FROM operation_requests WHERE resource_type=? AND resource_id IN (?)', ['warehouse_task', ids('warehouse_tasks')])
      }
      if (ids('sys_users').length) {
        await pool.query('DELETE FROM auth_audit_logs WHERE user_id IN (?)', [ids('sys_users')])
        await pool.query('DELETE FROM user_warehouse_scope WHERE user_id IN (?)', [ids('sys_users')])
      }
      if (ids('pda_device_sessions').length) await pool.query('DELETE FROM pda_device_sessions WHERE id IN (?)', [ids('pda_device_sessions')])
      if (ids('sys_roles').length) await pool.query('DELETE FROM sys_role_permissions WHERE role_id IN (?)', [ids('sys_roles')])
      for (const table of ['warehouse_tasks', 'sorting_bins', 'pda_devices', 'inventory_warehouses', 'sys_users', 'sys_roles']) {
        for (const id of ids(table)) await pool.query(`DELETE FROM ${table} WHERE id=?`, [id])
        if (ids(table).length) {
          const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM ${table} WHERE id IN (?)`, [ids(table)])
          assert.equal(Number(count), 0, `cleanup ${table}`)
        }
      }
      console.log('[sorting-bin-recovery] cleanup verified: only owned fixture IDs removed')
    } finally { await pool.end() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
