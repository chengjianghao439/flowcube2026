'use strict'
const path = require('node:path')
const root = require('node:path').resolve(__dirname, '../..')
process.env.DB_NAME ||= 'flowcube_hr_fix_test'
require(path.join(root, 'tests/helpers/testEnvironment')).configureTestEnvironment()
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { pool } = require(path.join(root, 'backend/src/config/db'))
const hr = require(path.join(root, 'backend/src/modules/hr/hr.service'))
const companies = require(path.join(root, 'backend/src/modules/accounting/companies.service'))
const { calcMonthlyTax } = require(path.join(root, 'backend/src/modules/hr/hr.tax'))
const op = { userId: null }
const created = []
const evidence = { database: process.env.DB_NAME, results: [] }
async function fixture(label, amounts) {
  const c = await companies.createCompany({ code: `R2H${Date.now()}${created.length}`, name: `Round2 payroll ${label}`, startPeriod: '202601' })
  created.push(c.id)
  await hr.createEmployee({ empNo: `R2H${Date.now()}${created.length}`, name: '独立计税探针', hireDate: '2025-01-01' }, op, c.id)
  const payrolls = []
  for (let i = 0; i < amounts.length; i++) {
    const p = await hr.createPayroll({ period: `2026${String(i + 1).padStart(2, '0')}` }, op, c.id)
    const line = (await hr.getPayroll(p.id, c.id)).lines[0]
    await hr.updatePayrollLine(p.id, line.id, { gross: amounts[i] }, op, c.id)
    payrolls.push(p.id)
  }
  return { cid: c.id, p: payrolls }
}
async function snapshot(cid) {
  const [payrolls] = await pool.query('SELECT period,status,total_gross,total_tax,total_net FROM hr_payrolls WHERE company_id=? ORDER BY period', [cid])
  const [ledger] = await pool.query('SELECT year,month,accum_taxable,accum_tax_paid FROM hr_tax_accumulated WHERE company_id=? ORDER BY year,month', [cid])
  return { payrolls, ledger }
}
async function main() {
  const [[target]] = await pool.query('SELECT DATABASE() AS db, VERSION() AS mysql')
  assert.equal(target.db, 'flowcube_hr_fix_test')
  evidence.target = target
  try {
    const a = await fixture('negative cumulative', [0, 10000])
    await hr.calculatePayroll(a.p[0], op, a.cid)
    const feb = await hr.calculatePayroll(a.p[1], op, a.cid)
    assert.equal(feb.totalTax, 150)
    evidence.results.push({ name: 'negative_cumulative_deduction_lost', expectedFebTax: 0, actualFebTax: feb.totalTax, ...(await snapshot(a.cid)) })

    const b = await fixture('out of order after paid', [30000, 30000, 30000])
    await hr.calculatePayroll(b.p[1], op, b.cid)
    await hr.calculatePayroll(b.p[2], op, b.cid)
    await hr.payPayroll(b.p[2], { paidDate: '2026-03-31' }, op, b.cid)
    const before = await snapshot(b.cid)
    await hr.calculatePayroll(b.p[0], op, b.cid)
    await hr.calculatePayroll(b.p[1], op, b.cid)
    const after = await snapshot(b.cid)
    let marchRecalculateError
    try { await hr.calculatePayroll(b.p[2], op, b.cid) } catch (e) { marchRecalculateError = { statusCode: e.statusCode, message: e.message } }
    assert.equal(marchRecalculateError.statusCode, 400)
    assert.equal(Number(after.payrolls[2].total_tax), 1730)
    assert.equal(Number(after.ledger[2].accum_taxable), 50000)
    assert.equal(Number(after.ledger[2].accum_tax_paid), 2480)
    const [[vouchers]] = await pool.query('SELECT COUNT(*) AS count FROM acct_vouchers WHERE company_id=? AND source_id=?', [b.cid, b.p[2]])
    evidence.results.push({ name: 'out_of_order_and_stale_paid_successor', before, after, actualMarchTax: 1730, expectedMarchTax: 2500, expectedMarchAccumTaxable: 75000, expectedMarchAccumTaxPaid: 4980, marchRecalculateError, paidMarchVoucherCount: vouchers.count })

    const c = await fixture('sequential control', [30000, 30000, 30000])
    for (const id of c.p) await hr.calculatePayroll(id, op, c.cid)
    evidence.results.push({ name: 'sequential_control', ...(await snapshot(c.cid)) })

    const d = await fixture('skip month', [30000, 0, 30000])
    await hr.calculatePayroll(d.p[0], op, d.cid)
    const march = await hr.calculatePayroll(d.p[2], op, d.cid)
    assert.equal(march.totalTax, 750)
    evidence.results.push({ name: 'skip_uncalculated_zero_month', actualMarchTax: march.totalTax, expectedMarchTax: 1230, ...(await snapshot(d.cid)) })

    const jan = calcMonthlyTax({ monthlyGross: 0, monthlySocialPersonal: 0 })
    evidence.pureFunction = { jan, feb: calcMonthlyTax({ monthlyGross: 10000, monthlySocialPersonal: 0, priorAccumTaxable: jan.accumTaxable, priorAccumTaxPaid: jan.accumTaxPaid }) }
  } finally {
    for (const cid of created) {
      await pool.query('DELETE e FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id WHERE v.company_id=?', [cid])
      await pool.query('DELETE FROM acct_vouchers WHERE company_id=?', [cid])
      await pool.query('DELETE l FROM hr_payroll_lines l JOIN hr_payrolls p ON p.id=l.payroll_id WHERE p.company_id=?', [cid])
      for (const table of ['hr_payrolls', 'hr_tax_accumulated', 'hr_employees', 'hr_social_rates', 'acct_accounts']) await pool.query(`DELETE FROM ${table} WHERE company_id=?`, [cid])
      await pool.query('DELETE FROM acct_companies WHERE id=?', [cid])
    }
    evidence.fixtureCompaniesCleaned = created.length
    await pool.end()
    fs.writeFileSync('/tmp/flowcube-round2-payroll-evidence.json', JSON.stringify(evidence, null, 2))
  }
  console.log(JSON.stringify(evidence, null, 2))
}
main().catch(e => { console.error(e.stack); process.exitCode = 1 })
