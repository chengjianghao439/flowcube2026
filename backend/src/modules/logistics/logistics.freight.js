const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { SETTLEMENT_TYPE, buildDueDateSql } = require('../../constants/settlementType')

/**
 * 运费对账（文档 06 · Phase 4）。
 *
 * 铁律：
 *  - 只有 freight_type=1 寄付（我方付）才计入应付；到付/第三方付不产生应付（否则虚增应付）。
 *    手工录入但无法关联运单的账单，视为我方成本（寄付）计入——录入者录它就意味着这是我方要付的钱。
 *  - 运费应付以"承运商月结汇总单"为账款主体承接 payment_records.order_id（运费无采购/销售 order_id，
 *    不能多条硬塞同一 order_id 冲突 UNIQUE(type,order_id)）。settlement_type 用月结、confirm_status=0 待财务确认。
 *  - 全量重算幂等：同承运商同账期反复生成，按当前所有合格账单 SUM 覆盖，不重复计账。
 */

function fmtBill(r) {
  return {
    id: r.id,
    carrierId: r.carrier_id,
    carrierName: r.carrier_name || null,
    waybillId: r.waybill_id,
    trackingNo: r.tracking_no || null,
    billPeriod: r.bill_period || null,
    actualFreight: Number(r.actual_freight),
    weight: r.weight != null ? Number(r.weight) : null,
    freightType: r.freight_type != null ? Number(r.freight_type) : null,
    settlementId: r.settlement_id,
    reconciled: !!r.reconciled,
    source: r.source || null,
    createdAt: r.created_at,
  }
}

