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

// 发票日期序列化：DB 读出的 Date 对象 → 'YYYY-MM-DD'（String(Date) 会得到 'Sun Aug 09 2026...'，
// 直接 slice 出非法日期）；前端传的字符串原样返回
const fmtDate = (d) => {
  if (!d) return null
  if (d instanceof Date) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return String(d).slice(0, 10)
}

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

/**
 * 开票量校验（P2-5 防多开票）：发票关联业务单（sourceNo）时，累计已开票价税合计
 * 不得超过该单的应收/应付基准（payment_records.total_amount——出库/收货后按实发/实收
 * 量重算的权威口径，而非订单原始总额）。
 *
 * 只对「能反查到单据、且该单已产生账款基准」的发票做硬校验；查不到单据或该单尚无
 * 账款基准（未结算/未出库，属「先开票后发货」的合法场景）不拦截，保留发票池弱关联的
 * 灵活性。已红冲（销项 status=2）的发票是冲销，不计入已开票合计。
 *
 * @param {object} d        - 本次录入/编辑的发票载荷
 * @param {number} d.invoiceType - 1进项 2销项
 * @param {number} d.amountWithTax - 本次价税合计
 * @param {string} [d.sourceNo]    - 关联单号（弱关联，可空）
 * @param {number} [excludeId]     - 编辑时排除自身，避免自算
 * @returns {Promise<{base: number, issued: number, sourceId: number|null}|null>}
 */
async function assertInvoiceQuota(d, excludeId = null) {
  const sourceNo = String(d.sourceNo ?? '').trim()
  if (!sourceNo) return null
  const type = Number(d.invoiceType)
  const table = type === 2 ? 'sale_orders' : 'purchase_orders'
  const recType = type === 2 ? 2 : 1

  // 1. 按单号反查单据 id（弱关联只存单号字符串，这里补查）
  const [[order]] = await pool.query(
    `SELECT id FROM ${table} WHERE order_no = ? AND deleted_at IS NULL`,
    [sourceNo],
  )
  if (!order) return null   // 查不到单据：不校验（可能是期初/无单发票）

  // 2. 该单的权威应收/应付基准（payment_records 是出库/收货后重算的唯一事实源；此表无 deleted_at）
  const [[pr]] = await pool.query(
    'SELECT total_amount FROM payment_records WHERE type = ? AND order_id = ? LIMIT 1',
    [recType, order.id],
  )
  const base = pr ? Number(pr.total_amount) : 0
  if (!(base > 0)) return null   // 该单尚无账款基准：不拦截（先开票后发货）

  // 3. 已开票合计（销项剔除红冲 status=2；编辑时排除自身；进项剔除删除）。
  //    同时按 source_id 与 source_no 匹配：旧数据可能只有 source_no 没 source_id。
  const excludeSql = excludeId ? 'AND id <> ?' : ''
  const params = excludeId ? [type, order.id, sourceNo, excludeId] : [type, order.id, sourceNo]
  const [[{ issuedSum }]] = await pool.query(
    `SELECT COALESCE(SUM(amount_with_tax), 0) AS issuedSum
       FROM fin_invoices
      WHERE invoice_type = ? AND deleted_at IS NULL
        AND (source_id = ? OR source_no = ?)
        AND (invoice_type = 1 OR status <> 2)
        ${excludeSql}`,
    params,
  )
  const issued = Number(issuedSum)
  const incoming = round2(Number(d.amountWithTax))
  if (round2(issued + incoming) > round2(base)) {
    throw new AppError(
      `该单累计已开票 ${issued.toFixed(2)} + 本次 ${incoming.toFixed(2)} 超过${type === 2 ? '应收' : '应付'}基准 ${base.toFixed(2)}，请核对是否多开票`,
      400, 'INVOICE_OVER_QUOTA',
    )
  }
  return { base, issued, sourceId: order.id }
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
  // P2-5 防多开票：关联单据时校验累计开票量不超过应收/应付基准
  const quota = await assertInvoiceQuota({ ...d, invoiceType: v.type, amountWithTax: v.withTax })
  try {
    const [r] = await pool.query(
      `INSERT INTO fin_invoices
         (invoice_type, invoice_code, invoice_no, party_name, party_tax_no,
          amount_no_tax, tax_rate, tax_amount, amount_with_tax, invoice_date, status,
          source_type, source_id, source_no, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [v.type, d.invoiceCode || null, v.no, v.party, d.partyTaxNo || null,
       v.noTax, round2(d.taxRate), v.tax, v.withTax, fmtDate(d.invoiceDate),
       d.sourceType || (quota ? 'invoice_order' : null), quota ? quota.sourceId : (d.sourceId || null), d.sourceNo || null, d.remark || null,
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
  // P2-5：编辑时排除自身，防止「改大本次开票金额被自己挡住」
  const quota = await assertInvoiceQuota(
    { ...cur, ...d, invoiceType: v.type, amountWithTax: v.withTax, sourceNo: d.sourceNo ?? cur.sourceNo },
    id,
  )
  const sourceId = quota ? quota.sourceId : (d.sourceId ?? cur.sourceId)
  try {
    await pool.query(
      `UPDATE fin_invoices SET invoice_code=?, invoice_no=?, party_name=?, party_tax_no=?,
         amount_no_tax=?, tax_rate=?, tax_amount=?, amount_with_tax=?, invoice_date=?,
         source_type=?, source_id=?, source_no=?, remark=?
       WHERE id=? AND deleted_at IS NULL`,
      [d.invoiceCode ?? cur.invoiceCode, v.no, v.party, d.partyTaxNo ?? cur.partyTaxNo,
       v.noTax, round2(d.taxRate ?? cur.taxRate), v.tax, v.withTax, fmtDate(d.invoiceDate ?? cur.invoiceDate),
       d.sourceType ?? cur.sourceType, sourceId, d.sourceNo ?? cur.sourceNo, d.remark ?? cur.remark, Number(id)])
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

module.exports = { listInvoices, getInvoice, createInvoice, updateInvoice, changeStatus, removeInvoice, assertInvoiceQuota }
