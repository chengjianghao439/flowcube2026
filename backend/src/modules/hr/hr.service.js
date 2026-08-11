const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const engine = require('../accounting/voucher-engine')
const { SOURCE_TYPES, DIR } = require('../../constants/voucherSource')
const { calcMonthlyTax, netPay } = require('./hr.tax')
const { normalizePagination } = require('../../utils/pagination')

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
  const [r] = await pool.query(
    `INSERT INTO hr_employees (company_id, emp_no, name, id_card_no, department_id, department_name, hire_date)
     VALUES (?,?,?,?,?,?,?)`,
    [Number(companyId) || 1, no, String(name).trim(), idCardNo || null,
      departmentId ? Number(departmentId) : null, departmentName || null, hireDate || null],
  )
  return { id: r.insertId, empNo: no }
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
     FROM hr_payrolls p ${where} ORDER BY p.period DESC LIMIT ? OFFSET ?`,
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

/** 建工资单（草稿）：把在职员工都带进来，工资默认 0，待填。 */
async function createPayroll({ period }, operator, companyId = 1) {
  const p = String(period || '')
  if (!/^\d{6}$/.test(p)) throw new AppError('请提供工资所属期 YYYYMM', 400)
  const cid = Number(companyId) || 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[dup]] = await conn.query('SELECT id FROM hr_payrolls WHERE company_id = ? AND period = ?', [cid, p])
    if (dup) throw new AppError(`${p} 的工资单已存在`, 409)
    const payrollNo = await generateDailyCode(conn, 'PAY', 'hr_payrolls', 'payroll_no')
    const [r] = await conn.query(
      `INSERT INTO hr_payrolls (company_id, period, payroll_no, status, created_by) VALUES (?,?,?,1,?)`,
      [cid, p, payrollNo, operator?.userId ?? null],
    )
    const payrollId = r.insertId
    const [emps] = await conn.query('SELECT id FROM hr_employees WHERE company_id = ? AND status = 1 AND is_active = 1', [cid])
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
    const [[payroll]] = await conn.query(
      'SELECT * FROM hr_payrolls WHERE id = ? AND company_id = ? FOR UPDATE', [Number(id), cid],
    )
    if (!payroll) throw new AppError('工资单不存在', 404)
    if (Number(payroll.status) === 3) throw new AppError('工资单已发放，不能再核算', 400)
    const period = payroll.period
    const y = period.slice(0, 4)
    const m = Number(period.slice(4, 6))

    // 取社保比例（本年度；缺则全 0）
    const [[rates]] = await conn.query(
      'SELECT * FROM hr_social_rates WHERE company_id = ? AND year = ?', [cid, y],
    )
    const socialCompanyRate = rates ? Number(rates.social_company_rate) + Number(rates.fund_company_rate) : 0
    const socialPersonalRate = rates ? Number(rates.social_personal_rate) + Number(rates.fund_personal_rate) : 0

    const [lines] = await conn.query('SELECT * FROM hr_payroll_lines WHERE payroll_id = ?', [Number(id)])
    let totalGross = 0, totalSocialCompany = 0, totalTax = 0, totalNet = 0

    for (const line of lines) {
      const detail = typeof line.detail_json === 'string' ? JSON.parse(line.detail_json || '{}') : (line.detail_json || {})
      const gross = Number(detail.gross || 0)
      const base = Math.min(Math.max(gross, rates ? Number(rates.base_min) : 0), rates && Number(rates.base_max) > 0 ? Number(rates.base_max) : Number.POSITIVE_INFINITY)
      const socialPersonal = engine.round2(base * socialPersonalRate)
      const socialCompany = engine.round2(base * socialCompanyRate)

      // 上月累计（本月往前推：m=1 时上一年 12 月？简化：年初清零，1 月从 0 起）
      const [[prior]] = m > 1 ? await conn.query(
        'SELECT accum_taxable, accum_tax_paid FROM hr_tax_accumulated WHERE employee_id = ? AND year = ? AND month = ?',
        [line.employee_id, y, m - 1],
      ) : [[]]

      const taxR = calcMonthlyTax({
        month: m, monthlyGross: gross, monthlySocialPersonal: socialPersonal,
        priorAccumTaxable: prior ? Number(prior.accum_taxable) : 0,
        priorAccumTaxPaid: prior ? Number(prior.accum_tax_paid) : 0,
      })
      const tax = taxR.tax
      const net = netPay(gross, socialPersonal, tax)

      await conn.query(
        `UPDATE hr_payroll_lines SET gross=?, social_company=?, social_personal=?, taxable_income=?, tax=?, net=?, detail_json=? WHERE id=?`,
        [gross, socialCompany, socialPersonal, taxR.accumTaxable, tax, net,
          JSON.stringify({ gross, socialCompany, socialPersonal, tax, net }), line.id],
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
  const date = String(paidDate || new Date().toISOString().slice(0, 10))
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[payroll]] = await conn.query(
      'SELECT * FROM hr_payrolls WHERE id = ? AND company_id = ? FOR UPDATE', [Number(id), cid],
    )
    if (!payroll) throw new AppError('工资单不存在', 404)
    if (Number(payroll.status) === 3) throw new AppError('工资单已发放', 400)
    if (Number(payroll.status) !== 2) throw new AppError('请先核算工资单再发放', 400)

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
    const sp = engine.round2(Number(payroll.total_gross) - Number(payroll.total_net) - Number(payroll.total_tax))
    if (sp > 0) {
      await engine.upsertVoucher(conn, {
        sourceType: SOURCE_TYPES.SOCIAL_PERSONAL, sourceId: Number(id), sourceNo: payroll.payroll_no, summary,
        voucherDate: date, legs: [legs('221101', DIR.DEBIT, sp, `${period} 代扣个人社保`), legs('224102', DIR.CREDIT, sp, `${period} 应付个人社保`)],
      }, accountMap, allocSeq, operator?.userId ?? null, cid)
    }

    // ④ 发放：借 应付职工薪酬-工资(净额) + 借 其他应付款-代扣个税 / 贷 银行存款
    const tax = Number(payroll.total_tax)
    const net = Number(payroll.total_net)
    const payLegs = [legs('221101', DIR.DEBIT, gross, `${period} 发放工资`)]
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
  listEmployees, createEmployee, listPayrolls, createPayroll, calculatePayroll, payPayroll,
}
