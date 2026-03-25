const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { unlockContainersByTask } = require('../../engine/containerEngine')
const { WT_STATUS } = require('../../constants/warehouseTaskStatus')
const { assertTaskPickScanClosure } = require('../warehouse-tasks/warehouse-tasks.service')

/**
 * 按各任务明细汇总刷新波次行的 picked_qty（只读任务表，禁止反向写任务）
 */
async function refreshWavePickedFromTasks(exec, waveId) {
  const [waveTasks] = await exec.query('SELECT task_id FROM picking_wave_tasks WHERE wave_id = ?', [waveId])
  const taskIds = waveTasks.map(t => t.task_id)
  if (!taskIds.length) return

  const [rows] = await exec.query(
    `SELECT product_id, COALESCE(SUM(picked_qty), 0) AS sum_picked
     FROM warehouse_task_items WHERE task_id IN (?)
     GROUP BY product_id`,
    [taskIds],
  )
  const sumByProduct = Object.fromEntries(rows.map(r => [r.product_id, Number(r.sum_picked)]))

  const [waveItems] = await exec.query('SELECT id, product_id FROM picking_wave_items WHERE wave_id = ?', [waveId])
  for (const wi of waveItems) {
    const sp = sumByProduct[wi.product_id] ?? 0
    await exec.query('UPDATE picking_wave_items SET picked_qty = ? WHERE id = ?', [sp, wi.id])
  }
}

const WAVE_STATUS   = { 1: '待拣货', 2: '拣货中', 3: '待分拣', 4: '已完成', 5: '已取消' }
const WAVE_PRIORITY = { 1: '紧急', 2: '普通', 3: '低' }

const fmt = r => ({
  id:            r.id,
  waveNo:        r.wave_no,
  warehouseId:   r.warehouse_id,
  warehouseName: r.warehouse_name || null,
  status:        r.status,
  statusName:    WAVE_STATUS[r.status],
  priority:      r.priority || 2,
  priorityName:  WAVE_PRIORITY[r.priority] || '普通',
  taskCount:     r.task_count,
  operatorId:    r.operator_id,
  operatorName:  r.operator_name,
  remark:        r.remark,
  createdAt:     r.created_at,
  updatedAt:     r.updated_at,
})

const genWaveNo = conn => generateDailyCode(conn, 'WV', 'picking_waves', 'wave_no')

