const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { scopeFilter } = require('../../utils/warehouseScope')
const serialEngine = require('../../engine/serialEngine')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')

// 容器状态（见 containerEngine.CONTAINER_STATUS）：1 ACTIVE / 4 PENDING_PUTAWAY / 5 PENDING_QA
const C_ACTIVE = 1, C_PENDING_PUTAWAY = 4, C_PENDING_QA = 5

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

/**
 * 历史导入候选（文档 04 · Phase 2）：某商品在可见仓库的全部 ACTIVE 在库容器（待补 SN），
 * 附阻断标志。序列号管理是商品级，导入必须全覆盖——若存在待上架/待质检容器、被出库锁定的容器、
 * 或用户无权限仓库里还有该商品在库，则不可导入（前端据此拦住并提示）。
 */
async function getImportCandidates({ productId, scopeWarehouseIds = null }) {
  const pid = Number(productId)
  if (!Number.isFinite(pid) || pid <= 0) throw new AppError('请选择商品', 400)
  const [[prod]] = await pool.query(
    'SELECT id, code, name, unit, serial_managed FROM product_items WHERE id = ? AND deleted_at IS NULL',
    [pid],
  )
  if (!prod) throw new AppError('商品不存在', 404)

  const scope = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')
  const [containers] = await pool.query(
    `SELECT c.id AS container_id, c.barcode, c.warehouse_id, w.name AS warehouse_name,
            loc.code AS location_code, c.remaining_qty, c.locked_by_task_id,
            (SELECT COUNT(*) FROM product_serials ps WHERE ps.container_id = c.id AND ps.status = 1) AS sn_count
     FROM inventory_containers c
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.product_id = ? AND c.status = ? AND c.deleted_at IS NULL AND c.remaining_qty > 0
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)${scope.sql}
     ORDER BY c.warehouse_id, c.id`,
    [pid, C_ACTIVE, ...scope.params],
  )
  // 阻断项统计（不泄露越权仓库明细，只给计数）
  const [[{ pendingCount }]] = await pool.query(
    'SELECT COUNT(*) AS pendingCount FROM inventory_containers WHERE product_id = ? AND status IN (?, ?) AND deleted_at IS NULL',
    [pid, C_PENDING_PUTAWAY, C_PENDING_QA],
  )
  let outOfScopeStock = 0
  if (scopeWarehouseIds != null) {
    const [[{ n }]] = await pool.query(
      `SELECT COALESCE(SUM(remaining_qty),0) AS n FROM inventory_containers
       WHERE product_id = ? AND status = ? AND deleted_at IS NULL AND remaining_qty > 0
         AND (is_legacy = 0 OR is_legacy IS NULL)
         AND warehouse_id NOT IN (${scopeWarehouseIds.length ? scopeWarehouseIds.map(() => '?').join(',') : 'NULL'})`,
      scopeWarehouseIds.length ? [pid, C_ACTIVE, ...scopeWarehouseIds] : [pid, C_ACTIVE],
    )
    outOfScopeStock = Number(n)
  }
  const lockedContainers = containers.filter(c => c.locked_by_task_id != null).length

  return {
    product: { id: Number(prod.id), code: prod.code, name: prod.name, unit: prod.unit, serialManaged: Number(prod.serial_managed) === 1 },
    containers: containers.map(c => ({
      containerId: Number(c.container_id),
      barcode: c.barcode,
      warehouseId: Number(c.warehouse_id),
      warehouseName: c.warehouse_name || null,
      locationCode: c.location_code || null,
      remainingQty: Number(c.remaining_qty),
      snCount: Number(c.sn_count),
      locked: c.locked_by_task_id != null,
    })),
    totalQty: containers.reduce((s, c) => s + Number(c.remaining_qty), 0),
    blockers: {
      alreadySerialized: Number(prod.serial_managed) === 1,
      pendingContainers: Number(pendingCount),
      lockedContainers,
      outOfScopeStock,
      noStock: containers.length === 0,
    },
  }
}

/**
 * 历史序列号导入（文档 04 · Phase 2）。事务 + 幂等；逐容器把 SN 绑到既有 ACTIVE 容器（status=1），
 * 原子开启 serial_managed。严守：不改容器 remaining_qty；每容器 SN 数==remaining_qty；全覆盖（商品级）；
 * 无 PENDING/锁定容器；无越权仓库残留库存。写入走 serialEngine，末尾逐容器 assertSerialCountMatchesContainer 兜底。
 */
