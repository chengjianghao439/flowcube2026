'use strict'

// 只使用 configureTestEnvironment 指向的独立 MySQL 测试库；SQL 钩子仅控制真实查询时序。
require('./helpers/testEnvironment').configureTestEnvironment()
const assert = require('node:assert/strict')
const { prepareSmokeContext } = require('./helpers/smokeTestKit')
const { pool } = require('../backend/src/config/db')
const assets = require('../backend/src/modules/fixed-assets/fixed-assets.service')
const accounts = require('../backend/src/modules/finance/finance-accounts.service')
const receipts = require('../backend/src/modules/payments/payment-receipts.service')
const { generateContainerCode } = require('../backend/src/utils/codeGenerator')
const op = { userId: 1, realName: 'Finance regression', operatorId: 1, operatorName: 'Finance regression' }
const failures = []
let passed = 0
const createdAssets = []
const createdAccounts = []
const q = (...args) => pool.query(...args)
async function test(name, run) {
  try { await run(); passed++; console.log('[PASS]', name) }
  catch (e) { failures.push(name); console.error('[FAIL]', name, e.message) }
}
async function asset(data = {}) {
  const a = await assets.createAsset({ assetName: 'Prelaunch regression', acquireDate: '2026-01-01', originalCost: 100, residualRate: 0, usefulMonths: 6, ...data }, op)
  createdAssets.push(a.id)
  return a
}
async function account() {
  const a = await accounts.create({ name: 'Prelaunch regression', type: 1 }, op)
  createdAccounts.push(a.id)
  return a
}
async function parkAssets() {
  if (createdAssets.length) await q('UPDATE fixed_assets SET status=3 WHERE id IN (?)', [createdAssets])
}
async function assetLedgerSnapshot(id) {
  const [history] = await q('SELECT * FROM fixed_asset_depr WHERE asset_id=? ORDER BY period', [id])
  const [vouchers] = await q("SELECT v.* FROM acct_vouchers v JOIN fixed_asset_depr d ON v.source_type='asset_depreciation' AND v.source_id=d.id WHERE d.asset_id=? ORDER BY v.id", [id])
  const [entries] = await q("SELECT e.* FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id JOIN fixed_asset_depr d ON v.source_type='asset_depreciation' AND v.source_id=d.id WHERE d.asset_id=? ORDER BY e.id", [id])
  return { history, vouchers, entries }
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function timeout(promise) { return Promise.race([promise, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('SQL timing hook timed out')), 5000); t.unref() })]) }

