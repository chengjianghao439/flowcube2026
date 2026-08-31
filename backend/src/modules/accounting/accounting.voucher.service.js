/**
 * 会计凭证 Service（文档 10 · Phase 1）
 * 凭证列表/详情、生成本期凭证（调 voucher-engine）、手工凭证、冲销、导出、勾稽对账。
 * 所有生成/写操作在事务内；引擎只读业务表只写 acct_*。
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const engine = require('./voucher-engine')
const { assertPeriodOpen } = require('./accounting.period.service')
const { SOURCE_TYPES } = require('../../constants/voucherSource')

const SOURCE_TYPE_LABELS = {
  [SOURCE_TYPES.PURCHASE_SETTLE]: '采购结算',
  [SOURCE_TYPES.SALE_REVENUE]:    '销售收入',
  [SOURCE_TYPES.SALE_COGS]:       '销售成本',
  [SOURCE_TYPES.RECEIPT_IN]:      '收款',
  [SOURCE_TYPES.PAYMENT_OUT]:     '付款',
  [SOURCE_TYPES.EXPENSE_PAY]:     '费用报销',
  [SOURCE_TYPES.REFUND_PAY]:      '退款',
  [SOURCE_TYPES.PURCHASE_RETURN]: '采购退货',
  [SOURCE_TYPES.SALE_RETURN]:     '销售退货',
  [SOURCE_TYPES.STOCK_CHECK]:     '盘点盈亏',
  [SOURCE_TYPES.MANUAL]:          '手工凭证',
}
const round2 = engine.round2

function fmtVoucher(row) {
  return {
    id: row.id,
    voucherNo: row.voucher_no,
    voucherDate: row.voucher_date,
    period: row.period,
    sourceType: row.source_type,
    sourceTypeName: SOURCE_TYPE_LABELS[row.source_type] || row.source_type,
    sourceId: row.source_id ?? null,
    sourceNo: row.source_no ?? null,
    summary: row.summary ?? null,
    totalDebit: Number(row.total_debit),
    totalCredit: Number(row.total_credit),
    status: row.status,
    isReversal: row.is_reversal ? 1 : 0,
    reversedId: row.reversed_id ?? null,
    createdAt: row.created_at,
  }
}
function fmtEntry(row) {
  return {
    id: row.id,
    lineNo: row.line_no,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    direction: row.direction,
    amount: Number(row.amount),
    summary: row.summary ?? null,
    auxType: row.aux_type ?? 0,
    auxId: row.aux_id ?? null,
    auxName: row.aux_name ?? null,
  }
}

// ─── 查询 ──────────────────────────────────────────────────────────────────

async function listVouchers({ period, sourceType, status, keyword, page = 1, pageSize = 20, companyId = 1 } = {}) {
  const where = ['company_id = ?']
  const params = [companyId]
  if (period)     { where.push('period = ?'); params.push(String(period)) }
  if (sourceType) { where.push('source_type = ?'); params.push(String(sourceType)) }
  if (status)     { where.push('status = ?'); params.push(Number(status)) }
  if (keyword)    { where.push('(voucher_no LIKE ? OR source_no LIKE ? OR summary LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k) }
  const whereSql = where.join(' AND ')

  const p = Math.max(1, Number(page) || 1)
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20))
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM acct_vouchers WHERE ${whereSql}`, params)
  const [rows] = await pool.query(
    `SELECT * FROM acct_vouchers WHERE ${whereSql} ORDER BY voucher_date DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps],
  )
  return { list: rows.map(fmtVoucher), pagination: { page: p, pageSize: ps, total: Number(total) } }
}

async function getVoucher(id, companyId = 1) {
  const [[row]] = await pool.query('SELECT * FROM acct_vouchers WHERE id = ? AND company_id = ?', [Number(id), companyId])
  if (!row) throw new AppError('凭证不存在', 404)
  const [entries] = await pool.query('SELECT * FROM acct_voucher_entries WHERE voucher_id = ? ORDER BY line_no ASC', [Number(id)])
  return { ...fmtVoucher(row), entries: entries.map(fmtEntry) }
}

// ─── 生成本期凭证 ────────────────────────────────────────────────────────────

async function generatePeriodVouchers({ period = null, userId = null, companyId = 1 } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    if (period) await assertPeriodOpen(conn, period, companyId)
    // 全量重算（未指定期间）跳过已结账期间：那些期间的账面已被锁定认可，
    // 重算去动它们等于破坏已结的账（skippedClosed 计入返回，调用方可见）
    const [closedRows] = await conn.query('SELECT period FROM acct_periods WHERE status = 2 AND company_id = ?', [companyId])
    const closedPeriods = new Set(closedRows.map(r => r.period))
    const stats = await engine.generateVouchers(conn, { period: period || null, createdBy: userId, closedPeriods, companyId })
    await conn.commit()
    return stats
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ─── 手工凭证 ────────────────────────────────────────────────────────────────

async function nextVoucherNo(conn, period, companyId = 1) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(voucher_no,'-',-1) AS UNSIGNED)), 0) AS mx
       FROM acct_vouchers WHERE period = ? AND company_id = ?`,
    [period, companyId],
  )
  return `记-${period}-${String((Number(row.mx) || 0) + 1).padStart(4, '0')}`
}

/**
 * 手工凭证录入。source_type='manual'、source_id=NULL（多张手工凭证 source_id 均为 NULL，
 * MySQL 唯一索引对 NULL 视为互异，不冲突）。分录科目必须是启用的明细科目，借贷必平。
 */