// ── 列表查询 ──────────────────────────────────────────────────────────────────

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, warehouseId = null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const conds = ['w.wave_no LIKE ?']
  const params = [like]
  if (status)      { conds.push('w.status = ?');       params.push(status) }
  if (warehouseId) { conds.push('w.warehouse_id = ?'); params.push(warehouseId) }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT w.*, wh.name AS warehouse_name
     FROM picking_waves w
     LEFT JOIN inventory_warehouses wh ON wh.id = w.warehouse_id
     WHERE ${where}
     ORDER BY w.priority ASC, w.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM picking_waves w WHERE ${where}`, params,
  )

  const list = []
  for (const r of rows) {
    const wave = fmt(r)
    const [items] = await pool.query(
      'SELECT COUNT(*) AS cnt, SUM(total_qty) AS totalQty, SUM(picked_qty) AS pickedQty FROM picking_wave_items WHERE wave_id = ?',
      [r.id],
    )
    wave.itemCount = Number(items[0].cnt)
    wave.totalQty  = Number(items[0].totalQty || 0)
    wave.pickedQty = Number(items[0].pickedQty || 0)
    list.push(wave)
  }

  return { list, pagination: { page, pageSize, total } }
}

// ── 详情 ──────────────────────────────────────────────────────────────────────

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT w.*, wh.name AS warehouse_name
     FROM picking_waves w
     LEFT JOIN inventory_warehouses wh ON wh.id = w.warehouse_id
     WHERE w.id = ?`,
    [id],
  )
  if (!row) throw new AppError('波次不存在', 404)

  if (row.status < 4) {
    await refreshWavePickedFromTasks(pool, id)
  }

  const wave = fmt(row)

  const [tasks] = await pool.query(
    `SELECT wt.wave_id, wt.task_id, wt.sale_order_id, wt.sale_order_no, wt.customer_name,
            t.status AS task_status, t.task_no
     FROM picking_wave_tasks wt
     LEFT JOIN warehouse_tasks t ON t.id = wt.task_id
     WHERE wt.wave_id = ?`,
    [id],
  )
  wave.tasks = tasks.map(t => ({
    taskId:       t.task_id,
    taskNo:       t.task_no,
    taskStatus:   t.task_status,
    saleOrderId:  t.sale_order_id,
    saleOrderNo:  t.sale_order_no,
    customerName: t.customer_name,
  }))

  const [items] = await pool.query(
    'SELECT * FROM picking_wave_items WHERE wave_id = ? ORDER BY id ASC', [id],
  )
  wave.items = items.map(i => ({
    id:          i.id,
    productId:   i.product_id,
    productCode: i.product_code,
    productName: i.product_name,
    unit:        i.unit,
    totalQty:    Number(i.total_qty),
    pickedQty:   Number(i.picked_qty),
  }))

  const [pickLinesRows] = await pool.query(
    `SELECT wt.task_id, wti.id AS item_id, wti.product_id, wti.required_qty, wti.picked_qty
     FROM picking_wave_tasks wt
     JOIN warehouse_task_items wti ON wti.task_id = wt.task_id
     WHERE wt.wave_id = ?
     ORDER BY wt.id ASC, wti.id ASC`,
    [id],
  )
  wave.pickLines = pickLinesRows.map(r => ({
    taskId:      r.task_id,
    itemId:      r.item_id,
    productId:   r.product_id,
    requiredQty: Number(r.required_qty),
    pickedQty:   Number(r.picked_qty),
  }))

  return wave
}

// ── 创建波次 ──────────────────────────────────────────────────────────────────

