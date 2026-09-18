#!/usr/bin/env node
'use strict'

/**
 * P0-3 回归：销售出库收入凭证必须按「折后净额」入账，与 payment_records(type=2) 口径一致。
 *
 * 背景（2026-09-18 多维度审计 P0-3）：
 *   voucher-engine.js 文件头声明的口径是「销售收入用毛额 SUM(shipped×售价)，销售退货单独冲
 *   → 净额 = payment_records(type=2)」。但 sale.service 的应收口径是
 *   「已发毛额 − 退货 − 整单折扣按已发比例分摊」。退货有独立凭证(8)去冲，**折扣没有独立单据、
 *   也就没有单独的冲销凭证**——修复前 1122 恒比子账应收多出 Σ折扣，总账与子账永远勾不平，
 *   收入与利润同步虚增。
 *
 * 本测试直接驱动 buildSaleRevenue（已导出供测试），不连数据库。
 * 运行：node tests/sale-revenue-discount.test.js
 */

const assert = require('node:assert/strict')
const path = require('node:path')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-for-auth-0123456789'

const { buildSaleRevenue } = require(path.resolve(__dirname, '../backend/src/modules/accounting/voucher-engine'))
const { DIR } = require(path.resolve(__dirname, '../backend/src/constants/voucherSource'))

// 只读桩连接：返回一行模拟的 payment_records ⋈ sale_orders ⋈ 已发明细汇总
const stubConn = (row) => ({ query: async () => [[row]] })
const rowOf = ({ gross, discount = 0, orderGross, soId = 1 }) => ({
  soId, order_no: 'SO-TEST-1', vdate: new Date('2026-09-18T10:00:00+08:00'),
  customer_id: 7, customer_name: '测试客户', gross, discount, orderGross,
})

const legOf = (voucher, code) => voucher.legs.find(l => l.code === code)
const amountOf = (voucher, code) => Number(legOf(voucher, code)?.amount ?? 0)
const debitTotal = (v) => v.legs.filter(l => l.direction === DIR.DEBIT).reduce((s, l) => s + Number(l.amount), 0)
const creditTotal = (v) => v.legs.filter(l => l.direction === DIR.CREDIT).reduce((s, l) => s + Number(l.amount), 0)

let failed = 0
const test = async (name, fn) => {
  try { await fn(); console.log('  [PASS]', name) }
  catch (e) { failed++; console.error('  [FAIL]', name, '\n', e.stack) }
}

async function main() {
  await test('无折扣时按毛额入账（修复不能改变无折扣场景）', async () => {
    const [v] = await buildSaleRevenue(stubConn(rowOf({ gross: 100, orderGross: 100 })), new Map())
    assert.equal(amountOf(v, '1122'), 100)
    assert.equal(amountOf(v, '6001'), 100)
    assert.equal(debitTotal(v), creditTotal(v), '借贷必须平衡')
  })

  await test('★全额发货 + 整单折扣：1122 必须是折后净额（修复前记毛额 100）', async () => {
    const [v] = await buildSaleRevenue(stubConn(rowOf({ gross: 100, discount: 10, orderGross: 100 })), new Map())
    assert.equal(amountOf(v, '1122'), 90, '1122 应等于 毛额 − 整单折扣')
    assert.equal(amountOf(v, '6001'), 90, '收入应同步净额化')
    assert.equal(debitTotal(v), creditTotal(v))
  })

  await test('★分批发货：折扣按「已发原值/订单原值」比例分摊，不是整单一次性扣', async () => {
    const [v] = await buildSaleRevenue(stubConn(rowOf({ gross: 50, discount: 10, orderGross: 100 })), new Map())
    // 10 × (50/100) = 5
    assert.equal(amountOf(v, '1122'), 45, '已发一半应只摊到一半折扣')
    assert.equal(amountOf(v, '6001'), 45)
  })

  await test('折扣分摊与销售侧口径函数一致（同一公式，不各写一套）', async () => {
    const { calculateDiscountApplied } = require(path.resolve(__dirname, '../backend/src/modules/sale/sale.contracts'))
    for (const [gross, discount, orderGross] of [[100, 10, 100], [50, 10, 100], [30, 7, 90], [0.3, 0.1, 1]]) {
      const [v] = await buildSaleRevenue(stubConn(rowOf({ gross, discount, orderGross })), new Map())
      const expected = gross - calculateDiscountApplied({ discount, shippedGross: gross, orderGross })
      assert.equal(amountOf(v, '1122'), Math.round(expected * 100) / 100, `gross=${gross} discount=${discount}`)
    }
  })

  await test('销项税额仍按发票取，且不得超过折后净额（避免出现负收入）', async () => {
    const [v] = await buildSaleRevenue(stubConn(rowOf({ gross: 100, discount: 10, orderGross: 100 })), new Map([[1, 8]]))
    assert.equal(amountOf(v, '1122'), 90)
    assert.equal(amountOf(v, '222102'), 8)
    assert.equal(amountOf(v, '6001'), 82)
    assert.equal(debitTotal(v), creditTotal(v))
  })

  await test('税额大于折后净额时被夹到净额，收入不为负', async () => {
    const [v] = await buildSaleRevenue(stubConn(rowOf({ gross: 100, discount: 90, orderGross: 100 })), new Map([[1, 500]]))
    assert.equal(amountOf(v, '1122'), 10)
    assert.equal(amountOf(v, '222102'), 10)
    assert.equal(amountOf(v, '6001'), 0)
    assert.equal(debitTotal(v), creditTotal(v))
  })

  await test('折后净额为 0 时不生成零额凭证', async () => {
    const vouchers = await buildSaleRevenue(stubConn(rowOf({ gross: 100, discount: 100, orderGross: 100 })), new Map())
    assert.equal(vouchers.length, 0)
  })

  console.log('\n' + '─'.repeat(60))
  console.log(`  销售收入凭证折扣口径: ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`)
  console.log('─'.repeat(60))
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
