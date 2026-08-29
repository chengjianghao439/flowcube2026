const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { SETTLEMENT_TYPE } = require('../../constants/settlementType')
const { normalizePagination } = require('../../utils/pagination')

/**
 * 汇总对账单：把某往来方一段期间内的月结账款汇总成一张单，确认锁定后发对方核对，
 * 对方汇款后在收款核销里冲抵这张单。
 *
 * 核销仍然落在 payment_records 上——账款余额是唯一事实源，对账单的 settled_amount
 * 只是下属明细核销额的汇总投影（由 refreshSettlement 重算，不独立累加，避免两处漂移）。
 */

const ST = { DRAFT: 1, CONFIRMED: 2, SETTLED: 3 }
const ST_NAME = { 1: '草稿', 2: '已确认', 3: '已核销' }

function fmt(row) {
  return {
    id: Number(row.id),
    statementNo: row.statement_no,
    type: Number(row.type),
    partyName: row.party_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    totalAmount: Number(row.total_amount),
    settledAmount: Number(row.settled_amount),
    balance: Number(row.balance),
    status: Number(row.status),
    statusName: ST_NAME[Number(row.status)],
    itemCount: row.item_count != null ? Number(row.item_count) : undefined,
    confirmedByName: row.confirmed_by_name,
    confirmedAt: row.confirmed_at,
    remark: row.remark,
    operatorName: row.operator_name,
    createdAt: row.created_at,
  }
}

/**
 * 按下属明细的实际核销情况重算对账单金额与状态。
 * 每次核销后调用；调用方已在事务内并锁好对账单行。
 */
async function refreshSettlement(conn, statementId) {
  const [[agg]] = await conn.query(
    `SELECT COALESCE(SUM(r.total_amount),0) AS total,
            COALESCE(SUM(r.paid_amount),0)  AS paid
       FROM reconciliation_statement_items i
       JOIN payment_records r ON r.id = i.record_id
      WHERE i.statement_id = ?`,
    [statementId],
  )
  const total = Number(agg.total)
  const paid = Math.min(Number(agg.paid), total)
  const balance = Math.max(0, total - paid)
  const [[cur]] = await conn.query('SELECT status FROM reconciliation_statements WHERE id=?', [statementId])
  // 只有已确认的单据会因核销完而进入终态；草稿单不因为下属账款被别处核销就自动完成
  const nextStatus = Number(cur.status) === ST.DRAFT
    ? ST.DRAFT
    : (balance <= 1e-6 && total > 0 ? ST.SETTLED : ST.CONFIRMED)
  await conn.query(
    'UPDATE reconciliation_statements SET total_amount=?,settled_amount=?,balance=?,status=? WHERE id=?',
    [total, paid, balance, nextStatus, statementId],
  )
  return { total, paid, balance, status: nextStatus }
}