function fmtSettlement(r) {
  return {
    id: r.id,
    settlementNo: r.settlement_no,
    carrierId: r.carrier_id,
    carrierName: r.carrier_name || null,
    billPeriod: r.bill_period,
    totalFreight: Number(r.total_freight),
    billCount: Number(r.bill_count),
    status: Number(r.status),
    statusLabel: Number(r.status) === 2 ? '已生成应付' : '草稿',
    statusTone: Number(r.status) === 2 ? 'success' : 'draft',
    paymentRecordId: r.payment_record_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// ─── 运费账单明细（人工录入 / 平台回传）─────────────────────────────────────────
async function listFreightBills({ page = 1, pageSize = 20, carrierId = null, billPeriod = '', reconciled = null } = {}) {
  const where = ['1=1']
  const params = []
  if (carrierId) { where.push('b.carrier_id = ?'); params.push(Number(carrierId)) }
  if (billPeriod) { where.push('b.bill_period = ?'); params.push(billPeriod) }
  if (reconciled != null && reconciled !== '') { where.push('b.reconciled = ?'); params.push(reconciled ? 1 : 0) }
  const whereSql = `WHERE ${where.join(' AND ')}`
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT b.*, c.name AS carrier_name, w.freight_type
     FROM logistics_freight_bills b
     LEFT JOIN carriers c ON c.id = b.carrier_id
     LEFT JOIN logistics_waybills w ON w.id = b.waybill_id
     ${whereSql} ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM logistics_freight_bills b ${whereSql}`, params,
  )
  return { list: rows.map(fmtBill), pagination: { page, pageSize, total } }
}

/**
 * 录入一条运费账单。tracking_no 若能命中运单则自动关联 waybill_id（拿到 freight_type）。
 * uk_bill(carrier_id, tracking_no) 幂等：重复录同一单更新金额。
 */
async function createFreightBill({ carrierId, trackingNo, waybillId = null, billPeriod = null, actualFreight, weight = null, source = 'import' }) {
  const cid = Number(carrierId)
  if (!Number.isFinite(cid) || cid <= 0) throw new AppError('承运商不能为空', 400)
  const tn = String(trackingNo || '').trim()
  if (!tn) throw new AppError('快递单号不能为空', 400)
  const freight = Number(actualFreight)
  if (!Number.isFinite(freight) || freight < 0) throw new AppError('运费金额非法', 400)

  let wid = waybillId ? Number(waybillId) : null
  let period = billPeriod
  if (!wid) {
    const [[wb]] = await pool.query('SELECT id FROM logistics_waybills WHERE tracking_no = ? LIMIT 1', [tn])
    if (wb) wid = wb.id
  }
  if (!period) {
    // 账期缺省取当前年月（真实场景由导入文件带；此处兜底）
    const [[{ p }]] = await pool.query("SELECT DATE_FORMAT(NOW(), '%Y-%m') AS p")
    period = p
  }
  const [r] = await pool.query(
    `INSERT INTO logistics_freight_bills
       (carrier_id, waybill_id, tracking_no, bill_period, actual_freight, weight, source)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       actual_freight = VALUES(actual_freight), weight = VALUES(weight),
       bill_period = VALUES(bill_period), waybill_id = COALESCE(VALUES(waybill_id), waybill_id)`,
    [cid, wid, tn, period, freight, weight, source],
  )
  return { id: r.insertId || null, billPeriod: period }
}

// ─── 汇总生成对承运商的应付 ────────────────────────────────────────────────────
async function listSettlements({ page = 1, pageSize = 20, carrierId = null, billPeriod = '' } = {}) {
  const where = ['1=1']
  const params = []
  if (carrierId) { where.push('carrier_id = ?'); params.push(Number(carrierId)) }
  if (billPeriod) { where.push('bill_period = ?'); params.push(billPeriod) }
  const whereSql = `WHERE ${where.join(' AND ')}`
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT * FROM logistics_freight_settlements ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM logistics_freight_settlements ${whereSql}`, params,
  )
  return { list: rows.map(fmtSettlement), pagination: { page, pageSize, total } }
}

/**
 * 生成/重算某承运商某账期的运费应付。全量重算幂等（按当前所有寄付账单 SUM 覆盖）。
 * @returns 生成的汇总单
 */
async function generateSettlement({ carrierId, billPeriod }, { createdBy = null } = {}) {
  const cid = Number(carrierId)
  const period = String(billPeriod || '').trim()
  if (!Number.isFinite(cid) || cid <= 0) throw new AppError('承运商不能为空', 400)
  if (!/^\d{4}-\d{2}$/.test(period)) throw new AppError('账期格式应为 YYYY-MM', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[carrier]] = await conn.query('SELECT id, name FROM carriers WHERE id = ? AND deleted_at IS NULL', [cid])
    if (!carrier) throw new AppError('承运商不存在', 404)

    // 合格账单：寄付(freight_type=1) 或 无法关联运单(视为我方成本)。锁定以串行化并发生成。
    const [bills] = await conn.query(
      `SELECT b.id, b.actual_freight
       FROM logistics_freight_bills b
       LEFT JOIN logistics_waybills w ON w.id = b.waybill_id
       WHERE b.carrier_id = ? AND b.bill_period = ?
         AND (w.freight_type = 1 OR b.waybill_id IS NULL)
       FOR UPDATE`,
      [cid, period],
    )
    if (!bills.length) throw new AppError('该承运商该账期无寄付运费可对账', 400)
    const total = bills.reduce((s, b) => s + Number(b.actual_freight), 0)
    const billIds = bills.map(b => b.id)

    // 汇总单头 upsert（uk_carrier_period）。先确保有 id 承接 payment_records.order_id。
    let [[settlement]] = await conn.query(
      'SELECT * FROM logistics_freight_settlements WHERE carrier_id = ? AND bill_period = ? FOR UPDATE',
      [cid, period],
    )
    if (!settlement) {
      const settlementNo = await generateDailyCode(conn, 'FS', 'logistics_freight_settlements', 'settlement_no')
      const [ins] = await conn.query(
        `INSERT INTO logistics_freight_settlements
           (settlement_no, carrier_id, carrier_name, bill_period, total_freight, bill_count, status, created_by)
         VALUES (?,?,?,?,?,?,1,?)`,
        [settlementNo, cid, carrier.name, period, total, billIds.length, createdBy],
      )
      ;[[settlement]] = await conn.query('SELECT * FROM logistics_freight_settlements WHERE id = ?', [ins.insertId])
    } else {
      await conn.query(
        'UPDATE logistics_freight_settlements SET total_freight = ?, bill_count = ? WHERE id = ?',
        [total, billIds.length, settlement.id],
      )
    }

    // 应付（承运商月结，月结 30 天，confirm_status=0 待财务确认）。
    // ⚠️ order_id 必须写 NULL：payment_records 的 UNIQUE(type,order_id) 里 type=1 的 order_id
    //    语义是采购单 id（inbound-tasks.settle.js）。运费若拿 settlement.id 当 order_id，会与采购单
    //    id 撞车、ON DUPLICATE 误改真实采购应付。手工/非单据应付一律 order_id=NULL（多个 NULL 不冲突，
    //    见 payments.service.js:130 与迁移 145），幂等改由 settlement.payment_record_id 承接（按 id 定位重算）。
    const due = buildDueDateSql(SETTLEMENT_TYPE.MONTHLY, 30, null)
    let paymentRecordId = settlement.payment_record_id || null
    if (paymentRecordId) {
      const [[old]] = await conn.query('SELECT total_amount FROM payment_records WHERE id = ? FOR UPDATE', [paymentRecordId])
      if (old) {
        const changed = Number(old.total_amount) !== total
        await conn.query(
          `UPDATE payment_records
           SET total_amount = ?, balance = GREATEST(0, ? - paid_amount),
               ${changed ? 'confirm_status = 0,' : ''}
               status = CASE WHEN paid_amount >= ? THEN 3 WHEN paid_amount > 0 THEN 2 ELSE 1 END
           WHERE id = ?`,
          [total, total, total, paymentRecordId],
        )
      } else {
        paymentRecordId = null // 应付记录被删，重建
      }
    }
    if (!paymentRecordId) {
      const [ins] = await conn.query(
        `INSERT INTO payment_records
           (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status, settlement_type, due_date)
         VALUES (1, NULL, ?, ?, ?, 0, ?, 1, 0, ?, ${due.expr})`,
        [settlement.settlement_no, carrier.name, total, total, SETTLEMENT_TYPE.MONTHLY, ...due.params],
      )
      paymentRecordId = ins.insertId
    }

    await conn.query(
      'UPDATE logistics_freight_settlements SET status = 2, payment_record_id = ? WHERE id = ?',
      [paymentRecordId, settlement.id],
    )
    await conn.query(
      `UPDATE logistics_freight_bills SET reconciled = 1, settlement_id = ? WHERE id IN (?)`,
      [settlement.id, billIds],
    )
    await conn.commit()

    const [[out]] = await pool.query('SELECT * FROM logistics_freight_settlements WHERE id = ?', [settlement.id])
    return fmtSettlement(out)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  listFreightBills,
  createFreightBill,
  listSettlements,
  generateSettlement,
}
