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
  const created = await ctx.http.post('/api/finance/accounts', { token, json: { name: randomRef('精度合法'), type: 2, openingBalance: 0.12 } })
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

test('创建资金账户拒绝非分期初，合法分位金额精确落库', async () => {
  for (const openingBalance of [0.001, 0.00005]) {
    const bad = await ctx.http.post('/api/finance/accounts', { token, json: { name: randomRef('精度拒绝'), type: 2, openingBalance } })
    assert.equal(bad.status, 400)
    assert.equal(bad.data.code, 'CASH_PRECISION_INVALID')
  }
  const [[row]] = await ctx.pool.query('SELECT opening_balance,current_balance FROM finance_accounts WHERE id=?', [accountId])
  assert.equal(row.opening_balance, '0.1200')
  assert.equal(row.current_balance, '0.1200')
})

test('修改期初与调整余额拒绝非分目标，合法调整精确落库', async () => {
  for (const openingBalance of [0.001, 0.00005]) {
    const update = await ctx.http.put(`/api/finance/accounts/${accountId}`, { token, json: { name: '精度合法', type: 2, isActive: true, openingBalance } })
    assert.equal(update.status, 400)
    assert.equal(update.data.code, openingBalance === 0.00005 ? 'MONEY_PRECISION_INVALID' : 'CASH_PRECISION_INVALID')
  }
  const path = `/api/finance/accounts/${accountId}/adjust`
  const rejected = await ctx.http.post(path, { token, json: { expectedBalance: 0.12, targetBalance: 0.00009 } })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.data.code, 'CASH_PRECISION_INVALID')
  const oldClient = await ctx.http.post(path, { token, json: { targetBalance: 0.43 } })
  assert.equal(oldClient.status, 400)
  const headers = { 'X-Request-Key': randomRef('adjust') }
  const payload = { expectedBalance: 0.12, targetBalance: 0.43 }
  const accepted = await ctx.http.post(path, { token, headers, json: payload })
  assert.equal(accepted.status, 200)
  const replay = await ctx.http.post(path, { token, headers, json: payload })
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.data.data, accepted.data.data)
  const stale = await ctx.http.post(path, { token, headers: { 'X-Request-Key': randomRef('stale') }, json: { ...payload, targetBalance: 0.32 } })
  assert.equal(stale.status, 409)
  assert.equal(stale.data.code, 'FINANCE_ACCOUNT_BALANCE_CHANGED')
  assert.equal(stale.data.data.currentBalance, 0.43)
  const [[row]] = await ctx.pool.query('SELECT opening_balance,current_balance FROM finance_accounts WHERE id=?', [accountId])
  assert.equal(row.opening_balance, '0.1200')
  assert.equal(row.current_balance, '0.4300')
  const [transactions] = await ctx.pool.query('SELECT direction, amount FROM finance_account_transactions WHERE account_id=?', [accountId])
  assert.deepEqual(transactions.map(t => [Number(t.direction), t.amount]), [[1, '0.3100']])
})

test('资金流水 service 边界拒绝非分金额', async () => {
  const conn = await ctx.pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const amount of [0.001, 0.00005]) await assert.rejects(accounts.recordTransaction(conn, { accountId, direction: 1, amount, bizType: 4 }), error => error.code === 'CASH_PRECISION_INVALID')
    await conn.rollback()
  } finally { conn.release() }
})
