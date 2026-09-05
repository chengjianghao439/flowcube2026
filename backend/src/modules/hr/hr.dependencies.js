const AppError = require('../../utils/AppError')
const { calcMonthlyTax, netPay } = require('./hr.tax')

/** 只能在 lockAccountingCompany 后调用；账套行覆盖不存在的月份，避免缺行时无法加锁。 */
async function loadPayrollDependencies(conn, payroll, lines, { paying = false, readInput }) {
  const cid = Number(payroll.company_id), period = String(payroll.period), year = period.slice(0, 4)
  const employeeIds = lines.map(l => Number(l.employee_id))
  const [employees] = await conn.query(
    `SELECT e.id, DATE_FORMAT(e.hire_date, '%Y%m') AS hire_period,
       (SELECT MIN(p.period) FROM hr_payroll_lines l JOIN hr_payrolls p ON p.id=l.payroll_id
         WHERE l.employee_id=e.id AND p.company_id=?) AS first_period
     FROM hr_employees e WHERE e.company_id=? AND e.id IN (?) FOR UPDATE`, [cid, cid, employeeIds],
  )
  const [history] = await conn.query(
    `SELECT l.*, p.period, p.status FROM hr_payroll_lines l JOIN hr_payrolls p ON p.id=l.payroll_id
     WHERE p.company_id=? AND p.period BETWEEN ? AND ? AND l.employee_id IN (?)
     ORDER BY p.period, l.employee_id, l.id FOR UPDATE`, [cid, `${year}01`, `${year}12`, employeeIds],
  )
  const [ledgerRows] = await conn.query(
    'SELECT * FROM hr_tax_accumulated WHERE company_id=? AND year=? AND employee_id IN (?) FOR UPDATE', [cid, year, employeeIds],
  )
  const ledger = new Map(ledgerRows.map(r => [`${r.employee_id}:${Number(r.month)}`, r]))
  const result = new Map()
  for (const employee of employees) {
    // 旧员工缺少入职日期时只能以首张工资为已知起点；不能凭空补扣其之前的月份。
    const start = employee.hire_period || employee.first_period
    if (!start || start > period) throw new AppError('工资所属期早于员工入职月份，请核对员工及工资所属期', 409)
    const firstMonth = start < `${year}01` ? 1 : Number(start.slice(4, 6))
    const employeeHistory = history.filter(r => Number(r.employee_id) === Number(employee.id))
    let prior = { accumTaxable: 0, accumTaxPaid: 0 }
    for (let month = firstMonth; month < Number(period.slice(4, 6)); month++) {
      const requiredPeriod = `${year}${String(month).padStart(2, '0')}`
      const rows = employeeHistory.filter(r => r.period === requiredPeriod)
      if (rows.length !== 1 || ![2, 3].includes(Number(rows[0].status))) {
        throw new AppError(`员工 ${employee.id} 的前置月份 ${requiredPeriod} 未完成有效核算，请先补齐（零收入月份也须录入并核算）`, 409, 'HR_PRIOR_CALCULATION_REQUIRED')
      }
      const row = rows[0]
      if (paying && Number(row.status) !== 3) throw new AppError(`请先发放前置月份 ${requiredPeriod} 工资，再发放 ${period}`, 409, 'HR_PRIOR_PAYMENT_REQUIRED')
      const gross = readInput(row)
      const expected = calcMonthlyTax({ monthlyGross: gross, monthlySocialPersonal: Number(row.social_personal), priorAccumTaxable: prior.accumTaxable, priorAccumTaxPaid: prior.accumTaxPaid })
      assertTaxSnapshot(row, ledger.get(`${employee.id}:${month}`), expected, gross, requiredPeriod)
      prior = expected
    }
    const currentRows = employeeHistory.filter(r => r.period === period)
    if (currentRows.length !== 1) throw new AppError('工资单包含重复员工明细，请核对后重新核算', 409)
    result.set(Number(employee.id), {
      prior,
      paidSuccessor: employeeHistory.find(r => r.period > period && Number(r.status) === 3),
      ledger: ledger.get(`${employee.id}:${Number(period.slice(4, 6))}`),
      successor: employeeHistory.find(r => r.period > period && [2, 3].includes(Number(r.status))),
    })
  }
  return result
}

function matchesTaxSnapshot(line, ledger, taxResult, gross) {
  return !!ledger && Number(line.gross) === gross
    && Number(line.taxable_income) === taxResult.accumTaxable && Number(line.tax) === taxResult.tax
    && Number(line.net) === netPay(gross, Number(line.social_personal), taxResult.tax)
    && Number(ledger.accum_taxable) === taxResult.accumTaxable && Number(ledger.accum_tax_paid) === taxResult.accumTaxPaid
}

function assertTaxSnapshot(line, ledger, taxResult, gross, period) {
  if (!matchesTaxSnapshot(line, ledger, taxResult, gross)) {
    throw new AppError(`${period} 工资累计台账或核算明细已失效，请先核对并重新核算；涉及已发放工资须人工复核，不会自动修改历史凭证`, 409, 'HR_TAX_BASELINE_STALE')
  }
}

/** 防止后来补建/编辑前月改变未知入职日期的累计起点或已使用的累计链。 */
async function assertNoCalculatedSuccessor(conn, companyId, period, { creating = false } = {}) {
  const [[later]] = await conn.query(
    `SELECT period FROM hr_payrolls WHERE company_id=? AND period>? AND period<=? AND status IN (2,3)
     ORDER BY period LIMIT 1 FOR UPDATE`, [companyId, period, `${String(period).slice(0, 4)}12`],
  )
  if (later) throw new AppError(`后续月份 ${later.period} 已核算或发放，不能补建或修改上游工资；请先处理后续核算依赖`, 409, 'HR_CALCULATED_SUCCESSOR')
  if (creating) {
    const [[unknownStart]] = await conn.query(
      `SELECT p.period FROM hr_payrolls p JOIN hr_payroll_lines l ON l.payroll_id=p.id
       JOIN hr_employees e ON e.id=l.employee_id AND e.company_id=p.company_id
       WHERE p.company_id=? AND p.period>? AND p.status IN (2,3) AND e.hire_date IS NULL
       AND NOT EXISTS (SELECT 1 FROM hr_payroll_lines old_l JOIN hr_payrolls old_p ON old_p.id=old_l.payroll_id
         WHERE old_l.employee_id=e.id AND old_p.company_id=p.company_id AND old_p.period<=?)
       ORDER BY p.period LIMIT 1 FOR UPDATE`, [companyId, period, period],
    )
    if (unknownStart) throw new AppError(`后续月份 ${unknownStart.period} 已核算或发放，补建更早工资会改变缺少入职日期员工的累计起点，请先核对入职资料与历史核算`, 409, 'HR_CALCULATED_SUCCESSOR')
  }
}

module.exports = { loadPayrollDependencies, matchesTaxSnapshot, assertTaxSnapshot, assertNoCalculatedSuccessor }
