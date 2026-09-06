const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { isDirect, json } = require('./logistics.direct')

// ─── 内联状态机（不进 documentStatusRules.js，像 return_tasks）────────────────
const WB_STATUS = { PENDING: 1, FETCHING: 2, FETCHED: 3, FAILED: 4, VOID: 5, UNKNOWN: 6 }
const WB_STATUS_META = {
  1: { label: '待取号', tone: 'active' },
  2: { label: '取号中', tone: 'warning' },
  3: { label: '已取号', tone: 'success' },
  4: { label: '取号失败', tone: 'danger' },
  5: { label: '已作废', tone: 'draft' },
  6: { label: '下单待核实', tone: 'warning' },
}
const FREIGHT_TYPE_LABEL = { 1: '寄付', 2: '到付', 3: '第三方付' }

function fmt(r) {
  const meta = WB_STATUS_META[Number(r.status)] || { label: String(r.status), tone: 'info' }
  return {
    id: r.id,
    waybillNo: r.waybill_no,
    saleOrderId: r.sale_order_id,
    saleOrderNo: r.sale_order_no || null,
    warehouseTaskId: r.warehouse_task_id,
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name || null,
    packageId: r.package_id,
    packageBarcode: r.package_barcode || null,
    carrierId: r.carrier_id,
    carrierName: r.carrier_name || null,
    platformCode: r.platform_code || null,
    platformCarrier: r.platform_carrier || null,
    trackingNo: r.tracking_no || null,
    trackingNumbers: json(r.tracking_numbers, []),
    shipment: json(r.shipment_json),
    submittedToPlatform: !!r.direct_request,
    status: Number(r.status),
    statusLabel: meta.label,
    statusTone: meta.tone,
    freightType: r.freight_type != null ? Number(r.freight_type) : null,
    freightTypeLabel: r.freight_type != null ? (FREIGHT_TYPE_LABEL[Number(r.freight_type)] || null) : null,
    estFreight: r.est_freight != null ? Number(r.est_freight) : null,
    receiverName: r.receiver_name || null,
    receiverPhone: r.receiver_phone || null,
    receiverAddress: r.receiver_address || null,
    printDataRef: r.print_data_ref || null,
    trackStatus: Number(r.track_status || 0),
    errorMessage: r.error_message || null,
    retryCount: Number(r.retry_count || 0),
    lastTriedAt: r.last_tried_at || null,
    customerName: r.customer_name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const SELECT_COLS = `
  w.*, so.order_no AS sale_order_no, so.customer_name,
  wh.name AS warehouse_name`
const SELECT_FROM = `
  FROM logistics_waybills w
  LEFT JOIN sale_orders so ON so.id = w.sale_order_id
  LEFT JOIN inventory_warehouses wh ON wh.id = w.warehouse_id`

// ─── 列表（接仓库数据权限）────────────────────────────────────────────────────
async function listWaybills({ page = 1, pageSize = 20, keyword = '', status = null, warehouseIds = null, startDate = '', endDate = '', carrierId = null } = {}) {
  const where = ['1=1']
  const params = []
  if (keyword) {
    where.push('(w.waybill_no LIKE ? OR w.tracking_no LIKE ? OR w.carrier_name LIKE ? OR so.order_no LIKE ? OR w.receiver_name LIKE ?)')
    const like = `%${keyword}%`
    params.push(like, like, like, like, like)
  }
  if (status != null && status !== '') {
    where.push('w.status = ?')
    params.push(Number(status))
  }
  if (startDate) {
    where.push('w.created_at >= ?')
    params.push(`${startDate} 00:00:00`)
  }
  if (endDate) {
    where.push('w.created_at <= ?')
    params.push(`${endDate} 23:59:59`)
  }
  if (carrierId) {
    where.push('w.carrier_id = ?')
    params.push(Number(carrierId))
  }
  const scope = scopeFilter(warehouseIds, 'w.warehouse_id')
  const whereSql = `WHERE ${where.join(' AND ')}${scope.sql}`
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLS} ${SELECT_FROM} ${whereSql}
     ORDER BY w.id DESC LIMIT ? OFFSET ?`,
    [...params, ...scope.params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total ${SELECT_FROM} ${whereSql}`,
    [...params, ...scope.params],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function getWaybillById(id, { warehouseIds = null } = {}) {
  const [[row]] = await pool.query(
    `SELECT ${SELECT_COLS} ${SELECT_FROM} WHERE w.id = ?`, [id],
  )
  if (!row) throw new AppError('运单不存在', 404)
  assertInScope(warehouseIds, row.warehouse_id, '运单')
  return fmt(row)
}

async function getTrackEvents(id, { warehouseIds = null } = {}) {
  await getWaybillById(id, { warehouseIds }) // scope 校验
  const [rows] = await pool.query(
    `SELECT id, event_time, status_code, description, location, created_at
     FROM logistics_tracking_events WHERE waybill_id = ?
     ORDER BY event_time ASC, id ASC`, [id],
  )
  return rows.map(r => ({
    id: r.id,
    eventTime: r.event_time,
    statusCode: r.status_code || null,
    description: r.description || null,
    location: r.location || null,
    createdAt: r.created_at,
  }))
}

// ─── 打包完成时写"待取号"记录（在 finishPackage 事务内调用，零 HTTP）──────────
/**
 * 只有销售单已指定承运商（carrier_id 非空）才建运单——这是本功能的 opt-in 信号。
 * 快照收件信息/承运商平台配置，生成内部单号 WB+日期序列。
 * uk_package 幂等：同包裹重复调用不会插第二条（ON DUPLICATE 空更新）。
 * @returns {Promise<{waybillId, waybillNo}|null>} 未建（无承运商）返回 null
 */
async function createPendingWaybillTx(conn, { packageId, createdBy = null } = {}) {
  const [[info]] = await conn.query(
    `SELECT p.id AS package_id, p.barcode AS package_barcode,
            wt.id AS warehouse_task_id, wt.warehouse_id, wt.sale_order_id,
            so.carrier_id, so.freight_type, so.receiver_name, so.receiver_phone, so.receiver_address,
            c.name AS carrier_name, c.platform_code, c.platform_carrier
     FROM packages p
     JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     LEFT JOIN sale_orders so ON so.id = wt.sale_order_id
     LEFT JOIN carriers c ON c.id = so.carrier_id
     WHERE p.id = ? FOR UPDATE`,
    [packageId],
  )
  if (!info || !info.sale_order_id || !info.carrier_id) return null // 无销售单/未指定承运商 → 不建运单
  if (isDirect(info.platform_code)) return null // 官方直连在整批 packDone 后按实际箱数创建

  // 已存在则直接返回（uk_package），避免依赖异常路径
  const [[existing]] = await conn.query(
    'SELECT id, waybill_no FROM logistics_waybills WHERE package_id = ?', [packageId],
  )
  if (existing) return { waybillId: existing.id, waybillNo: existing.waybill_no }

  const waybillNo = await generateDailyCode(conn, 'WB', 'logistics_waybills', 'waybill_no')
  const [r] = await conn.query(
    `INSERT INTO logistics_waybills
       (waybill_no, sale_order_id, warehouse_task_id, warehouse_id, package_id, package_barcode,
        carrier_id, carrier_name, platform_code, platform_carrier, status,
        freight_type, receiver_name, receiver_phone, receiver_address, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      waybillNo, info.sale_order_id, info.warehouse_task_id, info.warehouse_id, packageId, info.package_barcode,
      info.carrier_id, info.carrier_name, info.platform_code, info.platform_carrier, WB_STATUS.PENDING,
      info.freight_type, info.receiver_name, info.receiver_phone, info.receiver_address, createdBy,
    ],
  )
  if (!r.insertId) {
    const [[again]] = await conn.query('SELECT id, waybill_no FROM logistics_waybills WHERE package_id = ?', [packageId])
    return again ? { waybillId: again.id, waybillNo: again.waybill_no } : null
  }
  return { waybillId: r.insertId, waybillNo }
}

// ─── 手工录快递单号（Phase 1：承运商未对接平台时，运营手抄）────────────────────
async function manualSetTracking(id, { trackingNo }, { warehouseIds = null } = {}) {
  const tn = String(trackingNo || '').trim()
  if (!tn) throw new AppError('快递单号不能为空', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM logistics_waybills WHERE id = ? FOR UPDATE', [id])
    if (!row) throw new AppError('运单不存在', 404)
    assertInScope(warehouseIds, row.warehouse_id, '运单')
    if (isDirect(row.platform_code)) throw new AppError('直连运单由平台返回整批母子单号，请通过原单查询核实', 409)
    if (![1, 3, 4].includes(Number(row.status))) throw new AppError('当前状态不能手工录入快递单号', 409)
    await conn.query(
      `UPDATE logistics_waybills
       SET tracking_no = ?, status = ?, print_data_ref = 'manual', error_message = NULL
       WHERE id = ? AND status IN (?,?,?)`,
      [tn, WB_STATUS.FETCHED, id, WB_STATUS.PENDING, WB_STATUS.FAILED, WB_STATUS.FETCHED],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return getWaybillById(id, { warehouseIds })
}

// ─── 手动重试取号（把失败/待取号单交还给 worker）────────────────────────────────
async function retryFetch(id, { warehouseIds = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM logistics_waybills WHERE id = ? FOR UPDATE', [id])
    if (!row) throw new AppError('运单不存在', 404)
    assertInScope(warehouseIds, row.warehouse_id, '运单')
    if (isDirect(row.platform_code) && [1, 4, 6].includes(Number(row.status))) {
      await conn.query(`UPDATE logistics_waybills SET status = ?, retry_count = 0, last_tried_at = NULL, error_message = NULL WHERE id = ?`,
        [row.direct_request || Number(row.status) === 6 ? 6 : 1, id])
      await conn.commit()
      return getWaybillById(id, { warehouseIds })
    }
    if (![WB_STATUS.PENDING, WB_STATUS.FAILED].includes(Number(row.status))) {
      throw new AppError('仅待取号/取号失败的运单可重试', 409)
    }
    if (!row.platform_code) throw new AppError('该承运商未配置电子面单平台，无法自动取号（可手工录号）', 400)
    // 置回待取号，交给 worker 抢占；清错误信息
    await conn.query(
      `UPDATE logistics_waybills SET status = ?, error_message = NULL WHERE id = ? AND status IN (?,?)`,
      [WB_STATUS.PENDING, id, WB_STATUS.PENDING, WB_STATUS.FAILED],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return getWaybillById(id, { warehouseIds })
}

// ─── 作废运单 ─────────────────────────────────────────────────────────────────
async function voidWaybill(id, { reason = null } = {}, { warehouseIds = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM logistics_waybills WHERE id = ? FOR UPDATE', [id])
    if (!row) throw new AppError('运单不存在', 404)
    assertInScope(warehouseIds, row.warehouse_id, '运单')
    if (Number(row.status) === WB_STATUS.VOID) throw new AppError('运单已作废', 409)
    if (Number(row.status) === WB_STATUS.FETCHING) throw new AppError('取号进行中，请稍后再作废', 409)
    if (isDirect(row.platform_code) && (row.direct_request || [3, 6].includes(Number(row.status)))) {
      throw new AppError('该运单已向快递平台提交，请通过快递官方处理取消；本地作废不能取消真实快递订单', 409)
    }
    await conn.query(
      `UPDATE logistics_waybills SET status = ?, error_message = ? WHERE id = ? AND status <> ?`,
      [WB_STATUS.VOID, reason ? `已作废：${reason}` : '已作废', id, WB_STATUS.VOID],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return getWaybillById(id, { warehouseIds })
}

module.exports = {
  WB_STATUS,
  WB_STATUS_META,
  fmt,
  listWaybills,
  getWaybillById,
  getTrackEvents,
  createPendingWaybillTx,
  manualSetTracking,
  retryFetch,
  voidWaybill,
}
