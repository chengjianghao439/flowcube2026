const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { normalizePagination } = require('../../utils/pagination')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')

function pad(val) {
  if (!val) return ''
  return String(val).padStart(2, '0')
}

function generateCode({ zone, aisle, rack, level, position }) {
  if (!zone || !aisle || !rack || !level || !position) return ''
  return `${zone}${pad(aisle)}-${pad(rack)}-${pad(level)}${pad(position)}`
}

function makeLocationBarcode(id) {
  return `R${String(id).padStart(6, '0')}`
}

function formatRow(row) {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name ?? null,
    code: row.code,
    barcode: row.barcode ?? null,
    zone: row.zone,
    aisle: row.aisle,
    rack: row.rack,
    level: row.level,
    position: row.position,
    name: row.name,
    remark: row.remark,
    status: row.status,
    createdAt: row.created_at,
  }
}

async function assertLocationDeletable(id) {
  const [containers] = await pool.query(
    'SELECT 1 FROM inventory_containers WHERE location_id=? LIMIT 1',
    [id],
  )
  if (containers[0]) {
    throw new AppError('库位仍被库存容器引用，禁止删除；请改为停用', 409)
  }
}

async function findAll({ page = 1, pageSize = 20, keyword = '', warehouseId = null, status = '', zone = '', scopeWarehouseIds = null }) {
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like = `%${keyword}%`

  const conditions = ['wl.deleted_at IS NULL', '(wl.code LIKE ? OR wl.name LIKE ?)']
  const params = [like, like]

  if (warehouseId) {
    conditions.push('wl.warehouse_id = ?')
    params.push(warehouseId)
  }
  if (status) {
    conditions.push('wl.status = ?')
    params.push(Number(status))
  }
  if (zone) {
    conditions.push('wl.zone LIKE ?')
    params.push(`%${zone}%`)
  }
  const scope = scopeFilter(scopeWarehouseIds, 'wl.warehouse_id')
  const where = conditions.join(' AND ') + scope.sql
  const whereParams = [...params, ...scope.params]

  const [rows] = await pool.query(
    `SELECT wl.*, iw.name AS warehouse_name
     FROM warehouse_locations wl
     LEFT JOIN inventory_warehouses iw ON iw.id = wl.warehouse_id
     WHERE ${where}
     ORDER BY wl.warehouse_id ASC, wl.code ASC
     LIMIT ? OFFSET ?`,
    [...whereParams, ps, offset],
  )

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM warehouse_locations wl WHERE ${where}`,
    whereParams,
  )

  return { list: rows.map(formatRow), pagination: { page, pageSize: ps, total } }
}

async function findById(id, scopeWarehouseIds = null) {
  const [rows] = await pool.query(
    `SELECT wl.*, iw.name AS warehouse_name
     FROM warehouse_locations wl
     LEFT JOIN inventory_warehouses iw ON iw.id = wl.warehouse_id
     WHERE wl.id = ? AND wl.deleted_at IS NULL`,
    [id],
  )
  if (!rows[0]) throw new AppError('库位不存在', 404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '库位')
  return formatRow(rows[0])
}

/** 某仓库下全部库位（下拉/上架选位，与前端 getLocationsByWarehouseApi 一致） */
async function findAllByWarehouseId(warehouseId) {
  const wid = Number(warehouseId)
  if (!Number.isFinite(wid) || wid <= 0) throw new AppError('仓库 ID 无效', 400)
  const [rows] = await pool.query(
    `SELECT wl.*, iw.name AS warehouse_name
     FROM warehouse_locations wl
     LEFT JOIN inventory_warehouses iw ON iw.id = wl.warehouse_id
     WHERE wl.deleted_at IS NULL AND wl.warehouse_id = ?
     ORDER BY wl.code ASC`,
    [wid],
  )
  return rows.map(formatRow)
}

async function create(data) {
  const { warehouseId, zone, aisle, rack, level, position, name, remark } = data
  if (!warehouseId) throw new AppError('仓库不能为空', 400)

  const code = generateCode({ zone, aisle, rack, level, position })
  if (!code) throw new AppError('库位编码字段不完整', 400)

  // 同仓库内编码唯一
  const [[exists]] = await pool.query(
    'SELECT id FROM warehouse_locations WHERE warehouse_id = ? AND code = ? AND deleted_at IS NULL',
    [warehouseId, code],
  )
  if (exists) throw new AppError(`库位编码 ${code} 已存在`, 400)

  // 建库位与回填条码必须同一个事务：barcode 由自增 id 生成，只能先 INSERT 再 UPDATE，
  // 中间失败会留下一条没有条码的库位——PDA 扫不到它，而且不会有任何报错提示，
  // 要等仓库现场扫不出来才发现。
  // （原先这里对 UPDATE 单独 try/catch 吞掉「barcode 列不存在」是为兼容旧库，
  //   本机与生产现在都有该列，兼容分支已无必要，一并去掉。）
  const conn = await pool.getConnection()
  let insertId
  try {
    await conn.beginTransaction()
    const [result] = await conn.query(
      `INSERT INTO warehouse_locations
         (warehouse_id, code, zone, aisle, rack, level, position, name, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [warehouseId, code, zone, pad(aisle), pad(rack), pad(level), pad(position), name || '', remark || ''],
    )
    insertId = result.insertId
    await conn.query('UPDATE warehouse_locations SET barcode = ? WHERE id = ?', [makeLocationBarcode(insertId), insertId])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return findById(insertId)
}