/** 某往来方在期间内、尚未进过任何对账单的月结账款 */
async function listCandidates({ type, partyName, startDate, endDate }) {
  if (!partyName) throw new AppError('请先选择往来方', 400)
  const conds = [
    'pr.type = ?',
    'pr.party_name = ?',
    'pr.settlement_type = ?',
    'pr.status <> 3',
    'i.id IS NULL',
  ]
  const params = [Number(type), partyName, SETTLEMENT_TYPE.MONTHLY]
  if (startDate) { conds.push('pr.created_at >= ?'); params.push(`${startDate} 00:00:00`) }
  if (endDate) { conds.push('pr.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(endDate) }
  const [rows] = await pool.query(
    `SELECT pr.id, pr.order_no, pr.total_amount, pr.paid_amount, pr.balance, pr.status, pr.due_date, pr.created_at
       FROM payment_records pr
       LEFT JOIN reconciliation_statement_items i ON i.record_id = pr.id
      WHERE ${conds.join(' AND ')}
      ORDER BY pr.created_at ASC`,
    params,
  )
  return rows.map(r => ({
    id: Number(r.id),
    orderNo: r.order_no,
    totalAmount: Number(r.total_amount),
    paidAmount: Number(r.paid_amount),
    balance: Number(r.balance),
    status: Number(r.status),
    dueDate: r.due_date,
    createdAt: r.created_at,
  }))
}

async function create({ type, partyName, periodStart, periodEnd, recordIds = [], remark }, operator) {
  if (!recordIds.length) throw new AppError('请至少选择一笔账款', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const prefix = Number(type) === 1 ? 'SP' : 'SC'
    const statementNo = await generateDailyCode(conn, prefix, 'reconciliation_statements', 'statement_no')
    const [r] = await conn.query(
      `INSERT INTO reconciliation_statements
         (statement_no,type,party_name,period_start,period_end,status,remark,operator_id,operator_name)
       VALUES (?,?,?,?,?,1,?,?,?)`,
      [statementNo, Number(type), partyName, periodStart || null, periodEnd || null,
       remark || null, operator.operatorId, operator.operatorName],
    )
    const statementId = r.insertId

    for (const recordId of recordIds) {
      const [[rec]] = await conn.query('SELECT * FROM payment_records WHERE id=? FOR UPDATE', [Number(recordId)])
      if (!rec) throw new AppError(`账款 ${recordId} 不存在`, 404)
      if (Number(rec.type) !== Number(type)) throw new AppError(`${rec.order_no} 与本对账单类型不符`, 400)
      if (rec.party_name !== partyName) {
        throw new AppError(`${rec.order_no} 属于「${rec.party_name}」，与本单往来方不一致`, 400)
      }
      if (Number(rec.settlement_type) !== SETTLEMENT_TYPE.MONTHLY) {
        throw new AppError(`${rec.order_no} 不是月结账款，请在账款页逐笔处理`, 400)
      }
      try {
        await conn.query(
          `INSERT INTO reconciliation_statement_items (statement_id,record_id,order_no,total_amount)
           VALUES (?,?,?,?)`,
          [statementId, rec.id, rec.order_no, rec.total_amount],
        )
      } catch (e) {
        if (e?.code === 'ER_DUP_ENTRY') throw new AppError(`${rec.order_no} 已在其它对账单中，不能重复对账`, 409)
        throw e
      }
    }

    await refreshSettlement(conn, statementId)
    await conn.commit()
    return { id: statementId, statementNo }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/** 确认锁定：锁定后明细不可增删，可导出发对方、可核销 */
async function confirm(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[st]] = await conn.query('SELECT * FROM reconciliation_statements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
    if (!st) throw new AppError('对账单不存在', 404)
    if (Number(st.status) !== ST.DRAFT) throw new AppError('只有草稿状态的对账单可以确认', 409)
    await conn.query(
      'UPDATE reconciliation_statements SET status=?,confirmed_by=?,confirmed_by_name=?,confirmed_at=NOW() WHERE id=?',
      [ST.CONFIRMED, operator.operatorId, operator.operatorName, id],
    )
    await refreshSettlement(conn, id)
    await conn.commit()
    return { id: Number(id), status: ST.CONFIRMED }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/**
 * 解锁回草稿。业务上允许改已确认的单，但**已核销过的不能解锁**——
 * 否则改完明细后已收的钱对不上任何账款。
 */
async function unlock(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[st]] = await conn.query('SELECT * FROM reconciliation_statements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
    if (!st) throw new AppError('对账单不存在', 404)
    if (Number(st.status) === ST.DRAFT) throw new AppError('该对账单已是草稿状态', 400)
    if (Number(st.settled_amount) > 1e-6) {
      throw new AppError('该对账单已有核销记录，不能解锁；如需调整请先冲销已核销金额', 409)
    }
    await conn.query(
      'UPDATE reconciliation_statements SET status=?,confirmed_by=NULL,confirmed_by_name=NULL,confirmed_at=NULL WHERE id=?',
      [ST.DRAFT, id],
    )
    await conn.commit()
    return { id: Number(id), status: ST.DRAFT }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/** 移除明细（仅草稿态）；账款回到「未对账」池 */
async function removeItem(id, recordId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[st]] = await conn.query('SELECT * FROM reconciliation_statements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
    if (!st) throw new AppError('对账单不存在', 404)
    if (Number(st.status) !== ST.DRAFT) throw new AppError('已确认的对账单不能改明细，请先解锁', 409)
    await conn.query('DELETE FROM reconciliation_statement_items WHERE statement_id=? AND record_id=?', [id, Number(recordId)])
    await refreshSettlement(conn, id)
    await conn.commit()
    return { id: Number(id) }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function findAll({
  page = 1, pageSize = 20, type = '', status = '', keyword = '',
  statementNo = '', partyName = '',
  startDate = '', endDate = '', minAmount = '', maxAmount = '',
} = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['s.deleted_at IS NULL']
  const params = []
  if (type) { conds.push('s.type=?'); params.push(Number(type)) }
  if (status) { conds.push('s.status=?'); params.push(Number(status)) }
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(s.statement_no LIKE ? OR s.party_name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`) }
  const no = String(statementNo || '').trim()
  if (no) { conds.push('s.statement_no LIKE ?'); params.push(`%${no}%`) }
  const party = String(partyName || '').trim()
  if (party) { conds.push('s.party_name LIKE ?'); params.push(`%${party}%`) }
  if (startDate) { conds.push('s.created_at>=?'); params.push(`${startDate} 00:00:00`) }
  if (endDate)   { conds.push('s.created_at<DATE_ADD(?, INTERVAL 1 DAY)'); params.push(endDate) }
  if (minAmount !== '' && minAmount != null) { conds.push('s.total_amount>=?'); params.push(Number(minAmount)) }
  if (maxAmount !== '' && maxAmount != null) { conds.push('s.total_amount<=?'); params.push(Number(maxAmount)) }
  const where = `WHERE ${conds.join(' AND ')}`

  const [rows] = await pool.query(
    `SELECT s.*, (SELECT COUNT(*) FROM reconciliation_statement_items i WHERE i.statement_id = s.id) AS item_count,
            COALESCE(agg.real_total, 0) AS real_total, COALESCE(agg.real_paid, 0) AS real_paid
       FROM reconciliation_statements s
       LEFT JOIN (
         SELECT i.statement_id,
                SUM(r.total_amount) AS real_total,
                SUM(r.paid_amount)  AS real_paid
           FROM reconciliation_statement_items i
           JOIN payment_records r ON r.id = i.record_id
          GROUP BY i.statement_id
       ) agg ON agg.statement_id = s.id
       ${where}
      ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM reconciliation_statements s ${where}`, params)
  // 列表金额改用下属账款实时汇总，与详情(findById 明细 JOIN payment_records)口径统一：退货冲减/分批
  // 补应收会改下属账款 total_amount/paid_amount，但这些路径不触发 refreshSettlement，存储在
  // reconciliation_statements 上的投影会过期，导致列表总额与详情对不上、导出的对账额与系统实时值不符。
  // （minAmount/maxAmount 仍按入单时的存储额筛选，属辅助筛选，不追求与实时显示完全一致。）
  const list = rows.map(r => {
    const realTotal = Number(r.real_total)
    const realPaid = Math.min(Number(r.real_paid), realTotal)
    return fmt({ ...r, total_amount: realTotal, settled_amount: realPaid, balance: Math.max(0, realTotal - realPaid) })
  })
  return { list, pagination: { page: p, pageSize: ps, total } }
}

/** 详情：含明细（实时读账款当前余额，不用入单时的快照，便于看到已收多少） */
async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM reconciliation_statements WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('对账单不存在', 404)
  const [items] = await pool.query(
    `SELECT i.record_id, i.order_no, r.total_amount, r.paid_amount, r.balance, r.status, r.due_date, r.created_at
       FROM reconciliation_statement_items i
       JOIN payment_records r ON r.id = i.record_id
      WHERE i.statement_id = ?
      ORDER BY r.created_at ASC`,
    [id],
  )
  return {
    ...fmt(row),
    items: items.map(x => ({
      recordId: Number(x.record_id),
      orderNo: x.order_no,
      totalAmount: Number(x.total_amount),
      paidAmount: Number(x.paid_amount),
      balance: Number(x.balance),
      status: Number(x.status),
      dueDate: x.due_date,
      createdAt: x.created_at,
    })),
  }
}

module.exports = { listCandidates, create, confirm, unlock, removeItem, findAll, findById, refreshSettlement, ST }
