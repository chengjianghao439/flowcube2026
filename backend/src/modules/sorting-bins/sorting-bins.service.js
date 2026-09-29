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
 * 取货码（扫塑料盒取货生成的整件 `I` 码）精确解析。
 *
 * 与旧商品码路径**互斥**：一旦命中容器条码就按取货码处理，不合法直接拒绝，
 * **绝不**下落到商品码的精确/模糊匹配——否则一张「本任务取货码」会被错配到
 * 别的 SKU 的最早任务上，工人按提示放错格而不自知。
 *
 * 归属判定绑定**当前任务下的有效取货 PICK 行**（`scan_purpose=1` 且 `source_container_id`
 * 非空）。不能只看容器上的 `source_ref_type='plastic_box_pick'`：容器被取消/归还后可
 * 合法作为普通整件再给下一个任务拣，那时它仍是历史取货来源，但**不是**新任务的取货标签。
 *
 * @returns {Promise<object|null>} 命中容器则返回解析结果；未命中容器返回 null（交回商品码路径）
 */
async function resolvePickCode(code, scopeWarehouseIds = null) {
  const [[c]] = await pool.query(
    `SELECT id, barcode, container_type, product_id, locked_by_task_id, warehouse_id
     FROM inventory_containers WHERE barcode = ? AND deleted_at IS NULL`,
    [code],
  )
  if (!c) return null                    // 未命中容器：交回旧商品码路径
  if (Number(c.container_type) !== 1) {
    throw new AppError('该条码是塑料盒条码，不是取货码；请扫取货码或商品条码', 400, 'PICK_CODE_NOT_INDIVIDUAL')
  }
  if (c.locked_by_task_id == null) {
    throw new AppError(
      '该取货码未锁定给任何进行中的任务（可能已归还或已出库），请核对实物；如确需分拣请重新拣货',
      409, 'PICK_CODE_NOT_LOCKED',
    )
  }

  // scan_purpose=1 为取货扫码；source_container_id 非空 ⇒ 这条货是**从塑料盒取出来的**，
  // 而不是该容器被当普通整件直接拣走（后者没有取货标签语义，不许按取货码分拣）。
  const [picks] = await pool.query(
    `SELECT item_id, COALESCE(SUM(qty), 0) AS pick_qty
     FROM scan_logs
     WHERE task_id = ? AND container_id = ?
       AND COALESCE(scan_purpose, 1) = 1
       AND source_container_id IS NOT NULL
     GROUP BY item_id`,
    [c.locked_by_task_id, c.id],
  )
  if (!picks.length) {
    throw new AppError('该取货码在本任务下没有有效的盒取货记录，无法分拣', 409, 'PICK_CODE_NO_PICK_RECORD')
  }
  if (picks.length > 1) {
    throw new AppError('该取货码在本任务下对应多条明细，无法确定分拣归属，请联系主管', 409, 'PICK_CODE_AMBIGUOUS')
  }

  const [rows] = await pool.query(
    `SELECT wt.id AS task_id, wt.task_no, wt.customer_name, wt.warehouse_id, wt.status,
            wt.sorting_bin_id, wt.sorting_bin_code,
            wt.cancel_requested_at, wt.adjustment_requested_at,
            wti.id AS item_id, wti.product_id, wti.product_code, wti.product_name, wti.unit,
            wti.required_qty, wti.picked_qty
     FROM warehouse_tasks wt
     JOIN warehouse_task_items wti ON wti.id = ? AND wti.task_id = wt.id
     WHERE wt.id = ? AND wt.deleted_at IS NULL`,
    [Number(picks[0].item_id), c.locked_by_task_id],
  )
  const row = rows[0]
  if (!row) throw new AppError('该取货码所属的任务明细已不存在', 409, 'PICK_CODE_SOURCE_MISSING')
  if (Number(row.product_id) !== Number(c.product_id)) {
    throw new AppError('取货码上的商品与该任务明细不一致，无法分拣', 409, 'PICK_CODE_PRODUCT_MISMATCH')
  }
  assertInScope(scopeWarehouseIds, row.warehouse_id, '仓库任务')
  if (row.cancel_requested_at) {
    throw new AppError('该取货码所属任务正在拣货退回中，不可继续分拣', 409, 'PICK_CODE_TASK_CANCELLING')
  }
  if (row.adjustment_requested_at) {
    throw new AppError('该取货码所属任务有改单正在等待仓库确认，请先处理完成', 409, 'PICK_CODE_TASK_ADJUSTING')
  }
  if (![WT_STATUS.PICKING, WT_STATUS.SORTING].includes(Number(row.status))) {
    throw new AppError('该取货码所属任务不在分拣阶段（仅拣货中/待分拣可扫取货码）', 409, 'PICK_CODE_TASK_NOT_SORTING')
  }

  const [[{ itemCount }]] = await pool.query(
    'SELECT COUNT(*) AS itemCount FROM warehouse_task_items WHERE task_id = ?',
    [row.task_id],
  )
  return {
    productCode:    row.product_code,
    productName:    row.product_name,
    unit:           row.unit,
    requiredQty:    row.required_qty,
    pickedQty:      row.picked_qty,
    itemId:         row.item_id,
    taskId:         row.task_id,
    taskNo:         row.task_no,
    customerName:   row.customer_name,
    warehouseId:    row.warehouse_id,
    sortingBinId:   row.sorting_bin_id   || null,
    sortingBinCode: row.sorting_bin_code || null,
    taskItemCount:  Number(itemCount),
    // ── 取货码专属 ──
    isPickCode:     true,
    containerId:    Number(c.id),
    qty:            Number(picks[0].pick_qty),   // 该容器在本任务的**有效取货量**
  }
}

