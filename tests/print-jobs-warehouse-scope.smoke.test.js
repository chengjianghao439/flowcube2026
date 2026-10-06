#!/usr/bin/env node
'use strict'

/**
 * 回归测试：打印任务统计与打印机健康必须遵守仓库数据权限
 * （2026-09-26 一致性审查）
 *
 * 修复前的行为：
 *   打印任务列表 findAll 与详情 findById 都按 req.user.warehouseIds 过滤，
 *   但 getStatsCounts() 与 listPrinterHealth() 是**无参数**的——限仓用户打开打印中心，
 *   /stats 依然报出全公司的待打/失败任务数，/printer-health 列出全部仓库打印机的
 *   错误率与延迟。同一份数据、两个出口、两套口径：列表看不见的，统计照样看得见。
 *
 * 三段：
 *   §A 统计计数：限仓用户只算本仓增量、超管算全部增量（用增量断言，对测试库历史残留免疫）
 *   §B 统计与列表同口径：/stats 的 pending 必须等于 /api/print-jobs?status=pending 的 total，
 *      且列表里不得出现他仓任务——旧行为下 total（被过滤）与 pending（未过滤）必然对不上
 *   §C 打印机健康：限仓用户只看得到绑在本仓的打印机；他仓与「不限仓(NULL)」的都不出现
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/print-jobs-warehouse-scope.smoke.test.js
 */

const path = require('path')
const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
// 状态从常量取，不写字面量：0=待打、3=失败，写错断言就成了空转的假绿。
const { STATUS } = require('../backend/src/modules/print-jobs/print-jobs.status')

const SCOPE_PW = 'F5ScopePass1!'

async function createWarehouse(pool, suffix) {
  const [r] = await pool.query(
    'INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)',
    [`F5他仓-${suffix}`, `F5-WH2-${suffix}`],
  )
  return { id: Number(r.insertId), name: `F5他仓-${suffix}` }
}

async function createPrinter(pool, { code, name, warehouseId }) {
  await pool.query(
    'INSERT INTO printers (code, name, type, status, warehouse_id) VALUES (?, ?, 1, 1, ?)',
    [code, name, warehouseId ?? null],
  )
  const [[row]] = await pool.query('SELECT id FROM printers WHERE code=? LIMIT 1', [code])
  return { id: Number(row.id), code, name }
}

async function seedHealth(pool, printerId, { errorRate, latency, samples }) {
  await pool.query('DELETE FROM printer_health_stats WHERE printer_id=?', [printerId])
  await pool.query(
    `INSERT INTO printer_health_stats (printer_id, error_rate, avg_latency_ms, sample_count)
     VALUES (?, ?, ?, ?)`,
    [printerId, errorRate, latency, samples],
  )
}

/** 直接造打印任务：不设 job_unique_key，避开 uk_print_jobs_idem_scope_live（NULL 不参与唯一性）。 */
async function createJob(pool, { title, status, warehouseId, printerId, refCode }) {
  const [r] = await pool.query(
    `INSERT INTO print_jobs (title, content_type, content, status, warehouse_id, printer_id, ref_type, ref_code)
     VALUES (?, 'html', '<p>f5</p>', ?, ?, ?, 'f5_scope_test', ?)`,
    [title, status, warehouseId ?? null, printerId ?? null, refCode],
  )
  return Number(r.insertId)
}

