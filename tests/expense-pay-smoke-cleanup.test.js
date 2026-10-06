'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

async function cleanupFixture(fail = false) {
  const file = path.join(__dirname, 'expense-pay-period-guard.smoke.test.js')
  const source = fs.readFileSync(file, 'utf8')
  const body = source.slice(source.indexOf('    const safe = async'), source.indexOf('    await ctx.close()'))
  assert.ok(body.startsWith('    const safe = async'))
  const state = { funds: [{ id: 101, account: 12, backfill: 99 }, { id: 102, account: 13, backfill: 100 }], vouchers: [{ id: 81, source: 101 }, { id: 82, source: 102 }], entries: [81, 82], refresh: [9, 10], families: [9, 10] }
  const process_ = {}, pool = { query: async (raw, params) => {
    if (fail) throw Error('owned cleanup failed')
    const sql = raw.replace(/\s+/g, ' ')
    if (sql.includes('FROM acct_voucher_entries')) {
      const own = new Set(state.funds.filter(f => f.account === params[0]).map(f => f.id))
      const ids = new Set(state.vouchers.filter(v => own.has(v.source)).map(v => v.id))
      state.entries = state.entries.filter(id => !ids.has(id))
    } else if (sql.includes('FROM acct_vouchers')) {
      const own = new Set(state.funds.filter(f => sql.includes('JOIN finance_account_transactions') ? f.account === params[0] : f.backfill === params.at(-1)).map(f => f.id))
      state.vouchers = state.vouchers.filter(v => !own.has(v.source))
    } else if (sql.includes('DELETE FROM finance_account_transactions')) state.funds = state.funds.filter(f => f.account !== params[0])
    else if (sql.includes('DELETE FROM refresh_token_sessions')) state.refresh = state.refresh.filter(id => id !== params[0])
    else if (sql.includes('DELETE FROM auth_session_families')) state.families = state.families.filter(id => id !== params[0])
    return [{}]
  } }
  const cleanup = { accountIds: [12], claimIds: [], backfillIds: [99], categoryIds: [], userIds: [9], requestKeys: [], acctPeriod: null }
  await vm.runInNewContext(`(async()=>{${body}\n})()`, { cleanup, pool, process: process_, console: { error() {} } })
  return { state, exitCode: process_.exitCode }
}
test('expense smoke removes only owned voucher children before owned source rows and closes owned sessions', async () => {
  const { state, exitCode } = await cleanupFixture()
  assert.deepEqual(state.vouchers.map(v => v.id), [82])
  assert.deepEqual(state.entries, [82])
  assert.deepEqual(state.funds.map(f => f.id), [102])
  assert.deepEqual(state.refresh, [10])
  assert.deepEqual(state.families, [10])
  assert.equal(exitCode, undefined)
})
test('expense smoke cleanup failure must make the smoke exit nonzero', async () => {
  assert.equal((await cleanupFixture(true)).exitCode, 1)
})
