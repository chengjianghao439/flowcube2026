#!/usr/bin/env node
'use strict'

/**
 * 回归测试：报销付款必须有会计期间闸门
 * （2026-09-26 一致性审查 · 任务 7 收口）
 *
 * 修复前的行为：
 *   报销单已批准 → 出纳把付款日期填成某个**已结账期间**的日期 → 付款直接成功：
 *   finance_account_transactions 写进那个期间、账户余额当场减少、报销单变「已付款」，
 *   而同一笔钱的会计凭证会被 voucher-engine 判为「已结账期间」而跳过（stats.skippedClosed）。
 *   结果是钱动了、资金流水动了，会计账上却没有这笔。
 *   注意这不是「静默」——凭证引擎对每条跳过都打了 logger.warn；但 warn 只落在日志里，
 *   账面自己不会报不平，也没有任何业务入口会因此被拦住。
 *
 * 五段：
 *   §A 业务日期落在已结账期间 → 409 FINANCE_PERIOD_CLOSED，一分钱不动
 *   §B 带补录申请 → 202 申请单，业务数据一行不写（先审批、后动账）
 *   §C 审批 + 执行该申请 → 出账 1 笔、资金流水日期仍是原业务日期、
 *      凭证落期为**补录当期**（voucher_date_override）、backfill_id 留痕、
 *      executed_biz_id 已回填、重复执行不重复出账
 *   §D 未结账期间正常付款 → 照常成功（闸门不得误伤日常业务）
 *   §E 同请求键重发 → 幂等，不重复出账
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/expense-pay-period-guard.smoke.test.js
 */

const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')

const AMOUNT = 300
const OPENING = 10000
// 已结账期间用久远的 202001：与当前期间（202609）不相干，且清理时按精确 (company_id, period) 删除
const CLOSED_PERIOD = '202001'
const CLOSED_BIZ_DATE = '2020-01-15'
const OPEN_BIZ_DATE = '2021-06-10'   // 202106 从不结账
const BEIJING_TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

async function createAccount(ctx, token, { name }) {
  const resp = await ctx.http.post('/api/finance/accounts', {
    token, json: { name, type: 1, openingBalance: OPENING },
  })
  const id = Number(resp.data?.data?.id)
  if (!id) throw new Error(`建资金账户失败: ${JSON.stringify(resp.data)}`)
  return id
}

async function createCategory(ctx, token, name) {
  const resp = await ctx.http.post('/api/finance/expense-categories', { token, json: { name } })
  const id = Number(resp.data?.data?.id)
  if (!id) throw new Error(`建费用类别失败: ${JSON.stringify(resp.data)}`)
  return id
}

/**
 * 独立的审批人账号：报销单不许申请人自审（SELF_APPROVAL_DENIED），
 * 用同一个 smoke_admin 提交再审批会直接 403，测不到闸门本身。
 */
