const { lockAccountingCompany } = require('./accounting.period-lock')

/**
 * 已有采购结算来源的修订：旧分录不可变，先反冲旧版本再追加新版本。
 * 根的 source_id 唯一锚点永不释放；空来源不造零分录，恢复来源也不复活旧分录。
 * 自动反冲显式 source_root_id；人工红字为空，人工冲销任何最新正向版本后停止重算。
 */
async function revisePurchaseVoucher(conn, { root, spec, legs, voucherDate, period, hash, debit, credit,
  accountMap, allocSeq, createdBy, companyId, insertEntries }) {
  await lockAccountingCompany(conn, companyId)
  const [[current]] = await conn.query(
    `SELECT * FROM acct_vouchers
      WHERE company_id = ? AND (id = ? OR source_root_id = ?) AND is_reversal = 0
      ORDER BY id DESC LIMIT 1 FOR UPDATE`, [companyId, root.id, root.id],
  )
  const [[reversal]] = await conn.query(
    'SELECT id, source_root_id FROM acct_vouchers WHERE reversed_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE', [current.id],
  )
  // 包含历史已冲销但关联遗失的异常数据：保守跳过，不能自动复活人为冲销。
  const autoReversed = Number(current.status) === 3 && Number(reversal?.source_root_id) === Number(root.id)
  if ((Number(current.status) === 3 && !autoReversed) || (reversal && !autoReversed)) {
    return { skipped: true, reason: 'reversed', id: current.id }
  }
  if (autoReversed && !legs.length) return { skipped: true, reason: 'unchanged', id: current.id }
  if (!autoReversed && current.source_hash === hash) return { skipped: true, reason: 'unchanged', id: current.id }

  // 运行时加载避免 period.service→engine→本模块 的循环初始化；期间锁由调用方事务保持。
  const { assertPeriodOpen } = require('./accounting.period.service')
  await assertPeriodOpen(conn, current.period, companyId)
  if (legs.length && period !== current.period) await assertPeriodOpen(conn, period, companyId)

  let changedId
  if (!autoReversed) {
    const seq = await allocSeq(current.period)
    const voucherNo = `记-${current.period}-${String(seq).padStart(4, '0')}`
    const [r] = await conn.query(
      `INSERT INTO acct_vouchers
        (company_id,voucher_no,voucher_date,period,source_type,source_id,source_no,summary,
         total_debit,total_credit,status,is_reversal,reversed_id,source_root_id,created_by)
       VALUES (?,?,?,?,?,NULL,?,?,?,?,1,1,?,?,?)`,
      [companyId, voucherNo, current.voucher_date, current.period, current.source_type, current.source_no,
        `来源重算冲销 ${current.voucher_no}`, current.total_credit, current.total_debit, current.id, root.id, createdBy || null],
    )
    changedId = r.insertId
    // 复制历史科目及辅助核算快照，不能用已变更的主档重建反向分录。
    await conn.query(
      `INSERT INTO acct_voucher_entries
        (voucher_id,line_no,account_id,account_code,account_name,direction,amount,summary,aux_type,aux_id,aux_name)
       SELECT ?,line_no,account_id,account_code,account_name,IF(direction=1,2,1),amount,
              CONCAT('来源重算冲销:',COALESCE(summary,'')),aux_type,aux_id,aux_name
         FROM acct_voucher_entries WHERE voucher_id=?`, [changedId, current.id],
    )
    await conn.query('UPDATE acct_vouchers SET status=3 WHERE id=?', [current.id])
  }
  if (legs.length) {
    const seq = await allocSeq(period)
    const voucherNo = `记-${period}-${String(seq).padStart(4, '0')}`
    const [r] = await conn.query(
      `INSERT INTO acct_vouchers
        (company_id,voucher_no,voucher_date,period,source_type,source_id,source_no,summary,
         total_debit,total_credit,status,source_hash,source_root_id,created_by)
       VALUES (?,?,?,?,?,NULL,?,?,?,?,1,?,?,?)`,
      [companyId, voucherNo, voucherDate, period, spec.sourceType, spec.sourceNo || null, spec.summary || null,
        debit, credit, hash, root.id, createdBy || null],
    )
    changedId = r.insertId
    await insertEntries(conn, changedId, legs, accountMap)
  }
  return { updated: true, id: changedId }
}

module.exports = { revisePurchaseVoucher }
