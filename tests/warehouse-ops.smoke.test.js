#!/usr/bin/env node
'use strict'

// 独立回环测试库；仅删除本次 ID/唯一标记，不 DROP 运行时日志表。
const assert = require('node:assert/strict')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const { createLogger } = require('./helpers/smokeTestKit')
const reports = require('../backend/src/modules/reports/reports.service')
const scans = require('../backend/src/modules/scan-logs/scan-logs.service')
const logger = require('../backend/src/utils/logger')
const { beijingTodayYmd } = require('../backend/src/utils/backendTime')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const { WT_STATUS, WT_STATUS_NAME, WT_STATUS_ACTIVE } = require('../backend/src/constants/warehouseTaskStatus')
const { getStatusRule } = require('../backend/src/constants/documentStatusRules')
const express = require('../backend/node_modules/express')
const jwt = require('../backend/node_modules/jsonwebtoken')

async function main() {
  const log = createLogger()
  const mark = `WOPS${Date.now().toString(36)}`
  const warehouses = [], tasks = [], inbound = [], users = [], roles = []
  const warnings = []
  const originalWarn = logger.warn
  logger.warn = (message, meta, moduleName) => {
    warnings.push({ message, meta })
    originalWarn(message, meta, moduleName)
  }
  let server
  try {
    const [[target]] = await pool.query('SELECT DATABASE() AS db, @@session.time_zone AS timezone')
    console.log('[warehouse-ops] target', { host: process.env.DB_HOST, port: process.env.DB_PORT, ...target })
    const [existing] = await pool.query("SHOW TABLES LIKE 'pda_%_logs'")
    console.log('[warehouse-ops] 日志表初始化前', existing)
    for (let i = 0; i < 2; i++) {
      const [r] = await pool.query('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [`${mark}${i}`, mark])
      warehouses.push(r.insertId)
    }
    const [takenRoles] = await pool.query('SELECT id FROM sys_roles UNION SELECT role_id AS id FROM sys_users UNION SELECT role_id AS id FROM sys_role_permissions')
    const available = Array.from({ length: 254 }, (_, i) => i + 2).filter(id => !takenRoles.some(r => Number(r.id) === id))
    assert.ok(available.length >= 2, '测试需要两个未使用的合法角色 ID')
    for (const [index, id] of available.slice(0, 2).entries()) {
      await pool.query('INSERT INTO sys_roles (id,code,name,is_system) VALUES (?,?,?,0)', [id, `${mark}${index}`, mark])
      roles.push(id)
      const [r] = await pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name) VALUES (?,?,?,?,?)',
        [`${mark}${index}`, 'test-only-no-password-login', mark, id, mark])
      users.push(r.insertId)
      await pool.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)', [r.insertId, warehouses[0]])
    }
    await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [roles[0], PERMISSIONS.REPORT_VIEW])
    const today = beijingTodayYmd()
    const [[dates]] = await pool.query('SELECT DATE_FORMAT(DATE_SUB(?, INTERVAL 1 DAY), "%Y-%m-%d") AS yesterday, DATE_FORMAT(DATE_ADD(?, INTERVAL 1 DAY), "%Y-%m-%d") AS tomorrow', [today, today])
    const addTask = async (warehouse, day, status = WT_STATUS.SHIPPED, shippedDay = day, deleted = false) => {
      const [r] = await pool.query('INSERT INTO warehouse_tasks (task_no,customer_name,warehouse_id,warehouse_name,status,updated_at,shipped_at,deleted_at) VALUES (?,?,?,?,?,?,?,?)',
        [`${mark}T${tasks.length}`, mark, warehouse, mark, status, `${day} 12:00:00`, status === WT_STATUS.SHIPPED && shippedDay ? `${shippedDay} 12:00:00` : null, deleted ? `${today} 12:00:00` : null])
      tasks.push(r.insertId)
      return r.insertId
    }
    const a = await addTask(warehouses[0], today)
    const b = await addTask(warehouses[1], today)
    await addTask(warehouses[0], dates.yesterday)
    await addTask(warehouses[0], dates.tomorrow)
    // 各真实阶段放不同数量，避免旧数字恰好与单个夹具数相同而误通过。
    for (const [index, status] of WT_STATUS_ACTIVE.entries()) {
      for (let n = 0; n <= index; n++) await addTask(warehouses[0], today, status)
      await addTask(warehouses[1], today, status)
    }
    await addTask(warehouses[0], today, WT_STATUS.CANCELLED)
    await addTask(warehouses[0], today, WT_STATUS.PICKING, null, true)
    await addTask(warehouses[0], today, WT_STATUS.SHIPPED, today, true)
    await addTask(warehouses[0], today, WT_STATUS.SHIPPED, dates.yesterday)
    await addTask(warehouses[0], dates.yesterday, WT_STATUS.SHIPPED, today)
    await addTask(warehouses[0], today, WT_STATUS.SHIPPED, null)
    const inboundStates = [getStatusRule('inboundTask','receiveStart').from[0], getStatusRule('inboundTask','receiveStart').to,
      getStatusRule('inboundTask','receiveComplete').to, getStatusRule('inboundTask','finish').to, getStatusRule('inboundTask','cancel').to]
    const addInbound = async (warehouse, day, status, deleted = false) => {
      const [r] = await pool.query('INSERT INTO inbound_tasks (task_no,warehouse_id,status,updated_at,deleted_at) VALUES (?,?,?,?,?)',
        [`${mark}I${inbound.length}`, warehouse, status, `${day} 12:00:00`, deleted ? `${today} 12:00:00` : null])
      inbound.push(r.insertId)
    }
    for (const status of inboundStates) {
      for (let n = 0; n < (status === getStatusRule('inboundTask','finish').to ? 1 : status); n++) await addInbound(warehouses[0], today, status)
    }
    for (const day of [dates.yesterday, dates.tomorrow]) await addInbound(warehouses[0], day, getStatusRule('inboundTask','finish').to)
    await addInbound(warehouses[1], today, getStatusRule('inboundTask','finish').to)
    await addInbound(warehouses[0], today, getStatusRule('inboundTask','finish').to, true)
    // 使用产品既有服务建表并记录首条真实日志；保留建表状态供下次回归复用。
    await scans.logScanError({ taskId: a, barcode: mark, reason: mark, operatorId: users[0], operatorName: mark })
    await scans.logUndo({ taskId: a, itemId: 1, barcode: mark, prevQty: 2, newQty: 1, operatorId: users[0], operatorName: mark })
    const [[firstError]] = await pool.query('SELECT COUNT(*) AS n FROM pda_error_logs WHERE barcode=?', [mark])
    const [[firstUndo]] = await pool.query('SELECT COUNT(*) AS n FROM pda_undo_logs WHERE barcode=?', [mark])
    log.assert('既有服务按需建表并成功写入错误及撤销日志', Number(firstError.n) === 1 && Number(firstUndo.n) === 1)
    // 固定日期字段，覆盖北京时间 00:00:00 / 23:59:59 及相邻日。
    await pool.query('UPDATE pda_error_logs SET created_at=? WHERE barcode=?', [`${today} 00:00:00`, mark])
    await pool.query('UPDATE pda_undo_logs SET created_at=? WHERE barcode=?', [`${today} 00:00:00`, mark])
    const addError = async (task, at) => pool.query('INSERT INTO pda_error_logs (task_id,barcode,reason,operator_id,operator_name,created_at) VALUES (?,?,?,?,?,?)',
      [task, mark, mark, users[0], mark, at])
    for (let i = 0; i < 10; i++) await addError(a, `${today} 12:00:00`)
    await addError(a, `${today} 23:59:59`)
    await addError(a, `${dates.yesterday} 23:59:59`)
    await addError(a, `${dates.tomorrow} 00:00:00`)
    await addError(b, `${today} 12:00:00`)
    await addError(b, `${today} 12:00:00`)
    await addError(null, `${today} 12:00:00`)
    await addError(2147483647, `${today} 12:00:00`)
    for (const [task, at] of [[a, `${today} 23:59:59`], [a, `${dates.yesterday} 23:59:59`], [a, `${dates.tomorrow} 00:00:00`], [b, `${today} 12:00:00`], [null, `${today} 12:00:00`]]) {
      await pool.query('INSERT INTO pda_undo_logs (task_id,barcode,operator_id,operator_name,created_at) VALUES (?,?,?,?,?)', [task, mark, users[0], mark, at])
    }
    for (const [task, at, qty] of [[a, `${today} 00:00:00`, 2], [a, `${today} 23:59:59`, 3], [a, `${dates.yesterday} 23:59:59`, 100], [a, `${dates.tomorrow} 00:00:00`, 100], [b, `${today} 12:00:00`, 7]]) {
      await pool.query('INSERT INTO scan_logs (task_id,item_id,container_id,barcode,product_id,qty,scan_mode,operator_id,operator_name,scanned_at) VALUES (?,1,1,?,1,?,"整件",?,?,?)', [task, mark, qty, users[0], mark, at])
    }
    const data = await reports.warehouseOps([warehouses[0]])
    log.assert('已出库按真实出库日计数，NULL兼容更新时间，排除待打包/取消/删除/其他仓', data.summary.shippedToday === 3, JSON.stringify(data.summary))
    log.assert('拣货中只计PICKING，排除分拣/复核/打包/待出库/删除', data.summary.pickingNow === 2)
    log.assert('今日入库只计全部上架完成状态，排除收货中/待上架/取消/删除/其他仓', data.summary.inboundToday === 1)
    log.assert('流程积压按现行六个活动状态及名称输出、各阶段精确计数、排除终态', JSON.stringify(data.flowBottleneck) === JSON.stringify(WT_STATUS_ACTIVE.map((status,index) => ({ status, label: WT_STATUS_NAME[status], count: index + 1 }))))
    log.assert('扫码次数/数量按授权仓和北京时间整日统计', data.summary.scanCount === 2 && data.summary.pickQty === 5)
    log.assert('errSummary 四项补证：授权仓今日错误数为 12', data.summary.errorCount === 12, `actual=${data.summary.errorCount}`)
    log.assert('undoSummary 四项补证：授权仓今日撤销数为 2', data.summary.undoCount === 2, `actual=${data.summary.undoCount}`)
    log.assert('errByOp 四项补证：同操作员跨仓错误不串入', data.operators.length === 1 && data.operators[0].errorCount === 12 && data.operators[0].errorRate === '600.0%')
    const [expectedRecent] = await pool.query('SELECT id FROM pda_error_logs WHERE task_id=? AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY) ORDER BY created_at DESC,id DESC LIMIT 10', [a, today, today])
    log.assert('recentErrors 四项补证：仅授权仓今日最近 10 条，时间相同时 ID 稳定排序', JSON.stringify(data.recentErrors.map(r => r.id)) === JSON.stringify(expectedRecent.map(r => r.id)))
    const both = await reports.warehouseOps(warehouses)
    log.assert('多仓授权的错误/撤销/扫码汇总合并且排除无归属日志', both.summary.errorCount === 14 && both.summary.undoCount === 3 && both.summary.scanCount === 3 && both.summary.pickQty === 12)
    const full = await reports.warehouseOps(null)
    const [[expectedFull]] = await pool.query('SELECT (SELECT COUNT(*) FROM pda_error_logs WHERE created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)) AS errors,(SELECT COUNT(*) FROM pda_undo_logs WHERE created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)) AS undos', [today,today,today,today])
    log.assert('不限仓保持完整日志可见（含无任务归属）', full.summary.errorCount === Number(expectedFull.errors) && full.summary.undoCount === Number(expectedFull.undos))
    const empty = await reports.warehouseOps([])
    log.assert('空仓库范围汇总/人员/异常均为空', Object.entries(empty.summary).every(([key, value]) => key === 'errorRate' ? value === '0%' : value === 0) && empty.operators.length === 0 && empty.recentErrors.length === 0 && empty.flowBottleneck.every(r => r.count === 0) && empty.hourlyTrend.every(r => r.count === 0))
    log.assert('已初始化四项及空范围查询无 SQL 降级', warnings.length === 0, JSON.stringify(warnings.map(r => r.meta?.metricName)))

    const range = { startDate: today, endDate: today, scopeWarehouseIds: [warehouses[0]] }
    const stat = await scans.getStats(range)
    log.assert('PDA 统计同日包含结束日白天/深夜且错误按同仓过滤', stat.length === 1 && stat[0].scanCount === 2 && stat[0].totalQty === 5 && stat[0].errorCount === 12)
    const anomaly = await scans.getAnomalyReport(range)
    log.assert('PDA 异常汇总同日非零且按授权仓过滤', anomaly.summary.totalScans === 2 && anomaly.summary.totalErrors === 12 && anomaly.summary.totalUndos === 2)
    log.assert('PDA 异常各分组与汇总同范围', anomaly.byOperator.length === 1 && anomaly.byOperator[0].errorCount === 12 && anomaly.byReason[0]?.count === 12 && anomaly.byBarcode[0]?.count === 12 && anomaly.undoByOperator[0]?.undoCount === 2 && anomaly.dailyTrend.length === 1 && anomaly.dailyTrend[0].errorCount === 12)
    const allDates = await scans.getAnomalyReport({ scopeWarehouseIds: [warehouses[0]] })
    log.assert('PDA 无日期筛选保留历史但仍按授权仓过滤', allDates.summary.totalErrors === 14 && allDates.summary.totalUndos === 4 && allDates.summary.totalScans === 4)
    for (const boundary of [{ startDate: today }, { endDate: today }]) {
      const one = await scans.getAnomalyReport({ ...boundary, scopeWarehouseIds: [warehouses[0]] })
      const oneStat = await scans.getStats({ ...boundary, scopeWarehouseIds: [warehouses[0]] })
      log.assert(`PDA 单侧日期筛选生效 ${Object.keys(boundary)[0]}`, one.summary.totalErrors === 13 && one.summary.totalUndos === 3 && one.summary.totalScans === 3 && oneStat[0]?.scanCount === 3 && oneStat[0]?.errorCount === 13)
    }
    const emptyAnomaly = await scans.getAnomalyReport({ ...range, scopeWarehouseIds: [] })
    log.assert('PDA 空仓库范围全部汇总分组为空', emptyAnomaly.summary.totalErrors === 0 && emptyAnomaly.summary.totalUndos === 0 && emptyAnomaly.summary.totalScans === 0 && ['byOperator','byReason','byBarcode','undoByOperator','dailyTrend'].every(k => emptyAnomaly[k].length === 0) && (await scans.getStats({ ...range, scopeWarehouseIds: [] })).length === 0)
    const multiAnomaly = await scans.getAnomalyReport({ ...range, scopeWarehouseIds: warehouses })
    log.assert('PDA 多仓合并仍排除无任务/不存在任务的日志', multiAnomaly.summary.totalErrors === 14 && multiAnomaly.summary.totalUndos === 3 && multiAnomaly.summary.totalScans === 3)
    const fullAnomaly = await scans.getAnomalyReport({ ...range, scopeWarehouseIds: null })
    log.assert('PDA 不限仓仍统计无任务/不存在任务的日志', fullAnomaly.summary.totalErrors === Number(expectedFull.errors) && fullAnomaly.summary.totalUndos === Number(expectedFull.undos))
    log.assert('扫码任务详情授权仓保留所有该任务记录', (await scans.findByTask(a, [warehouses[0]])).length === 4)
    for (const [task, scope, status] of [[b,[warehouses[0]],403],[a,[],403],[2147483647,[warehouses[0]],404]]) {
      let error
      try { await scans.findByTask(task, scope) } catch (e) { error = e }
      log.assert(`扫码任务详情越权/空范围/不存在受控拒绝 ${task}/${status}`, error?.statusCode === status)
    }
    log.assert('PDA 只读查询没有 SQL 降级', warnings.length === 0)

    // 挂载真实路由、JWT/当前用户/权限/仓库范围中间件，不启动业务调度器。
    const app = express()
    app.use('/api/scan-logs', require('../backend/src/modules/scan-logs/scan-logs.routes'))
    app.use('/api/reports', require('../backend/src/modules/reports/reports.routes'))
    app.use((error, req, res, next) => { void next; res.status(error.statusCode || 500).json({ code: error.code }) })
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const endpoint = `http://127.0.0.1:${server.address().port}/api/reports/warehouse-ops`
    const token = userId => jwt.sign({ userId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '2m' })
    const request = async (userId, url = endpoint) => {
      const response = await fetch(url, { headers: userId ? { Authorization: `Bearer ${token(userId)}` } : {} })
      return { status: response.status, body: await response.json() }
    }
    log.assert('真实 HTTP 无登录返回 401', (await request()).status === 401)
    log.assert('真实 HTTP 无报表权限返回 403', (await request(users[1])).status === 403)
    const allowed = await request(users[0])
    log.assert('真实 HTTP 从数据库用户范围传至报表四指标', allowed.status === 200 && allowed.body.data?.summary.errorCount === 12 && allowed.body.data?.summary.undoCount === 2 && allowed.body.data?.operators[0]?.errorCount === 12 && allowed.body.data?.recentErrors.every(r => r.taskId === a))
    await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [roles[0], PERMISSIONS.SCAN_LOG_VIEW])
    require('../backend/src/middleware/loadRolePermissions').clearRolePermissionsCache(roles[0])
    const scanUrl = endpoint.replace('/reports/warehouse-ops', '/scan-logs')
    for (const path of ['/stats','/anomaly',`/task/${a}`]) {
      log.assert(`真实 HTTP PDA 读取拒绝未登录 ${path}`, (await request(null, scanUrl + path)).status === 401)
      log.assert(`真实 HTTP PDA 读取拒绝无权限 ${path}`, (await request(users[1], scanUrl + path)).status === 403)
    }
    const httpStats = await request(users[0], `${scanUrl}/stats?startDate=${today}&endDate=${today}`)
    const httpAnomaly = await request(users[0], `${scanUrl}/anomaly?startDate=${today}&endDate=${today}`)
    log.assert('真实 HTTP PDA 日期和用户仓库范围传到服务', httpStats.body.data?.[0]?.errorCount === 12 && httpStats.body.data?.[0]?.scanCount === 2 && httpAnomaly.body.data?.summary.totalErrors === 12 && httpAnomaly.body.data?.summary.totalUndos === 2)
    log.assert('真实 HTTP PDA 任务详情允许同仓、拒绝跨仓', (await request(users[0], `${scanUrl}/task/${a}`)).status === 200 && (await request(users[0], `${scanUrl}/task/${b}`)).status === 403)

  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    logger.warn = originalWarn
    for (const table of ['scan_logs', 'pda_error_logs', 'pda_undo_logs']) {
      try { await pool.query(`DELETE FROM ${table} WHERE barcode=?`, [mark]) } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e }
    }
    if (inbound.length) await pool.query('DELETE FROM inbound_tasks WHERE id IN (?)', [inbound])
    if (tasks.length) await pool.query('DELETE FROM warehouse_tasks WHERE id IN (?)', [tasks])
    if (users.length) {
      await pool.query('DELETE FROM auth_audit_logs WHERE user_id IN (?)', [users])
      await pool.query('DELETE FROM user_warehouse_scope WHERE user_id IN (?)', [users])
      await pool.query('DELETE FROM sys_users WHERE id IN (?)', [users])
    }
    if (roles.length) {
      await pool.query('DELETE FROM sys_role_permissions WHERE role_id IN (?)', [roles])
      await pool.query('DELETE FROM sys_roles WHERE id IN (?)', [roles])
    }
    if (warehouses.length) await pool.query('DELETE FROM inventory_warehouses WHERE id IN (?)', [warehouses])
    await pool.end()
  }
  const { failed } = log.summary()
  if (failed) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