async function createApprover(ctx, suffix) {
  const bcrypt = require('../backend/node_modules/bcryptjs')
  const username = `eppg_appr_${suffix}`
  const password = `Eppg-${suffix}-Pass1!`
  await ctx.pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, ?, 1, '管理员', 1)`,
    [username, bcrypt.hashSync(password, 10), 'EPPG审批人'],
  )
  const [[row]] = await ctx.pool.query('SELECT id FROM sys_users WHERE username=? LIMIT 1', [username])
  const auth = await login(ctx.http, username, password)
  if (!auth.token) throw new Error(`审批人登录失败: ${username}`)
  return { userId: Number(row.id), token: auth.token }
}

/** 建报销单 → 提交 → 由他人审批，返回 { claimId, claimNo }，停在「已批准(3)」 */
async function seedApprovedClaim(ctx, token, approverToken, { categoryId, amount, happenedAt, title }) {
  const { http, pool } = ctx
  const created = await http.post('/api/finance/expense-claims', {
    token,
    json: {
      title,
      items: [{ categoryId, amount, happenedAt, description: '跨期闸门回归测试' }],
    },
  })
  const claimId = Number(created.data?.data?.id)
  if (!claimId) throw new Error(`建报销单失败: ${JSON.stringify(created.data)}`)
  const claimNo = created.data?.data?.claimNo || null
  const sub = await http.post(`/api/finance/expense-claims/${claimId}/submit`, { token })
  if (!sub.ok) throw new Error(`提交报销单失败: ${JSON.stringify(sub.data)}`)
  const app = await http.post(`/api/finance/expense-claims/${claimId}/approve`, { token: approverToken })
  if (!app.ok) throw new Error(`审批报销单失败: ${JSON.stringify(app.data)}`)
  const [[row]] = await pool.query('SELECT status, total_amount FROM expense_claims WHERE id=?', [claimId])
  if (Number(row.status) !== 3) throw new Error(`报销单未停在已批准(3)，实为 ${row.status}`)
  return { claimId, claimNo }
}

const claimStatusOf = async (pool, id) => {
  const [[row]] = await pool.query(
    'SELECT status, total_amount, paid_at, paid_account_id FROM expense_claims WHERE id=?', [id],
  )
  return row || null
}

const balanceOf = async (pool, accountId) => {
  const [[row]] = await pool.query('SELECT current_balance FROM finance_accounts WHERE id=?', [accountId])
  return Number(row?.current_balance ?? NaN)
}

const txnsOf = async (pool, accountId, bizId) => dbQuery(
  pool,
  `SELECT id, direction, amount, biz_type, biz_id, biz_no, happened_at, voucher_date_override, backfill_id
     FROM finance_account_transactions WHERE account_id=? AND biz_id=? ORDER BY id`,
  [accountId, bizId],
)

/**
 * 归一化到 YYYY-MM-DD。库连接时区是 +08:00，DATE 列读回来是「北京时间 00:00」的 Date 对象，
 * 直接 String(date) 会得到 "Wed Jan 15 2020 …"，断言必然假失败。
 */
const ymd = (v) => (v instanceof Date
  ? new Date(v.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  : String(v ?? '').slice(0, 10))

const backfillRowOf = async (pool, id) => {
  const [[row]] = await pool.query(
    `SELECT id, status, biz_type, biz_id, biz_no, amount, period, business_date, request_key,
            executed_at, executed_biz_id, posting_period, voucher_generate_error, request_snapshot
       FROM finance_period_backfills WHERE id=?`,
    [id],
  )
  return row || null
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http } = ctx
  const cleanup = { claimIds: [], categoryIds: [], accountIds: [], backfillIds: [], requestKeys: [], userIds: [], acctPeriod: null, acctPeriodPrevStatus: null }
  let step = 'init'

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    if (!token) throw new Error('smoke_admin 登录失败')

    const suffix = randomRef('EPPG').slice(-8)

    // ── 夹具：把 202001 标成已结账 ────────────────────────────────────────
    step = 'fixture:closed-period'
    const [existingPeriod] = await dbQuery(
      pool, 'SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [CLOSED_PERIOD],
    )
    if (existingPeriod) {
      cleanup.acctPeriod = CLOSED_PERIOD
      cleanup.acctPeriodPrevStatus = Number(existingPeriod.status)
      if (Number(existingPeriod.status) !== 2) {
        await pool.query('UPDATE acct_periods SET status=2 WHERE company_id=1 AND period=?', [CLOSED_PERIOD])
      }
    } else {
      await pool.query(
        'INSERT INTO acct_periods (company_id, period, status, closed_by_name, closed_at) VALUES (1, ?, 2, ?, NOW())',
        [CLOSED_PERIOD, 'EPPG回归测试'],
      )
      cleanup.acctPeriod = CLOSED_PERIOD
    }
    const [[closedRow]] = await pool.query(
      'SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [CLOSED_PERIOD],
    )
    log.assert(`前置：会计期间 ${CLOSED_PERIOD} 已结账`, Number(closedRow?.status) === 2, `status=${closedRow?.status}`)

    step = 'fixture:account-category'
    const approver = await createApprover(ctx, suffix)
    cleanup.userIds.push(approver.userId)
    const accountId = await createAccount(ctx, token, { name: `EPPG测试账户-${suffix}` })
    cleanup.accountIds.push(accountId)
    const categoryId = await createCategory(ctx, token, `EPPG测试类别-${suffix}`)
    cleanup.categoryIds.push(categoryId)
    log.assert('前置：资金账户与费用类别就绪', balanceOf && true, `accountId=${accountId}`)

    // ══════════════════════════════════════════════════════════════════
    // §A 业务日期落在已结账期间 → 必须 409，且一分钱不动
    // ══════════════════════════════════════════════════════════════════
    log.section(`§A 付款日期落在已结账期间 ${CLOSED_PERIOD} → 必须 409`)
    step = 'A:seed'
    const A = await seedApprovedClaim(ctx, token, approver.token, {
      categoryId, amount: AMOUNT, happenedAt: CLOSED_BIZ_DATE, title: `EPPG-A-${suffix}`,
    })
    cleanup.claimIds.push(A.claimId)

    step = 'A:pay'
    const balanceBefore = await balanceOf(pool, accountId)
    const payA = await http.post(`/api/finance/expense-claims/${A.claimId}/pay`, {
      token,
      headers: { 'X-Request-Key': `${suffix}-A` },
      json: { accountId, happenedAt: CLOSED_BIZ_DATE, remark: '跨期闸门回归' },
    })
    cleanup.requestKeys.push(`${suffix}-A`)
    console.log(`\n[已结账期间付款] HTTP ${payA.status} ${JSON.stringify(payA.data).slice(0, 260)}`)
    log.assert('★ 付款被拒绝（409）', payA.status === 409, `实际 HTTP ${payA.status}`)
    log.assert(
      '★ 错误码为 FINANCE_PERIOD_CLOSED',
      payA.data?.code === 'FINANCE_PERIOD_CLOSED',
      JSON.stringify(payA.data).slice(0, 200),
    )
    log.assert(
      '★ 拒绝消息给出可操作的出路（改日期 / 跨期补录）',
      String(payA.data?.message || '').includes('未结账的日期')
        && String(payA.data?.message || '').includes('跨期补录'),
      String(payA.data?.message || '').slice(0, 240),
    )

    step = 'A:read'
    const claimA = await claimStatusOf(pool, A.claimId)
    const txnsA = await txnsOf(pool, accountId, A.claimId)
    const balanceAfterA = await balanceOf(pool, accountId)
    log.assert(
      '★ 报销单未被改动（仍停在已批准(3)、无付款痕迹）',
      Number(claimA?.status) === 3 && claimA?.paid_at == null,
      `status=${claimA?.status} paid_at=${claimA?.paid_at}`,
    )
    log.assert('★ 未产生任何资金流水', txnsA.length === 0, `流水 ${txnsA.length} 笔`)
    log.assert(
      '★ 账户余额未被改动（被拒的付款不得留下半截副作用）',
      Math.abs(balanceAfterA - balanceBefore) < 0.005,
      `${balanceBefore} → ${balanceAfterA}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §B 带补录申请 → 202 申请单，业务数据一行不写
    // ══════════════════════════════════════════════════════════════════
    log.section('§B 补录申请 → 202 只落申请单，不动账')
    step = 'B:apply'
    const applyKey = `${suffix}-B`
    const payB = await http.post(`/api/finance/expense-claims/${A.claimId}/pay`, {
      token,
      headers: { 'X-Request-Key': applyKey },
      json: {
        accountId, happenedAt: CLOSED_BIZ_DATE, remark: '跨期补录申请',
        backfillRequest: true, backfillReason: '银行流水显示该笔报销付款确实发生在 2020 年 1 月',
      },
    })
    cleanup.requestKeys.push(applyKey)
    console.log(`\n[补录申请] HTTP ${payB.status} ${JSON.stringify(payB.data).slice(0, 300)}`)
    log.assert('★ 返回 202（受理为申请，而非付款）', payB.status === 202, `实际 HTTP ${payB.status}`)
    const applicationNo = payB.data?.data?.applicationNo
    log.assert(
      '★ 返回申请单号（BF-…），调用方可据此提示「已提交待审批」',
      typeof applicationNo === 'string' && applicationNo.startsWith('BF-'),
      `applicationNo=${applicationNo}`,
    )
    const backfillId = Number(payB.data?.data?.id)
    if (Number.isFinite(backfillId) && backfillId > 0) cleanup.backfillIds.push(backfillId)

    step = 'B:read'
    const claimB = await claimStatusOf(pool, A.claimId)
    const txnsB = await txnsOf(pool, accountId, A.claimId)
    const backfillB = backfillId ? await backfillRowOf(pool, backfillId) : null
    log.assert(
      '★ 业务数据一行未写：报销单仍已批准(3)、无付款痕迹',
      Number(claimB?.status) === 3 && claimB?.paid_at == null,
      `status=${claimB?.status} paid_at=${claimB?.paid_at}`,
    )
    log.assert('★ 未产生任何资金流水（先审批、后动账）', txnsB.length === 0, `流水 ${txnsB.length} 笔`)
    log.assert(
      '★ 申请单已落库且为「待审批(0)」、记录了原业务单号与金额',
      backfillB && Number(backfillB.status) === 0
        && backfillB.biz_type === 'expense_pay'
        && Number(backfillB.biz_id) === Number(A.claimId)
        && Math.abs(Number(backfillB.amount) - AMOUNT) < 0.005,
      backfillB ? `status=${backfillB.status} biz=${backfillB.biz_type}/${backfillB.biz_id} amount=${backfillB.amount}` : '(无)',
    )
    log.assert(
      '★ 申请单记录了业务发生期间（补录要补的是哪个月）',
      backfillB && backfillB.period === CLOSED_PERIOD
        && ymd(backfillB.business_date) === CLOSED_BIZ_DATE,
      backfillB ? `period=${backfillB.period} businessDate=${ymd(backfillB.business_date)}` : '(无)',
    )
    if (!backfillB) throw new Error('§B 未落申请单，后续无法执行')

    // 同键重发 → 读回原单，不新增第二张（申请身份跟着操作走）
    step = 'B:replay'
    const payB2 = await http.post(`/api/finance/expense-claims/${A.claimId}/pay`, {
      token,
      headers: { 'X-Request-Key': applyKey },
      json: {
        accountId, happenedAt: CLOSED_BIZ_DATE, remark: '跨期补录申请',
        backfillRequest: true, backfillReason: '银行流水显示该笔报销付款确实发生在 2020 年 1 月',
      },
    })
    const [[bfCount]] = await pool.query(
      'SELECT COUNT(*) AS n FROM finance_period_backfills WHERE biz_type=? AND biz_id=?',
      ['expense_pay', A.claimId],
    )
    log.assert(
      '★ 同请求键重发不新增第二张申请单（否则审批两次＝同一笔钱记两次）',
      Number(bfCount.n) === 1,
      `申请单 ${bfCount.n} 张（第二次 HTTP ${payB2.status}）`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §C 批准（批准即执行）→ 出账 1 笔，落期为补录当期
    // ══════════════════════════════════════════════════════════════════
    log.section('§C 批准补录 → 出账 1 笔、落期为当期、业务日期不变')
    step = 'C:approve'
    const balanceBeforeC = await balanceOf(pool, accountId)
    // 口径是「先审批、后动账」：审批人点完批准这笔钱就该落账，approve 内部直接执行
    const approve = await http.post(`/api/accounting/backfills/${backfillId}/approve`, {
      token: approver.token, json: { remark: '核对银行流水无误，同意补录' },
    })
    console.log(`\n[批准补录] HTTP ${approve.status} ${JSON.stringify(approve.data).slice(0, 320)}`)
    log.assert(
      '★ 批准成功且业务当场落账（批准即执行）',
      approve.ok && approve.data?.data?.executed === true,
      JSON.stringify(approve.data).slice(0, 260),
    )

    step = 'C:read'
    const claimC = await claimStatusOf(pool, A.claimId)
    const txnsC = await txnsOf(pool, accountId, A.claimId)
    const balanceAfterC = await balanceOf(pool, accountId)
    const backfillC = await backfillRowOf(pool, backfillId)
    const postingPeriod = String(backfillC?.posting_period || '')
    const currentPeriod = BEIJING_TODAY.slice(0, 4) + BEIJING_TODAY.slice(5, 7)
    console.log(`[批准后] 报销单 status=${claimC?.status} 流水 ${txnsC.length} 笔 `
      + `余额 ${balanceBeforeC} → ${balanceAfterC} 落期=${postingPeriod}`)

    log.assert(
      '★ 货真价实地动了账：报销单变已付款(4)、出账 1 笔、余额减少 300',
      Number(claimC?.status) === 4 && txnsC.length === 1
        && Math.abs(balanceAfterC - (balanceBeforeC - AMOUNT)) < 0.005,
      `status=${claimC?.status} 流水=${txnsC.length} 余额 ${balanceBeforeC}→${balanceAfterC}`,
    )
    log.assert(
      '★ 资金流水的发生日期仍是原业务日期（银行对账依据不能改）',
      txnsC.length === 1 && ymd(txnsC[0].happened_at) === CLOSED_BIZ_DATE,
      txnsC.length ? `happened_at=${ymd(txnsC[0].happened_at)}` : '(无流水)',
    )
    log.assert(
      '★ 凭证落期为补录当期（voucher_date_override=批准当天），不是业务期间',
      txnsC.length === 1 && ymd(txnsC[0].voucher_date_override) === BEIJING_TODAY,
      txnsC.length ? `voucher_date_override=${ymd(txnsC[0].voucher_date_override)}（期望 ${BEIJING_TODAY}）` : '(无流水)',
    )
    log.assert(
      '★ 资金流水留痕 backfill_id（可从事务反查补录单）',
      txnsC.length === 1 && Number(txnsC[0].backfill_id) === Number(backfillId),
      txnsC.length ? `backfill_id=${txnsC[0].backfill_id}` : '(无流水)',
    )
    log.assert(
      '★ 申请单落期记为补录当期、executed_biz_id 已回填',
      backfillC && postingPeriod === currentPeriod
        && Number(backfillC.status) === 1 && backfillC.executed_at != null
        && backfillC.executed_biz_id != null,
      `posting_period=${postingPeriod}（期望 ${currentPeriod}）status=${backfillC?.status} `
      + `executed_at=${backfillC?.executed_at} executed_biz_id=${backfillC?.executed_biz_id}`,
    )
    if (backfillC?.voucher_generate_error) {
      // 凭证生成失败不会回滚业务（钱确实动了），只把原因记在申请单上。本测试不把「测试库有没有
      // 配好费用科目」当成产品缺陷，但必须显式打出来，不能让一条警告淹在日志里。
      console.log(`[提示] 调整凭证未生成，申请单记录了原因：${backfillC.voucher_generate_error}`)
    }

    step = 'C:re-execute'
    const exec2 = await http.post(`/api/accounting/backfills/${backfillId}/execute`, { token: approver.token })
    const txnsC2 = await txnsOf(pool, accountId, A.claimId)
    const balanceAfterC2 = await balanceOf(pool, accountId)
    log.assert(
      '★ 重复执行不重复出账（executed_at 判幂等）',
      exec2.ok && exec2.data?.data?.alreadyExecuted === true && txnsC2.length === 1
        && Math.abs(balanceAfterC2 - balanceAfterC) < 0.005,
      `second=${exec2.status}/alreadyExecuted=${exec2.data?.data?.alreadyExecuted} `
      + `流水=${txnsC2.length} 笔 余额 ${balanceAfterC}→${balanceAfterC2}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §D/§E 未结账期间照常付款 + 同键重发幂等
    // ══════════════════════════════════════════════════════════════════
    log.section(`§D 未结账期间（${OPEN_BIZ_DATE}）→ 照常付款；§E 同键重发幂等`)
    step = 'D:seed'
    const D = await seedApprovedClaim(ctx, token, approver.token, {
      categoryId, amount: AMOUNT, happenedAt: OPEN_BIZ_DATE, title: `EPPG-D-${suffix}`,
    })
    cleanup.claimIds.push(D.claimId)

    step = 'D:pay'
    const payKey = `${suffix}-D`
    const balanceBeforeD = await balanceOf(pool, accountId)
    const payD = await http.post(`/api/finance/expense-claims/${D.claimId}/pay`, {
      token,
      headers: { 'X-Request-Key': payKey },
      json: { accountId, happenedAt: OPEN_BIZ_DATE, remark: '正常期间付款' },
    })
    cleanup.requestKeys.push(payKey)
    console.log(`\n[正常期间付款] HTTP ${payD.status} ${JSON.stringify(payD.data).slice(0, 200)}`)
    log.assert('★ 闸门不误伤：未结账期间的付款照常成功', payD.ok, JSON.stringify(payD.data).slice(0, 200))

    step = 'D:read'
    const claimD = await claimStatusOf(pool, D.claimId)
    const txnsD = await txnsOf(pool, accountId, D.claimId)
    const balanceAfterD = await balanceOf(pool, accountId)
    log.assert(
      '★ 正常付款确实出账 1 笔且状态变已付款(4)',
      Number(claimD?.status) === 4 && txnsD.length === 1
        && Math.abs(balanceAfterD - (balanceBeforeD - AMOUNT)) < 0.005,
      `status=${claimD?.status} 流水=${txnsD.length} 余额 ${balanceBeforeD}→${balanceAfterD}`,
    )
    log.assert(
      '★ 正常付款不留凭证落期覆盖（voucher_date_override 为空）与补录痕迹',
      txnsD.length === 1 && txnsD[0].voucher_date_override == null && txnsD[0].backfill_id == null,
      txnsD.length ? `override=${txnsD[0].voucher_date_override} backfill=${txnsD[0].backfill_id}` : '(无流水)',
    )

    step = 'E:replay'
    const payD2 = await http.post(`/api/finance/expense-claims/${D.claimId}/pay`, {
      token,
      headers: { 'X-Request-Key': payKey },
      json: { accountId, happenedAt: OPEN_BIZ_DATE, remark: '正常期间付款' },
    })
    const txnsD2 = await txnsOf(pool, accountId, D.claimId)
    const balanceAfterD2 = await balanceOf(pool, accountId)
    log.assert(
      '★ 同请求键重发：不出第二次账（金额与状态都不变）',
      payD2.ok && txnsD2.length === 1
        && Math.abs(balanceAfterD2 - (balanceBeforeD - AMOUNT)) < 0.005,
      `second=${payD2.status} 流水=${txnsD2.length} 余额=${balanceAfterD2}`,
    )
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
    process.exitCode = 1
  } finally {
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    for (const accountId of cleanup.accountIds) {
      await safe('finance_account_transactions', 'DELETE FROM finance_account_transactions WHERE account_id=?', [accountId])
      await safe('finance_accounts', 'DELETE FROM finance_accounts WHERE id=?', [accountId])
    }
    for (const claimId of cleanup.claimIds) {
      await safe('expense_claim_items', 'DELETE FROM expense_claim_items WHERE claim_id=?', [claimId])
      await safe('expense_claims', 'DELETE FROM expense_claims WHERE id=?', [claimId])
    }
    for (const backfillId of cleanup.backfillIds) {
      await safe('acct_vouchers',
        'DELETE FROM acct_vouchers WHERE source_type=? AND source_id IN (SELECT id FROM finance_account_transactions WHERE backfill_id=?)',
        ['expense_pay', backfillId])
      await safe('finance_period_backfills', 'DELETE FROM finance_period_backfills WHERE id=?', [backfillId])
    }
    for (const categoryId of cleanup.categoryIds) {
      await safe('expense_categories', 'DELETE FROM expense_categories WHERE id=?', [categoryId])
    }
    for (const userId of cleanup.userIds) {
      await safe('sys_users', 'DELETE FROM sys_users WHERE id=?', [userId])
    }
    for (const key of cleanup.requestKeys) {
      await safe('operation_requests', 'DELETE FROM operation_requests WHERE request_key=?', [key])
    }
    if (cleanup.acctPeriod) {
      // 只还原本次动过的那一行：原本就存在且已结账的期间不动它，原本不存在的删掉
      if (cleanup.acctPeriodPrevStatus == null) {
        await safe('acct_periods', 'DELETE FROM acct_periods WHERE company_id=1 AND period=?', [cleanup.acctPeriod])
      } else if (cleanup.acctPeriodPrevStatus !== 2) {
        await safe('acct_periods', 'UPDATE acct_periods SET status=? WHERE company_id=1 AND period=?',
          [cleanup.acctPeriodPrevStatus, cleanup.acctPeriod])
      }
    }

    await ctx.close()
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
