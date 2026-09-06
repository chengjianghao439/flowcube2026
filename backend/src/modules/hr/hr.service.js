const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const engine = require('../accounting/voucher-engine')
const { SOURCE_TYPES, DIR } = require('../../constants/voucherSource')
const { calcMonthlyTax, netPay } = require('./hr.tax')
const { normalizePagination } = require('../../utils/pagination')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { lockAccountingCompany } = require('../accounting/accounting.period-lock')
const { loadPayrollDependencies, matchesTaxSnapshot, assertTaxSnapshot, assertNoCalculatedSuccessor } = require('./hr.dependencies')

/**
 * 工资社保个税核算（文档10 完整会计准则 · 功能4）。
 *
 * 员工 → 工资单(期) → 核算（个税累计预扣）→ 发放。凭证复用 voucher-engine：
 *   salary_accrual 计提（借费用/贷应付职工薪酬）
 *   social_company 单位社保（借费用/贷其他应付款）
 *   social_personal 代扣个人社保（借应付职工薪酬/贷其他应付款）
 *   salary_payment 发放（借应付职工薪酬/贷银行存款+其他应付款-个税）
 * 一张工资单(期)一个 source_id=hr_payrolls.id，幂等重算覆盖。
 */

// ── 员工 ──────────────────────────────────────────────────────────────

