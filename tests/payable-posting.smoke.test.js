#!/usr/bin/env node
'use strict'

/**
 * 非单据应付的入账口径与勾稽判定（2026-09-26 一致性审查 · 任务 3b）
 *
 * 被测命题：一笔「没有单据」的应付（承运商运费结算 / 手工录入），
 *   (1) 录入时是否被强制指定借方科目；
 *   (2) 会计点「生成本期凭证」后，勾稽的「未入账应付」是否真的把它销掉；
 *   (3) 凭证被红字冲销、或账面金额被改大而凭证没跟着重算时，是否重新把它报出来。
 *
 * (3) 是重点。判定一度写成「存在一条非零的 2202 分录即算已入账」：红冲后原凭证仍在表里
 * （status=3，分录金额照旧非零），于是**已被冲掉的应付反而显示为已入账**；只记了一部分金额
 * （净额 50 / 账款 100）同样蒙混过关。现改为「按来源汇总 2202 净额，与账款金额逐笔比对，
 * 只报差额」，故上面三条断言在旧实现下必红。
 *
 * 独占库：本测试跑在自己的库 flowcube_payable_test 上（启动时先执行全部迁移），不碰共享 smoke 库。
 * 必须独占的理由：它要走**真实的生成入口** POST /api/accounting/vouchers/generate——该入口是
 * 全量重算，在共享库上既会被无关的历史脏数据打断（销售来源不一致会让整批生成 409），
 * 又会就地更新已存在的凭证，事后按 id 删除新增项无法还原被更新的那些，等于污染别人的基线。
 * 在独占库上，写入与清理都由本测试负责：开头重置到确定起点，结尾（含失败路径）清干净。
 *
 * 运行：sh /tmp/run-test.sh node tests/payable-posting.smoke.test.js
 */

// 必须在 require 任何 backend 模块之前改写目标库，否则 db 配置会指向共享 smoke 库
const TARGET_DB = 'flowcube_payable_test'
process.env.NODE_ENV = 'test'
process.env.DB_NAME = TARGET_DB
// 本机测试实例用 3307；GitHub Actions 的独占 MySQL service 用 3306。
const port = String(process.env.DB_PORT)
const allowedPort = port === '3307' || (process.env.CI === 'true' && port === '3306')
if (process.env.DB_HOST !== '127.0.0.1' || !allowedPort || process.env.DB_NAME !== TARGET_DB) {
  console.error(`[拒运行] host=${process.env.DB_HOST} port=${port} name=${process.env.DB_NAME}（须为本机独占测试库 ${TARGET_DB}）`)
  process.exit(2)
}

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const FIXTURE_TAG = 'payable-posting smoke'
const ACCT_DEBIT = '6602'    // 管理费用：叶子、启用，合法的借方科目
const ACCT_SUMMARY = '2211'  // 应付职工薪酬：汇总科目（is_leaf=0），不该被允许记账
const ACCT_PAYABLE = '2202'  // 应付账款本身：借应付贷应付等于没记

const money = n => Number(Number(n).toFixed(2))

/**
 * 清空本测试在独占库里的全部残留（凭证与账款都只可能由本测试产生）。
 * 先自证独占：库里若存在带其它标记的账款，说明这库被别的东西用了，立即拒绝清理而非误删。
 */
