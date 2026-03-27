const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

function fmt(r) {
  return {
    id:           r.id,
    warehouseId:  r.warehouse_id,
    warehouseName: r.warehouse_name || null,
    barcode:      r.barcode ?? null,
    zone:         r.zone,
    code:         r.code,
    name:         r.name,
    maxLevels:    r.max_levels,
    maxPositions: r.max_positions,
    status:       r.status,
    remark:       r.remark || null,
    createdAt:    r.created_at,
  }
}

async function findAll({ page = 1, pageSize = 20, keyword = '', warehouseId = null, zone = null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const conds = ['r.deleted_at IS NULL', '(r.code LIKE ? OR r.name LIKE ? OR r.zone LIKE ?)']
  const params = [like, like, like]

  if (warehouseId) { conds.push('r.warehouse_id = ?'); params.push(warehouseId) }
  if (zone)        { conds.push('r.zone = ?');         params.push(zone) }

  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT r.*, w.name AS warehouse_name
     FROM warehouse_racks r
     LEFT JOIN inventory_warehouses w ON w.id = r.warehouse_id
     WHERE ${where}
     ORDER BY r.warehouse_id ASC, r.zone ASC, r.code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM warehouse_racks r WHERE ${where}`,
    params,
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findActive(warehouseId) {
  const conds = ['r.deleted_at IS NULL', 'r.status = 1']
  const params = []
  if (warehouseId) { conds.push('r.warehouse_id = ?'); params.push(warehouseId) }
  const [rows] = await pool.query(
    `SELECT r.* FROM warehouse_racks r WHERE ${conds.join(' AND ')} ORDER BY r.zone ASC, r.code ASC`,
    params,
  )
  return rows.map(fmt)
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT r.*, w.name AS warehouse_name
     FROM warehouse_racks r
     LEFT JOIN inventory_warehouses w ON w.id = r.warehouse_id
     WHERE r.id = ? AND r.deleted_at IS NULL`,
    [id],
  )
  if (!row) throw new AppError('货架不存在', 404)
  return fmt(row)
}

async function create(data) {
  const { warehouseId, zone = '', code, name = '', maxLevels = 5, maxPositions = 10, remark } = data
  if (!warehouseId) throw new AppError('仓库不能为空', 400)
  if (!code)        throw new AppError('货架编码不能为空', 400)

  const [[exists]] = await pool.query(
    'SELECT id FROM warehouse_racks WHERE warehouse_id = ? AND code = ? AND deleted_at IS NULL',
    [warehouseId, code],
  )
  if (exists) throw new AppError(`货架编码 ${code} 已存在`, 400)

  const [result] = await pool.query(
    `INSERT INTO warehouse_racks (warehouse_id, zone, code, name, max_levels, max_positions, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [warehouseId, zone, code, name, maxLevels, maxPositions, remark || null],
  )
  const newId = result.insertId
  const barcode = `RCK${String(newId).padStart(6, '0')}`
  try {
    await pool.query('UPDATE warehouse_racks SET barcode = ? WHERE id = ?', [barcode, newId])
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column ['`]?barcode/i.test(String(e.message))) {
      throw new AppError('数据库缺少货架条码字段，请先执行迁移 backend/src/database/051_warehouse_racks_barcode.sql', 503)
    }
    throw e
  }
  return findById(newId)
}

async function update(id, data) {
  await findById(id)
  const { zone, code, name, maxLevels, maxPositions, status, remark } = data

  if (code) {
    const [[dup]] = await pool.query(
      'SELECT id FROM warehouse_racks WHERE code = ? AND id <> ? AND deleted_at IS NULL',
      [code, id],
    )
    if (dup) throw new AppError(`货架编码 ${code} 已存在`, 400)
  }

  await pool.query(
    `UPDATE warehouse_racks
     SET zone=COALESCE(?,zone), code=COALESCE(?,code), name=COALESCE(?,name),
         max_levels=COALESCE(?,max_levels), max_positions=COALESCE(?,max_positions),
         status=COALESCE(?,status), remark=COALESCE(?,remark)
     WHERE id = ? AND deleted_at IS NULL`,
    [zone ?? null, code ?? null, name ?? null, maxLevels ?? null, maxPositions ?? null,
     status ?? null, remark ?? null, id],
  )
  return findById(id)
}

/**
 * 校验货架可删：库位表 rack 字段与货架 code 一致时视为绑定；相关库位上仍有在库容器则禁止删除
 */
