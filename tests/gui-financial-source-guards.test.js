const test = require('node:test')
const assert = require('node:assert/strict')

process.env.JWT_SECRET ||= 'test-only-secret-not-used-for-auth-0123456789'
const { pool } = require('../backend/src/config/db')
const { buildSaleReturn } = require('../backend/src/modules/accounting/voucher-engine')
const invoices = require('../backend/src/modules/accounting/accounting.invoice.service')
const freight = require('../backend/src/modules/logistics/logistics.freight')

test('只有真实关联原单的合格退货冲应收；无源退货不二次冲回', async () => {
  const conn = {
    async query(sql) {
      if (sql.includes('AS cogsBack')) return [[
        { id: 1, sale_order_id: 11, return_no: 'SR-LINKED', arAmount: '11.00', cogsBack: '5.00' },
        { id: 2, sale_order_id: null, return_no: 'SR-UNLINKED', arAmount: '11.00', cogsBack: '0.00' },
        { id: 3, sale_order_id: 11, return_no: 'SR-REJECTED', arAmount: '0.00', cogsBack: '0.00' },
      ]]
      if (sql.includes('COUNT(*) AS missing')) return [[{ missing: 0 }]]
      return [[]]
    },
  }
  const specs = await buildSaleReturn(conn)
  assert.deepEqual(specs.map(s => [s.sourceId, s.legs.map(l => [l.code, l.amount])]), [
    [1, [['6001', 11], ['1122', 11], ['1405', 5], ['6401', 5]]],
  ])
})

test('同一账套重复无代码进项发票在写入前被拒绝', async t => {
  const trace = []
  const conn = {
    beginTransaction: async () => {},
    rollback: async () => { trace.push('rollback') },
    commit: async () => { trace.push('commit') },
    release: () => {},
    async query(sql, args) {
      if (sql.includes('acct_companies')) {
        assert.deepEqual(args, [2])
        trace.push('company lock')
        return [[{ id: 2 }]]
      }
      if (sql.includes('FROM fin_invoices')) {
        trace.push('duplicate lookup')
        assert.equal(args[0], 2)
        return [[{ id: 9 }]]
      }
      trace.push('write')
      return [{ insertId: 10 }]
    },
  }
  t.mock.method(pool, 'getConnection', async () => conn)
  await assert.rejects(invoices.createInvoice({
    invoiceType: 1, invoiceNo: 'QA-001', invoiceCode: ' ', partyName: '合成供应商',
    amountNoTax: 10, taxRate: 0.1, taxAmount: 1, amountWithTax: 11, invoiceDate: '2026-11-12',
  }, null, 2), { code: 'INVOICE_DUP' })
  assert.deepEqual(trace, ['company lock', 'duplicate lookup', 'rollback'])
})

test('没有同承运商寄付证据的账单不得创建应付', async t => {
  const writes = []
  const conn = {
    beginTransaction: async () => {},
    rollback: async () => {},
    release: () => {},
    async query(sql) {
      if (sql.includes('FROM carriers')) return [[{ id: 1, name: '合成承运商' }]]
      if (sql.includes('FROM logistics_freight_settlements')) return [[]]
      if (sql.includes('FROM logistics_freight_bills')) {
        // LEFT JOIN returns an unmatched bill; an eligibility filter must keep it out.
        return sql.includes('w.freight_type = 1') && !sql.includes('OR b.waybill_id IS NULL')
          ? [[]] : [[{ id: 3, actual_freight: '5.00', waybill_id: null }]]
      }
      writes.push(sql)
      throw Error('生成运费时执行了非预期写入')
    },
  }
  t.mock.method(pool, 'getConnection', async () => conn)
  await assert.rejects(freight.generateSettlement({ carrierId: 1, billPeriod: '2026-11' }), { code: 'FREIGHT_NO_ELIGIBLE_BILLS' })
  assert.deepEqual(writes, [])
})