/**
 * PDA 扫商品条码 → 查找对应任务的分拣格
 * 逻辑：在备货中（status=2）的任务明细里查找匹配 product_code 的条目
 */
async function scanProduct(code, scopeWarehouseIds = null) {
  // 取货码优先且**互斥**：命中容器就不会再走下面的商品码匹配
  const pickHit = await resolvePickCode(code, scopeWarehouseIds)
  if (pickHit) return pickHit
  const scope = scopeFilter(scopeWarehouseIds, 'wt.warehouse_id')
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
       AND wti.product_code = ?${scope.sql}
     ORDER BY wt.created_at ASC
     LIMIT 10`,
    [code, ...scope.params],
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
         AND (wti.product_code LIKE ? OR wti.product_name LIKE ?)${scope.sql}
       ORDER BY wt.created_at ASC
       LIMIT 5`,
      [`%${code}%`, `%${code}%`, ...scope.params],
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

  // A —— 该明细**全部有效盒取货量**（含尚未扫标签分拣的那部分），口径同 warehouse-tasks.sort.js。
  // 旧商品码路径可选份额的上限依据是 **A**，不是「已确认标签量 C」：标签份额在拣货那一刻
  // 就已归属，未扫任何标签时旧码也只能报 picked - A（否则会把标签份额静默标掉）。
  // 无盒取货时 A=0 ⇒ sortableQty === pickedQty，与既有行为完全一致。
  const [[{ labelTotal }]] = await pool.query(
    `SELECT COALESCE(SUM(sl.qty), 0) AS labelTotal
     FROM scan_logs sl
     JOIN warehouse_task_items wti ON wti.id = sl.item_id AND wti.task_id = sl.task_id
     WHERE sl.task_id = ? AND wti.product_id = ?
       AND COALESCE(sl.scan_purpose, 1) = 1
       AND sl.source_container_id IS NOT NULL`,
    [item.task_id, item.product_id],
  )
  const pickedQty = Number(item.picked_qty)
  const labelTotalQty = Number(labelTotal)

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
    // ── 商品码路径的可报份额（被盒取货标签占走的部分之外）──
    labelTotalQty,
    sortableQty:    Math.max(0, pickedQty - labelTotalQty),
  }
}

/**
 * 查询仓库的所有分拣格（附当前任务信息）
 */
