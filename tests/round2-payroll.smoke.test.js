'use strict'
require('./helpers/testEnvironment').configureTestEnvironment()
const assert = require('node:assert/strict')
const { pool } = require('../backend/src/config/db')
const hr = require('../backend/src/modules/hr/hr.service')
const companies = require('../backend/src/modules/accounting/companies.service')
const op = { userId: null }, created = []
let failures = 0
async function test(name, fn) { try { await fn(); console.log('[PASS]', name) } catch (e) { failures++; console.error('[FAIL]', name, e.stack) } }
async function fixture(label, hireDate = '2025-01-01') {
  const c = await companies.createCompany({ code: `R2P${Date.now()}${created.length}`, name: label, startPeriod: '202601' })
  created.push(c.id)
  const employee = await hr.createEmployee({ name: label, empNo: `E${c.id}`, hireDate }, op, c.id)
  return { cid: c.id, eid: employee.id }
}
async function draft(f, period, gross) {
  const p = await hr.createPayroll({ period }, op, f.cid)
  const l = (await hr.getPayroll(p.id, f.cid)).lines.find(x => x.employeeId === f.eid)
  await hr.updatePayrollLine(p.id, l.id, { gross }, op, f.cid)
  return p.id
}
const calc = (f, id) => hr.calculatePayroll(id, op, f.cid)
const pay = (f, id) => hr.payPayroll(id, { paidDate: '2026-09-05' }, op, f.cid)
async function main() {
  try {
    await test('零收入扣除余额由一月完整延续到二月', async () => {
      const f = await fixture('累计扣除'), jan = await draft(f, '202601', 0), feb = await draft(f, '202602', 10000)
      await calc(f, jan); assert.equal((await calc(f, feb)).totalTax, 0)
      const [[r]] = await pool.query('SELECT accum_taxable FROM hr_tax_accumulated WHERE employee_id=? AND year=2026 AND month=1', [f.eid])
      assert.equal(Number(r.accum_taxable), -5000)
    })
    await test('逆序及缺失零收入月核算拒绝且不落账', async () => {
      const f = await fixture('缺月'), jan = await draft(f, '202601', 30000), feb = await draft(f, '202602', 0), mar = await draft(f, '202603', 30000)
      await assert.rejects(calc(f, feb), e => e.statusCode === 409 && /202601/.test(e.message))
      await calc(f, jan)
      await assert.rejects(calc(f, mar), e => e.statusCode === 409 && /202602/.test(e.message))
      assert.equal((await hr.getPayroll(mar, f.cid)).status, 1)
      await calc(f, feb); assert.equal((await calc(f, mar)).totalTax, 1230)
    })
    await test('前月未发拒绝后月发放；顺序发放及同值重算保持凭证不变', async () => {
      const f = await fixture('顺序发放'), jan = await draft(f, '202601', 30000), feb = await draft(f, '202602', 30000)
      const a = await calc(f, jan); await calc(f, feb)
      await assert.rejects(pay(f, feb), e => e.statusCode === 409 && /发放/.test(e.message))
      assert.deepEqual(await calc(f, jan), a)
      await pay(f, jan); await pay(f, feb)
      const [v] = await pool.query('SELECT source_type,source_id,total_debit,total_credit FROM acct_vouchers WHERE company_id=? ORDER BY id', [f.cid])
      assert.equal(v.length, 4); assert.ok(v.every(x => Number(x.total_debit) === Number(x.total_credit)))
    })
    await test('后月已核算时上游重算变化拒绝并保留全部原值', async () => {
      const f = await fixture('拒绝改变依赖'), jan = await draft(f, '202601', 30000), feb = await draft(f, '202602', 30000)
      const a = await calc(f, jan); await calc(f, feb)
      await pool.query('INSERT INTO hr_social_rates(company_id,year,social_personal_rate) VALUES(?,2026,0.1)', [f.cid])
      await assert.rejects(calc(f, jan), e => e.statusCode === 409 && /后续|后月/.test(e.message))
      assert.equal((await hr.getPayroll(jan, f.cid)).totalTax, a.totalTax)
      // 模拟升级前已发放后月：保持历史凭证和台账，拒绝再改变上游。
      await pool.query('UPDATE hr_payrolls SET status=3 WHERE id=?', [feb])
      await assert.rejects(calc(f, jan), e => e.statusCode === 409)
      await assert.rejects(pay(f, jan), e => e.statusCode === 409 && /后续|后月/.test(e.message))
      const [[v]] = await pool.query('SELECT COUNT(*) AS n FROM acct_vouchers WHERE company_id=?', [f.cid]); assert.equal(Number(v.n), 0)
    })
    await test('发放重验当前及前置累计台账，旧截零或陈旧明细拒绝', async () => {
      const f = await fixture('旧链拦截'), jan = await draft(f, '202601', 0), feb = await draft(f, '202602', 10000)
      await calc(f, jan); await pay(f, jan); await calc(f, feb)
      await pool.query('UPDATE hr_tax_accumulated SET accum_taxable=0 WHERE employee_id=? AND month=1', [f.eid])
      await assert.rejects(pay(f, feb), e => e.statusCode === 409 && /累计|核算/.test(e.message))
      await pool.query('UPDATE hr_tax_accumulated SET accum_taxable=-5000 WHERE employee_id=? AND month=1', [f.eid])
      await pool.query('UPDATE hr_tax_accumulated SET accum_tax_paid=150 WHERE employee_id=? AND month=2', [f.eid])
      await assert.rejects(pay(f, feb), e => e.statusCode === 409)
      const [[v]] = await pool.query('SELECT COUNT(*) AS n FROM acct_vouchers WHERE company_id=? AND source_id=?', [f.cid, feb]); assert.equal(Number(v.n), 0)
    })
    await test('任职起月只扣一个月、不得计算入职前月份、跨年重新累计', async () => {
      const f = await fixture('中途入职', '2026-12-15'), dec = await draft(f, '202612', 10000)
      assert.equal((await calc(f, dec)).totalTax, 150)
      const jan = await draft(f, '202701', 10000); assert.equal((await calc(f, jan)).totalTax, 150)
      const g = await fixture('尚未入职', '2026-03-15')
      const early = await hr.createPayroll({ period: '202602' }, op, g.cid)
      assert.equal((await hr.getPayroll(early.id, g.cid)).lines.length, 0)
    })
    await test('持续任职缺失工资单不能归零；未知入职日期可从首张单起连续核算', async () => {
      const f = await fixture('整月缺失'), feb = await draft(f, '202602', 10000)
      await assert.rejects(calc(f, feb), e => e.statusCode === 409 && /202601/.test(e.message))
      const g = await fixture('历史未知入职', null), sep = await draft(g, '202609', 10000)
      assert.equal((await calc(g, sep)).totalTax, 150)
      await assert.rejects(hr.createPayroll({ period: '202608' }, op, g.cid), e => e.statusCode === 409)
      await assert.rejects(hr.createPayroll({ period: '202512' }, op, g.cid), e => e.statusCode === 409)
    })
    await test('新员工从本月入职起累计，同单老员工继续依赖上月', async () => {
      const f = await fixture('新老员工'), jan = await draft(f, '202601', 30000)
      await calc(f, jan)
      const newcomer = await hr.createEmployee({ name: '二月新员工', empNo: `N${f.cid}`, hireDate: '2026-02-18' }, op, f.cid)
      const feb = await draft(f, '202602', 30000)
      const newLine = (await hr.getPayroll(feb, f.cid)).lines.find(l => l.employeeId === newcomer.id)
      await hr.updatePayrollLine(feb, newLine.id, { gross: 10000 }, op, f.cid)
      assert.equal((await calc(f, feb)).totalTax, 1880)
      await pay(f, jan); await pay(f, feb)
      const [[r]] = await pool.query('SELECT accum_taxable,accum_tax_paid FROM hr_tax_accumulated WHERE employee_id=? AND month=2', [newcomer.id])
      assert.equal(Number(r.accum_taxable), 5000); assert.equal(Number(r.accum_tax_paid), 150)
    })
    await test('跨月并发核算串行后读取刚提交的前月累计', async () => {
      const f = await fixture('并发跨月'), jan = await draft(f, '202601', 30000), feb = await draft(f, '202602', 30000)
      const get = pool.getConnection.bind(pool)
      let first = true, release, signal
      const pause = new Promise(r => { release = r }), ready = new Promise(r => { signal = r })
      pool.getConnection = async () => {
        const conn = await get()
        if (first) { first = false; const query = conn.query.bind(conn); conn.query = async (...args) => { const r = await query(...args); if (/SELECT \* FROM hr_payrolls.*FOR UPDATE/.test(String(args[0]))) { signal(); await pause } return r } }
        return conn
      }
      const a = calc(f, jan)
      let b
      try {
        await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('lock timeout')), 5000); t.unref() })])
        b = calc(f, feb); await new Promise(r => setTimeout(r, 50))
      } finally { release(); pool.getConnection = get }
      assert.equal((await a).totalTax, 750); assert.equal((await b).totalTax, 1730)
    })
  } finally {
    for (const cid of created) {
      await pool.query('DELETE e FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id WHERE v.company_id=?', [cid])
      await pool.query('DELETE FROM acct_vouchers WHERE company_id=?', [cid])
      await pool.query('DELETE l FROM hr_payroll_lines l JOIN hr_payrolls p ON p.id=l.payroll_id WHERE p.company_id=?', [cid])
      for (const table of ['hr_payrolls', 'hr_tax_accumulated', 'hr_employees', 'hr_social_rates', 'acct_accounts', 'acct_periods']) await pool.query(`DELETE FROM ${table} WHERE company_id=?`, [cid])
      await pool.query('DELETE FROM acct_companies WHERE id=?', [cid])
    }
    await pool.end()
  }
  if (failures) process.exitCode = 1
}
main().catch(e => { console.error(e.stack); process.exitCode = 1 })