async function createManualVoucher({ voucherDate, summary, entries, companyId = 1 }, userId) {
  if (!Array.isArray(entries) || entries.length < 2) throw new AppError('手工凭证至少需要两条分录', 400)
  const dateStr = engine.toDateStr(voucherDate)
  const period = dateStr.slice(0, 4) + dateStr.slice(5, 7)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertPeriodOpen(conn, period, companyId)

    // 解析科目并校验（启用的明细科目）
    const legs = []
    let debit = 0, credit = 0
    for (const e of entries) {
      const amount = round2(e.amount)
      if (!(amount > 0)) throw new AppError('分录金额必须大于 0', 400)
      const dir = Number(e.direction) === 1 ? 1 : 2
      const [[acct]] = await conn.query(
        'SELECT id, code, name, is_leaf, is_active FROM acct_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL',
        [Number(e.accountId), companyId],
      )
      if (!acct) throw new AppError(`科目不存在（id=${e.accountId}）`, 400)
      if (!acct.is_leaf) throw new AppError(`汇总科目「${acct.code} ${acct.name}」不可直接记账`, 400)
      if (!acct.is_active) throw new AppError(`科目「${acct.code} ${acct.name}」已停用`, 400)
      if (dir === 1) debit += amount; else credit += amount
      legs.push({ acct, dir, amount, summary: e.summary || null, auxType: e.auxType ? 1 : 0, auxId: e.auxId || null, auxName: e.auxName || null })
    }
    if (round2(debit) !== round2(credit)) throw new AppError(`借贷不平：借 ${round2(debit)} ≠ 贷 ${round2(credit)}`, 400, 'ACCT_VOUCHER_UNBALANCED')

    const voucherNo = await nextVoucherNo(conn, period, companyId)
    const [r] = await conn.query(
      `INSERT INTO acct_vouchers
         (company_id, voucher_no, voucher_date, period, source_type, source_id, source_no, summary, total_debit, total_credit, status, created_by)
       VALUES (?, ?, ?, ?, 'manual', NULL, NULL, ?, ?, ?, 1, ?)`,
      [companyId, voucherNo, dateStr, period, summary || null, round2(debit), round2(credit), userId || null],
    )
    let lineNo = 0
    for (const l of legs) {
      lineNo += 1
      await conn.query(
        `INSERT INTO acct_voucher_entries
           (voucher_id, line_no, account_id, account_code, account_name, direction, amount, summary, aux_type, aux_id, aux_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.insertId, lineNo, l.acct.id, l.acct.code, l.acct.name, l.dir, l.amount, l.summary, l.auxType, l.auxId, l.auxName],
      )
    }
    await conn.commit()
    logger.info('accounting', `手工凭证 ${voucherNo} 借贷各 ${round2(debit)}`, { id: r.insertId, userId })
    return { id: r.insertId, voucherNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 删除凭证：仅手工凭证可删（自动凭证由重算维护）。 */
async function removeVoucher(id, userId, companyId = 1) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[v]] = await conn.query('SELECT id, source_type, voucher_no, period FROM acct_vouchers WHERE id = ? AND company_id = ? FOR UPDATE', [Number(id), companyId])
    if (!v) throw new AppError('凭证不存在', 404)
    if (v.source_type !== SOURCE_TYPES.MANUAL) throw new AppError('自动生成的凭证不可删除（如需修正请重新生成或冲销）', 400, 'ACCT_VOUCHER_NOT_MANUAL')
    await assertPeriodOpen(conn, v.period, companyId)
    await conn.query('DELETE FROM acct_voucher_entries WHERE voucher_id = ?', [Number(id)])
    await conn.query('DELETE FROM acct_vouchers WHERE id = ?', [Number(id)])
    await conn.commit()
    logger.info('accounting', `删除手工凭证 ${v.voucher_no}`, { userId })
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 红字冲销：生成一张借贷方向相反、金额相等的冲销凭证，原凭证 status→3 已冲销。
 * 原凭证一经生成不物理删除、不就地改分录（审计要求）。冲销后引擎重算会跳过 status=3 的原凭证，
 * 不再覆盖（见 voucher-engine.upsertVoucher）。
 */
async function reverseVoucher(id, userId, companyId = 1) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[v]] = await conn.query('SELECT * FROM acct_vouchers WHERE id = ? AND company_id = ? FOR UPDATE', [Number(id), companyId])
    if (!v) throw new AppError('凭证不存在', 404)
    if (v.status === 3) throw new AppError('该凭证已冲销', 400)
    if (v.is_reversal) throw new AppError('红字冲销凭证本身不可再冲销', 400)
    await assertPeriodOpen(conn, v.period, companyId)
    const [entries] = await conn.query('SELECT * FROM acct_voucher_entries WHERE voucher_id = ? ORDER BY line_no ASC', [Number(id)])
    if (entries.length === 0) throw new AppError('原凭证无分录', 400)

    const voucherNo = await nextVoucherNo(conn, v.period, companyId)
    const [r] = await conn.query(
      `INSERT INTO acct_vouchers
         (company_id, voucher_no, voucher_date, period, source_type, source_id, source_no, summary, total_debit, total_credit, status, is_reversal, reversed_id, created_by)
       VALUES (?, ?, ?, ?, 'manual', NULL, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [companyId, voucherNo, v.voucher_date, v.period, v.source_no || null, `冲销 ${v.voucher_no}`,
       Number(v.total_credit), Number(v.total_debit), Number(id), userId || null],
    )
    let lineNo = 0
    for (const e of entries) {
      lineNo += 1
      await conn.query(
        `INSERT INTO acct_voucher_entries
           (voucher_id, line_no, account_id, account_code, account_name, direction, amount, summary, aux_type, aux_id, aux_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.insertId, lineNo, e.account_id, e.account_code, e.account_name,
         e.direction === 1 ? 2 : 1, e.amount, `冲销:${e.summary || ''}`.trim(), e.aux_type, e.aux_id, e.aux_name],
      )
    }
    await conn.query('UPDATE acct_vouchers SET status = 3 WHERE id = ?', [Number(id)])
    await conn.commit()
    logger.info('accounting', `冲销凭证 ${v.voucher_no} → 红字 ${voucherNo}`, { userId })
    return { id: r.insertId, voucherNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ─── 勾稽对账（凭证 vs 业务事实） ─────────────────────────────────────────────

/**
 * 资金/应付/应收三项勾稽核对，供 UI 展示与自查（对齐设计 §10）。
 * 不按 status 过滤：红字冲销(原凭证 status=3 + 红字 is_reversal)成对相抵为零，全量纳入才正确
 * （只留红字会算成负的原始额）。见 accounting.ledger.service 顶注同一口径。
 *
 * companyId 参数用于过滤凭证数据（acct_vouchers/entries 有 company_id）。
 * 资金流水（finance_account_transactions）和账款（payment_records）是公司级表，
 * 目前不支持按账套过滤——如果资金账户和账款需要账套隔离，需要后续迁移添加对应字段。
 */
async function reconciliation(companyId = 1) {
  const [[fundV]] = await pool.query(
    `SELECT COALESCE(SUM(e.amount),0) s FROM acct_voucher_entries e
       JOIN acct_vouchers v ON v.id = e.voucher_id
      WHERE v.company_id = ? AND v.source_type IN ('receipt_in','payment_out','expense_pay') AND e.account_code IN ('1001','1002')`,
    [companyId],
  )
  // 资金流水合计：通过 JOIN finance_accounts 获取账套过滤（如果 finance_accounts 已添加 company_id）
  const [[fundT]] = await pool.query(
    `SELECT COALESCE(SUM(t.amount),0) s FROM finance_account_transactions t
       JOIN finance_accounts fa ON fa.id = t.account_id
      WHERE t.biz_type IN (1,2,3) AND fa.company_id = ?`,
    [companyId],
  )
  const [[payableV]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction=2 THEN amount ELSE -amount END),0) s
       FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id
      WHERE v.company_id = ? AND e.account_code='2202' AND v.source_type IN ('purchase_settle','purchase_return')`,
    [companyId],
  )
  // 应付账款余额：公司级数据，payment_records 目前不支持账套过滤
  const [[payableB]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) s FROM payment_records WHERE type=1 AND order_id IS NOT NULL`)
  const [[recvV]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE -amount END),0) s
       FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id
      WHERE v.company_id = ? AND e.account_code='1122' AND v.source_type IN ('sale_revenue','sale_return')`,
    [companyId],
  )
  // 应收账款余额：公司级数据，payment_records 目前不支持账套过滤
  const [[recvB]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) s FROM payment_records WHERE type=2 AND order_id IS NOT NULL`)
  const item = (name, voucher, business) => ({
    name, voucher: round2(voucher), business: round2(business),
    diff: round2(voucher - business), matched: round2(voucher - business) === 0,
  })
  return {
    items: [
      item('资金（收付款/报销 vs 资金流水）', fundV.s, fundT.s),
      item('应付账款（凭证净额 vs 应付余额）', payableV.s, payableB.s),
      item('应收账款（凭证净额 vs 应收余额）', recvV.s, recvB.s),
    ],
  }
}

module.exports = {
  listVouchers,
  getVoucher,
  generatePeriodVouchers,
  createManualVoucher,
  removeVoucher,
  reverseVoucher,
  reconciliation,
  SOURCE_TYPE_LABELS,
  fmtVoucher,
  fmtEntry,
}