async function findAll(warehouseId, scopeWarehouseIds = null) {
  assertInScope(scopeWarehouseIds, warehouseId, '分拣格')
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
async function findAllWarehouses({ keyword = '', status = null, warehouseId = null, scopeWarehouseIds = null, exportLimit = null } = {}) {
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
  const limit = exportLimit == null ? '' : ' LIMIT ?'
  if (exportLimit != null) whereParams.push(Math.max(1, Math.min(10001, Number(exportLimit) || 10001)))

  const [rows] = await pool.query(
    `SELECT sb.*,
            wh.name     AS warehouse_name,
            wt.task_no  AS current_task_no,
            wt.customer_name
     FROM sorting_bins sb
     JOIN inventory_warehouses wh ON wh.id = sb.warehouse_id
     LEFT JOIN warehouse_tasks wt ON wt.id = sb.current_task_id
     WHERE ${where}
     ORDER BY sb.warehouse_id ASC, sb.code ASC${limit}`,
    whereParams,
  )
  return rows.map(r => ({ ...fmt(r), warehouseName: r.warehouse_name }))
}

/**
 * 创建分拣格
 */
async function create({ code, warehouseId, remark }, scopeWarehouseIds = null) {
  assertInScope(scopeWarehouseIds, warehouseId, '分拣格')
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
async function batchCreate({ warehouseId, prefix, from, to }, scopeWarehouseIds = null) {
  assertInScope(scopeWarehouseIds, warehouseId, '分拣格')
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
    'SELECT id, code FROM sorting_bins WHERE warehouse_id=? AND status=1 AND current_task_id IS NULL ORDER BY id ASC LIMIT 1 FOR UPDATE',
    [warehouseId],
  )
  if (!bin) return null  // 无空闲格，不强制（允许无分拣格运作）
  const [updated] = await conn.query(
    'UPDATE sorting_bins SET status=2, current_task_id=? WHERE id=? AND status=1 AND current_task_id IS NULL',
    [taskId, bin.id],
  )
  if (updated.affectedRows !== 1) return null
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
  // 先读取任务 ID，再依照任务→分拣格的统一锁序获取行锁；锁后复查绑定，
  // 避免读取期间旧任务释放、别的任务占用同一格时把新绑定误清空。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [[snapshot]] = await pool.query('SELECT warehouse_id,current_task_id FROM sorting_bins WHERE id=?', [id])
    if (!snapshot) throw new AppError('分拣格不存在', 404)
    assertInScope(scopeWarehouseIds, snapshot.warehouse_id, '分拣格')
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      if (snapshot.current_task_id) {
        await conn.query('SELECT id FROM warehouse_tasks WHERE id=? FOR UPDATE', [snapshot.current_task_id])
      }
      const [[bin]] = await conn.query('SELECT warehouse_id,current_task_id FROM sorting_bins WHERE id=? FOR UPDATE', [id])
      if (!bin) throw new AppError('分拣格不存在', 404)
      assertInScope(scopeWarehouseIds, bin.warehouse_id, '分拣格')
      if (Number(bin.current_task_id || 0) !== Number(snapshot.current_task_id || 0)) {
        await conn.rollback()
        continue
      }
      if (bin.current_task_id) {
        await conn.query(
          'UPDATE warehouse_tasks SET sorting_bin_id=NULL, sorting_bin_code=NULL WHERE id=? AND sorting_bin_id=?',
          [bin.current_task_id, id],
        )
      }
      await conn.query('UPDATE sorting_bins SET status=1,current_task_id=NULL WHERE id=?', [id])
      await conn.commit()
      return
    } catch (error) { await conn.rollback(); throw error }
    finally { conn.release() }
  }
  throw new AppError('分拣格占用状态已变化，请刷新后重试', 409, 'SORTING_BIN_RELEASE_CONFLICT')
}

module.exports = {
  scanProduct,
  resolvePickCode,
  findAll, findAllWarehouses, create, batchCreate, update, remove,
  assignToTask, releaseByTask, forceRelease, checkCapacityWarning,
}