async function importHistorical({ productId, containers, operator = null, requestKey = null, scopeWarehouseIds = null }) {
  const pid = Number(productId)
  if (!Number.isFinite(pid) || pid <= 0) throw new AppError('请选择商品', 400)
  if (!Array.isArray(containers) || !containers.length) throw new AppError('请为每个在库容器补齐序列号', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'serial.import', userId: operator?.userId || null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const [[prod]] = await conn.query('SELECT id, serial_managed FROM product_items WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [pid])
    if (!prod) throw new AppError('商品不存在', 404)
    if (Number(prod.serial_managed) === 1) throw new AppError('该商品已启用序列号管理，无需再次导入', 400, 'SERIAL_ALREADY_MANAGED')

    // 无在途 PENDING 容器（待上架/待质检）——否则上架后 putaway 只写事件不建 SN，出库仍会 broken
    const [[{ pendingCount }]] = await conn.query(
      'SELECT COUNT(*) AS pendingCount FROM inventory_containers WHERE product_id = ? AND status IN (?, ?) AND deleted_at IS NULL',
      [pid, C_PENDING_PUTAWAY, C_PENDING_QA],
    )
    if (Number(pendingCount) > 0) throw new AppError('该商品尚有待上架/待质检容器，请先完成上架/质检再导入序列号', 409, 'SERIAL_IMPORT_PENDING_CONTAINERS')

    // 全量 ACTIVE 容器（**不过滤 scope**：商品级开关必须全覆盖），FOR UPDATE 锁定
    const [dbContainers] = await conn.query(
      `SELECT id, warehouse_id, remaining_qty, locked_by_task_id
       FROM inventory_containers
       WHERE product_id = ? AND status = ? AND deleted_at IS NULL AND remaining_qty > 0
         AND (is_legacy = 0 OR is_legacy IS NULL)
       ORDER BY id FOR UPDATE`,
      [pid, C_ACTIVE],
    )
    if (!dbContainers.length) throw new AppError('该商品没有需要补齐序列号的在库容器（零库存可直接在商品档案开启）', 400, 'SERIAL_IMPORT_NO_STOCK')

    // 越权仓库残留库存 → 无法完成商品级全覆盖
    if (scopeWarehouseIds != null) {
      const scoped = new Set(scopeWarehouseIds.map(Number))
      if (dbContainers.some(c => !scoped.has(Number(c.warehouse_id)))) {
        throw new AppError('该商品在您无权限的仓库还有在库库存，无法完成全量序列号导入（序列号管理是商品级，需覆盖全部在库容器）', 403, 'SERIAL_IMPORT_OUT_OF_SCOPE')
      }
    }
    const locked = dbContainers.filter(c => c.locked_by_task_id != null)
    if (locked.length) throw new AppError(`有 ${locked.length} 个容器正被出库任务锁定，请等待相关出库完成后再导入`, 409, 'SERIAL_IMPORT_CONTAINER_LOCKED')

    // 提交集合 ↔ DB 全量 ACTIVE 容器：必须一一对应（不缺不多）
    const dbMap = new Map(dbContainers.map(c => [Number(c.id), c]))
    const submittedMap = new Map()
    for (const item of containers) {
      const cid = Number(item?.containerId)
      if (!Number.isFinite(cid) || cid <= 0) throw new AppError('容器ID无效', 400)
      if (submittedMap.has(cid)) throw new AppError(`容器 ${cid} 重复提交`, 400)
      submittedMap.set(cid, Array.isArray(item.serialNos) ? item.serialNos : [])
    }
    for (const cid of dbMap.keys()) {
      if (!submittedMap.has(cid)) throw new AppError('未覆盖全部在库容器：序列号管理是商品级，必须为每个在库容器一次性补齐', 400, 'SERIAL_IMPORT_NOT_FULL_COVERAGE')
    }
    for (const cid of submittedMap.keys()) {
      if (!dbMap.has(cid)) throw new AppError(`容器 ${cid} 不属于该商品的在库容器或不可导入`, 400, 'SERIAL_IMPORT_UNKNOWN_CONTAINER')
    }

    // 先置开关（否则 assertSerialCountMatchesContainer 因 serial_managed=0 会跳过校验），全在同一事务
    await conn.query('UPDATE product_items SET serial_managed = 1 WHERE id = ?', [pid])

    const globalSeen = new Set()
    let totalImported = 0
    for (const [cid, serialNos] of submittedMap) {
      const c = dbMap.get(cid)
      const need = Number(c.remaining_qty)
      const list = serialEngine.normalizeSerialList(serialNos)   // 单容器内清洗/去重
      if (list.length !== need) throw new AppError(`容器 ${cid} 需 ${need} 个序列号，实际提交 ${list.length} 个`, 400, 'SERIAL_IMPORT_COUNT_MISMATCH')
      for (const sn of list) {
        if (globalSeen.has(sn)) throw new AppError(`序列号在多个容器间重复：${sn}`, 400, 'SERIAL_DUP_ACROSS_CONTAINERS')
        globalSeen.add(sn)
      }
      await serialEngine.importHistoricalSerials(conn, { productId: pid, warehouseId: c.warehouse_id, containerId: cid, serialNos: list, operatorId: operator?.userId || null })
      await serialEngine.assertSerialCountMatchesContainer(conn, cid)   // 逐容器兜底（此时 serial_managed 已=1）
      totalImported += list.length
    }

    const payload = { productId: pid, containerCount: submittedMap.size, importedCount: totalImported }
    if (requestState.enabled) {
      await completeOperationRequest(conn, requestState, { data: payload, message: `历史序列号导入 ${totalImported} 台`, resourceType: 'product', resourceId: pid })
    }
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

module.exports = { listSerials, traceSerial, checkConsistency, getImportCandidates, importHistorical }