/** 独立限仓用户：只授「打印查看」，只挂一个仓库——不复用 smoke_limited，避免污染共享夹具。 */
async function createScopedUser(pool, ctx, suffix, warehouseId) {
  const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
  const roleCode = `f5_scope_${suffix}`
  const [role] = await pool.query(
    "INSERT INTO sys_roles (name, code, remark, is_system) VALUES (?, ?, 'f5 warehouse scope fixture', 0)",
    [`F5限仓角色-${suffix}`, roleCode],
  )
  const roleId = Number(role.insertId)
  await pool.query(
    'INSERT INTO sys_role_permissions (role_id, permission) VALUES (?, ?)',
    [roleId, PERMISSIONS.PRINT_JOB_VIEW],
  )
  const username = `f5_scope_${suffix}`
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, 'F5限仓用户', ?, 'F5限仓', 1)`,
    [username, bcrypt.hashSync(SCOPE_PW, 10), roleId],
  )
  const [[u]] = await pool.query('SELECT id FROM sys_users WHERE username=? LIMIT 1', [username])
  const userId = Number(u.id)
  await pool.query(
    'INSERT INTO user_warehouse_scope (user_id, warehouse_id) VALUES (?, ?)',
    [userId, Number(warehouseId)],
  )
  const auth = await login(ctx.http, username, SCOPE_PW)
  if (!auth.token) throw new Error(`限仓用户登录失败：${username}`)
  return { userId, roleId, username, token: auth.token }
}

async function statsOf(ctx, token) {
  const r = await ctx.http.get('/api/print-jobs/stats', { token })
  if (!r.ok) throw new Error(`/stats 失败 HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`)
  return { pending: Number(r.data?.data?.pending), failed: Number(r.data?.data?.failed) }
}

async function healthOf(ctx, token) {
  const r = await ctx.http.get('/api/print-jobs/printer-health', { token })
  if (!r.ok) throw new Error(`/printer-health 失败 HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`)
  return Array.isArray(r.data?.data) ? r.data.data : []
}

async function listPendingOf(ctx, token) {
  const r = await ctx.http.get('/api/print-jobs?status=pending&pageSize=200', { token })
  if (!r.ok) throw new Error(`列表失败 HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`)
  return { list: r.data?.data?.list || [], total: Number(r.data?.data?.pagination?.total) }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { http, pool } = ctx
  const suffix = randomRef('f5').replace(/[^a-zA-Z0-9]/g, '').slice(-8)
  const cleanup = { jobIds: [], printerIds: [], warehouseIds: [], userIds: [], roleIds: [] }
  let step = 'init'

  try {
    const admin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    if (!admin.token) throw new Error('smoke_admin 登录失败')
    const homeWarehouseId = Number(ctx.warehouse.id)

    // ── 夹具：他仓、两台打印机（本仓 / 他仓）、只看得见本仓的限仓用户 ──
    step = 'fixtures'
    const scoped = await createScopedUser(pool, ctx, suffix, homeWarehouseId)
    cleanup.userIds.push(scoped.userId)
    cleanup.roleIds.push(scoped.roleId)

    const otherWarehouse = await createWarehouse(pool, suffix)
    cleanup.warehouseIds.push(otherWarehouse.id)

    const prnHome = await createPrinter(pool, {
      code: `F5-PRN-H-${suffix}`, name: `F5本仓打印机-${suffix}`, warehouseId: homeWarehouseId,
    })
    const prnOther = await createPrinter(pool, {
      code: `F5-PRN-O-${suffix}`, name: `F5他仓打印机-${suffix}`, warehouseId: otherWarehouse.id,
    })
    cleanup.printerIds.push(prnHome.id, prnOther.id)
    await seedHealth(pool, prnHome.id, { errorRate: 0.02, latency: 120, samples: 50 })
    await seedHealth(pool, prnOther.id, { errorRate: 0.5, latency: 900, samples: 50 })
    log.assert('前置：限仓用户就绪（仅打印查看权限、范围仅本仓）', !!scoped.token)

    // ── §A 统计计数：只算本仓 ──
    log.section('§A /stats 统计计数按仓库范围过滤')
    step = 'A:baseline'
    const baseScoped = await statsOf(ctx, scoped.token)
    const baseAdmin = await statsOf(ctx, admin.token)

    step = 'A:seed'
    const homeJobs = [
      await createJob(pool, { title: 'F5本仓待打1', status: STATUS.PENDING, warehouseId: homeWarehouseId, printerId: prnHome.id, refCode: `F5H-${suffix}-1` }),
      await createJob(pool, { title: 'F5本仓待打2', status: STATUS.PENDING, warehouseId: homeWarehouseId, printerId: prnHome.id, refCode: `F5H-${suffix}-2` }),
      await createJob(pool, { title: 'F5本仓失败1', status: STATUS.FAILED, warehouseId: homeWarehouseId, printerId: prnHome.id, refCode: `F5H-${suffix}-3` }),
    ]
    const otherJobs = [
      await createJob(pool, { title: 'F5他仓待打1', status: STATUS.PENDING, warehouseId: otherWarehouse.id, printerId: prnOther.id, refCode: `F5O-${suffix}-1` }),
      await createJob(pool, { title: 'F5他仓待打2', status: STATUS.PENDING, warehouseId: otherWarehouse.id, printerId: prnOther.id, refCode: `F5O-${suffix}-2` }),
      await createJob(pool, { title: 'F5他仓待打3', status: STATUS.PENDING, warehouseId: otherWarehouse.id, printerId: prnOther.id, refCode: `F5O-${suffix}-3` }),
      await createJob(pool, { title: 'F5他仓失败1', status: STATUS.FAILED, warehouseId: otherWarehouse.id, printerId: prnOther.id, refCode: `F5O-${suffix}-4` }),
    ]
    cleanup.jobIds.push(...homeJobs, ...otherJobs)

    step = 'A:assert'
    const scopedA = await statsOf(ctx, scoped.token)
    const adminA = await statsOf(ctx, admin.token)
    console.log(`[统计增量] 限仓 待打 ${baseScoped.pending}→${scopedA.pending} / 失败 ${baseScoped.failed}→${scopedA.failed}`
      + `　超管 待打 ${baseAdmin.pending}→${adminA.pending} / 失败 ${baseAdmin.failed}→${adminA.failed}`)

    log.assert(
      '★ 限仓用户的待打计数只增加本仓 2 笔（他仓 3 笔不得计入）',
      scopedA.pending - baseScoped.pending === 2,
      `增量 ${scopedA.pending - baseScoped.pending}（期望 2）`,
    )
    log.assert(
      '★ 限仓用户的失败计数只增加本仓 1 笔（他仓 1 笔不得计入）',
      scopedA.failed - baseScoped.failed === 1,
      `增量 ${scopedA.failed - baseScoped.failed}（期望 1）`,
    )
    log.assert(
      '★ 超管不受限仓影响：待打 +5、失败 +2（全部 7 笔都在计数里）',
      adminA.pending - baseAdmin.pending === 5 && adminA.failed - baseAdmin.failed === 2,
      `待打增量 ${adminA.pending - baseAdmin.pending}（期望 5）失败增量 ${adminA.failed - baseAdmin.failed}（期望 2）`,
    )

    // ── §B 统计与列表同口径 ──
    log.section('§B /stats 与 /api/print-jobs 列表同口径')
    step = 'B:list'
    const scopedList = await listPendingOf(ctx, scoped.token)
    const adminList = await listPendingOf(ctx, admin.token)
    const otherRefCodes = otherJobs.map((_, i) => `F5O-${suffix}-${i + 1}`)
    const leaked = scopedList.list.filter(j => otherRefCodes.includes(String(j.refCode)))
    console.log(`[列表] 限仓 total=${scopedList.total}（=stats 待打 ${scopedA.pending}）返回 ${scopedList.list.length} 条`
      + `　超管 total=${adminList.total}（=stats 待打 ${adminA.pending}）`)

    log.assert(
      '★ 限仓用户列表的 total 与 /stats 的待打数一致（旧行为：total 被过滤而 pending 没有）',
      scopedList.total === scopedA.pending,
      `total=${scopedList.total} stats.pending=${scopedA.pending}`,
    )
    log.assert(
      '★ 超管列表的 total 与 /stats 的待打数一致',
      adminList.total === adminA.pending,
      `total=${adminList.total} stats.pending=${adminA.pending}`,
    )
    log.assert(
      '★ 限仓用户列表里没有任何他仓任务',
      leaked.length === 0,
      leaked.length ? `泄漏 ${leaked.length} 条：${leaked.map(j => j.refCode).join('、')}` : '',
    )
    log.assert(
      '★ 限仓用户列表里每条任务的仓库都是本仓',
      scopedList.list.length > 0 && scopedList.list.every(j => Number(j.warehouseId) === homeWarehouseId),
      `仓库集合 ${[...new Set(scopedList.list.map(j => j.warehouseId))].join('、')}`,
    )
    log.assert(
      '★ 超管列表能看见本仓与他仓的任务（对照组，证明断言不是「谁都看不见」）',
      adminList.list.some(j => otherRefCodes.includes(String(j.refCode))),
      `超管返回 ${adminList.list.length} 条`,
    )

    // ── §C 打印机健康 ──
    log.section('§C /printer-health 按打印机绑仓过滤')
    step = 'C:health'
    const scopedHealth = await healthOf(ctx, scoped.token)
    const adminHealth = await healthOf(ctx, admin.token)
    const scopedIds = scopedHealth.map(h => Number(h.printerId))
    const adminIds = adminHealth.map(h => Number(h.printerId))
    console.log(`[打印机健康] 限仓 ${scopedHealth.length} 台 [${scopedIds.join(',')}]`
      + `　超管 ${adminHealth.length} 台 [${adminIds.join(',')}]`)

    log.assert(
      '★ 限仓用户能看到本仓打印机的健康数据',
      scopedIds.includes(prnHome.id),
      `限仓结果 [${scopedIds.join(',')}] 不含本仓打印机 #${prnHome.id}`,
    )
    log.assert(
      '★ 限仓用户看不到他仓打印机的错误率/延迟',
      !scopedIds.includes(prnOther.id),
      `限仓结果 [${scopedIds.join(',')}] 泄漏了他仓打印机 #${prnOther.id}`,
    )
    log.assert(
      '★ 超管能看到两台（对照组，证明他仓那台确实有数据、不是刚好查不到）',
      adminIds.includes(prnHome.id) && adminIds.includes(prnOther.id),
      `超管结果 [${adminIds.join(',')}]`,
    )
    // 不靠接口自证：把限仓返回的每一台拿去库里验仓库归属。残留数据里若有绑着已删打印机
    // 或 NULL 仓的 health 行，这里会直接暴露（NULL 仓只应属于不限仓用户）。
    const scopedPrinterRows = await dbQuery(
      pool,
      `SELECT id, warehouse_id FROM printers WHERE id IN (${scopedIds.length ? scopedIds.map(() => '?').join(',') : 'NULL'})`,
      scopedIds,
    )
    log.assert(
      '★ 逐台回库核对：限仓结果里的打印机全部绑在本仓（且没有查不到归属的幽灵行）',
      scopedPrinterRows.length === scopedIds.length
        && scopedPrinterRows.every(r => Number(r.warehouse_id) === homeWarehouseId),
      `返回 ${scopedIds.length} 台，库里查到 ${scopedPrinterRows.length} 台，`
      + `仓库集合 ${[...new Set(scopedPrinterRows.map(r => r.warehouse_id))].join('、')}`,
    )
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
    process.exitCode = 1
  } finally {
    // 按精确 ID 清理，绝不按名字/编码前缀批量删除（共享夹具自洁原则）
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    for (const id of cleanup.jobIds) await safe('print_jobs', 'DELETE FROM print_jobs WHERE id=?', [id])
    for (const pid of cleanup.printerIds) {
      await safe('printer_health_stats', 'DELETE FROM printer_health_stats WHERE printer_id=?', [pid])
      await safe('print_jobs(printer)', 'DELETE FROM print_jobs WHERE printer_id=?', [pid])
      await safe('printers', 'DELETE FROM printers WHERE id=?', [pid])
    }
    for (const userId of cleanup.userIds) {
      await safe('user_warehouse_scope', 'DELETE FROM user_warehouse_scope WHERE user_id=?', [userId])
      await safe('sys_users', 'DELETE FROM sys_users WHERE id=?', [userId])
    }
    for (const roleId of cleanup.roleIds) {
      await safe('sys_role_permissions', 'DELETE FROM sys_role_permissions WHERE role_id=?', [roleId])
      await safe('sys_roles', 'DELETE FROM sys_roles WHERE id=?', [roleId])
    }
    for (const wid of cleanup.warehouseIds) {
      await safe('inventory_warehouses', 'DELETE FROM inventory_warehouses WHERE id=?', [wid])
    }

    await ctx.close()
    // 全局单例池（backend/src/config/db）自己收尾：它也是 mysql2 连接、socket 不 unref，
    // app/service 查询过一次就会留住事件循环，断言全绿、退出码已定进程却吊着不退。
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
