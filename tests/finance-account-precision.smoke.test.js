'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { prepareSmokeContext, login, randomRef } = require('./helpers/smokeTestKit')
const { pool: appPool } = require('../backend/src/config/db')
const accounts = require('../backend/src/modules/finance/finance-accounts.service')

let ctx, token, accountId
before(async () => {
  require('./helpers/testEnvironment').validateTestEnvironment()
  process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
  ctx = await prepareSmokeContext()
  token = (await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')).token
  assert.ok(token)
  const created = await ctx.http.post('/api/finance/accounts', { token, json: { name: randomRef('精度合法'), type: 2, openingBalance: 0.1234 } })
  assert.equal(created.status, 201)
  accountId = created.data.data.id
})
after(async () => {
  if (ctx) {
    if (accountId) {
      await ctx.pool.query('DELETE FROM finance_account_transactions WHERE account_id=?', [accountId])
      await ctx.pool.query('DELETE FROM finance_accounts WHERE id=?', [accountId])
    }
    await ctx.close()
  }
  await appPool.end()
})

test('创建资金账户拒绝超四位期初，合法四位金额原样落库', async () => {
  const bad = await ctx.http.post('/api/finance/accounts', { token, json: { name: randomRef('精度拒绝'), type: 2, openingBalance: 0.00005 } })
  assert.equal(bad.status, 400)
  assert.equal(bad.data.code, 'MONEY_PRECISION_INVALID')
  const [[row]] = await ctx.pool.query('SELECT opening_balance,current_balance FROM finance_accounts WHERE id=?', [accountId])
  assert.equal(row.opening_balance, '0.1234')
  assert.equal(row.current_balance, '0.1234')
})

test('修改期初与调整余额拒绝超四位目标，合法调整精确落库', async () => {
  const update = await ctx.http.put(`/api/finance/accounts/${accountId}`, { token, json: { name: '精度合法', type: 2, isActive: true, openingBalance: 0.00005 } })
  assert.equal(update.status, 400)
  assert.equal(update.data.code, 'MONEY_PRECISION_INVALID')
  const rejected = await ctx.http.post(`/api/finance/accounts/${accountId}/adjust`, { token, json: { targetBalance: 0.00009 } })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.data.code, 'MONEY_PRECISION_INVALID')
  const accepted = await ctx.http.post(`/api/finance/accounts/${accountId}/adjust`, { token, json: { targetBalance: 0.4321 } })
  assert.equal(accepted.status, 200)
  const [[row]] = await ctx.pool.query('SELECT opening_balance,current_balance FROM finance_accounts WHERE id=?', [accountId])
  assert.equal(row.opening_balance, '0.1234')
  assert.equal(row.current_balance, '0.4321')
})

test('资金流水 service 边界拒绝超四位金额', async () => {
  const conn = await ctx.pool.getConnection()
  try {
    await conn.beginTransaction()
    await assert.rejects(accounts.recordTransaction(conn, { accountId, direction: 1, amount: 0.00005, bizType: 4 }), error => error.code === 'MONEY_PRECISION_INVALID')
    await conn.rollback()
  } finally { conn.release() }
})