async function listEmployees({ page = 1, pageSize = 20, keyword = '', companyId = 1 } = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['e.company_id = ?']
  const params = [Number(companyId) || 1]
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(e.emp_no LIKE ? OR e.name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`) }
  const where = `WHERE ${conds.join(' AND ')}`
  const [rows] = await pool.query(
    `SELECT * FROM hr_employees e ${where} ORDER BY e.id ASC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hr_employees e ${where}`, params)
  return { list: rows.map(fmtEmp), pagination: { page: p, pageSize: ps, total } }
}

function fmtEmp(r) {
  return {
    id: Number(r.id), empNo: r.emp_no, name: r.name,
    idCardNo: r.id_card_no, departmentId: r.department_id != null ? Number(r.department_id) : null,
    departmentName: r.department_name, hireDate: r.hire_date, status: Number(r.status), isActive: !!r.is_active,
  }
}

async function createEmployee({ empNo, name, idCardNo, departmentId, departmentName, hireDate }, operator, companyId = 1) {
  if (!String(name || '').trim()) throw new AppError('请填写员工姓名', 400)
  const no = String(empNo || '').trim() || `EMP${Date.now().toString().slice(-6)}`
  const cid = Number(companyId) || 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockAccountingCompany(conn, cid)
    const [r] = await conn.query(
      `INSERT INTO hr_employees (company_id, emp_no, name, id_card_no, department_id, department_name, hire_date)
       VALUES (?,?,?,?,?,?,?)`,
      [Number(companyId) || 1, no, String(name).trim(), idCardNo || null,
        departmentId ? Number(departmentId) : null, departmentName || null, hireDate || null],
    )
    await conn.commit()
    return { id: r.insertId, empNo: no }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

// ── 工资单 ────────────────────────────────────────────────────────────

async function listPayrolls({ page = 1, pageSize = 20, period = '', companyId = 1 } = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['p.company_id = ?']
  const params = [Number(companyId) || 1]
  if (period) { conds.push('p.period = ?'); params.push(String(period)) }
  const where = `WHERE ${conds.join(' AND ')}`
  const [rows] = await pool.query(
    `SELECT p.*, (SELECT COUNT(*) FROM hr_payroll_lines l WHERE l.payroll_id=p.id) AS emp_count
     FROM hr_payrolls p ${where} ORDER BY p.period DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hr_payrolls p ${where}`, params)
  return { list: rows.map(fmtPayroll), pagination: { page: p, pageSize: ps, total } }
}

function fmtPayroll(r) {
  return {
    id: Number(r.id), period: r.period, payrollNo: r.payroll_no,
    totalGross: Number(r.total_gross), totalSocialCompany: Number(r.total_social_company),
    totalTax: Number(r.total_tax), totalNet: Number(r.total_net),
    status: Number(r.status), empCount: Number(r.emp_count || 0), createdAt: r.created_at,
  }
}

function validateGross(gross) {
  if (typeof gross !== 'number' || !Number.isFinite(gross) || gross < 0 || gross > 999999999.99
    || Math.abs(gross * 100 - Math.round(gross * 100)) > 0.00001) {
    throw new AppError('请明确录入有效应发工资（0 至 999999999.99，最多两位小数）', 400)
  }
  return gross
}

function readPayrollInput(line) {
  const detail = typeof line.detail_json === 'string' ? JSON.parse(line.detail_json || '{}') : (line.detail_json || {})
  if (detail.grossEntered !== true) throw new AppError('请先逐行录入应发工资；零工资也须明确录入', 400)
  return validateGross(detail.gross)
}

async function getPayroll(id, companyId = 1) {
  const cid = Number(companyId) || 1
  const [[payroll]] = await pool.query('SELECT * FROM hr_payrolls WHERE id=? AND company_id=?', [Number(id), cid])
  if (!payroll) throw new AppError('工资单不存在', 404)
  const [lines] = await pool.query(
    `SELECT l.*, e.name AS employee_name, e.emp_no FROM hr_payroll_lines l
     JOIN hr_employees e ON e.id=l.employee_id AND e.company_id=? WHERE l.payroll_id=? ORDER BY l.id`, [cid, Number(id)],
  )
  return { ...fmtPayroll({ ...payroll, emp_count: lines.length }), lines: lines.map(line => {
    const detail = typeof line.detail_json === 'string' ? JSON.parse(line.detail_json || '{}') : (line.detail_json || {})
    return { id: Number(line.id), employeeId: Number(line.employee_id), employeeName: line.employee_name, empNo: line.emp_no,
      grossEntered: detail.grossEntered === true, gross: detail.grossEntered === true ? Number(detail.gross) : null,
      socialCompany: Number(line.social_company), socialPersonal: Number(line.social_personal), tax: Number(line.tax), net: Number(line.net) }
  }) }
}

/** 草稿应发额为绝对值覆盖；同请求重试不会累加，核算后禁止修改。 */
async function updatePayrollLine(id, lineId, { gross }, operator, companyId = 1, requestKey = null) {
  validateGross(gross)
  const cid = Number(companyId) || 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockAccountingCompany(conn, cid)
    const [[payroll]] = await conn.query('SELECT * FROM hr_payrolls WHERE id=? AND company_id=? FOR UPDATE', [Number(id), cid])
    if (!payroll) throw new AppError('工资单不存在', 404)
    const requestState = await beginOperationRequest(conn, { requestKey, action: `hr.line.${cid}.${Number(id)}.${Number(lineId)}`, userId: operator?.userId ?? null })
    if (requestState.replay) { await conn.commit(); return requestState.responseData }
    if (Number(payroll.status) !== 1) throw new AppError('仅草稿工资单可修改应发工资；已核算或发放后禁止修改', 409)
    await assertNoCalculatedSuccessor(conn, cid, payroll.period)
    const [[line]] = await conn.query(
      `SELECT l.id FROM hr_payroll_lines l JOIN hr_employees e ON e.id=l.employee_id AND e.company_id=?
       WHERE l.id=? AND l.payroll_id=? FOR UPDATE`, [cid, Number(lineId), Number(id)],
    )
    if (!line) throw new AppError('工资明细不存在', 404)
    await conn.query('UPDATE hr_payroll_lines SET gross=?, detail_json=? WHERE id=?',
      [gross, JSON.stringify({ grossEntered: true, gross }), Number(lineId)])
    const result = { id: Number(lineId), payrollId: Number(id), grossEntered: true, gross }
    await completeOperationRequest(conn, requestState, { data: result, resourceType: 'hr_payroll_line', resourceId: Number(lineId) })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 建工资单（草稿）：带入在职员工；未录入与显式零工资分别保存。 */
async function createPayroll({ period }, operator, companyId = 1) {
  const p = String(period || '')
  if (!/^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(p)) throw new AppError('请提供工资所属期 YYYYMM', 400)
  const cid = Number(companyId) || 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockAccountingCompany(conn, cid)
    const [[dup]] = await conn.query('SELECT id FROM hr_payrolls WHERE company_id = ? AND period = ?', [cid, p])
    if (dup) throw new AppError(`${p} 的工资单已存在`, 409)
    await assertNoCalculatedSuccessor(conn, cid, p, { creating: true })
    const payrollNo = await generateDailyCode(conn, 'PAY', 'hr_payrolls', 'payroll_no')
    const [r] = await conn.query(
      `INSERT INTO hr_payrolls (company_id, period, payroll_no, status, created_by) VALUES (?,?,?,1,?)`,
      [cid, p, payrollNo, operator?.userId ?? null],
    )
    const payrollId = r.insertId
    const [emps] = await conn.query(
      `SELECT id FROM hr_employees WHERE company_id=? AND status=1 AND is_active=1
       AND (hire_date IS NULL OR DATE_FORMAT(hire_date, '%Y%m')<=?) ORDER BY id FOR UPDATE`, [cid, p])
    for (const e of emps) {
      await conn.query(
        `INSERT INTO hr_payroll_lines (payroll_id, employee_id) VALUES (?,?)`,
        [payrollId, e.id],
      )
    }
    await conn.commit()
    return { id: payrollId, payrollNo }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/**
 * 核算工资单：按每员工 gross/socialPersonal 用累计预扣法算个税，更新明细 + 单头汇总。
 * 幂等：同一 (payroll_id) 重复核算覆盖（个税台账 UNIQUE(employee_id, year, month) 也覆盖）。
 */
async function calculatePayroll(id, operator, companyId = 1) {
  const cid = Number(companyId) || 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockAccountingCompany(conn, cid)
    const [[payroll]] = await conn.query(
      'SELECT * FROM hr_payrolls WHERE id = ? AND company_id = ? FOR UPDATE', [Number(id), cid],
    )
    if (!payroll) throw new AppError('工资单不存在', 404)
    if (Number(payroll.status) === 3) throw new AppError('工资单已发放，不能再核算', 400)
    if (![1, 2].includes(Number(payroll.status))) throw new AppError('工资单当前状态不允许核算', 409)
    const period = payroll.period
    const y = period.slice(0, 4)
    const m = Number(period.slice(4, 6))

    // 取社保比例（本年度；缺则全 0）
    const [[rates]] = await conn.query(
      'SELECT * FROM hr_social_rates WHERE company_id = ? AND year = ?', [cid, y],
    )
    const socialCompanyRate = rates ? Number(rates.social_company_rate) + Number(rates.fund_company_rate) : 0
    const socialPersonalRate = rates ? Number(rates.social_personal_rate) + Number(rates.fund_personal_rate) : 0

    const [lines] = await conn.query('SELECT l.* FROM hr_payroll_lines l JOIN hr_employees e ON e.id=l.employee_id AND e.company_id=? WHERE l.payroll_id=? ORDER BY l.id FOR UPDATE', [cid, Number(id)])
    const [[{ count }]] = await conn.query('SELECT COUNT(*) AS count FROM hr_payroll_lines WHERE payroll_id=?', [Number(id)])
    if (!lines.length || lines.length !== Number(count)) throw new AppError('工资单无有效员工或明细账套不一致', 400)
    lines.forEach(readPayrollInput)
    const dependencies = await loadPayrollDependencies(conn, payroll, lines, { readInput: readPayrollInput })
    let totalGross = 0, totalSocialCompany = 0, totalTax = 0, totalNet = 0

    for (const line of lines) {
      const gross = readPayrollInput(line)
      const base = Math.min(Math.max(gross, rates ? Number(rates.base_min) : 0), rates && Number(rates.base_max) > 0 ? Number(rates.base_max) : Number.POSITIVE_INFINITY)
      const socialPersonal = engine.round2(base * socialPersonalRate)
      const socialCompany = engine.round2(base * socialCompanyRate)

      const dependency = dependencies.get(Number(line.employee_id))
      const taxR = calcMonthlyTax({
        monthlyGross: gross, monthlySocialPersonal: socialPersonal,
        priorAccumTaxable: dependency.prior.accumTaxable,
        priorAccumTaxPaid: dependency.prior.accumTaxPaid,
      })
      // 正确的同月重复核算仍可覆盖；后月已依赖本月时只接受完全相同的结果。
      if (dependency.successor && (!matchesTaxSnapshot(line, dependency.ledger, taxR, gross)
        || Number(line.social_personal) !== socialPersonal || Number(line.social_company) !== socialCompany)) {
        throw new AppError(`后续月份 ${dependency.successor.period} 已核算或发放，不能改变上游工资核算；请先处理后续核算依赖，已发放结果须人工复核`, 409, 'HR_CALCULATED_SUCCESSOR')
      }
      const tax = taxR.tax
      if (engine.round2(socialPersonal + tax) > gross) throw new AppError('个人社保及个税扣款超过应发工资，请核对工资与社保基数后重新核算', 400)
      const net = netPay(gross, socialPersonal, tax)

      await conn.query(
        `UPDATE hr_payroll_lines SET gross=?, social_company=?, social_personal=?, taxable_income=?, tax=?, net=?, detail_json=? WHERE id=?`,
        [gross, socialCompany, socialPersonal, taxR.accumTaxable, tax, net,
          JSON.stringify({ grossEntered: true, gross, socialCompany, socialPersonal, tax, net }), line.id],
      )
      // 个税累计台账（幂等覆盖）
      await conn.query(
        `INSERT INTO hr_tax_accumulated (company_id, employee_id, year, month, accum_taxable, accum_tax_paid)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE accum_taxable=VALUES(accum_taxable), accum_tax_paid=VALUES(accum_tax_paid)`,
        [cid, line.employee_id, y, m, taxR.accumTaxable, taxR.accumTaxPaid],
      )

      totalGross += gross; totalSocialCompany += socialCompany; totalTax += tax; totalNet += net
    }

    await conn.query(
      `UPDATE hr_payrolls SET total_gross=?, total_social_company=?, total_tax=?, total_net=?, status=2 WHERE id=?`,
      [engine.round2(totalGross), engine.round2(totalSocialCompany), engine.round2(totalTax), engine.round2(totalNet), Number(id)],
    )
    await conn.commit()
    return { id: Number(id), totalGross: engine.round2(totalGross), totalSocialCompany: engine.round2(totalSocialCompany), totalTax: engine.round2(totalTax), totalNet: engine.round2(totalNet) }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 发放工资：生成 4 张凭证（计提/单位社保/代扣/发放），工资单 → 已发放。 */
async function payPayroll(id, { paidDate }, operator, companyId = 1) {
  const cid = Number(companyId) || 1
  const date = String(paidDate || beijingTodayYmd())
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockAccountingCompany(conn, cid)
    const [[payroll]] = await conn.query(
      'SELECT * FROM hr_payrolls WHERE id = ? AND company_id = ? FOR UPDATE', [Number(id), cid],
    )
    if (!payroll) throw new AppError('工资单不存在', 404)
    if (Number(payroll.status) === 3) throw new AppError('工资单已发放', 400)
    if (Number(payroll.status) !== 2) throw new AppError('请先核算工资单再发放', 400)

    const [lines] = await conn.query('SELECT l.* FROM hr_payroll_lines l JOIN hr_employees e ON e.id=l.employee_id AND e.company_id=? WHERE l.payroll_id=? ORDER BY l.id FOR UPDATE', [cid, Number(id)])
    const [[{ count }]] = await conn.query('SELECT COUNT(*) AS count FROM hr_payroll_lines WHERE payroll_id=?', [Number(id)])
    if (!lines.length || lines.length !== Number(count)) throw new AppError('工资单无有效员工或明细账套不一致', 400)
    lines.forEach(readPayrollInput)
    const dependencies = await loadPayrollDependencies(conn, payroll, lines, { paying: true, readInput: readPayrollInput })
    for (const line of lines) {
      const dependency = dependencies.get(Number(line.employee_id))
      if (dependency.paidSuccessor) throw new AppError(`后续月份 ${dependency.paidSuccessor.period} 已发放，不能再补发上游工资；请人工复核历史发放顺序与累计台账`, 409, 'HR_PAID_SUCCESSOR')
      const expected = calcMonthlyTax({ monthlyGross: readPayrollInput(line), monthlySocialPersonal: Number(line.social_personal),
        priorAccumTaxable: dependency.prior.accumTaxable, priorAccumTaxPaid: dependency.prior.accumTaxPaid })
      assertTaxSnapshot(line, dependency.ledger, expected, readPayrollInput(line), payroll.period)
    }

    // 发放前核对历史核算结果；不通过截零或反推社保掩盖金额缺口。
    for (const line of lines) {
      if (engine.round2(Number(line.social_personal) + Number(line.tax)) > Number(line.gross)
        || engine.round2(Number(line.social_personal) + Number(line.tax) + Number(line.net)) !== Number(line.gross)) {
        throw new AppError('工资扣款超过应发或核算明细不平，请重新核对', 400)
      }
    }
    for (const [field, total] of [['gross', 'total_gross'], ['social_company', 'total_social_company'], ['tax', 'total_tax'], ['net', 'total_net']]) {
      if (engine.round2(lines.reduce((sum, line) => sum + Number(line[field]), 0)) !== Number(payroll[total])) throw new AppError('工资明细与汇总不一致，请重新核算', 400)
    }

    const accountMap = await engine.loadAccountMap(conn, cid)
    const allocSeq = await engine.makeSeqAllocator(conn, cid)
    const period = payroll.period
    const summary = `${period} 工资发放`
    const legs = (code, direction, amount, s) => ({ code, direction, amount: engine.round2(amount), summary: s })

    // ① 计提工资：借 管理费用-工资 / 贷 应付职工薪酬-工资
    const gross = Number(payroll.total_gross)
    await engine.upsertVoucher(conn, {
      sourceType: SOURCE_TYPES.SALARY_ACCRUAL, sourceId: Number(id), sourceNo: payroll.payroll_no, summary,
      voucherDate: date, legs: [legs('660201', DIR.DEBIT, gross, `${period} 计提工资`), legs('221101', DIR.CREDIT, gross, `${period} 应付工资`)],
    }, accountMap, allocSeq, operator?.userId ?? null, cid)

    // ② 单位社保：借 管理费用-社保公积金 / 贷 其他应付款-代扣个人社保
    const sc = Number(payroll.total_social_company)
    if (sc > 0) {
      await engine.upsertVoucher(conn, {
        sourceType: SOURCE_TYPES.SOCIAL_COMPANY, sourceId: Number(id), sourceNo: payroll.payroll_no, summary,
        voucherDate: date, legs: [legs('660202', DIR.DEBIT, sc, `${period} 单位社保`), legs('221102', DIR.CREDIT, sc, `${period} 应付社保`)],
      }, accountMap, allocSeq, operator?.userId ?? null, cid)
    }

    // ③ 代扣个人社保：借 应付职工薪酬-工资 / 贷 其他应付款-代扣个人社保
    const sp = engine.round2(lines.reduce((sum, line) => sum + Number(line.social_personal), 0))
    if (sp > 0) {
      await engine.upsertVoucher(conn, {
        sourceType: SOURCE_TYPES.SOCIAL_PERSONAL, sourceId: Number(id), sourceNo: payroll.payroll_no, summary,
        voucherDate: date, legs: [legs('221101', DIR.DEBIT, sp, `${period} 代扣个人社保`), legs('224102', DIR.CREDIT, sp, `${period} 应付个人社保`)],
      }, accountMap, allocSeq, operator?.userId ?? null, cid)
    }

    // ④ 发放：借 应付职工薪酬-工资(净额) + 借 其他应付款-代扣个税 / 贷 银行存款
    // 借方 221101 应冲减「尚未转出的部分」= gross - sp（个人社保已在③转出）= net + tax。
    // 此前误用 gross，贷方合计 tax+net，借贷差 = sp（个人社保），有社保账套下 assertBalanced 抛错。
    const tax = Number(payroll.total_tax)
    const net = Number(payroll.total_net)
    const payLegs = [legs('221101', DIR.DEBIT, net + tax, `${period} 发放工资`)]
    if (tax > 0) payLegs.push(legs('224101', DIR.CREDIT, tax, `${period} 代扣个税`))
    payLegs.push(legs('1002', DIR.CREDIT, net, `${period} 实发工资`))
    await engine.upsertVoucher(conn, {
      sourceType: SOURCE_TYPES.SALARY_PAYMENT, sourceId: Number(id), sourceNo: payroll.payroll_no, summary,
      voucherDate: date, legs: payLegs,
    }, accountMap, allocSeq, operator?.userId ?? null, cid)

    await conn.query('UPDATE hr_payrolls SET status = 3 WHERE id = ?', [Number(id)])
    await conn.commit()
    return { id: Number(id), gross, socialCompany: sc, socialPersonal: sp, tax, net }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

module.exports = {
  listEmployees, createEmployee, listPayrolls, createPayroll, getPayroll, updatePayrollLine, calculatePayroll, payPayroll,
}