async function create({ taskIds, remark, priority = 2 }) {
  if (!taskIds?.length || taskIds.length < 2) {
    throw new AppError('请选择至少 2 个任务创建波次', 400)
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 查询选中的任务
    const [tasks] = await conn.query(
      `SELECT t.*, wh.name AS warehouse_name
       FROM warehouse_tasks t
       LEFT JOIN inventory_warehouses wh ON wh.id = t.warehouse_id
       WHERE t.id IN (?) AND t.deleted_at IS NULL`,
      [taskIds],
    )

    if (tasks.length !== taskIds.length) {
      throw new AppError('部分任务不存在', 400)
    }

    // 校验：所有任务状态必须为 2（备货中）
    const invalid = tasks.find(t => t.status !== 2)
    if (invalid) {
      throw new AppError(`任务 ${invalid.task_no} 状态不是"备货中"，无法创建波次`, 400)
    }

    // 校验：所有任务必须同一仓库
    const whIds = [...new Set(tasks.map(t => t.warehouse_id))]
    if (whIds.length > 1) {
      throw new AppError('选中任务不属于同一仓库，无法创建波次', 400)
    }

    const warehouseId = whIds[0]
    const waveNo = await genWaveNo(conn)

    // 创建波次主记录
    const safePriority = [1, 2, 3].includes(priority) ? priority : 2
    const [result] = await conn.query(
      `INSERT INTO picking_waves (wave_no, warehouse_id, status, priority, task_count, remark)
       VALUES (?, ?, 1, ?, ?, ?)`,
      [waveNo, warehouseId, safePriority, tasks.length, remark || null],
    )
    const waveId = result.insertId

    // 写入波次任务关联
    for (const t of tasks) {
      await conn.query(
        `INSERT INTO picking_wave_tasks (wave_id, task_id, sale_order_id, sale_order_no, customer_name)
         VALUES (?, ?, ?, ?, ?)`,
        [waveId, t.id, t.sale_order_id, t.sale_order_no, t.customer_name],
      )
    }

    // 汇总商品：查询所有任务的明细
    const [allItems] = await conn.query(
      `SELECT product_id, product_code, product_name, unit, SUM(required_qty) AS total_qty
       FROM warehouse_task_items
       WHERE task_id IN (?)
       GROUP BY product_id, product_code, product_name, unit`,
      [taskIds],
    )

    for (const item of allItems) {
      await conn.query(
        `INSERT INTO picking_wave_items (wave_id, product_id, product_code, product_name, unit, total_qty, picked_qty)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [waveId, item.product_id, item.product_code, item.product_name, item.unit, item.total_qty],
      )
    }

    await conn.commit()
    return { waveId, waveNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 开始拣货（1 → 2）──────────────────────────────────────────────────────────

async function startPicking(id, { userId, userName }) {
  const wave = await findById(id)
  if (wave.status !== 1) throw new AppError('只有"待拣货"状态可以开始拣货', 400)

  await pool.query(
    'UPDATE picking_waves SET status = 2, operator_id = ?, operator_name = ? WHERE id = ?',
    [userId, userName, id],
  )

  // 开始拣货时自动生成并缓存路线
  await generateAndCacheRoute(id)
}

// ── 完成拣货（2 → 3 待分拣）────────────────────────────────────────────────────

async function finishPicking(id) {
  const wave = await findById(id)
  if (wave.status !== 2) throw new AppError('只有"拣货中"状态可以完成拣货', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await refreshWavePickedFromTasks(conn, id)
    const [waveTasks] = await conn.query(
      'SELECT task_id FROM picking_wave_tasks WHERE wave_id = ? ORDER BY id ASC',
      [id],
    )
    for (const t of waveTasks) {
      await assertTaskPickScanClosure(conn, t.task_id)
    }
    await conn.query('UPDATE picking_waves SET status = 3 WHERE id = ?', [id])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 完成分拣（3 → 4 已完成）─ 将已拣数量回写到各任务 ──────────────────────────

async function finish(id) {
  const wave = await findById(id)
  if (wave.status !== 3) throw new AppError('只有"待分拣"状态可以完成波次', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await refreshWavePickedFromTasks(conn, id)

    const [waveTasks] = await conn.query(
      'SELECT task_id FROM picking_wave_tasks WHERE wave_id = ? ORDER BY id ASC',
      [id],
    )
    for (const t of waveTasks) {
      await assertTaskPickScanClosure(conn, t.task_id)
    }
    for (const t of waveTasks) {
      const [r] = await conn.query(
        'UPDATE warehouse_tasks SET status = ? WHERE id = ? AND status = ?',
        [WT_STATUS.SORTING, t.task_id, WT_STATUS.PICKING],
      )
      if (r.affectedRows === 0) {
        throw new AppError(`任务状态已变更，无法完成波次分拣（task_id=${t.task_id}）`, 409)
      }
    }

    await conn.query('UPDATE picking_waves SET status = 4 WHERE id = ?', [id])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 取消波次 ──────────────────────────────────────────────────────────────────

async function cancel(id) {
  const wave = await findById(id)
  if (wave.status >= 4) throw new AppError('波次已完成或已取消', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [waveTasks] = await conn.query('SELECT task_id FROM picking_wave_tasks WHERE wave_id = ?', [id])
    for (const t of waveTasks) {
      await unlockContainersByTask(conn, t.task_id)
    }
    await conn.query('UPDATE picking_waves SET status = 5 WHERE id = ?', [id])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 波次拣货路线（Location Merge：同库位合并）──────────────────────────────────

async function getPickRoute(waveId) {
  const wave = await findById(waveId)
  if (wave.status >= 4) throw new AppError('波次已完成或已取消', 400)

  // 优先使用缓存路线（支持断点恢复）
  const cached = await getCachedRoute(waveId)
  if (cached) return cached

  // 先收集所有容器（扁平列表）
  const flatContainers = []

  for (const item of wave.items) {
    const remaining = item.totalQty - item.pickedQty
    if (remaining <= 0) continue

    const [containers] = await pool.query(
      `SELECT c.id AS containerId, c.barcode, c.remaining_qty AS remainingQty,
              c.locked_by_task_id AS lockedByTaskId,
              loc.code AS locationCode,
              loc.zone, loc.aisle, loc.rack, loc.level, loc.position
       FROM inventory_containers c
       LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
       WHERE c.product_id = ?
         AND c.warehouse_id = ?
         AND c.remaining_qty > 0
         AND c.status = 1
         AND c.deleted_at IS NULL
         AND c.locked_by_task_id IS NULL
       ORDER BY
         loc.zone ASC, loc.aisle ASC, loc.rack ASC, loc.level ASC, loc.position ASC,
         c.created_at ASC`,
      [item.productId, wave.warehouseId],
    )

    let need = remaining
    for (const c of containers) {
      if (need <= 0) break
      const qty = Math.min(Number(c.remainingQty), need)
      flatContainers.push({
        waveItemId:   item.id,
        productId:    item.productId,
        productCode:  item.productCode,
        productName:  item.productName,
        unit:         item.unit,
        containerId:  c.containerId,
        barcode:      c.barcode,
        locationCode: c.locationCode || null,
        zone:         c.zone  || '',
        aisle:        c.aisle || '',
        rack:         c.rack  || '',
        level:        c.level || '',
        position:     c.position || '',
        qty,
      })
      need -= qty
    }
  }

  // 按库位路径排序
  flatContainers.sort((a, b) => {
    const keys = ['zone', 'aisle', 'rack', 'level', 'position']
    for (const k of keys) {
      if (a[k] < b[k]) return -1
      if (a[k] > b[k]) return  1
    }
    return 0
  })

  // Location Merge：按 locationCode 合并
  const locGroups = new Map()
  for (const c of flatContainers) {
    const key = c.locationCode || `_no_loc_${c.containerId}`
    if (!locGroups.has(key)) {
      locGroups.set(key, {
        locationCode: c.locationCode,
        zone: c.zone, aisle: c.aisle, rack: c.rack, level: c.level, position: c.position,
        containers: [],
      })
    }
    locGroups.get(key).containers.push({
      waveItemId:  c.waveItemId,
      containerId: c.containerId,
      barcode:     c.barcode,
      productName: c.productName,
      productCode: c.productCode,
      unit:        c.unit,
      qty:         c.qty,
    })
  }

  const route = []
  let step = 1
  for (const [, group] of locGroups) {
    route.push({
      step:         step++,
      locationCode: group.locationCode,
      containers:   group.containers,
    })
  }

  return {
    waveId,
    waveNo: wave.waveNo,
    totalSteps: route.length,
    totalContainers: flatContainers.length,
    route,
  }
}

// ── 路线缓存：生成并持久化 ────────────────────────────────────────────────────

async function generateAndCacheRoute(waveId, conn) {
  const useConn = conn || pool

  // 先清理旧缓存
  await useConn.query('DELETE FROM picking_wave_routes WHERE wave_id = ?', [waveId])

  const wave = await findById(waveId)
  const flatContainers = []

  for (const item of wave.items) {
    const remaining = item.totalQty - item.pickedQty
    if (remaining <= 0) continue

    const [containers] = await useConn.query(
      `SELECT c.id AS containerId, c.barcode, c.remaining_qty AS remainingQty,
              loc.code AS locationCode,
              loc.zone, loc.aisle, loc.rack, loc.level, loc.position
       FROM inventory_containers c
       LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
       WHERE c.product_id = ?
         AND c.warehouse_id = ?
         AND c.remaining_qty > 0
         AND c.status = 1
         AND c.deleted_at IS NULL
         AND c.locked_by_task_id IS NULL
       ORDER BY
         loc.zone ASC, loc.aisle ASC, loc.rack ASC, loc.level ASC, loc.position ASC,
         c.created_at ASC`,
      [item.productId, wave.warehouseId],
    )

    let need = remaining
    for (const c of containers) {
      if (need <= 0) break
      const qty = Math.min(Number(c.remainingQty), need)
      flatContainers.push({
        waveItemId:   item.id,
        productId:    item.productId,
        productCode:  item.productCode,
        productName:  item.productName,
        unit:         item.unit,
        containerId:  c.containerId,
        barcode:      c.barcode,
        locationCode: c.locationCode || null,
        zone:         c.zone  || '',
        aisle:        c.aisle || '',
        rack:         c.rack  || '',
        level:        c.level || '',
        position:     c.position || '',
        qty,
      })
      need -= qty
    }
  }

  flatContainers.sort((a, b) => {
    const keys = ['zone', 'aisle', 'rack', 'level', 'position']
    for (const k of keys) {
      if (a[k] < b[k]) return -1
      if (a[k] > b[k]) return  1
    }
    return 0
  })

  // 按库位分组，分配 step
  const locGroups = new Map()
  for (const c of flatContainers) {
    const key = c.locationCode || `_no_loc_${c.containerId}`
    if (!locGroups.has(key)) locGroups.set(key, { locationCode: c.locationCode, containers: [] })
    locGroups.get(key).containers.push(c)
  }

  let step = 1
  for (const [, group] of locGroups) {
    for (const c of group.containers) {
      await useConn.query(
        `INSERT INTO picking_wave_routes
         (wave_id, step, location_code, container_id, barcode, product_id, product_name, product_code, unit, wave_item_id, qty, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [waveId, step, group.locationCode, c.containerId, c.barcode, c.productId, c.productName, c.productCode, c.unit, c.waveItemId, c.qty],
      )
    }
    step++
  }
}

// ── 路线缓存：读取（含断点恢复）──────────────────────────────────────────────

async function getCachedRoute(waveId) {
  const [rows] = await pool.query(
    'SELECT * FROM picking_wave_routes WHERE wave_id = ? ORDER BY step ASC, id ASC',
    [waveId],
  )
  if (!rows.length) return null

  const wave = await findById(waveId)

  // 按 step 分组（同一 step = 同一库位）
  const stepMap = new Map()
  for (const r of rows) {
    if (!stepMap.has(r.step)) {
      stepMap.set(r.step, { step: r.step, locationCode: r.location_code, containers: [] })
    }
    stepMap.get(r.step).containers.push({
      id:          r.id,
      waveItemId:  r.wave_item_id,
      containerId: r.container_id,
      barcode:     r.barcode,
      productName: r.product_name,
      productCode: r.product_code,
      unit:        r.unit,
      qty:         Number(r.qty),
      status:      r.status,
    })
  }

  const route = []
  for (const [, group] of stepMap) {
    const allCompleted = group.containers.every(c => c.status === 'completed')
    const anyCompleted = group.containers.some(c => c.status === 'completed')
    route.push({
      step:         group.step,
      locationCode: group.locationCode,
      status:       allCompleted ? 'completed' : anyCompleted ? 'in_progress' : 'pending',
      containers:   group.containers,
    })
  }

  return {
    waveId,
    waveNo: wave.waveNo,
    totalSteps: route.length,
    totalContainers: rows.length,
    route,
  }
}

// ── 标记路线容器为已完成 ──────────────────────────────────────────────────────

async function markRouteContainerCompleted(waveId, barcode) {
  await pool.query(
    `UPDATE picking_wave_routes SET status = 'completed', completed_at = NOW()
     WHERE wave_id = ? AND barcode = ? AND status = 'pending'`,
    [waveId, barcode],
  )
}

module.exports = {
  findAll,
  findById,
  create,
  startPicking,
  finishPicking,
  finish,
  cancel,
  getPickRoute,
  generateAndCacheRoute,
  getCachedRoute,
  markRouteContainerCompleted,
  refreshWavePickedFromTasks,
}
