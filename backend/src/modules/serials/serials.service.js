const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { scopeFilter } = require('../../utils/warehouseScope')

/**
 * 序列号台账 / 追溯 / 一致性对账（文档 04 · 6/8）。纯只读：不写 product_serials/serial_events，
 * 只查询。列表与对账都接仓库数据权限 scopeFilter(ps.warehouse_id / c.warehouse_id)，防越权跨仓看序列号。
 * 序列号写入的唯一合法入口仍是 engine/serialEngine，本模块只做展示与巡检。
 */

// product_serials.status: 1在库 2已出库 3已退货（见迁移 169）
const STATUS_LABEL = { 1: '在库', 2: '已出库', 3: '已退货' }

function fmtSerial(r) {
  return {
    id: Number(r.id),
    serialNo: r.serial_no,
    productId: Number(r.product_id),
    productCode: r.product_code,
    productName: r.product_name,
    unit: r.unit,
    status: Number(r.status),
    statusLabel: STATUS_LABEL[Number(r.status)] || '未知',
    warehouseId: r.warehouse_id != null ? Number(r.warehouse_id) : null,
    warehouseName: r.warehouse_name || null,
    containerId: r.container_id != null ? Number(r.container_id) : null,
    containerBarcode: r.container_barcode || null,
    purchaseOrderId: r.purchase_order_id != null ? Number(r.purchase_order_id) : null,
    inboundTaskId: r.inbound_task_id != null ? Number(r.inbound_task_id) : null,
    saleOrderId: r.sale_order_id != null ? Number(r.sale_order_id) : null,
    warehouseTaskId: r.warehouse_task_id != null ? Number(r.warehouse_task_id) : null,
    shippedAt: r.shipped_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** 序列号台账：搜索 SN/商品编码名称、状态、仓库、商品；接 scopeFilter，分页 */
async function listSerials({ page = 1, pageSize = 20, keyword = '', status = null, warehouseId = null, productId = null, scopeWarehouseIds = null }) {
  const conds = ['1=1']
  const params = []
  if (keyword) { conds.push('(ps.serial_no LIKE ? OR p.code LIKE ? OR p.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) }
  if (status != null) { conds.push('ps.status = ?'); params.push(Number(status)) }
  if (warehouseId) { conds.push('ps.warehouse_id = ?'); params.push(Number(warehouseId)) }
  if (productId) { conds.push('ps.product_id = ?'); params.push(Number(productId)) }
  const scope = scopeFilter(scopeWarehouseIds, 'ps.warehouse_id')
  const where = conds.join(' AND ') + scope.sql
  const whereParams = [...params, ...scope.params]

  const offset = (Number(page) - 1) * Number(pageSize)
  const [rows] = await pool.query(
    `SELECT ps.id, ps.serial_no, ps.product_id, p.code AS product_code, p.name AS product_name, p.unit,
            ps.status, ps.warehouse_id, w.name AS warehouse_name,
            ps.container_id, c.barcode AS container_barcode,
            ps.purchase_order_id, ps.inbound_task_id, ps.sale_order_id, ps.warehouse_task_id, ps.shipped_at,
            ps.created_at, ps.updated_at
     FROM product_serials ps
     JOIN product_items p ON p.id = ps.product_id
     LEFT JOIN inventory_warehouses w ON w.id = ps.warehouse_id
     LEFT JOIN inventory_containers c ON c.id = ps.container_id
     WHERE ${where}
     ORDER BY ps.updated_at DESC, ps.id DESC
     LIMIT ? OFFSET ?`,
    [...whereParams, Number(pageSize), offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM product_serials ps JOIN product_items p ON p.id = ps.product_id WHERE ${where}`,
    whereParams,
  )
  return { list: rows.map(fmtSerial), pagination: { page: Number(page), pageSize: Number(pageSize), total: Number(total) } }
}

/** 追溯：按 SN（可带 productId 消歧）返回主行 + 全链路事件时间线（register→putaway→ship→…） */
async function traceSerial({ serialNo, productId = null, scopeWarehouseIds = null }) {
  const sn = String(serialNo || '').trim()
  if (!sn) throw new AppError('请提供序列号', 400)
  const conds = ['ps.serial_no = ?']
  const params = [sn]
  if (productId) { conds.push('ps.product_id = ?'); params.push(Number(productId)) }
  const scope = scopeFilter(scopeWarehouseIds, 'ps.warehouse_id')
  const [mains] = await pool.query(
    `SELECT ps.*, p.code AS product_code, p.name AS product_name, p.unit,
            w.name AS warehouse_name, c.barcode AS container_barcode
     FROM product_serials ps
     JOIN product_items p ON p.id = ps.product_id
     LEFT JOIN inventory_warehouses w ON w.id = ps.warehouse_id
     LEFT JOIN inventory_containers c ON c.id = ps.container_id
     WHERE ${conds.join(' AND ')}${scope.sql}
     ORDER BY ps.id`,
    [...params, ...scope.params],
  )

  const matches = []
  for (const m of mains) {
    const [events] = await pool.query(
      `SELECT se.id, se.event_type, se.from_status, se.to_status, se.container_id, se.warehouse_id,
              se.ref_type, se.ref_id, se.remark, se.created_at,
              u.real_name AS operator_name, cont.barcode AS container_barcode
       FROM serial_events se
       LEFT JOIN sys_users u ON u.id = se.operator_id
       LEFT JOIN inventory_containers cont ON cont.id = se.container_id
       WHERE se.serial_id = ?
       ORDER BY se.created_at ASC, se.id ASC`,
      [m.id],
    )
    matches.push({
      serial: fmtSerial(m),
      events: events.map(e => ({
        id: Number(e.id),
        eventType: e.event_type,
        fromStatus: e.from_status != null ? Number(e.from_status) : null,
        toStatus: e.to_status != null ? Number(e.to_status) : null,
        containerId: e.container_id != null ? Number(e.container_id) : null,
        containerBarcode: e.container_barcode || null,
        warehouseId: e.warehouse_id != null ? Number(e.warehouse_id) : null,
        refType: e.ref_type,
        refId: e.ref_id != null ? Number(e.ref_id) : null,
        remark: e.remark,
        operatorName: e.operator_name || null,
        createdAt: e.created_at,
      })),
    })
  }
  return { serialNo: sn, matchCount: matches.length, matches }
}

/**
 * 一致性对账：对 serial_managed 商品的 ACTIVE 容器，逐个比对 remaining_qty vs 在库序列号数。
 * 守住核心不变量「容器 remaining_qty == 挂在它上 status=1 的序列号行数」。正常应零不一致。
 */
async function checkConsistency({ warehouseId = null, scopeWarehouseIds = null }) {
  const conds = ['c.status = 1', 'c.deleted_at IS NULL', 'p.serial_managed = 1']
  const params = []
  if (warehouseId) { conds.push('c.warehouse_id = ?'); params.push(Number(warehouseId)) }
  const scope = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')
  const whereSql = conds.join(' AND ') + scope.sql
  const whereParams = [...params, ...scope.params]

  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT c.id AS container_id, c.barcode, c.product_id, p.code AS product_code, p.name AS product_name,
              c.warehouse_id, w.name AS warehouse_name, c.remaining_qty,
              (SELECT COUNT(*) FROM product_serials ps WHERE ps.container_id = c.id AND ps.status = 1) AS sn_count
       FROM inventory_containers c
       JOIN product_items p ON p.id = c.product_id
       LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
       WHERE ${whereSql}
     ) t
     WHERE t.remaining_qty <> t.sn_count
     ORDER BY t.container_id`,
    whereParams,
  )
  const [[{ checked }]] = await pool.query(
    `SELECT COUNT(*) AS checked FROM inventory_containers c JOIN product_items p ON p.id = c.product_id WHERE ${whereSql}`,
    whereParams,
  )
  return {
    checkedContainers: Number(checked),
    mismatchCount: rows.length,
    consistent: rows.length === 0,
    mismatches: rows.map(r => ({
      containerId: Number(r.container_id),
      barcode: r.barcode,
      productId: Number(r.product_id),
      productCode: r.product_code,
      productName: r.product_name,
      warehouseId: r.warehouse_id != null ? Number(r.warehouse_id) : null,
      warehouseName: r.warehouse_name || null,
      remainingQty: Number(r.remaining_qty),
      inStockSerialCount: Number(r.sn_count),
    })),
  }
}

module.exports = { listSerials, traceSerial, checkConsistency }