async function resetFixtureData(pool) {
  const foreign = await dbQuery(pool,
    'SELECT id, remark FROM payment_records WHERE remark IS NULL OR remark <> ? LIMIT 5', [FIXTURE_TAG])
  if (foreign.length) {
    throw new Error(`独占库 ${TARGET_DB} 里存在非本测试创建的数据（payment_records id=${foreign.map(r => r.id).join(',')}），拒绝清理`)
  }
  await pool.query('DELETE FROM payment_entries')
  await pool.query('DELETE FROM payment_record_events')
  await pool.query('DELETE FROM payment_records')
  await pool.query('DELETE FROM acct_voucher_entries')
  await pool.query('DELETE FROM acct_vouchers')
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  let debitAccountWasActive = null

  try {
    const { token: tk } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!tk) throw new Error('管理员登录失败')

    const recon = async () => {
      const res = await ctx.http.get('/api/accounting/vouchers/reconciliation', { token: tk })
      if (!res.ok) throw new Error(`勾稽查询失败 ${res.status}：${JSON.stringify(res.data)}`)
      return res.data.data.unpostedLedger
    }
    const createPayable = async ({ amount, debitAccountCode, type = 1, settlementType, dueDate }) => {
      const res = await ctx.http.post('/api/payments', {
        token: tk,
        json: {
          type,
          orderNo: randomRef(type === 1 ? 'AP' : 'AR'),
          partyName: 'Smoke非单据应付',
          totalAmount: amount,
          ...(debitAccountCode === undefined ? {} : { debitAccountCode }),
          ...(settlementType === undefined ? {} : { settlementType }),
          ...(dueDate === undefined ? {} : { dueDate }),
          remark: FIXTURE_TAG,
        },
      })
      return res
    }
    const ymdOf = (v) => {
      if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      }
      return String(v || '').slice(0, 10)
    }
    const shiftToday = (days) => {
      const d = new Date()
      d.setDate(d.getDate() + days)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    // 真实生成入口：会计在凭证页点「生成本期凭证」走的就是它（POST /api/accounting/vouchers/generate）。
    // 顺带做副作用校验：生成是只读业务表的推导，不允许改动 payment_records 的任何列。
    const businessSnapshot = async () => JSON.stringify(
      await dbQuery(ctx.pool, 'SELECT id, total_amount, balance, status, confirm_status FROM payment_records ORDER BY id'))
    const generate = async () => {
      const bizBefore = await businessSnapshot()
      const res = await ctx.http.post('/api/accounting/vouchers/generate', { token: tk, json: {} })
      const bizAfter = await businessSnapshot()
      return { res, bizUnchanged: bizBefore === bizAfter, stats: res.data?.data }
    }
    const voucherOf = async (recordId) => {
      const [v] = await dbQuery(ctx.pool,
        `SELECT id FROM acct_vouchers
          WHERE company_id=1 AND source_type='manual_payable' AND source_id=? AND is_reversal=0 LIMIT 1`,
        [recordId])
      return v ? Number(v.id) : null
    }
    const countVouchers = async () =>
      Number((await dbQuery(ctx.pool, 'SELECT COUNT(*) n FROM acct_vouchers'))[0].n)

    // ── 起点：独占库重置到确定状态 ────────────────────────────────────────────
    log.section('起点：独占库重置（上次失败也不影响本次）')
    await resetFixtureData(ctx.pool)
    const accounts = await dbQuery(ctx.pool, 'SELECT COUNT(*) n FROM acct_accounts WHERE company_id=1 AND deleted_at IS NULL')
    log.assert(`独占库 ${TARGET_DB} 已迁移且干净（账款 0 行、凭证 0 张、账套 1 有科目）`,
      Number(accounts[0].n) > 0 && await countVouchers() === 0)

    // ── A. 手工应付的科目闸门 ─────────────────────────────────────────────────
    log.section('A. 手工应付必须逐笔指定合法借方科目')
    const noAccount = await createPayable({ amount: 50 })
    log.assert('★ 应付不传借方科目被拒绝（400）',
      noAccount.status === 400, `${noAccount.status} ${JSON.stringify(noAccount.data?.message)}`)
    log.assert('拒绝原因说明缺的是科目',
      /借方科目/.test(String(noAccount.data?.message || '')), String(noAccount.data?.message))

    const ghost = await createPayable({ amount: 50, debitAccountCode: '9999' })
    log.assert('不存在的科目被拒绝（400）', ghost.status === 400 && /不存在/.test(String(ghost.data?.message || '')),
      `${ghost.status} ${ghost.data?.message}`)

    const summary = await createPayable({ amount: 50, debitAccountCode: ACCT_SUMMARY })
    log.assert('汇总科目被拒绝（400）', summary.status === 400 && /汇总/.test(String(summary.data?.message || '')),
      `${summary.status} ${summary.data?.message}`)

    const payableItself = await createPayable({ amount: 50, debitAccountCode: ACCT_PAYABLE })
    log.assert('借方为应付账款本身被拒绝（400）',
      payableItself.status === 400 && /应付账款/.test(String(payableItself.data?.message || '')),
      `${payableItself.status} ${payableItself.data?.message}`)

    const [beforeActive] = await dbQuery(ctx.pool,
      'SELECT is_active FROM acct_accounts WHERE company_id=1 AND code=? AND deleted_at IS NULL LIMIT 1', [ACCT_DEBIT])
    debitAccountWasActive = Number(beforeActive?.is_active ?? 1)
    await ctx.pool.query('UPDATE acct_accounts SET is_active=0 WHERE company_id=1 AND code=?', [ACCT_DEBIT])
    const disabled = await createPayable({ amount: 50, debitAccountCode: ACCT_DEBIT })
    log.assert('停用科目被拒绝（400）', disabled.status === 400 && /停用/.test(String(disabled.data?.message || '')),
      `${disabled.status} ${disabled.data?.message}`)
    await ctx.pool.query('UPDATE acct_accounts SET is_active=? WHERE company_id=1 AND code=?', [debitAccountWasActive, ACCT_DEBIT])

    const receivable = await createPayable({ amount: 50, type: 2 })
    log.assert('应收（type=2）不传科目不受影响', receivable.ok === true,
      `${receivable.status} ${JSON.stringify(receivable.data?.message)}`)

    // ── A2. 结算方式与到期日：决定这笔账款落在哪个页面、账龄怎么算 ────────────────
    // 前端「新建应付账款」必选现结/月结：现结→现结供应商账款页，月结→月结供应商对账页。
    // 两个页面各按 settlement_type 筛（IMMEDIATE_SCOPE / MONTHLY_SCOPE），选错就等于从
    // 录入人的列表里消失，所以「建完能在列表看到」必须由真实列表接口证明，不能只看落库值。
    log.section('A2. 结算方式决定归属页面，到期日随之确定')
    const cash = await createPayable({ amount: 30, debitAccountCode: ACCT_DEBIT, settlementType: 1 })
    const cashId = Number(cash.data?.data?.id)
    log.assert('选现结的手工应付创建成功', cash.ok === true && cashId > 0, JSON.stringify(cash.data))
    const [cashRow] = await dbQuery(ctx.pool,
      'SELECT settlement_type, due_date FROM payment_records WHERE id = ?', [cashId])
    log.assert('★ 现结落 settlement_type=1、到期日=当天（现结当天到期）',
      Number(cashRow.settlement_type) === 1 && ymdOf(cashRow.due_date) === shiftToday(0),
      JSON.stringify({ settlement_type: cashRow.settlement_type, due_date: ymdOf(cashRow.due_date) }))

    const monthly = await createPayable({ amount: 40, debitAccountCode: ACCT_DEBIT, settlementType: 2 })
    const monthlyId = Number(monthly.data?.data?.id)
    const [monthlyRow] = await dbQuery(ctx.pool,
      'SELECT settlement_type, due_date FROM payment_records WHERE id = ?', [monthlyId])
    log.assert('★ 月结落 settlement_type=2、到期日=当天+30（月结默认账期）',
      Number(monthlyRow.settlement_type) === 2 && ymdOf(monthlyRow.due_date) === shiftToday(30),
      JSON.stringify({ settlement_type: monthlyRow.settlement_type, due_date: ymdOf(monthlyRow.due_date) }))

    const explicit = await createPayable({ amount: 45, debitAccountCode: ACCT_DEBIT, settlementType: 2, dueDate: '2026-12-31' })
    const [explicitRow] = await dbQuery(ctx.pool,
      'SELECT due_date FROM payment_records WHERE id = ?', [Number(explicit.data?.data?.id)])
    log.assert('显式指定的到期日优先于按结算方式推算',
      ymdOf(explicitRow.due_date) === '2026-12-31', ymdOf(explicitRow.due_date))

    // 归属页面：现结列表能看到现结那笔、看不到月结那笔（反之亦然）——这是「录入后可在列表追踪」的实证
    const cashList = await ctx.http.get('/api/payments?type=1&settlementTypes=1&pageSize=100', { token: tk })
    const cashIds = (cashList.data?.data?.list || []).map(r => Number(r.id))
    log.assert('★ 现结的手工应付出现在「现结账款」列表里',
      cashList.ok === true && cashIds.includes(cashId),
      `status=${cashList.status} list=${cashIds.join(',')}`)
    log.assert('月结的手工应付不出现在现结列表（它在月结对账页）', !cashIds.includes(monthlyId))

    const monthlyList = await ctx.http.get('/api/payments?type=1&settlementTypes=2&pageSize=100', { token: tk })
    const monthlyIds = (monthlyList.data?.data?.list || []).map(r => Number(r.id))
    log.assert('月结的手工应付出现在「月结对账」列表里',
      monthlyList.ok === true && monthlyIds.includes(monthlyId) && !monthlyIds.includes(cashId),
      `status=${monthlyList.status} list=${monthlyIds.join(',')}`)

    // 单据号与往来方为空是无效录入：路由层就应拒绝，不能落一条无单号的账款
    const blankNo = await createPayable({ amount: 10, debitAccountCode: ACCT_DEBIT })
    const blankRes = await ctx.http.post('/api/payments', {
      token: tk,
      json: { type: 1, orderNo: '', partyName: 'Smoke非单据应付', totalAmount: 10, debitAccountCode: ACCT_DEBIT, remark: FIXTURE_TAG },
    })
    log.assert('空单号被拒绝（400）', blankRes.status === 400, `${blankRes.status} ${blankRes.data?.message}`)
    // 上面这笔合法创建用于清理（避免造出无主数据）；删掉它，A2 段不留业务数据
    await ctx.pool.query('DELETE FROM payment_record_events WHERE payment_record_id = ?', [Number(blankNo.data?.data?.id)])
    await ctx.pool.query('DELETE FROM payment_records WHERE id = ?', [Number(blankNo.data?.data?.id)])
    await ctx.pool.query('DELETE FROM payment_record_events WHERE payment_record_id IN (?,?,?)', [cashId, monthlyId, Number(explicit.data?.data?.id)])
    await ctx.pool.query('DELETE FROM payment_records WHERE id IN (?,?,?)', [cashId, monthlyId, Number(explicit.data?.data?.id)])

    // ── B. 覆盖判定：生成前报出、生成后销掉、冲销后重新报出 ─────────────────────
    log.section('B. 未入账判定的三个时刻（未生成 / 已生成 / 被红冲）')
    const base = await recon()

    const okA = await createPayable({ amount: 100, debitAccountCode: ACCT_DEBIT })
    const idA = Number(okA.data?.data?.id)
    log.assert('带科目的手工应付创建成功', okA.ok === true && idA > 0, JSON.stringify(okA.data))

    const afterCreate = await recon()
    log.assert('★ 凭证未生成时，这笔应付被报为未入账',
      money(afterCreate.total - base.total) === 100
      && money(afterCreate.uncovered - base.uncovered) === 100
      && afterCreate.uncoveredCount - base.uncoveredCount === 1
      && money(afterCreate.unclassified - base.unclassified) === 0,
      JSON.stringify({ base, afterCreate }))
    log.assert('★ 建账款本身不生成凭证（凭证只有会计手动生成这一个入口）',
      await voucherOf(idA) === null)

    const okB = await createPayable({ amount: 200, debitAccountCode: ACCT_DEBIT })
    const idB = Number(okB.data?.data?.id)
    const gen1 = await generate()
    log.assert('★ 真实生成入口执行成功（全量重算）', gen1.res.ok === true,
      `${gen1.res.status} ${JSON.stringify(gen1.res.data)}`)
    log.assert('生成过程不改动业务表（payment_records 各列前后一致）', gen1.bizUnchanged === true)
    log.assert('生成只新增凭证，数量与结果一致', await countVouchers() > 0, JSON.stringify(gen1.stats))

    const afterGenerate = await recon()
    log.assert('★ 生成凭证后，未入账金额归零',
      money(afterGenerate.total - base.total) === 0
      && money(afterGenerate.uncovered - base.uncovered) === 0
      && afterGenerate.uncoveredCount === base.uncoveredCount,
      JSON.stringify({ base, afterGenerate }))

    const countAfterFirst = await countVouchers()
    await generate()
    await generate()
    const afterRegenerate = await recon()
    log.assert('重复生成凭证幂等：未入账口径与凭证张数都不再变化',
      money(afterRegenerate.total) === money(afterGenerate.total)
      && money(afterRegenerate.uncovered) === money(afterGenerate.uncovered)
      && await countVouchers() === countAfterFirst,
      JSON.stringify({ afterGenerate, afterRegenerate }))

    const voucherA = await voucherOf(idA)
    log.assert('A 笔确实生成了凭证（2202 来源 manual_payable）', !!voucherA, `voucherOf(${idA})=${voucherA}`)
    const reversal = await ctx.http.post(`/api/accounting/vouchers/${voucherA}/reverse`, { token: tk })
    log.assert('A 笔凭证红字冲销成功', reversal.ok === true,
      `${reversal.status} ${JSON.stringify(reversal.data?.message)}`)

    const afterReverse = await recon()
    log.assert('★ 凭证被红冲后，这笔应付重新被报为未入账（旧实现会误判为已入账）',
      money(afterReverse.total - base.total) === 100
      && money(afterReverse.uncovered - base.uncovered) === 100
      && afterReverse.uncoveredCount - base.uncoveredCount === 1,
      JSON.stringify({ base, afterReverse }))

    // ── C. 金额不等：账面金额被改大而凭证没跟着重算 ────────────────────────────
    log.section('C. 凭证净额只盖住一部分时，只报差额')
    // 造法取自真实成因：运费/手工应付的金额可被重算改写（见 logistics.freight.js 的重算分支），
    // 而凭证只在下次生成时更新。这里把账面 200 改到 250，凭证仍是 200。
    await ctx.pool.query('UPDATE payment_records SET total_amount=250, balance=250 WHERE id=?', [idB])
    const afterAmountChange = await recon()
    log.assert('★ 只覆盖一部分时，报出未覆盖的 50（旧实现按存在性判定会放过）',
      money(afterAmountChange.uncovered - base.uncovered) === 150  // A 的 100 全额 + B 的 50 差额
      && afterAmountChange.uncoveredCount - base.uncoveredCount === 2
      && money(afterAmountChange.total - base.total) === 150,
      JSON.stringify({ base, afterAmountChange }))

    // ── D. 历史未分类：不猜科目、不生成凭证、单独报告 ──────────────────────────
    log.section('D. 无借方科目的历史记录单独归类为未分类')
    const [insLegacy] = await ctx.pool.query(
      `INSERT INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,confirm_status,remark)
       VALUES (1,NULL,'Smoke历史未分类','Smoke历史未分类',77,77,1,?)`,
      [FIXTURE_TAG])
    const idLegacy = Number(insLegacy.insertId)
    const afterLegacy = await recon()
    log.assert('★ 无科目记录计入未分类金额与笔数，不计入未覆盖',
      money(afterLegacy.unclassified - base.unclassified) === 77
      && afterLegacy.unclassifiedCount - base.unclassifiedCount === 1
      && money(afterLegacy.uncovered - base.uncovered) === 150
      && money(afterLegacy.total - base.total) === 227,
      JSON.stringify({ base, afterLegacy }))

    await generate()
    const afterLegacyGenerate = await recon()
    log.assert('生成凭证时跳过无科目记录（不猜科目、不补凭证）',
      money(afterLegacyGenerate.unclassified - base.unclassified) === 77
      && afterLegacyGenerate.unclassifiedCount - base.unclassifiedCount === 1
      && (await dbQuery(ctx.pool,
        `SELECT id FROM acct_vouchers WHERE source_id=? AND source_type IN ('manual_payable','freight_settle')`,
        [idLegacy])).length === 0,
      JSON.stringify({ afterLegacyGenerate }))
    // 与 D 的跳过相反：B 笔的账面被改大后重跑一次生成，凭证被就地补到 250，差额自愈——
    // 这正是「未覆盖金额」的正确处置路径：先如实报出，重跑生成即可修复。
    log.assert('★ 重跑生成会把差额补上（B 的 50 自愈），只剩被红冲的 A 与未分类的历史',
      money(afterLegacyGenerate.uncovered - base.uncovered) === 100
      && afterLegacyGenerate.uncoveredCount - base.uncoveredCount === 1
      && money(afterLegacyGenerate.total - base.total) === 177,
      JSON.stringify({ base, afterLegacyGenerate }))

    // ── E. 收尾：清理后库回到起点 ─────────────────────────────────────────────
    log.section('E. 收尾：清空本测试数据，库回到起点')
    await resetFixtureData(ctx.pool)
    log.assert('清理后无残留（账款与凭证均为 0）',
      (await dbQuery(ctx.pool, 'SELECT COUNT(*) n FROM payment_records'))[0].n === 0
      && await countVouchers() === 0)
    return log
  } finally {
    // 失败路径也要清干净，且必须还原被临时停用的科目
    if (debitAccountWasActive !== null) {
      await ctx.pool.query('UPDATE acct_accounts SET is_active=? WHERE company_id=1 AND code=?',
        [debitAccountWasActive, ACCT_DEBIT]).catch(() => {})
    }
    await resetFixtureData(ctx.pool).catch(() => {})
    await ctx.close()
  }
}

main().then((log) => {
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}).catch((e) => {
  console.error('[PAYABLE-POSTING] 未捕获异常：', e)
  process.exit(1)
})