async function assertRackSafeToDelete(rack) {
  const wid = Number(rack.warehouseId)
  const rackCode = String(rack.code || '').trim()
  if (!wid || !rackCode) throw new AppError('货架数据不完整', 400)

  const [[locRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM warehouse_locations
     WHERE warehouse_id = ? AND deleted_at IS NULL
       AND rack IS NOT NULL AND TRIM(rack) = ?`,
    [wid, rackCode],
  )
  const locCnt = Number(locRow.c)
  if (locCnt > 0) {
    throw new AppError(
      `无法删除：仍有 ${locCnt} 个库位的「货架」字段指向编码「${rackCode}」，请先调整库位后再删`,
      400,
    )
  }

  const [[cntRow]] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM inventory_containers c
     JOIN warehouse_locations wl ON wl.id = c.location_id AND wl.deleted_at IS NULL
     WHERE c.warehouse_id = ? AND c.deleted_at IS NULL AND c.status = 1 AND c.remaining_qty > 0
       AND wl.rack IS NOT NULL AND TRIM(wl.rack) = ?`,
    [wid, rackCode],
  )
  const cnt = Number(cntRow.c)
  if (cnt > 0) {
    throw new AppError(
      `无法删除：该货架相关库位上仍有 ${cnt} 个在库容器（含商品库存），请先移库或出库后再删`,
      400,
    )
  }
}

async function softDelete(id) {
  const rack = await findById(id)
  await assertRackSafeToDelete(rack)
  await pool.query(
    'UPDATE warehouse_racks SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

/**
 * 新建货架前扫描提示：RCK 冲突、PRD/CNT/商品编码 与 rack 维度上在库关系
 */
async function scanHint({ warehouseId, rackCode, scanRaw, excludeRackId = null }) {
  const wid = Number(warehouseId)
  const code = String(rackCode || '').trim()
  const raw = String(scanRaw || '').trim()
  if (!wid || !code || !raw) {
    return { kind: 'invalid', message: '请先选择仓库、填写货架编码，再扫描' }
  }

  const up = raw.toUpperCase()

  const rck = /^RCK(\d+)$/i.exec(raw)
  if (rck) {
    try {
      const [[existing]] = await pool.query(
        `SELECT id, code FROM warehouse_racks WHERE UPPER(barcode) = ? AND deleted_at IS NULL`,
        [up],
      )
      if (existing && (!excludeRackId || Number(existing.id) !== Number(excludeRackId))) {
        return {
          kind:    'warn',
          message: `该货架条码已存在（货架编码：${existing.code}），请勿重复使用`,
        }
      }
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column ['`]?barcode/i.test(String(e.message))) {
        return { kind: 'invalid', message: '数据库未迁移货架条码字段，无法校验 RCK' }
      }
      throw e
    }
    return { kind: 'ok', message: '条码可用；保存后将自动生成 RCK 条码' }
  }

  const prd = /^PRD(\d+)$/i.exec(raw)
  if (prd) {
    const pid = Number(prd[1])
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS c FROM inventory_containers c
       JOIN warehouse_locations wl ON wl.id = c.location_id AND wl.deleted_at IS NULL
       WHERE c.warehouse_id = ? AND c.product_id = ? AND c.status = 1 AND c.deleted_at IS NULL
         AND c.remaining_qty > 0 AND wl.rack IS NOT NULL AND TRIM(wl.rack) = ?`,
      [wid, pid, code],
    )
    if (Number(cnt.c) > 0) {
      return {
        kind:    'binding',
        message: `该商品（PRD）在货架编码「${code}」相关库位仍有在库容器，保存前请确认；若删除旧货架需先移库`,
      }
    }
    return { kind: 'ok', message: '未发现该商品在此货架维度上的在库容器' }
  }

  const cntM = /^CNT(\d+)$/i.exec(raw)
  if (cntM) {
    const [[c]] = await pool.query(
      `SELECT c.barcode, wl.rack FROM inventory_containers c
       LEFT JOIN warehouse_locations wl ON wl.id = c.location_id AND wl.deleted_at IS NULL
       WHERE c.warehouse_id = ? AND UPPER(c.barcode) = ? AND c.deleted_at IS NULL`,
      [wid, up],
    )
    if (c && c.rack != null && String(c.rack).trim() === code) {
      return {
        kind:    'binding',
        message: `容器 ${c.barcode} 已位于「货架=${code}」的库位上，请注意与新建货架的关系`,
      }
    }
    if (c && c.rack != null && String(c.rack).trim() !== code) {
      return {
        kind: 'ok',
        message: `容器 ${c.barcode} 所在库位货架字段为「${String(c.rack).trim()}」，与当前编码 ${code} 不一致`,
      }
    }
    return { kind: 'ok', message: '未找到该容器或暂无库位货架信息' }
  }

  const [[prod]] = await pool.query(
    'SELECT id, code, name FROM product_items WHERE (code = ? OR CAST(id AS CHAR) = ?) AND deleted_at IS NULL LIMIT 1',
    [raw, raw],
  )
  if (prod) {
    const [[c2]] = await pool.query(
      `SELECT COUNT(*) AS c FROM inventory_containers c
       JOIN warehouse_locations wl ON wl.id = c.location_id AND wl.deleted_at IS NULL
       WHERE c.warehouse_id = ? AND c.product_id = ? AND c.status = 1 AND c.deleted_at IS NULL
         AND c.remaining_qty > 0 AND wl.rack IS NOT NULL AND TRIM(wl.rack) = ?`,
      [wid, prod.id, code],
    )
    if (Number(c2.c) > 0) {
      return {
        kind:    'binding',
        message: `商品「${prod.name}」在货架「${code}」相关库位仍有在库，若需调整库存请先移库`,
      }
    }
  }

  return { kind: 'ok', message: '未识别为 RCK/PRD/CNT 或仓库内商品编码，无额外绑定提示' }
}

async function enqueuePrintLabel(id, { tenantId = 0, userId = null } = {}) {
  await findById(id)
  const { enqueueRackLabelJob } = require('../print-jobs/print-jobs.service')
  const job = await enqueueRackLabelJob({
    rackId: id,
    tenantId,
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
  findAll,
  findActive,
  findById,
  create,
  update,
  softDelete,
  scanHint,
  enqueuePrintLabel,
}
