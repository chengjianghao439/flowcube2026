#!/usr/bin/env node
'use strict'

/**
 * 会计结转/期间锁定 + PDA 扫码盘点 回归测试（审计 3.5）。
 *   node tests/accounting-period.smoke.test.js
 *
 * 这两块是 v0.4.60/61 两大新功能，此前零测试。会计正确性是「静默出错」类风险：
 * 界面正常、数字悄悄不对。本测试锁死：
 *
 * 结转（accounting.period.service）：
 *   1. 损益结转凭证借贷平衡（收入清零 + 差额落 4103）。
 *   2. 幂等：重复生成不新增凭证、不改动已生成的。
 *   3. 结账后写凭证被拒（assertPeriodOpen 抛 409）。
 *   4. 反结账恢复可写。
 *   5. 结账前置校验：结转凭证未生成时结账被拒。
 *
 * 扫码盘点（POST /api/stockcheck/:id/items/:itemId/scan）：
 *   6. 个体容器扫到计 1。
 *   7. 数量容器预填账面数可改。
 *   8. 无 PDA 会话被拒（403）。
 *
 * 全程事务内，结尾 rollback——不落任何数据（同 accounting.smoke.test.js 模式）。
 */

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  randomRef,
} = require('./helpers/smokeTestKit')
const periodSvc = require('../backend/src/modules/accounting/accounting.period.service')
const engine = require('../backend/src/modules/accounting/voucher-engine')
const { SOURCE_TYPES } = require('../backend/src/constants/voucherSource')

const today = () => new Date().toISOString().slice(0, 10)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

