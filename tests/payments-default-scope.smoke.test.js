'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
validateTestEnvironment()
const { pool } = require('../backend/src/config/db')
const payments = require('../backend/src/modules/payments/payments.service')
const exportsService = require('../backend/src/modules/export/export.service')

test('按单登记未结清查询：历史未付、部分付款、结清切换及导出口径一致', async t => {
  const name = `DEFAULT-${randomUUID().slice(0,8)}`
  const ids = []
  try {
    for (const type of [1,2]) {
      for (const [suffix,status,paid,balance,settlement,date] of [
        ['OLD',1,0,100,1,'2025-01-01'], ['PART',2,30,70,1,'2025-02-01'],
        ['PAID',3,100,0,1,'2025-03-01'], ['ZERO',1,0,0,1,'2025-04-01'],
        ['MONTH',1,0,100,2,'2025-05-01'],
      ]) {
        const [r] = await pool.query('INSERT INTO payment_records(type,order_no,party_name,total_amount,paid_amount,balance,status,settlement_type,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          [type,`${name}-${type}-${suffix}`,name,paid+balance,paid,balance,status,settlement,date])
        ids.push(r.insertId)
      }
      await t.test(`${type===1?'应付':'应收'}默认未结清涵盖旧单和部分付款，排除结清、零余额、月结`, async () => {
        const q = { type,partyName:name,status:'unsettled',settlementTypes:'1,3,4' }
        const data = await payments.findAll(q)
        assert.deepEqual(data.list.map(r=>r.orderNo.split('-').at(-1)),['PART','OLD'])
        assert.equal(data.summary.balance,170)
        assert.equal(data.pagination.total,2)
        const exported = await exportsService.getPaymentsExportPayload(q)
        assert.equal(exported.rows.length,2)
      })
      await t.test(`${type===1?'应付':'应收'}可显式查看结清或全部；导出同样遵守单号与日期筛选`, async () => {
        const q = {type,partyName:name,settlementTypes:'1,3,4'}
        assert.equal((await payments.findAll({...q,status:3})).pagination.total,1)
        assert.equal((await payments.findAll(q)).pagination.total,4)
        const selected = {...q,orderNo:`${name}-${type}-PART`,startDate:'2025-02-01',endDate:'2025-02-01'}
        assert.equal((await exportsService.getPaymentsExportPayload(selected)).rows.length,1)
      })
    }
  } finally {
    if (ids.length) {
      await pool.query('DELETE FROM party_ledger_events WHERE record_id IN (?)',[ids])
      await pool.query('DELETE FROM payment_records WHERE id IN (?)',[ids])
    }
    await pool.end()
  }
})
