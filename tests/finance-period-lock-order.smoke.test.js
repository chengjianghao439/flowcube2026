#!/usr/bin/env node
'use strict'

/**
 * 资金期间闸门 × 结账的**真实锁序**回归（2026-09-26 一致性审查 · 任务 7 收尾）。
 *
 * 为什么单独一个套件：
 *   `finance-period-guard.smoke.test.js` 验的是「闸门该不该拦」（顺序语义）；F01 验的是
 *   「两笔收款并发不互相串行化」。**没有任何一个套件验过「闸门与结账在同一把锁上真的互斥」**
 *   ——而闸门从排他锁改成共享锁（`lockAccountingCompanyShared`）之后，这一点从「靠读代码相信」
 *   变成了必须实测的命题：共享锁若被写错（比如误用 `LOCK IN SHARE MODE` 的旧语法、
 *   或结账路径漏改成排他），结果就是「检查时期间未结账 → 结账插进来 → 业务写进已结账期间」，
 *   也就是本模块存在的理由（钱动了、账上不记）原样复现，而顺序测试**全绿**。
 *
 * 本套件用真实 service + 真实事务观察锁行为，不 mock 锁：
 *   §1 登记 vs 登记  → 共享锁兼容，第二笔不被第一笔挡住（F01 的锁层根因）
 *   §2 登记 vs 结账  → 登记持共享锁时，`closePeriod` 拿不到排他锁，必须等登记提交
 *   §3 结账生效后    → 登记读到 status=2，抛 409 FINANCE_PERIOD_CLOSED（真实 closePeriod 置的状态）
 *   §4 结账 vs 登记  → 结账持排他锁（停在提交前）时，登记被挡在锁上；结账提交后登记才继续，
 *                     并因期间已结账被拒。**这正是「不会出现检查时未结、写入时已结」的直接证据。**
 *
 * 运行（独占库，库需先建好，迁移由 runMigrations 负责）：
 *   sh /tmp/run-test-backfill.sh flowcube_lockorder_test node tests/finance-period-lock-order.smoke.test.js
 */

require('./helpers/testEnvironment').configureTestEnvironment()

const { createLogger } = require('./helpers/smokeTestKit')

// 顺序：testEnvironment 先配好 env，config/db 才会用对库建池；service 与测试必须共用同一个 pool，
// 否则 §4 里对 pool.getConnection 的暂停钩子拦不到 closePeriod 的连接。
const { pool } = require('../backend/src/config/db')
const { runMigrations } = require('../backend/src/database/migrate')
const { assertFinancePeriodOpen } = require('../backend/src/modules/accounting/finance-period.guard')
const periodSvc = require('../backend/src/modules/accounting/accounting.period.service')

const COMPANY = 1
// 刻意避开 12 月：12 月的 closePeriod 还会要求年终结转凭证，与本套件要验的锁序无关，
// 会用一个「前置条件不满足」的 409 把真正的锁序结论盖住。空库非 12 月期间 pl='not_required'，
// 可以真实结账成功。
const P_CONCURRENT = '199503'   // §1/§2/§3 用
const D_CONCURRENT = '1995-03-15'
const P_CLOSE_RACE = '199505'   // §4 用
const D_CLOSE_RACE = '1995-05-15'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = createLogger()

/** 在事务里跑一次闸门，并把「被拒」也当作结果返回（不抛出），便于断言等待/拒绝。 */
async function gateInTransaction(conn, date, opts = {}) {
  try {
    await conn.beginTransaction()
    const res = await assertFinancePeriodOpen(conn, date, { companyId: COMPANY, bizLabel: '锁序回归', ...opts })
    return { ok: true, ...res }
  } catch (e) {
    return { ok: false, statusCode: e.statusCode, code: e.code, message: e.message }
  } finally {
    try { await conn.rollback() } catch { /* 已回滚/连接已断 */ }
    conn.release()
  }
}

/**
 * 让某期间的 acct_periods 行先存在（status=1 未结账），避免 FOR SHARE 落到间隙锁上。
 *
 * **先记录这一行在本套件动手之前的样子**：本套件会把期间改成已结账(2)、并写 closed_* 字段，
 * 收尾若按期间号无条件 DELETE，就会把库里**原本就有**的行删掉（复跑、或非空的 `*_test` 库里
 * 完全可能已有这两行）。所以原样返回存在性与原值，交给 `restorePeriodRow` 精确收尾。
 */
