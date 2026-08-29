/**
 * sorting-bins.service.js
 * 分拣格（Put Wall）业务逻辑
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')

const { WT_STATUS } = require('../../constants/warehouseTaskStatus')

const STATUS = { 1: '空闲', 2: '占用' }

const fmt = r => ({
  id:            r.id,
  code:          r.code,
  warehouseId:   r.warehouse_id,
  status:        r.status,
  statusName:    STATUS[r.status],
  currentTaskId: r.current_task_id  || null,
  currentTaskNo: r.current_task_no  || null,
  customerName:  r.customer_name    || null,
  remark:        r.remark           || null,
  capacity:      r.capacity != null ? Number(r.capacity) : null,
  createdAt:     r.created_at,
  updatedAt:     r.updated_at,
})

/**
 * PDA 扫商品条码 → 查找对应任务的分拣格
 * 逻辑：在备货中（status=2）的任务明细里查找匹配 product_code 的条目
 */
async function scanProduct(code) {
  // 1. 在备货中（status=2）任务的明细里找匹配商品
  // 不限制 picked_qty，分拣操作面向整个任务，只要商品属于备货中任务即可
  const [items] = await pool.query(
    `SELECT wti.*, wt.task_no, wt.customer_name, wt.warehouse_id,
            wt.sorting_bin_id, wt.sorting_bin_code,
            wt.id AS task_id
     FROM warehouse_task_items wti
     JOIN warehouse_tasks wt ON wt.id = wti.task_id
     WHERE wt.status IN (${WT_STATUS.PICKING},${WT_STATUS.SORTING})
       AND wt.cancel_requested_at IS NULL
       AND wti.product_code = ?
     ORDER BY wt.created_at ASC
     LIMIT 10`,
    [code],
  )

  if (!items.length) {
    // 模糊匹配（兼容条码带前缀的情况）
    const [fuzzy] = await pool.query(
      `SELECT wti.*, wt.task_no, wt.customer_name, wt.warehouse_id,
              wt.sorting_bin_id, wt.sorting_bin_code,
              wt.id AS task_id
       FROM warehouse_task_items wti
       JOIN warehouse_tasks wt ON wt.id = wti.task_id
       WHERE wt.status IN (${WT_STATUS.PICKING},${WT_STATUS.SORTING})
         AND wt.cancel_requested_at IS NULL
         AND (wti.product_code LIKE ? OR wti.product_name LIKE ?)
       ORDER BY wt.created_at ASC
       LIMIT 5`,
      [`%${code}%`, `%${code}%`],
    )
    if (!fuzzy.length) return null
    items.push(...fuzzy)
  }

  // 取第一条匹配结果
  const item = items[0]

  // 查询该任务的总商品种数
  const [[{ itemCount }]] = await pool.query(
    'SELECT COUNT(*) AS itemCount FROM warehouse_task_items WHERE task_id=?',
    [item.task_id],
  )

  return {
    productCode:    item.product_code,
    productName:    item.product_name,
    unit:           item.unit,
    requiredQty:    item.required_qty,
    pickedQty:      item.picked_qty,
    itemId:         item.id,
    taskId:         item.task_id,
    taskNo:         item.task_no,
    customerName:   item.customer_name,
    warehouseId:    item.warehouse_id,
    sortingBinId:   item.sorting_bin_id   || null,
    sortingBinCode: item.sorting_bin_code || null,
    taskItemCount:  Number(itemCount),
  }
}

/**
 * 查询仓库的所有分拣格（附当前任务信息）
 */
async function findAll(warehouseId) {
  const [rows] = await pool.query(
    `SELECT sb.*,
            wt.task_no  AS current_task_no,
            wt.customer_name
     FROM sorting_bins sb
     LEFT JOIN warehouse_tasks wt ON wt.id = sb.current_task_id
     WHERE sb.warehouse_id = ?
     ORDER BY sb.code ASC`,
    [warehouseId],
  )
  return rows.map(fmt)
}

/**
 * 查询所有仓库的分拣格（管理页）
 */
async function findAllWarehouses({ keyword = '', status = null, warehouseId = null, scopeWarehouseIds = null } = {}) {
  const conds = ['1=1']
  const params = []
  if (keyword) {
    conds.push('(sb.code LIKE ? OR wh.name LIKE ? OR wt.task_no LIKE ? OR wt.customer_name LIKE ?)')
    const like = `%${keyword}%`
    params.push(like, like, like, like)
  }
  if (status) { conds.push('sb.status = ?'); params.push(+status) }
  if (warehouseId) { conds.push('sb.warehouse_id = ?'); params.push(+warehouseId) }
  const scope = scopeFilter(scopeWarehouseIds, 'sb.warehouse_id')
  const where = conds.join(' AND ') + scope.sql
  const whereParams = [...params, ...scope.params]

  const [rows] = await pool.query(
    `SELECT sb.*,
            wh.name     AS warehouse_name,
            wt.task_no  AS current_task_no,
            wt.customer_name
     FROM sorting_bins sb
     JOIN inventory_warehouses wh ON wh.id = sb.warehouse_id
     LEFT JOIN warehouse_tasks wt ON wt.id = sb.current_task_id
     WHERE ${where}
     ORDER BY sb.warehouse_id ASC, sb.code ASC`,
    whereParams,
  )
  return rows.map(r => ({ ...fmt(r), warehouseName: r.warehouse_name }))
}

/**
 * 创建分拣格
 */