async function main() {
  const ctx = await prepareSmokeContext()
  try {
    await test('F01 concurrent receipts retain both committed amounts despite prior RR snapshot', async () => {
      const a = await account()
      const ready = deferred(), resume = deferred()
      const get = pool.getConnection.bind(pool)
      let intercepted = false
      pool.getConnection = async () => {
        const conn = await get()
        if (!intercepted) {
          intercepted = true
          const query = conn.query.bind(conn)
          conn.query = async (...args) => {
            const result = await query(...args)
            if (String(args[0]).startsWith('SELECT value FROM sys_settings')) { ready.resolve(); await resume.promise }
            return result
          }
        }
        return conn
      }
      const second = receipts.create({ type: 2, partyName: 'Regression', amount: 20, paymentDate: '2026-09-05', accountId: a.id }, op)
      try {
        await timeout(ready.promise)
        await receipts.create({ type: 2, partyName: 'Regression', amount: 10, paymentDate: '2026-09-05', accountId: a.id }, op)
      } finally { resume.resolve(); pool.getConnection = get }
      await second
      assert.equal((await accounts.findById(a.id)).currentBalance, 30)
      const tx = await accounts.findTransactions({ accountId: a.id })
      assert.deepEqual(tx.list.map(r => r.balanceAfter).sort((a, b) => a - b), [10, 30])
      assert.equal(tx.list[0].happenedAt, '2026-09-05')
    })
    await test('F02 deletion and receipt serialize: never delete an account with a committed transaction', async () => {
      const a = await account()
      const ready = deferred(), resume = deferred()
      const get = pool.getConnection.bind(pool), query = pool.query.bind(pool)
      let intercepted = false
      const wrap = fn => async (...args) => {
        const result = await fn(...args)
        if (!intercepted && /finance_account_transactions/.test(String(args[0])) && /^SELECT/.test(String(args[0]))) {
          intercepted = true; ready.resolve(); await resume.promise
        }
        return result
      }
      pool.query = wrap(query)
      pool.getConnection = async () => { const c = await get(); c.query = wrap(c.query.bind(c)); return c }
      const deletion = accounts.softDelete(a.id).then(() => true, () => false)
      let outcomes
      try {
      await timeout(ready.promise)
      // Once the check is paused, start a real write. A locked deletion makes this write wait.
      const receipt = receipts.create({ type: 2, partyName: 'Regression', amount: 30, paymentDate: '2026-09-05', accountId: a.id }, op).then(() => true, () => false)
      await new Promise(resolve => setTimeout(resolve, 150))
      resume.resolve()
      outcomes = await Promise.all([deletion, receipt])
      } finally { resume.resolve(); pool.query = query; pool.getConnection = get; await deletion }
      assert.equal(outcomes.filter(Boolean).length, 1)
      const [[r]] = await q('SELECT deleted_at,(SELECT COUNT(*) FROM finance_account_transactions WHERE account_id=?) AS n FROM finance_accounts WHERE id=?', [a.id, a.id])
      assert.ok(!r.deleted_at || Number(r.n) === 0)
    })
    await test('F03 final depreciation voucher and response use the actual remaining cents', async () => {
      const a = await asset()
      let result
      for (const period of ['202601','202602','202603','202604','202605','202606']) result = await assets.runDepreciation({ period }, op)
      const [[last]] = await q("SELECT d.monthly_amount,v.total_debit FROM fixed_asset_depr d JOIN acct_vouchers v ON v.source_type='asset_depreciation' AND v.source_id=d.id WHERE d.asset_id=? ORDER BY d.period DESC LIMIT 1", [a.id])
      assert.equal(Number(last.monthly_amount), 16.65)
      assert.equal(Number(last.total_debit), 16.65)
      assert.equal(result.vouchers.find(r => r.assetId === a.id).monthly, 16.65)
      const before = await assetLedgerSnapshot(a.id)
      await assets.runDepreciation({ period: '202606' }, op)
      await assets.runDepreciation({ period: '202601' }, op)
      assert.deepEqual(await assetLedgerSnapshot(a.id), before)
    })
    await test('F11 fully depreciated asset disposes next month without another depreciation', async () => {
      const a = createdAssets[0]
      const result = await assets.disposeAsset(a, { disposeType: 2, disposeDate: '2026-07-01' }, op)
      assert.equal(result.netBook, 0)
      const [[r]] = await q('SELECT COUNT(*) AS n,SUM(monthly_amount) AS total FROM fixed_asset_depr WHERE asset_id=?', [a])
      assert.equal(Number(r.n), 6); assert.equal(Number(r.total), 100)
    })
    await parkAssets()
    await test('F10 replay of an existing period leaves ledger and voucher unchanged', async () => {
      const a = await asset()
      await assets.runDepreciation({ period: '202601' }, op)
      const before = await assetLedgerSnapshot(a.id)
      await assets.runDepreciation({ period: '202601' }, op)
      assert.deepEqual(await assetLedgerSnapshot(a.id), before)
      await assets.runDepreciation({ period: '202602' }, op)
      const withLaterPeriod = await assetLedgerSnapshot(a.id)
      await assets.runDepreciation({ period: '202601' }, op)
      assert.deepEqual(await assetLedgerSnapshot(a.id), withLaterPeriod)
    })
    await parkAssets()
    await test('F10 reject a new period older than existing depreciation history', async () => {
      await asset()
      await assets.runDepreciation({ period: '202603' }, op)
      await assert.rejects(assets.runDepreciation({ period: '202602' }, op), e => e.statusCode === 409)
    })
    await parkAssets()
    await test('F04 disposal creates same-transaction depreciation voucher and F14 DATE strings', async () => {
      const a = await asset({ acquireDate: '2026-09-01', originalCost: 1200, residualRate: 0.05, usefulMonths: 12 })
      await assets.disposeAsset(a.id, { disposeType: 2, disposeDate: '2026-09-05' }, op)
      const detail = await assets.findAsset(a.id)
      const [[r]] = await q("SELECT d.monthly_amount,v.total_debit FROM fixed_asset_depr d LEFT JOIN acct_vouchers v ON v.source_type='asset_depreciation' AND v.source_id=d.id WHERE d.asset_id=?", [a.id])
      assert.equal(Number(r.monthly_amount), 95); assert.equal(Number(r.total_debit), 95)
      assert.equal(detail.acquireDate, '2026-09-01'); assert.equal(detail.disposeDate, '2026-09-05')
      assert.equal(detail.deprHistory[0].deprDate, '2026-09-05')
    })
    await parkAssets()
    await test('F10 concurrent depreciation runs produce one ledger and one matching voucher', async () => {
      const a = await asset()
      await Promise.all([assets.runDepreciation({ period: '202601' }, op), assets.runDepreciation({ period: '202601' }, op)])
      const [[r]] = await q("SELECT COUNT(*) AS n,SUM(d.monthly_amount) AS amount,SUM(v.total_debit) AS debit FROM fixed_asset_depr d JOIN acct_vouchers v ON v.source_type='asset_depreciation' AND v.source_id=d.id WHERE d.asset_id=?", [a.id])
      assert.equal(Number(r.n), 1); assert.equal(Number(r.amount), 16.67); assert.equal(Number(r.debit), 16.67)
    })
    await parkAssets()
    await test('F04 disposal rolls back ledger, disposition and status when depreciation voucher fails', async () => {
      const a = await asset()
      await q("UPDATE acct_accounts SET code='REG660203' WHERE company_id=1 AND code='660203'")
      try {
        await assert.rejects(assets.disposeAsset(a.id, { disposeType: 2, disposeDate: '2026-01-15' }, op), e => e.code === 'ACCT_MAPPING_MISSING_ACCOUNT')
        const [[r]] = await q('SELECT status,(SELECT COUNT(*) FROM fixed_asset_depr WHERE asset_id=?) AS depr,(SELECT COUNT(*) FROM fixed_asset_disposals WHERE asset_id=?) AS disposals FROM fixed_assets WHERE id=?', [a.id, a.id, a.id])
        assert.equal(Number(r.status), 1); assert.equal(Number(r.depr), 0); assert.equal(Number(r.disposals), 0)
      } finally { await q("UPDATE acct_accounts SET code='660203' WHERE company_id=1 AND code='REG660203'") }
    })
    await parkAssets()
    await test('F11 disposal of a nearly fully depreciated asset respects residual floor', async () => {
      const a = await asset({ originalCost: 100, residualRate: 0.1, usefulMonths: 7 })
      for (const period of ['202601','202602','202603','202604','202605','202606']) await assets.runDepreciation({ period }, op)
      const result = await assets.disposeAsset(a.id, { disposeType: 2, disposeDate: '2026-07-15' }, op)
      assert.equal(result.netBook, 10)
      const detail = await assets.findAsset(a.id)
      assert.equal(detail.accumDepr, 90); assert.equal(detail.deprHistory.at(-1).monthlyAmount, 12.84)
    })
    await parkAssets()
    await test('F10 disposal rejects an earlier acquisition date or earlier existing depreciation period', async () => {
      const a = await asset()
      await assert.rejects(assets.disposeAsset(a.id, { disposeType: 2, disposeDate: '2025-12-31' }, op), e => e.statusCode === 400)
      await assets.runDepreciation({ period: '202603' }, op)
      await assert.rejects(assets.disposeAsset(a.id, { disposeType: 2, disposeDate: '2026-02-15' }, op), e => e.code === 'ASSET_DEPRECIATION_ORDER')
    })
    await parkAssets()
    await test('O01 cold seed observes committed legacy containers after an earlier RR snapshot', async () => {
      const conn = await pool.getConnection()
      let containerId
      try {
        await q("DELETE FROM daily_sequences WHERE seq_key='inventory_containers:barcode:B'")
        await conn.beginTransaction()
        await conn.query('SELECT value FROM sys_settings LIMIT 1')
        const [created] = await q("INSERT INTO inventory_containers(barcode,product_id,warehouse_id,status) VALUES('B900000',?,?,4)", [ctx.product.id, ctx.warehouse.id])
        containerId = created.insertId
        const code = await generateContainerCode(conn, 'B')
        assert.equal(code, 'B900001')
      } finally {
        await conn.rollback(); conn.release()
        if (containerId) await q('DELETE FROM inventory_containers WHERE id=?', [containerId])
      }
    })
    await test('O01 concurrent transactional callers serialize without shared-lock upgrade deadlocks', async () => {
      await generateContainerCode(pool, 'I')
      const codes = await Promise.all(Array.from({ length: 8 }, async () => {
        const conn = await pool.getConnection()
        try {
          await conn.beginTransaction()
          const code = await generateContainerCode(conn, 'I')
          await conn.commit()
          return code
        } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
      }))
      assert.equal(new Set(codes).size, 8)
    })
    await test('O01 concurrent cold initialization with pool and transactions stays unique above legacy maximum', async () => {
      for (const prefix of ['I', 'B']) {
        await q('DELETE FROM daily_sequences WHERE seq_key=?', [`inventory_containers:barcode:${prefix}`])
        const legacy = prefix === 'I' ? 'CNT950000' : 'B960000'
        const [row] = await q('INSERT INTO inventory_containers(barcode,product_id,warehouse_id,status) VALUES(?,?,?,4)', [legacy, ctx.product.id, ctx.warehouse.id])
        try {
          const codes = await Promise.all(Array.from({ length: 8 }, async (_, n) => {
            if (n % 2) return generateContainerCode(pool, prefix)
            const conn = await pool.getConnection()
            try {
              await conn.beginTransaction()
              const code = await generateContainerCode(conn, prefix)
              await conn.commit()
              return code
            } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
          }))
          assert.equal(new Set(codes).size, 8)
          assert.ok(codes.every(code => Number(code.slice(1)) > (prefix === 'I' ? 950000 : 960000)))
        } finally { await q('DELETE FROM inventory_containers WHERE id=?', [row.insertId]) }
      }
    })
    await test('O01 existing container sequence avoids repeated full-table aggregate and is concurrent-safe', async () => {
      await generateContainerCode(pool, 'I')
      const conn = await pool.getConnection()
      const query = conn.query.bind(conn)
      let scans = 0
      conn.query = async (...args) => { if (/MAX\(/i.test(String(args[0])) && /inventory_containers/.test(String(args[0]))) scans++; return query(...args) }
      const codes = []
      try { for (let n = 0; n < 3; n++) codes.push(await generateContainerCode(conn, 'I')) } finally { conn.release() }
      assert.equal(scans, 0)
      const concurrent = await Promise.all(Array.from({ length: 8 }, () => generateContainerCode(pool, 'I')))
      assert.equal(new Set([...codes, ...concurrent]).size, 11)
    })
  } finally {
    if (createdAssets.length) {
      const [vouchers] = await q(`SELECT id FROM acct_vouchers WHERE
        (source_type='asset_depreciation' AND source_id IN (SELECT id FROM fixed_asset_depr WHERE asset_id IN (?))) OR
        (source_type='asset_disposal' AND source_id IN (SELECT id FROM fixed_asset_disposals WHERE asset_id IN (?)))`, [createdAssets, createdAssets])
      if (vouchers.length) {
        const ids = vouchers.map(row => row.id)
        await q('DELETE FROM acct_voucher_entries WHERE voucher_id IN (?)', [ids])
        await q('DELETE FROM acct_vouchers WHERE id IN (?)', [ids])
      }
      await q('DELETE FROM fixed_asset_disposals WHERE asset_id IN (?)', [createdAssets])
      await q('DELETE FROM fixed_asset_depr WHERE asset_id IN (?)', [createdAssets])
      await q('DELETE FROM fixed_assets WHERE id IN (?)', [createdAssets])
    }
    if (createdAccounts.length) {
      await q('DELETE FROM finance_account_transactions WHERE account_id IN (?)', [createdAccounts])
      await q('DELETE FROM payment_receipts WHERE account_id IN (?)', [createdAccounts])
      await q('DELETE FROM finance_accounts WHERE id IN (?)', [createdAccounts])
    }
    await ctx.close()
    await pool.end()
  }
  console.log(`${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exitCode = 1
}
main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1) })