async function ensurePeriodRow(period) {
  const [[before]] = await pool.query(
    // acct_periods 的主键是 (company_id, period)，**没有 id 列**——别按习惯补 id。
    'SELECT status, closed_by, closed_by_name, closed_at FROM acct_periods WHERE company_id = ? AND period = ?',
    [COMPANY, period],
  )
  if (before) return { period, existed: true, before }
  await pool.query('INSERT INTO acct_periods (company_id, period, status) VALUES (?, ?, 1)', [COMPANY, period])
  return { period, existed: false, before: null }
}

/** 收尾：本轮新建的行删掉；**本来就存在的行按原值恢复**（本套件的结账改写过它的 status/closed_*）。 */
async function restorePeriodRow(fixture) {
  if (!fixture.existed) {
    const [r] = await pool.query('DELETE FROM acct_periods WHERE company_id = ? AND period = ?', [COMPANY, fixture.period])
    return { action: 'deleted', affected: r.affectedRows }
  }
  const b = fixture.before
  const [r] = await pool.query(
    `UPDATE acct_periods SET status = ?, closed_by = ?, closed_by_name = ?, closed_at = ?
      WHERE company_id = ? AND period = ?`,
    [b.status, b.closed_by, b.closed_by_name, b.closed_at, COMPANY, fixture.period],
  )
  return { action: 'restored', affected: r.affectedRows, before: b }
}

async function periodStatus(period) {
  const [[row]] = await pool.query(
    'SELECT status, closed_by_name, closed_at FROM acct_periods WHERE company_id = ? AND period = ?',
    [COMPANY, period],
  )
  return row || null
}

