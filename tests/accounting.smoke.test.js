#!/usr/bin/env node
'use strict'

/**
 * 会计凭证引擎回归测试（文档 10 · Phase 1）。
 *   node tests/accounting.smoke.test.js
 *
 * 会计正确性是「静默出错」类风险（界面正常、数字悄悄不对）。本测试锁死几条违反即事故的口径：
 *   1. 每张凭证借贷必平（引擎入库前 assert，头表合计=分录合计）。
 *   2. 资金侧凭证(收/付款/报销的 1001/1002 分录)合计 === 资金流水(finance_account_transactions biz1/2/3)合计。
 *   3. 现金账户(type=2)→库存现金1001，其余→银行存款1002。
 *   4. 幂等：同一事实反复生成不新增、不改动（source_hash 未变即跳过）。
 *   5. UNIQUE(source_type, source_id)：无重复凭证。
 *   6. 引擎只读业务表、只写 acct_*（本测试全程事务内，结尾 rollback，不落任何数据）。
 *
 * 用可控资金 fixture（银行/现金账户各一 + 收/付/报销流水）保证 CI 空库也有确定断言；
 * 同时对库中既有业务事实一并生成并校验全量平衡，覆盖各 builder。
 */

const {
  createLogger,
  prepareSmokeContext,
  randomRef,
} = require('./helpers/smokeTestKit')
const engine = require('../backend/src/modules/accounting/voucher-engine')

const today = () => new Date().toISOString().slice(0, 10)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

async function vget(conn, sourceType, sourceId) {
  const [[v]] = await conn.query('SELECT * FROM acct_vouchers WHERE source_type=? AND source_id=?', [sourceType, sourceId])
  if (!v) return null
  const [es] = await conn.query('SELECT * FROM acct_voucher_entries WHERE voucher_id=? ORDER BY line_no', [v.id])
  return { v, es }
}
function leg(es, code, direction) {
  return es.find(e => e.account_code === code && e.direction === direction)
}

