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
  const receiptIds = []
  const statementIds = []
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
    for (const type of [1, 2]) await t.test(`只读来源 DTO ${type}: 原单身份、NULL 来源及四位金额保持`, async () => {
      const orderId = 900000000000 + Math.floor(Math.random() * 1000000000)
      const records = []
      for (const sourceId of [orderId, null]) {
        const [result] = await pool.query('INSERT INTO payment_records(type,order_id,order_no,party_name,total_amount,paid_amount,balance,status,settlement_type) VALUES(?,?,?,?,?,?,?,?,?)',
          [type,sourceId,`${name}-${type}-${sourceId ? 'SRC' : 'MAN'}`,name,'100.1234','30.0123','70.1111',2,1])
        ids.push(result.insertId); records.push(result.insertId)
      }
      const [r] = await pool.query('INSERT INTO payment_receipts(receipt_no,type,party_name,amount,settled_amount,balance,payment_date) VALUES(?,?,?,?,?,?,?)',
        [`${name}-${type}-R`,type,name,'80.1234','20.0123','60.1111','2026-10-03'])
      receiptIds.push(r.insertId)
      await pool.query('INSERT INTO payment_entries(record_id,receipt_id,amount,payment_date) VALUES ?', [records.map((id,index) => [id,r.insertId,index ? '10.0062' : '10.0061','2026-10-03'])])
      const [st] = await pool.query('INSERT INTO reconciliation_statements(statement_no,type,party_name,total_amount,settled_amount,balance) VALUES(?,?,?,?,?,?)',
        [`${name}-${type}-S`,type,name,0,0,0])
      statementIds.push(st.insertId)
      await pool.query('INSERT INTO reconciliation_statement_items(statement_id,record_id,order_no,total_amount) VALUES ?', [records.map(id => [st.insertId,id,`${name}-${id}`,100.1234])])
      const receipt = await require('../backend/src/modules/payments/payment-receipts.service').findById(r.insertId)
      const statement = await require('../backend/src/modules/payments/reconciliation-statements.service').findById(st.insertId)
      const list = (await payments.findAll({type,partyName:name})).list.filter(x => records.includes(x.id))
      assert.equal(list.find(x => x.id === records[0]).orderId, orderId)
      assert.equal(list.find(x => x.id === records[1]).orderId, null)
      assert.deepEqual(receipt.settlements.map(x => [x.orderId,x.type]), [[orderId,type],[null,type]])
      assert.deepEqual(records.map(id => { const item = statement.items.find(x => x.recordId === id); return [item.orderId,item.type] }), [[orderId,type],[null,type]])
      assert.equal(receipt.amount,80.1234); assert.equal(receipt.settledAmount,20.0123); assert.equal(receipt.balance,60.1111)
      assert.equal(statement.totalAmount,200.2468); assert.equal(statement.settledAmount,60.0246); assert.equal(statement.balance,200.2468 - 60.0246); assert.equal(statement.balance.toFixed(4),'140.2222')
      assert.equal(receipt.settlements[0].orderBalance,70.1111)
    })
  } finally {
    if (receiptIds.length) await pool.query('DELETE FROM payment_entries WHERE receipt_id IN (?)',[receiptIds])
    if (statementIds.length) {
      await pool.query('DELETE FROM reconciliation_statement_items WHERE statement_id IN (?)',[statementIds])
      await pool.query('DELETE FROM reconciliation_statements WHERE id IN (?)',[statementIds])
    }
    if (receiptIds.length) await pool.query('DELETE FROM payment_receipts WHERE id IN (?)',[receiptIds])
    if (ids.length) {
      await pool.query('DELETE FROM party_ledger_events WHERE record_id IN (?)',[ids])
      await pool.query('DELETE FROM payment_records WHERE id IN (?)',[ids])
    }
    await pool.end()
  }
})