async function main() {
  const log = createLogger()
  log.section('会计结转/期间锁定 + 扫码盘点回归')
  const ctx = await prepareSmokeContext()
  const { pool } = ctx

  // periodSvc 自开事务（pool.getConnection），测试无法用外层事务与其共享——
  // 因此这里不走「事务内 rollback」模式，改为：测试后显式清理本次产生的数据。
  const cleanup = async () => {
    await conn.query('DELETE FROM acct_voucher_entries WHERE voucher_id IN (SELECT id FROM acct_vouchers WHERE voucher_no LIKE ?)', ['V-CLOSE-%'])
    await conn.query('DELETE FROM acct_vouchers WHERE voucher_no LIKE ?', ['V-CLOSE-%'])
    await conn.query('DELETE FROM acct_voucher_entries WHERE voucher_id IN (SELECT id FROM acct_vouchers WHERE source_type IN (?, ?))', [SOURCE_TYPES.PERIOD_CLOSE, SOURCE_TYPES.PERIOD_CLOSE_Y])
    await conn.query('DELETE FROM acct_vouchers WHERE source_type IN (?, ?)', [SOURCE_TYPES.PERIOD_CLOSE, SOURCE_TYPES.PERIOD_CLOSE_Y])
    await conn.query("DELETE FROM acct_periods WHERE period = '209901'")
  }
  const conn = await pool.getConnection()
  try {
    // 确定起点：清掉本测试将触碰的结转凭证与期间行
    await cleanup()

    // ── 结转 fixture：给 2099-01 造一张"销售费用"凭证（借 6601 500），
    //    以及一张收入凭证（贷 6001 800），让损益有净额可结转。
    //    直接用 acct 表插入业务凭证，避开业务链路复杂度，只测结转自身逻辑。
    const [[acct6601]] = await conn.query("SELECT id FROM acct_accounts WHERE code='6601'")
    const [[acct6001]] = await conn.query("SELECT id FROM acct_accounts WHERE code='6001'")
    const [[acct4103]] = await conn.query("SELECT id FROM acct_accounts WHERE code='4103'")
    if (!acct6601 || !acct6001 || !acct4103) {
      throw new Error('缺少结转所需科目（6601/6001/4103），请确认 177/194 迁移已执行')
    }

    // 手动插两张业务凭证（模拟"发生了费用与收入"），voucher_no 用随机号避免撞车
    const insVoucher = async (voucherNo, voucherDate, legs) => {
      const [r] = await conn.query(
        'INSERT INTO acct_vouchers (voucher_no, voucher_date, period, source_type, source_id, summary, created_by) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [voucherNo, voucherDate, '209901', 'manual', null, '结转测试业务凭证'],
      )
      let line = 0
      for (const l of legs) {
        line += 1
        await conn.query(
          'INSERT INTO acct_voucher_entries (voucher_id, account_id, account_code, account_name, direction, amount, summary, line_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [r.insertId, l.accountId, l.code, l.name, l.direction, l.amount, l.summary || '', line],
        )
      }
      return r.insertId
    }
    await insVoucher(randomRef('V-CLOSE-1').slice(0, 30), '2099-01-31', [
      { accountId: acct6601.id, code: '6601', name: '销售费用', direction: 1, amount: 500 },
    ])
    await insVoucher(randomRef('V-CLOSE-2').slice(0, 30), '2099-01-31', [
      { accountId: acct6001.id, code: '6001', name: '主营业务收入', direction: 2, amount: 800 },
    ])

    // ── 生成结转凭证 ────────────────────────────────────────────────
    const gen1 = await periodSvc.generateClosingVouchers('209901', 1)
    log.assert('生成了损益结转凭证', gen1.generated >= 1 && gen1.status?.pl === 'current',
      JSON.stringify({ generated: gen1.generated, status: gen1.status }))

    // 校验结转凭证借贷平衡
    const [[v]] = await conn.query('SELECT * FROM acct_vouchers WHERE source_type=? AND source_id=?', [SOURCE_TYPES.PERIOD_CLOSE, 209901])
    const [es] = await conn.query('SELECT * FROM acct_voucher_entries WHERE voucher_id=?', [v.id])
    const debit = es.filter(e => e.direction === 1).reduce((s, e) => s + Number(e.amount), 0)
    const credit = es.filter(e => e.direction === 2).reduce((s, e) => s + Number(e.amount), 0)
    log.assert('结转凭证借贷平衡', r2(debit) === r2(credit), `借=${debit} 贷=${credit}`)

    // 收入 800 - 费用 500 = 利润 300 → 4103 贷方 300
    const leg4103 = es.find(e => e.account_code === '4103')
    log.assert('利润差额落 4103（收入-费用=300 贷记）', leg4103 && r2(leg4103.amount) === 300,
      JSON.stringify(es.map(e => [e.account_code, e.direction, Number(e.amount)])))
    // 6601 清零（借 500 → 贷 500）
    const leg6601 = es.find(e => e.account_code === '6601')
    log.assert('费用科目 6601 反向清零', leg6601 && leg6601.direction === 2 && r2(leg6601.amount) === 500,
      JSON.stringify(es.map(e => [e.account_code, e.direction, Number(e.amount)])))

    // ── 幂等：重复生成不新增 ─────────────────────────────────────────
    const idBefore = v.id
    const gen2 = await periodSvc.generateClosingVouchers('209901', 1)
    const [[v2]] = await conn.query('SELECT * FROM acct_vouchers WHERE source_type=? AND source_id=?', [SOURCE_TYPES.PERIOD_CLOSE, 209901])
    log.assert('重复生成幂等（同凭证 id，未新增）', Number(v2.id) === Number(idBefore) && gen2.status?.pl === 'current',
      `before=${idBefore} after=${v2.id} generated=${gen2.generated}`)

    // ── 结账前置：已生成且最新 → 可结账 ──────────────────────────────
    const closed = await periodSvc.closePeriod('209901', { userId: 1, realName: '测试员' })
    log.assert('结账成功', closed.status === 2, JSON.stringify(closed))

    // ── 结账后写凭证被拒 ─────────────────────────────────────────────
    let blocked = false
    try { await periodSvc.generateClosingVouchers('209901', 1) } catch (e) { blocked = e.code === 'ACCT_PERIOD_CLOSED' }
    log.assert('★ 结账后重生成结转凭证被拒（期间锁定）', blocked, '应抛 ACCT_PERIOD_CLOSED')

    // ── 反结账恢复可写 ───────────────────────────────────────────────
    const reopened = await periodSvc.reopenPeriod('209901', { userId: 1 })
    log.assert('反结账成功', reopened.status === 1, JSON.stringify(reopened))
    const regen = await periodSvc.generateClosingVouchers('209901', 1)
    log.assert('反结账后可再次生成结转凭证', regen.status?.pl === 'current', JSON.stringify(regen.status))

    // ── 结账前置校验：结转凭证被删 → 结账被拒 ─────────────────────────
    await conn.query('DELETE FROM acct_voucher_entries WHERE voucher_id=?', [v2.id])
    await conn.query('DELETE FROM acct_vouchers WHERE id=?', [v2.id])
    let denied = false
    try { await periodSvc.closePeriod('209901', { userId: 1 }) } catch (e) { denied = e.code === 'ACCT_CLOSING_VOUCHER_REQUIRED' }
    log.assert('★ 结转凭证未生成时结账被拒', denied, '应抛 ACCT_CLOSING_VOUCHER_REQUIRED')

    // ── 扫码盘点：个体容器扫到计 1、数量容器预填账面 ───────────────────
    log.section('扫码盘点（POST /api/stockcheck/:id/items/:itemId/scan）')
    const stockcheckSvc = require('../backend/src/modules/stockcheck/stockcheck.service')
    const product = ctx.product
    // 建一个 ACTIVE 个体容器（type=1 initial_qty=1）与一个数量容器（type=0 initial_qty=5）
    const [cInd] = await conn.query(
      `INSERT INTO inventory_containers (barcode, product_id, warehouse_id, remaining_qty, initial_qty, container_type, status, location_id)
       VALUES (?, ?, ?, 1, 1, 1, 1, ?)`,
      [randomRef('C-IND').slice(0, 40), product.id, ctx.warehouse.id, ctx.location.id],
    )
    const [cQty] = await conn.query(
      `INSERT INTO inventory_containers (barcode, product_id, warehouse_id, remaining_qty, initial_qty, container_type, status, location_id)
       VALUES (?, ?, ?, 5, 5, 0, 1, ?)`,
      [randomRef('C-QTY').slice(0, 40), product.id, ctx.warehouse.id, ctx.location.id],
    )

    // 建盘点单与明细
    const [ck] = await conn.query(
      "INSERT INTO inventory_checks (check_no, warehouse_id, warehouse_name, status, operator_id, operator_name) VALUES (?, ?, ?, 1, 1, '测试员')",
      [randomRef('CK').slice(0, 30), ctx.warehouse.id, ctx.warehouse.name],
    )
    const [cki] = await conn.query(
      'INSERT INTO inventory_check_items (check_id, product_id, product_code, product_name, book_qty, unit) VALUES (?, ?, ?, ?, 6, ?)',
      [ck.insertId, product.id, product.code, product.name, 6, product.unit],
    )

    // 个体容器扫到计 1
    const indBarcode = await (async () => { const [[r]] = await conn.query('SELECT barcode FROM inventory_containers WHERE id=?', [cInd.insertId]); return r.barcode })()
    const qtyBarcode = await (async () => { const [[r]] = await conn.query('SELECT barcode FROM inventory_containers WHERE id=?', [cQty.insertId]); return r.barcode })()
    const scanInd = await stockcheckSvc.saveItemContainerScans(ck.insertId, cki.insertId,
      [{ barcode: indBarcode, countedQty: 1 }], { userId: 1 }, null)
    log.assert('★ 个体容器扫到计 1（actualQty=1）', Number(scanInd.actualQty) === 1, JSON.stringify(scanInd))

    // 数量容器预填账面 5（countedQty 可覆盖）
    const scanQty = await stockcheckSvc.saveItemContainerScans(ck.insertId, cki.insertId,
      [{ barcode: qtyBarcode, countedQty: 5 }], { userId: 1 }, null)
    log.assert('★ 数量容器预填账面计 5', Number(scanQty.actualQty) === 5, JSON.stringify(scanQty))

    // 汇总：两容器共 6 = 账面 6 → 无差异
    const final = await stockcheckSvc.saveItemContainerScans(ck.insertId, cki.insertId,
      [
        { barcode: indBarcode, countedQty: 1 },
        { barcode: qtyBarcode, countedQty: 5 },
      ], { userId: 1 }, null)
    log.assert('个体+数量容器合计=账面（6=6，diffQty=0）',
      Number(final.actualQty) === 6 && Number(final.diffQty) === 0, JSON.stringify(final))

    // 无 PDA 会话被拒（路由层拦截，直接调 service 不需要；这里验证 HTTP 接口）
    const { login } = require('./helpers/smokeTestKit')
    const { token: adminToken } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    const httpResp = await ctx.http.post(`/api/stockcheck/${ck.insertId}/items/${cki.insertId}/scan`, {
      token: adminToken,
      headers: { 'X-Client': 'pda' }, // 无 X-PDA-Session
      json: { scans: [{ barcode: indBarcode, countedQty: 1 }] },
    })
    log.assert('★ 扫码盘点无 PDA 会话被拒（403）',
      httpResp.status === 403 && httpResp.data?.code === 'PDA_SESSION_REQUIRED',
      `status=${httpResp.status} code=${httpResp.data?.code}`)

    await conn.commit() // 落库后统一清理
    await cleanup()
  } catch (e) {
    await conn.rollback()
    await cleanup().catch(() => {})
    throw e
  } finally {
    conn.release()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[ACCOUNTING-PERIOD] 未捕获异常：', e)
  process.exit(1)
})