async function main() {
  const log = createLogger()
  log.section('会计凭证引擎回归')
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  try {
    // 全程事务内，结尾 rollback：先清空凭证作为确定起点
    await conn.query('DELETE FROM acct_voucher_entries')
    await conn.query('DELETE FROM acct_vouchers')

    // ── 可控资金 fixture ──────────────────────────────────────────────
    const [bank] = await conn.query('INSERT INTO finance_accounts (code,name,type) VALUES (?,?,1)', [randomRef('ACCT-BANK'), 'Smoke银行户'])
    const [cash] = await conn.query('INSERT INTO finance_accounts (code,name,type) VALUES (?,?,2)', [randomRef('ACCT-CASH'), 'Smoke现金户'])
    const insTxn = async (accountId, direction, amount, bizType, party, no) => {
      const [r] = await conn.query(
        `INSERT INTO finance_account_transactions (account_id,direction,amount,biz_type,biz_id,biz_no,party_name,balance_after,happened_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [accountId, direction, amount, bizType, null, no, party, amount, today()],
      )
      return r.insertId
    }
    const tReceiptBank = await insTxn(bank.insertId, 1, 123.45, 1, '测试客户A', 'RC-T1')  // 收款→银行
    const tReceiptCash = await insTxn(cash.insertId, 1, 200.00, 1, '测试客户B', 'RC-T2')  // 收款→现金
    const tPayout      = await insTxn(bank.insertId, 2, 67.89, 2, '测试供应商C', 'PY-T1')  // 付款
    const tExpense     = await insTxn(bank.insertId, 2, 50.00, 3, '测试员工D', 'EX-T1')    // 报销

    // ── 生成 ──────────────────────────────────────────────────────────
    const stats1 = await engine.generateVouchers(conn, { createdBy: 1 })
    log.assert('生成了凭证', stats1.created > 0, JSON.stringify(stats1))

    // ── fixture 凭证精确断言 ──────────────────────────────────────────
    const rcBank = await vget(conn, 'receipt_in', tReceiptBank)
    log.assert('收款(银行)：借1002/贷1122 各123.45',
      rcBank && r2(leg(rcBank.es, '1002', 1)?.amount) === 123.45 && r2(leg(rcBank.es, '1122', 2)?.amount) === 123.45,
      JSON.stringify(rcBank?.es?.map(e => [e.account_code, e.direction, Number(e.amount)])))
    log.assert('收款分录带往来名称快照(应收侧 aux_name=客户A)',
      rcBank && leg(rcBank.es, '1122', 2)?.aux_name === '测试客户A')

    const rcCash = await vget(conn, 'receipt_in', tReceiptCash)
    log.assert('收款(现金)→库存现金1001（type=2 账户映射）',
      rcCash && r2(leg(rcCash.es, '1001', 1)?.amount) === 200 && r2(leg(rcCash.es, '1122', 2)?.amount) === 200,
      JSON.stringify(rcCash?.es?.map(e => [e.account_code, e.direction, Number(e.amount)])))

    const po = await vget(conn, 'payment_out', tPayout)
    log.assert('付款：借2202/贷1002 各67.89',
      po && r2(leg(po.es, '2202', 1)?.amount) === 67.89 && r2(leg(po.es, '1002', 2)?.amount) === 67.89)

    const ex = await vget(conn, 'expense_pay', tExpense)
    log.assert('报销：借6602/贷1002 各50',
      ex && r2(leg(ex.es, '6602', 1)?.amount) === 50 && r2(leg(ex.es, '1002', 2)?.amount) === 50)

    // ── 全量平衡（含库中既有业务事实生成的凭证） ──────────────────────
    const [unbal] = await conn.query(`
      SELECT v.id, COALESCE(SUM(CASE WHEN e.direction=1 THEN e.amount END),0) d,
                    COALESCE(SUM(CASE WHEN e.direction=2 THEN e.amount END),0) c, v.total_debit, v.total_credit
        FROM acct_vouchers v JOIN acct_voucher_entries e ON e.voucher_id=v.id
       GROUP BY v.id
      HAVING ABS(d-c)>0.005 OR ABS(d-v.total_debit)>0.005 OR ABS(c-v.total_credit)>0.005`)
    log.assert('每张凭证借贷平衡且头表=分录', unbal.length === 0, `不平 ${unbal.length} 张`)

    // ── 资金勾稽 ──────────────────────────────────────────────────────
    const [[fundV]] = await conn.query(`
      SELECT COALESCE(SUM(e.amount),0) s FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id
       WHERE v.source_type IN ('receipt_in','payment_out','expense_pay') AND e.account_code IN ('1001','1002')`)
    const [[fundT]] = await conn.query(`
      SELECT COALESCE(SUM(t.amount),0) s FROM finance_account_transactions t
        JOIN finance_accounts fa ON fa.id=t.account_id WHERE t.biz_type IN (1,2,3)`)
    log.assert('资金侧凭证合计 === 资金流水合计', r2(fundV.s) === r2(fundT.s), `凭证${r2(fundV.s)} vs 流水${r2(fundT.s)}`)

    // ── 无重复来源 ────────────────────────────────────────────────────
    const [dup] = await conn.query(`SELECT source_type,source_id,COUNT(*) n FROM acct_vouchers GROUP BY source_type,source_id HAVING n>1`)
    log.assert('无重复 (source_type,source_id)', dup.length === 0, JSON.stringify(dup.slice(0, 3)))

    // ── 幂等 ──────────────────────────────────────────────────────────
    const stats2 = await engine.generateVouchers(conn, { createdBy: 1 })
    log.assert('幂等：二次生成 created=0 且 updated=0', stats2.created === 0 && stats2.updated === 0, JSON.stringify(stats2))
    const [[{ n: cnt }]] = await conn.query('SELECT COUNT(*) n FROM acct_vouchers')
    log.assert('幂等：凭证总数不变', cnt === stats1.created, `count=${cnt} created=${stats1.created}`)

    await conn.rollback()  // 不落任何数据
  } catch (e) {
    await conn.rollback()
    log.assert('测试过程无异常', false, e.message)
  } finally {
    conn.release()
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[ACCOUNTING] 未捕获异常：', e); process.exit(1) })
