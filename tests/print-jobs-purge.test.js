#!/usr/bin/env node
'use strict'

/**
 * print_jobs 历史清理回归测试（审计 3.7）。
 *   node tests/print-jobs-purge.test.js
 *
 * print_jobs 是无界增长表之一。purgeFinishedJobs 只在 print-jobs sweeper 里每 60s 跑，
 * 之前零测试——如果保留窗口写反（比如删了新任务、留了旧的），队列历史会静默出错。
 * 本测试锁死三条边界：
 *   1. 超过保留窗口（默认 30 天）的「已完成」任务被删。
 *   2. 保留窗口内的「已完成」任务保留（新打印记录还要展示）。
 *   3. 超过窗口的「待打印/打印中」任务保留（幂等窗口 & 活动任务不受清理影响）。
 */

const {
  createLogger,
  prepareSmokeContext,
  randomRef,
} = require('./helpers/smokeTestKit')
const { purgeFinishedJobs } = require('../backend/src/modules/print-jobs/print-jobs.dispatch')

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  const pid = null // 测试创建后自行清理
  let testPrinterId = null
  try {
    const [printer] = await pool.query("INSERT INTO printers (code, name) VALUES (?, '历史清理测试打印机')", [randomRef('PURGE').slice(0, 30)])
    testPrinterId = printer.insertId
    const base = randomRef('PJ-PURGE').slice(0, 30)

    // 40 天前已完成 → 应删
    const [old] = await pool.query(
      `INSERT INTO print_jobs (job_unique_key, printer_id, warehouse_id, job_type, content_type, title, content, status, created_at, updated_at)
       VALUES (?, ?, 1, 'test_purge_old', 'zpl', 't', 'c', 2, DATE_SUB(NOW(), INTERVAL 40 DAY), DATE_SUB(NOW(), INTERVAL 40 DAY))`,
      [`${base}-OLD`, testPrinterId],
    )
    // 刚完成 → 应保留
    const [fresh] = await pool.query(
      `INSERT INTO print_jobs (job_unique_key, printer_id, warehouse_id, job_type, content_type, title, content, status, created_at, updated_at)
       VALUES (?, ?, 1, 'test_purge_fresh', 'zpl', 't', 'c', 2, NOW(), NOW())`,
      [`${base}-FRESH`, testPrinterId],
    )
    // 40 天前待打印 → 应保留（幂等窗口 / 活动任务）
    const [pending] = await pool.query(
      `INSERT INTO print_jobs (job_unique_key, printer_id, warehouse_id, job_type, content_type, title, content, status, created_at, updated_at)
       VALUES (?, ?, 1, 'test_purge_pending', 'zpl', 't', 'c', 0, DATE_SUB(NOW(), INTERVAL 40 DAY), DATE_SUB(NOW(), INTERVAL 40 DAY))`,
      [`${base}-PENDING`, testPrinterId],
    )

    const purged = await purgeFinishedJobs()
    log.assert('清理动作执行（返回受影响行数）', typeof purged === 'number', `purged=${purged}`)

    const [[oldRow]] = await pool.query('SELECT id FROM print_jobs WHERE id=?', [old.insertId])
    log.assert('★ 超过保留窗口的已完成任务被删', !oldRow, `id=${old.insertId}`)

    const [[freshRow]] = await pool.query('SELECT id FROM print_jobs WHERE id=?', [fresh.insertId])
    log.assert('★ 保留窗口内的已完成任务保留', !!freshRow, `id=${fresh.insertId}`)

    const [[pendingRow]] = await pool.query('SELECT id FROM print_jobs WHERE id=?', [pending.insertId])
    log.assert('★ 超过窗口的待打印任务保留（不影响活动队列）', !!pendingRow, `id=${pending.insertId}`)
  } finally {
    if (testPrinterId) {
      await pool.query('DELETE FROM print_jobs WHERE printer_id=?', [testPrinterId])
      await pool.query('DELETE FROM printers WHERE id=?', [testPrinterId])
    }
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[PRINT-JOBS-PURGE] 未捕获异常：', e)
  process.exit(1)
})
