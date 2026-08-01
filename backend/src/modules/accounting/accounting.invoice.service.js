/**
 * 发票管理 Service（文档 10 · Phase 3 · 设计 §4.5）
 * 进项/销项发票池 + 认证/抵扣/红冲台账。发票与业务单弱关联（source 可空可后补），
 * **不改采购/销售单金额口径**；税额只在凭证映射时按本表 tax_amount 拆分（见 voucher-engine §5.3）。
 * 后补/修改发票后，凭证靠幂等重算自然带上税额拆分。
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// 进项:1待认证 2已认证 3已抵扣；销项:1已开具 2已红冲
const STATUS_NAME = {
  1: { 1: '待认证', 2: '已认证', 3: '已抵扣' },
  2: { 1: '已开具', 2: '已红冲' },
}
// 允许的状态流转：type → { action: [from, to] }
const TRANSITIONS = {
  1: { certify: [1, 2], deduct: [2, 3] },   // 进项：认证、抵扣
  2: { redFlush: [1, 2] },                    // 销项：红冲
}

function fmt(row) {
  const type = row.invoice_type
  return {
    id: row.id,
    invoiceType: type,
    invoiceTypeName: type === 1 ? '进项' : '销项',
    invoiceCode: row.invoice_code ?? null,
    invoiceNo: row.invoice_no ?? null,
    partyName: row.party_name,
    partyTaxNo: row.party_tax_no ?? null,
    amountNoTax: Number(row.amount_no_tax),
    taxRate: Number(row.tax_rate),
    taxAmount: Number(row.tax_amount),
    amountWithTax: Number(row.amount_with_tax),
    invoiceDate: row.invoice_date,
    status: row.status,
    statusName: (STATUS_NAME[type] && STATUS_NAME[type][row.status]) || String(row.status),
    sourceType: row.source_type ?? null,
    sourceId: row.source_id ?? null,
    sourceNo: row.source_no ?? null,
    remark: row.remark ?? null,
    operatorName: row.operator_name ?? null,
    createdAt: row.created_at,
  }
}

async function listInvoices({ invoiceType, status, keyword, page = 1, pageSize = 20 } = {}) {
  const where = ['deleted_at IS NULL']
  const params = []
  if (invoiceType) { where.push('invoice_type = ?'); params.push(Number(invoiceType)) }
  if (status)      { where.push('status = ?'); params.push(Number(status)) }
  if (keyword)     { where.push('(invoice_no LIKE ? OR party_name LIKE ? OR source_no LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k) }
  const whereSql = where.join(' AND ')
  const p = Math.max(1, Number(page) || 1)
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20))
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM fin_invoices WHERE ${whereSql}`, params)
  const [rows] = await pool.query(
    `SELECT * FROM fin_invoices WHERE ${whereSql} ORDER BY invoice_date DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps])
  return { list: rows.map(fmt), pagination: { page: p, pageSize: ps, total: Number(total) } }
}

async function getInvoice(id) {
  const [[row]] = await pool.query('SELECT * FROM fin_invoices WHERE id = ? AND deleted_at IS NULL', [Number(id)])
  if (!row) throw new AppError('发票不存在', 404)
  return fmt(row)
}

function validatePayload(d) {
  const type = Number(d.invoiceType)
  if (type !== 1 && type !== 2) throw new AppError('发票类型非法（1进项 2销项）', 400)
  const noTax = round2(d.amountNoTax)
  const tax = round2(d.taxAmount)
  const withTax = round2(d.amountWithTax)
  if (!(withTax > 0)) throw new AppError('价税合计必须大于 0', 400)
  if (round2(noTax + tax) !== withTax) throw new AppError(`价税合计校验失败：不含税 ${noTax} + 税额 ${tax} ≠ 价税合计 ${withTax}`, 400, 'INVOICE_AMOUNT_MISMATCH')
  const no = String(d.invoiceNo ?? '').trim()
  if (!no) throw new AppError('发票号码不能为空', 400)
  const party = String(d.partyName ?? '').trim()
  if (!party) throw new AppError('对方单位不能为空', 400)
  if (!d.invoiceDate) throw new AppError('开票日期不能为空', 400)
  return { type, noTax, tax, withTax, no, party }
}

async function createInvoice(d, operator) {
  const v = validatePayload(d)
  try {
    const [r] = await pool.query(
      `INSERT INTO fin_invoices
         (invoice_type, invoice_code, invoice_no, party_name, party_tax_no,
          amount_no_tax, tax_rate, tax_amount, amount_with_tax, invoice_date, status,
          source_type, source_id, source_no, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [v.type, d.invoiceCode || null, v.no, v.party, d.partyTaxNo || null,
       v.noTax, round2(d.taxRate), v.tax, v.withTax, String(d.invoiceDate).slice(0, 10),
       d.sourceType || null, d.sourceId || null, d.sourceNo || null, d.remark || null,
       operator?.userId || null, operator?.username || null])
    logger.info('accounting', `录入${v.type === 1 ? '进项' : '销项'}发票 ${v.no} 价税${v.withTax}`, { id: r.insertId, operatorId: operator?.userId })
    return { id: r.insertId }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new AppError(`发票 ${d.invoiceCode || ''} ${v.no} 已存在`, 400, 'INVOICE_DUP')
    throw e
  }
}

async function updateInvoice(id, d, operator) {
  const cur = await getInvoice(id)
  if (cur.status !== 1) throw new AppError('仅待认证/已开具状态的发票可编辑', 400, 'INVOICE_LOCKED')
  const v = validatePayload({ ...cur, ...d })
  try {
    await pool.query(
      `UPDATE fin_invoices SET invoice_code=?, invoice_no=?, party_name=?, party_tax_no=?,
         amount_no_tax=?, tax_rate=?, tax_amount=?, amount_with_tax=?, invoice_date=?,
         source_type=?, source_id=?, source_no=?, remark=?
       WHERE id=? AND deleted_at IS NULL`,
      [d.invoiceCode ?? cur.invoiceCode, v.no, v.party, d.partyTaxNo ?? cur.partyTaxNo,
       v.noTax, round2(d.taxRate ?? cur.taxRate), v.tax, v.withTax, String(d.invoiceDate || cur.invoiceDate).slice(0, 10),
       d.sourceType ?? cur.sourceType, d.sourceId ?? cur.sourceId, d.sourceNo ?? cur.sourceNo, d.remark ?? cur.remark, Number(id)])
    logger.info('accounting', `更新发票 [id=${id}]`, { operatorId: operator?.userId })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new AppError('发票代码+号码与已有发票重复', 400, 'INVOICE_DUP')
    throw e
  }
}

async function changeStatus(id, action, operator) {
  const cur = await getInvoice(id)
  const rule = TRANSITIONS[cur.invoiceType] && TRANSITIONS[cur.invoiceType][action]
  if (!rule) throw new AppError('该发票不支持此操作', 400, 'INVOICE_ACTION_INVALID')
  const [from, to] = rule
  if (cur.status !== from) throw new AppError(`当前状态「${cur.statusName}」不可执行此操作`, 400, 'INVOICE_STATUS_INVALID')
  const [r] = await pool.query('UPDATE fin_invoices SET status=? WHERE id=? AND status=? AND deleted_at IS NULL', [to, Number(id), from])
  if (r.affectedRows !== 1) throw new AppError('状态已变化，请刷新重试', 409)
  logger.info('accounting', `发票 ${cur.invoiceNo} ${action} ${from}→${to}`, { operatorId: operator?.userId })
  return { status: to }
}

async function removeInvoice(id, operator) {
  const cur = await getInvoice(id)
  await pool.query('UPDATE fin_invoices SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [Number(id)])
  logger.info('accounting', `删除发票 ${cur.invoiceNo}`, { operatorId: operator?.userId })
}

module.exports = { listInvoices, getInvoice, createInvoice, updateInvoice, changeStatus, removeInvoice }