async function create({ code, warehouseId, remark }) {
  if (!code || !warehouseId) throw new AppError('编号和仓库不能为空', 400)
  const [[exist]] = await pool.query(
    'SELECT id FROM sorting_bins WHERE warehouse_id=? AND code=?',
    [warehouseId, code],
  )
  if (exist) throw new AppError(`编号 ${code} 在该仓库已存在`, 400)
  const [r] = await pool.query(
    'INSERT INTO sorting_bins (code, warehouse_id, remark) VALUES (?,?,?)',
    [code, warehouseId, remark || null],
  )
  return { id: r.insertId, code, warehouseId }
}

/**
 * 批量创建（按前缀+序号，如 A01-A10）
 */
async function batchCreate({ warehouseId, prefix, from, to }) {
  if (from > to || to - from > 99) throw new AppError('序号范围无效（最多100个）', 400)
  const created = []
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (let i = from; i <= to; i++) {
      const code = `${prefix}${String(i).padStart(2, '0')}`
      const [[exist]] = await conn.query(
        'SELECT id FROM sorting_bins WHERE warehouse_id=? AND code=?',
        [warehouseId, code],
      )
      if (!exist) {
        const [r] = await conn.query(
          'INSERT INTO sorting_bins (code, warehouse_id) VALUES (?,?)',
          [code, warehouseId],
        )
        created.push({ id: r.insertId, code })
      }
    }
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
  return created
}

/**
 * 更新备注 / 容量阈值
 */
async function update(id, { remark, capacity }, scopeWarehouseIds = null) {
  const [[bin]] = await pool.query('SELECT warehouse_id FROM sorting_bins WHERE id=?', [id])
  if (!bin) throw new AppError('分拣格不存在', 404)
  assertInScope(scopeWarehouseIds, bin.warehouse_id, '分拣格')
  const cap = capacity === undefined ? undefined : (capacity === null || capacity === '' ? null : Number(capacity))
  if (cap !== undefined && cap !== null && (!Number.isFinite(cap) || cap <= 0)) {
    throw new AppError('容量阈值必须为大于 0 的整数', 400)
  }
  if (cap === undefined) {
    await pool.query('UPDATE sorting_bins SET remark=? WHERE id=?', [remark || null, id])
  } else {
    await pool.query('UPDATE sorting_bins SET remark=?, capacity=? WHERE id=?', [remark || null, cap, id])
  }
}

/**
 * 删除（仅空闲格可删）
 */
async function remove(id, scopeWarehouseIds = null) {
  const [[bin]] = await pool.query('SELECT * FROM sorting_bins WHERE id=?', [id])
  if (!bin) throw new AppError('分拣格不存在', 404)
  assertInScope(scopeWarehouseIds, bin.warehouse_id, '分拣格')
  if (bin.status === 2) throw new AppError('占用中的分拣格不能删除', 400)
  await pool.query('DELETE FROM sorting_bins WHERE id=?', [id])
}

/**
 * 为任务分配一个空闲分拣格（同仓库，FIFO）
 * 在事务连接中调用
 */
async function assignToTask(conn, { warehouseId, taskId }) {
  const [[bin]] = await conn.query(
    'SELECT id, code FROM sorting_bins WHERE warehouse_id=? AND status=1 LIMIT 1 FOR UPDATE',
    [warehouseId],
  )
  if (!bin) return null  // 无空闲格，不强制（允许无分拣格运作）
  await conn.query(
    'UPDATE sorting_bins SET status=2, current_task_id=? WHERE id=?',
    [taskId, bin.id],
  )
  return { binId: bin.id, binCode: bin.code }
}

/**
 * 查询分拣格当前占用量（按绑定任务 warehouse_task_items.sorted_qty 求和），
 * 若配置了 capacity 且已超出，返回告警信息；否则返回 null。
 * 在事务连接中调用，挂在 sortTaskWithinTransaction 写入 sorted_qty 之后。
 */
async function checkCapacityWarning(conn, binId) {
  if (!binId) return null
  const [[bin]] = await conn.query(
    'SELECT id, code, capacity, current_task_id FROM sorting_bins WHERE id=?',
    [binId],
  )
  if (!bin || bin.capacity == null || !bin.current_task_id) return null

  const [[{ total }]] = await conn.query(
    'SELECT COALESCE(SUM(sorted_qty),0) AS total FROM warehouse_task_items WHERE task_id=?',
    [bin.current_task_id],
  )
  const currentQty = Number(total)
  const capacity = Number(bin.capacity)
  if (currentQty <= capacity) return null

  return {
    binId: Number(bin.id),
    binCode: bin.code,
    capacity,
    currentQty,
    message: `分拣格 ${bin.code} 已超容量：当前 ${currentQty} 件，容量 ${capacity} 件，请注意`,
  }
}

/**
 * 释放任务占用的分拣格
 * 在事务连接中调用
 */
async function releaseByTask(conn, taskId) {
  await conn.query(
    'UPDATE sorting_bins SET status=1, current_task_id=NULL WHERE current_task_id=?',
    [taskId],
  )
}

/**
 * 强制释放（管理员手动释放）
 */
async function forceRelease(id, scopeWarehouseIds = null) {
  const [[bin]] = await pool.query('SELECT * FROM sorting_bins WHERE id=?', [id])
  if (!bin) throw new AppError('分拣格不存在', 404)
  assertInScope(scopeWarehouseIds, bin.warehouse_id, '分拣格')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    if (bin.current_task_id) {
      await conn.query(
        'UPDATE warehouse_tasks SET sorting_bin_id=NULL, sorting_bin_code=NULL WHERE id=?',
        [bin.current_task_id],
      )
    }
    await conn.query(
      'UPDATE sorting_bins SET status=1, current_task_id=NULL WHERE id=?',
      [id],
    )
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

module.exports = {
  scanProduct,
  findAll, findAllWarehouses, create, batchCreate, update, remove,
  assignToTask, releaseByTask, forceRelease, checkCapacityWarning,
}