async function main() {
  await runMigrations()

  const insertedCompany = []
  const [[company]] = await pool.query('SELECT id FROM acct_companies WHERE id = ?', [COMPANY])
  if (!company) {
    await pool.query('INSERT INTO acct_companies (id, name) VALUES (?, ?)', [COMPANY, '锁序回归账套'])
    insertedCompany.push(COMPANY)
  }

  const periodFixtures = [await ensurePeriodRow(P_CONCURRENT), await ensurePeriodRow(P_CLOSE_RACE)]

  // ── §1 登记 vs 登记：共享锁兼容，互不阻塞 ────────────────────────────────
  log.section('§1 两笔并发登记不互相串行化（共享锁 vs 共享锁）')
  {
    const c1 = await pool.getConnection()
    const c2 = await pool.getConnection()
    try {
      // 会话级锁等待上限只加在 §1 这两条连接上：本节点要证的是「**不会**发生锁等待」，
      // 一旦闸门退化成排他锁，第二笔会等到 InnoDB 默认的 50 秒才报错——套件白挂 50 秒，
      // 而失败信息只说明「超时」。3 秒足够区分「立即返回」与「在等锁」，也不会拖住套件。
      await c1.query('SET SESSION innodb_lock_wait_timeout = 3')
      await c2.query('SET SESSION innodb_lock_wait_timeout = 3')

      await c1.beginTransaction()
      const r1 = await assertFinancePeriodOpen(c1, D_CONCURRENT, { companyId: COMPANY, bizLabel: '并发登记A' })
      log.assert('第一笔登记闸门放行（期间未结账）', r1.ok !== false && r1.closed === false, JSON.stringify(r1))

      // c1 仍持有 acct_companies / acct_periods 的共享锁、尚未提交。
      await c2.beginTransaction()
      const t0 = Date.now()
      let r2 = null
      let r2err = null
      try {
        r2 = await assertFinancePeriodOpen(c2, D_CONCURRENT, { companyId: COMPANY, bizLabel: '并发登记B' })
      } catch (e) {
        r2err = e
      }
      const elapsed = Date.now() - t0
      log.assert(
        '★ 第二笔登记不被第一笔挡住（立即返回，而不是等到锁释放）',
        !r2err && r2?.closed === false && elapsed < 1500,
        r2err
          ? `耗时 ${elapsed}ms 后报错 ${r2err.code || r2err.message} —— 两笔登记在同一把排他锁上排队了（闸门锁模式被改坏）`
          : `耗时 ${elapsed}ms；若为共享锁兼容应当立即返回，退化成排他锁会一直等到锁释放`,
      )
    } finally {
      try { await c1.commit() } catch { await c1.rollback() }
      try { await c2.commit() } catch { await c2.rollback() }
      // 归还前还原会话变量：这两条连接回到池里给后续使用者，3 秒的锁等待上限
      // 不该跟着池一起被带出去（本套件跑在独占库独立进程里，但别把这个前提当保证）。
      try { await c1.query('SET SESSION innodb_lock_wait_timeout = DEFAULT') } catch { /* 连接已坏 */ }
      try { await c2.query('SET SESSION innodb_lock_wait_timeout = DEFAULT') } catch { /* 连接已坏 */ }
      c1.release(); c2.release()
    }
  }

  // ── §2 登记持共享锁 → 结账被挡 ───────────────────────────────────────────
  log.section('§2 登记未提交时，结账拿不到排他锁（共享 vs 排他）')
  {
    const c1 = await pool.getConnection()
    let closing = null
    let closingSettled = false
    try {
      await c1.beginTransaction()
      const r1 = await assertFinancePeriodOpen(c1, D_CONCURRENT, { companyId: COMPANY, bizLabel: '登记占锁' })
      log.assert('登记闸门放行并**持有共享锁未提交**', r1.closed === false, JSON.stringify(r1))

      closing = periodSvc.closePeriod(P_CONCURRENT, { userId: null, realName: '锁序回归' }, COMPANY)
        .then((v) => { closingSettled = true; return v }, (e) => { closingSettled = true; return { error: e } })

      await sleep(1000)
      log.assert(
        '★ 结账被挡在账套锁上：登记提交前它无法完成',
        !closingSettled,
        closingSettled ? '结账在登记提交前就返回了 —— 说明登记与结账没有互斥（闸门锁模式或结账锁被改坏了）' : undefined,
      )

      await c1.commit()
      const cr = await closing
      log.assert(
        '★ 登记提交后结账才推进，并成功把期间置为已结账',
        cr && !cr.error && Number(cr.status) === 2,
        cr?.error ? `${cr.error.statusCode} ${cr.error.message}` : JSON.stringify(cr),
      )
      const st = await periodStatus(P_CONCURRENT)
      log.assert('期间状态已落库为 2（结账真实生效，§3 的依据）', Number(st?.status) === 2, JSON.stringify(st))
    } finally {
      try { await c1.rollback() } catch { /* 已提交 */ }
      c1.release()
      if (closing) await closing.catch(() => {})
    }
  }

  // ── §3 结账生效后，登记被真实拒绝 ────────────────────────────────────────
  log.section('§3 期间已结账后登记被拒（409 FINANCE_PERIOD_CLOSED）')
  {
    const c = await pool.getConnection()
    const r = await gateInTransaction(c, D_CONCURRENT, { bizLabel: '结账后登记' })
    log.assert('★ 登记被拒绝（HTTP 409）', r.ok === false && r.statusCode === 409, `statusCode=${r.statusCode}`)
    log.assert('★ 业务码为 FINANCE_PERIOD_CLOSED（前端据此引导补录）', r.code === 'FINANCE_PERIOD_CLOSED', String(r.code))
  }

  // ── §4 结账持排他锁 → 登记被挡，结账生效后登记被拒 ───────────────────────
  log.section('§4 结账持排他锁期间，登记被挡在锁上（排他 vs 共享）')
  {
    const realGetConnection = pool.getConnection.bind(pool)
    let armPatch = true
    let ready = null
    let resume = null
    const gate = new Promise((res) => { ready = res })
    const hold = new Promise((res) => { resume = res })

    // 让 closePeriod 停在校验全过、status 已 UPDATE、**commit 之前**：此刻排他锁已持有，
    // 且未提交——正是「结账进行中」这一瞬间。此后任何取共享锁的登记都必须排在它后面。
    pool.getConnection = async () => {
      const conn = await realGetConnection()
      if (!armPatch) return conn
      armPatch = false
      const realCommit = conn.commit.bind(conn)
      let paused = false
      conn.commit = async () => {
        if (paused) return realCommit()
        paused = true
        ready()
        await hold
        return realCommit()
      }
      return conn
    }

    let closing = null
    let reg = null
    let regSettled = false
    let regResult = null
    try {
      closing = periodSvc.closePeriod(P_CLOSE_RACE, { userId: null, realName: '锁序回归' }, COMPANY)
        .then((v) => ({ value: v }), (e) => ({ error: e }))
      await gate

      reg = (async () => {
        const connB = await pool.getConnection()
        try {
          await connB.beginTransaction()
          const res = await assertFinancePeriodOpen(connB, D_CLOSE_RACE, { companyId: COMPANY, bizLabel: '结账中登记' })
          return { ok: true, closed: res.closed }
        } catch (e) {
          return { ok: false, statusCode: e.statusCode, code: e.code }
        } finally {
          try { await connB.rollback() } catch { /* 已回滚 */ }
          connB.release()
        }
      })().then((r) => { regSettled = true; regResult = r; return r })

      await sleep(1000)
      log.assert(
        '★ 结账持有排他锁期间，登记无法越过（1 秒内未返回）',
        !regSettled,
        regSettled ? `登记在结账提交前就返回了：${JSON.stringify(regResult)}` : undefined,
      )

      resume()
      const cr = await closing
      log.assert(
        '结账正常提交，期间被置为已结账',
        cr && !cr.error && Number(cr.value?.status) === 2,
        cr?.error ? `${cr.error.statusCode} ${cr.error.message}` : JSON.stringify(cr),
      )

      const rr = await reg
      log.assert(
        '★ 结账提交后登记才继续，并因期间已结账被拒 409',
        rr.ok === false && rr.statusCode === 409 && rr.code === 'FINANCE_PERIOD_CLOSED',
        JSON.stringify(rr),
      )
    } finally {
      resume()
      pool.getConnection = realGetConnection
      if (closing) await closing.catch(() => {})
      if (reg) await reg.catch(() => {})
    }
  }

  // ── 收尾：只删本套件新建的期间行，原有行按原值恢复 ──────────────────────
  log.section('§Z 清理（按存在性精确收尾，不误删库里原有的期间行）')
  {
    for (const fx of periodFixtures) {
      const r = await restorePeriodRow(fx)
      if (fx.existed) {
        const [[now]] = await pool.query(
          'SELECT status, closed_by, closed_by_name, closed_at FROM acct_periods WHERE company_id = ? AND period = ?',
          [COMPANY, fx.period],
        )
        log.assert(
          `原有的 ${fx.period} 期间行已恢复原值（本套件的结账改写已撤回）`,
          r.affected === 1
            && Number(now?.status) === Number(fx.before.status)
            && now?.closed_by === fx.before.closed_by
            && now?.closed_by_name === fx.before.closed_by_name
            && String(now?.closed_at ?? '') === String(fx.before.closed_at ?? ''),
          `action=${r.action} before=${JSON.stringify(fx.before)} after=${JSON.stringify(now)}`,
        )
      } else {
        const [[now]] = await pool.query('SELECT period FROM acct_periods WHERE company_id = ? AND period = ?', [COMPANY, fx.period])
        log.assert(
          `本轮新建的 ${fx.period} 期间行已删除（库不残留本套件的结账状态）`,
          r.affected === 1 && !now,
          `action=${r.action} affected=${r.affected} 残留=${now ? '有' : '无'}`,
        )
      }
    }
    for (const id of insertedCompany) {
      await pool.query('DELETE FROM acct_companies WHERE id = ?', [id])
    }
    const [left] = await pool.query('SELECT COUNT(*) AS n FROM acct_periods WHERE company_id = ? AND period IN (?, ?)', [COMPANY, P_CONCURRENT, P_CLOSE_RACE])
    log.assert(
      '原库里本不存在的期间行确已清空、原有的行仍在',
      Number(left[0].n) === periodFixtures.filter((f) => f.existed).length,
      `剩 ${left[0].n} 行，其中原有 ${periodFixtures.filter((f) => f.existed).length} 行`,
    )
  }
}

main()
  .then(async () => {
    const counts = log.summary()
    await pool.end()
    process.exitCode = counts.failed ? 1 : 0
  })
  .catch(async (e) => {
    console.error('\n[套件异常终止]', e)
    try { await pool.end() } catch { /* 池可能已关 */ }
    process.exitCode = 1
  })