async function update(id, data, scopeWarehouseIds = null) {
  await findById(id, scopeWarehouseIds)
  const { warehouseId, zone, aisle, rack, level, position, name, remark, status } = data

  const code = generateCode({ zone, aisle, rack, level, position })
  if (!code) throw new AppError('库位编码字段不完整', 400)

  // 检查同仓库编码唯一（排除自身）
  const [[exists]] = await pool.query(
    'SELECT id FROM warehouse_locations WHERE warehouse_id = ? AND code = ? AND id <> ? AND deleted_at IS NULL',
    [warehouseId, code, id],
  )
  if (exists) throw new AppError(`库位编码 ${code} 已存在`, 400)

  await pool.query(
    `UPDATE warehouse_locations
     SET warehouse_id=?, code=?, zone=?, aisle=?, rack=?, level=?, position=?, name=?, remark=?, status=?
     WHERE id=? AND deleted_at IS NULL`,
    [warehouseId, code, zone, pad(aisle), pad(rack), pad(level), pad(position), name || '', remark || '', status ?? 1, id],
  )
  return findById(id)
}

async function softDelete(id, scopeWarehouseIds = null) {
  await findById(id, scopeWarehouseIds)
  await assertLocationDeletable(id)
  await pool.query(
    'UPDATE warehouse_locations SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

/**
 * PDA 上架时自动查找或创建库位
 * 规则：code = rackCode + "-" + level.padStart(2,'0') + "-" + position.padStart(2,'0')
 * 例：A01 + 02 + 03 → A01-02-03
 *
 * @param {object} conn       - 事务连接（调用方已开启事务）
 * @param {object} params
 * @param {number} params.warehouseId
 * @param {string} params.rackCode   - 货架编码，如 A01
 * @param {string} params.level      - 层，如 "02" 或 "2"
 * @param {string} params.position   - 位，如 "03" 或 "3"
 * @returns {number} location_id
 */
async function findByCode(code) {
  let rows
  try {
    ;[rows] = await pool.query(
      `SELECT id, code, barcode, name, zone, aisle, rack, level, position, warehouse_id, status
       FROM warehouse_locations
       WHERE (code = ? OR UPPER(barcode) = UPPER(?)) AND deleted_at IS NULL
       ORDER BY CASE WHEN UPPER(barcode) = UPPER(?) THEN 0 ELSE 1 END
       LIMIT 1`,
      [code, code, code],
    )
  } catch (e) {
    if (!(e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column ['`]?barcode/i.test(String(e.message)))) throw e
    ;[rows] = await pool.query(
      'SELECT id, code, name, zone, aisle, rack, level, position, warehouse_id, status FROM warehouse_locations WHERE code = ? AND deleted_at IS NULL LIMIT 1',
      [code],
    )
  }
  if (!rows.length) throw new AppError(`库位编码 ${code} 不存在`, 404)
  const r = rows[0]
  if (Number(r.status) !== 1) throw new AppError(`库位 ${code} 已停用`, 400)
  return { id: r.id, code: r.code, barcode: r.barcode ?? null, name: r.name, zone: r.zone, aisle: r.aisle, rack: r.rack, level: r.level, position: r.position, warehouseId: r.warehouse_id, status: r.status }
}

/**
 * 库位标签打印入队（对照 racks.service.enqueuePrintLabel）。
 * 返回 null = 未解析到打印机（前端提示未绑定/离线）；其余返回打印任务摘要。
 */
async function enqueuePrintLabel(id, { userId = null, scopeWarehouseIds = null } = {}) {
  await findById(id, scopeWarehouseIds)
  const { enqueueLocationLabelJob } = require('../print-jobs/print-jobs.service')
  // 不传 jobUniqueKey：由打印域按「对象 + 时间窗」默认分桶去重（见 print-jobs.label-command）
  const job = await enqueueLocationLabelJob({
    locationId: id,
    createdBy: userId,
  })
  if (!job) return null
  return {
    id:            job.id != null ? Number(job.id) : null,
    printerCode:   job.printerCode ?? null,
    printerName:   job.printerName ?? null,
    dispatchHint:  job.dispatchHint ?? null,
    contentType:   job.contentType ?? null,
    content:       job.content ?? null,
  }
}

module.exports = {
  findByCode,
  findAll,
  findById,
  findAllByWarehouseId,
  create,
  update,
  softDelete,
  generateCode,
  enqueuePrintLabel,
}
