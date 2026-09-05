'use strict'
require('./helpers/testEnvironment').configureTestEnvironment()
const assert = require('node:assert/strict')
const { prepareSmokeContext, login } = require('./helpers/smokeTestKit')
const { pool } = require('../backend/src/config/db')
const hr = require('../backend/src/modules/hr/hr.service')
const op = { userId: 1 }
let failures = 0
async function test(name, fn) { try { await fn(); console.log('[PASS]', name) } catch (e) { failures++; console.error('[FAIL]', name, e.message) } }
async function main() {
  const ctx = await prepareSmokeContext()
  const stamp = Date.now()
  const company = await require('../backend/src/modules/accounting/companies.service').createCompany({ code: `PHR${stamp}`, name: '工资接口独立回归账套' })
  const companyId = company.id
  const createdCompanies = [companyId]
  const employee = await hr.createEmployee({ name: '工资回归', empNo: `HR${stamp}` }, op, companyId)
  const payroll = await hr.createPayroll({ period: '202601' }, op, companyId)
  const [[line]] = await pool.query('SELECT id FROM hr_payroll_lines WHERE payroll_id=?', [payroll.id])
  try {
    await test('HTTP 明细读写验证鉴权权限、账套、zod 及路径 ID', async () => {
      const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
      const limited = await login(ctx.http, 'smoke_limited', 'SmokeLimited123!')
      async function request(method, suffix, body, access = token, cid = companyId, requestKey) {
        return fetch(`${ctx.baseUrl}/api/hr/payrolls/${suffix}`, { method, headers: { ...(access ? { Authorization: `Bearer ${access}` } : {}), 'X-Company-Id': String(cid), 'Content-Type': 'application/json', ...(requestKey ? { 'X-Request-Key': requestKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      }
      assert.equal((await request('GET', payroll.id, undefined, '')).status, 401)
      assert.equal((await request('GET', payroll.id, undefined, limited.token)).status, 403)
      assert.equal((await request('GET', payroll.id, undefined, token, companyId + 1)).status, 404)
      assert.equal((await request('PATCH', `${payroll.id}/lines/${line.id}`, { gross: null })).status, 400)
      assert.equal((await request('GET', 'invalid')).status, 400)
      assert.equal((await request('GET', payroll.id)).status, 200)
      assert.equal((await request('PATCH', `${payroll.id}/lines/${line.id}`, { gross: 123 })).status, 400)
      assert.equal((await request('PATCH', `${payroll.id}/lines/${line.id}`, { gross: 123 }, token, companyId, 'k'.repeat(81))).status, 400)
      const httpPayroll = await hr.createPayroll({ period: '202605' }, op, companyId)
      const httpLine = (await hr.getPayroll(httpPayroll.id, companyId)).lines[0]
      const saved = await request('PATCH', `${httpPayroll.id}/lines/${httpLine.id}`, { gross: 123 }, token, companyId, `hr-http-${stamp}`)
      assert.equal(saved.status, 200); assert.equal((await saved.json()).data.gross, 123)
    })
    await test('未录入工资不能核算，事务不生成个税或汇总', async () => {
      await assert.rejects(hr.calculatePayroll(payroll.id, op, companyId), /录入/)
      const [[p]] = await pool.query('SELECT status FROM hr_payrolls WHERE id=?', [payroll.id]); assert.equal(p.status, 1)
    })
    await test('明细读取及更新受账套保护，拒绝无效工资和越界行', async () => {
      assert.equal(typeof hr.getPayroll, 'function'); assert.equal(typeof hr.updatePayrollLine, 'function')
      await assert.rejects(hr.getPayroll(payroll.id, companyId + 1), e => e.statusCode === 404)
      await assert.rejects(hr.updatePayrollLine(payroll.id, line.id, { gross: 100 }, op, companyId + 1), e => e.statusCode === 404)
      for (const gross of [undefined, null, '', '100', -1, 0.001, Infinity, NaN]) await assert.rejects(hr.updatePayrollLine(payroll.id, line.id, { gross }, op, companyId), /工资/)
      await assert.rejects(hr.updatePayrollLine(payroll.id, line.id + 100000, { gross: 1 }, op, companyId), e => e.statusCode === 404)
    })
    await test('显式零工资可以录入及核算，重复绝对值写入不累加', async () => {
      await hr.updatePayrollLine(payroll.id, line.id, { gross: 0 }, op, companyId)
      await hr.updatePayrollLine(payroll.id, line.id, { gross: 0 }, op, companyId)
      const result = await hr.calculatePayroll(payroll.id, op, companyId); assert.equal(result.totalGross, 0)
      await assert.rejects(hr.updatePayrollLine(payroll.id, line.id, { gross: 1 }, op, companyId), /草稿/)
      assert.equal((await hr.getPayroll(payroll.id, companyId)).lines[0].grossEntered, true)
    })
    await test('非零工资正确核算且重复核算不重复个税记录', async () => {
      const second = await hr.createPayroll({ period: '202602' }, op, companyId)
      const detail = await hr.getPayroll(second.id, companyId)
      await hr.updatePayrollLine(second.id, detail.lines[0].id, { gross: 10000.25 }, op, companyId)
      const a = await hr.calculatePayroll(second.id, op, companyId), b = await hr.calculatePayroll(second.id, op, companyId)
      assert.equal(a.totalGross, 10000.25); assert.deepEqual(a, b); assert.ok(a.totalNet > 0 && a.totalNet <= a.totalGross)
      const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM hr_tax_accumulated WHERE company_id=? AND employee_id=? AND month=2', [companyId, employee.id]); assert.equal(count.n, 1)
    })
    await test('真实账套非零社保核算发放与重复发放凭证一致', async () => {
      const realCompany = await require('../backend/src/modules/accounting/companies.service').createCompany({ code: `HR${stamp}`, name: '工资发放回归' })
      const cid = realCompany.id
      createdCompanies.push(cid)
      await hr.createEmployee({ name: '发放员工', empNo: `PAY${stamp}` }, op, cid)
      await pool.query('INSERT INTO hr_social_rates(company_id,year,base_min,social_company_rate,social_personal_rate) VALUES(?,2026,5000,0.2,0.1)', [cid])
      const pay = await hr.createPayroll({ period: '202609' }, op, cid)
      const first = (await hr.getPayroll(pay.id, cid)).lines[0]
      await hr.updatePayrollLine(pay.id, first.id, { gross: 10000 }, op, cid)
      const calculated = await hr.calculatePayroll(pay.id, op, cid)
      await hr.payPayroll(pay.id, { paidDate: '2026-09-05' }, op, cid)
      const [vouchers] = await pool.query('SELECT source_type,total_debit,total_credit FROM acct_vouchers WHERE company_id=? AND source_id=? ORDER BY source_type', [cid, pay.id])
      assert.equal(vouchers.length, 4)
      assert.ok(vouchers.every(v => Number(v.total_debit) === Number(v.total_credit)))
      assert.equal(Number(vouchers.find(v => v.source_type === 'social_personal').total_debit), 1000)
      assert.equal(Number(vouchers.find(v => v.source_type === 'salary_payment').total_debit), calculated.totalNet + calculated.totalTax)
      await assert.rejects(hr.payPayroll(pay.id, { paidDate: '2026-09-05' }, op, cid), /已发放/)
      const [after] = await pool.query('SELECT source_type,total_debit,total_credit FROM acct_vouchers WHERE company_id=? AND source_id=? ORDER BY source_type', [cid, pay.id])
      assert.deepEqual(after, vouchers)
      const low = await hr.createPayroll({ period: '202610' }, op, cid)
      const lowLine = (await hr.getPayroll(low.id, cid)).lines[0]
      await hr.updatePayrollLine(low.id, lowLine.id, { gross: 100 }, op, cid)
      await assert.rejects(hr.calculatePayroll(low.id, op, cid), /扣款.*应发/)
      assert.equal((await hr.getPayroll(low.id, cid)).status, 1)
    })
    await test('旧请求重放返回原回执且不覆盖较新的工资录入', async () => {
      const retry = await hr.createPayroll({ period: '202604' }, op, companyId)
      const detail = await hr.getPayroll(retry.id, companyId)
      const lineId = detail.lines[0].id
      const first = await hr.updatePayrollLine(retry.id, lineId, { gross: 100 }, op, companyId, `hr-first-${stamp}`)
      await hr.updatePayrollLine(retry.id, lineId, { gross: 200 }, op, companyId, `hr-second-${stamp}`)
      assert.deepEqual(await hr.updatePayrollLine(retry.id, lineId, { gross: 100 }, op, companyId, `hr-first-${stamp}`), first)
      assert.equal((await hr.getPayroll(retry.id, companyId)).lines[0].gross, 200)
    })
    await test('并发核算与工资录入按单头锁串行，核算后不接受迟到编辑', async () => {
      const concurrent = await hr.createPayroll({ period: '202603' }, op, companyId)
      const detail = await hr.getPayroll(concurrent.id, companyId)
      await hr.updatePayrollLine(concurrent.id, detail.lines[0].id, { gross: 6000 }, op, companyId)
      const get = pool.getConnection.bind(pool)
      let release, locked
      const pause = new Promise(r => { release = r }), ready = new Promise(r => { locked = r })
      let first = true
      pool.getConnection = async () => {
        const conn = await get()
        if (first) {
          first = false
          const query = conn.query.bind(conn)
          conn.query = async (...args) => {
            const result = await query(...args)
            if (/SELECT \* FROM hr_payrolls.*FOR UPDATE/.test(String(args[0]))) { locked(); await pause }
            return result
          }
        }
        return conn
      }
      const calculating = hr.calculatePayroll(concurrent.id, op, companyId)
      let editing
      try {
        await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('lock timing timeout')), 5000); timer.unref() })])
        editing = hr.updatePayrollLine(concurrent.id, detail.lines[0].id, { gross: 9000 }, op, companyId).then(() => null, e => e)
      } finally { release(); pool.getConnection = get }
      assert.equal((await calculating).totalGross, 6000)
      assert.equal((await editing).statusCode, 409)
      assert.equal((await hr.getPayroll(concurrent.id, companyId)).lines[0].gross, 6000)
    })
    await test('未知工资状态不可进入核算', async () => {
      await pool.query('UPDATE hr_payrolls SET status=4 WHERE id=?', [payroll.id])
      await assert.rejects(hr.calculatePayroll(payroll.id, op, companyId), /状态/)
    })
    await test('旧版默认零核算单不得直接发放', async () => {
      await pool.query('UPDATE hr_payroll_lines SET detail_json=NULL WHERE payroll_id=?', [payroll.id])
      await pool.query('UPDATE hr_payrolls SET status=2 WHERE id=?', [payroll.id])
      await assert.rejects(hr.payPayroll(payroll.id, {}, op, companyId), /录入/)
    })
  } finally {
    await pool.query('DELETE l FROM hr_payroll_lines l JOIN hr_payrolls p ON p.id=l.payroll_id WHERE p.company_id=?', [companyId])
    await pool.query('DELETE FROM operation_requests WHERE action LIKE ?', [`hr.line.${companyId}.%`])
    await pool.query('DELETE FROM hr_payrolls WHERE company_id=?', [companyId])
    await pool.query('DELETE FROM hr_tax_accumulated WHERE company_id=?', [companyId])
    await pool.query('DELETE FROM hr_employees WHERE company_id=?', [companyId])
    for (const cid of createdCompanies) {
      await pool.query('DELETE e FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id WHERE v.company_id=?', [cid])
      await pool.query('DELETE FROM acct_vouchers WHERE company_id=?', [cid])
      await pool.query('DELETE l FROM hr_payroll_lines l JOIN hr_payrolls p ON p.id=l.payroll_id WHERE p.company_id=?', [cid])
      for (const table of ['hr_payrolls', 'hr_tax_accumulated', 'hr_employees', 'hr_social_rates', 'acct_accounts', 'acct_periods']) await pool.query(`DELETE FROM ${table} WHERE company_id=?`, [cid])
      await pool.query('DELETE FROM acct_companies WHERE id=?', [cid])
    }
    await ctx.close()
    await pool.end()
  }
  if (failures) process.exitCode = 1
}
main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e.message); process.exit(1) })
