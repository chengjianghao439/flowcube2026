const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { WT_STATUS, WT_STATUS_ACTIVE } = require('../../constants/warehouseTaskStatus')
const {
  assertTaskPickScanClosure,
  readyToShipWithinTransaction,
  cancel: cancelWarehouseTask,
} = require('../warehouse-tasks/warehouse-tasks.service')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { buildPackagePrintSummary } = require('../../utils/printSummary')
const { normalizePagination } = require('../../utils/pagination')

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

const WAVE_STATUS_CODE = {
  PENDING: 1,
  PICKING: 2,
  SORTING: 3,
  DONE: 4,
  CANCELLED: 5,
}

const WAVE_STATUS   = {
  [WAVE_STATUS_CODE.PENDING]: '待拣货',
  [WAVE_STATUS_CODE.PICKING]: '拣货中',
  [WAVE_STATUS_CODE.SORTING]: '待分拣',
  [WAVE_STATUS_CODE.DONE]: '已完成',
  [WAVE_STATUS_CODE.CANCELLED]: '已取消',
}
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

const genWaveNo = conn => generateDailyCode(conn, 'W', 'picking_waves', 'wave_no')

async function lockWaveForTransition(conn, id) {
  const [[wave]] = await conn.query(
    'SELECT id, status, warehouse_id FROM picking_waves WHERE id = ? FOR UPDATE',
    [id],
  )
  if (!wave) throw new AppError('波次不存在', 404)
  return wave
}

async function casWaveStatus(conn, { id, fromStatus, toStatus, extraSet = '', extraParams = [] }) {
  const setExtra = extraSet ? `, ${extraSet}` : ''
  const [result] = await conn.query(
    `UPDATE picking_waves
     SET status = ?${setExtra}
     WHERE id = ? AND status = ?`,
    [toStatus, ...extraParams, id, fromStatus],
  )
  if (result.affectedRows !== 1) {
    throw new AppError('波次状态已变化，请刷新后重试', 409)
  }
}

// ── 列表查询 ──────────────────────────────────────────────────────────────────

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, warehouseId = null, startDate = '', endDate = '', scopeWarehouseIds = null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like = `%${keyword}%`
  const conds = ['w.wave_no LIKE ?']
  const params = [like]
  if (status)      { conds.push('w.status = ?');       params.push(status) }
  if (warehouseId) { conds.push('w.warehouse_id = ?'); params.push(warehouseId) }
  if (startDate)   { conds.push('w.created_at >= ?');  params.push(`${startDate} 00:00:00`) }
  if (endDate)     { conds.push('w.created_at <= ?');  params.push(`${endDate} 23:59:59`) }
  // 仓库数据权限（2026-08-21 审计 A.3 修复）：限仓用户只看到自己仓库的波次
  if (Array.isArray(scopeWarehouseIds)) {
    conds.push(scopeWarehouseIds.length ? 'w.warehouse_id IN (?)' : '1=0')
    if (scopeWarehouseIds.length) params.push(scopeWarehouseIds)
  }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT w.*, wh.name AS warehouse_name
     FROM picking_waves w
     LEFT JOIN inventory_warehouses wh ON wh.id = w.warehouse_id
     WHERE ${where}
     ORDER BY w.priority ASC, w.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM picking_waves w WHERE ${where}`, params,
  )

  // 批量聚合（2026-08-22 性能）：此前逐行查 picking_wave_items 聚合（列表页 1+N），
  // 改为一次 IN 查询取回本页全部波次的 itemCount/totalQty/pickedQty。
  const waveIds = rows.map(r => r.id)
  const aggMap = new Map()
  if (waveIds.length) {
    const [aggRows] = await pool.query(
      `SELECT wave_id, COUNT(*) AS cnt, SUM(total_qty) AS totalQty, SUM(picked_qty) AS pickedQty
       FROM picking_wave_items WHERE wave_id IN (?) GROUP BY wave_id`,
      [waveIds],
    )
    for (const a of aggRows) {
      aggMap.set(Number(a.wave_id), {
        itemCount: Number(a.cnt),
        totalQty: Number(a.totalQty || 0),
        pickedQty: Number(a.pickedQty || 0),
      })
    }
  }

  const list = rows.map(r => ({
    ...fmt(r),
    ...(aggMap.get(Number(r.id)) || { itemCount: 0, totalQty: 0, pickedQty: 0 }),
  }))

  return { list, pagination: { page, pageSize: ps, total } }
}

// ── 详情 ──────────────────────────────────────────────────────────────────────

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query(
    `SELECT w.*, wh.name AS warehouse_name
     FROM picking_waves w
     LEFT JOIN inventory_warehouses wh ON wh.id = w.warehouse_id
     WHERE w.id = ?`,
    [id],
  )
  if (!row) throw new AppError('波次不存在', 404)
  // 单据级数据权限（2026-08-21 审计 A.3 修复）：限仓用户不能看他人仓库波次
  assertInScope(scopeWarehouseIds, row.warehouse_id, '波次')

  if (row.status < 4) {
    await refreshWavePickedFromTasks(pool, id)
  }

  const wave = fmt(row)
  const inboundThresholds = await getInboundClosureThresholds()

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
    `SELECT pwi.*, p.article_number, p.spec, p.color
       FROM picking_wave_items pwi
       JOIN product_items p ON p.id = pwi.product_id
      WHERE pwi.wave_id = ? ORDER BY pwi.id ASC`, [id],
  )
  wave.items = items.map(i => ({
    id:          i.id,
    productId:   i.product_id,
    productCode: i.product_code,
    productName: i.product_name,
    unit:        i.unit,
    articleNumber: i.article_number || null,
    spec:        i.spec || null,
    color:       i.color || null,
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

  const [packagePrintRows] = await pool.query(
    `SELECT
        p.id,
        p.barcode,
        j.id AS job_id,
        j.status,
        j.updated_at,
        j.error_message,
        pr.code AS printer_code,
        pr.name AS printer_name
     FROM picking_wave_tasks pwt
     INNER JOIN packages p ON p.warehouse_task_id = pwt.task_id
     LEFT JOIN (
       SELECT j1.*
       FROM print_jobs j1
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'package'
         GROUP BY ref_id
       ) latest ON latest.max_id = j1.id
     ) j ON j.ref_id = p.id AND j.ref_type = 'package'
     LEFT JOIN printers pr ON pr.id = j.printer_id
     WHERE pwt.wave_id = ?`,
    [id],
  )
  wave.printSummary = buildPackagePrintSummary(packagePrintRows, packagePrintRows.length, {
    timeoutMinutes: inboundThresholds.printTimeoutMinutes,
  })

  return wave
}

// ── 创建波次 ──────────────────────────────────────────────────────────────────

async function create({ taskIds, remark, priority = 2 }, scopeWarehouseIds = null) {
  if (!taskIds?.length || taskIds.length < 2) {
    throw new AppError('请选择至少 2 个任务创建波次', 400)
  }
  const normalizedTaskIds = taskIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
  const uniqueTaskIds = [...new Set(normalizedTaskIds)].sort((a, b) => a - b)
  if (uniqueTaskIds.length !== taskIds.length) {
    throw new AppError('波次任务不可重复选择', 400)
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 查询并锁定选中的任务。按 id 排序加锁，避免并发创建波次时同一批任务重复绑定。
    const [tasks] = await conn.query(
      `SELECT t.*, wh.name AS warehouse_name
       FROM warehouse_tasks t
       LEFT JOIN inventory_warehouses wh ON wh.id = t.warehouse_id
       WHERE t.id IN (?) AND t.deleted_at IS NULL
       ORDER BY t.id ASC
       FOR UPDATE`,
      [uniqueTaskIds],
    )

    if (tasks.length !== uniqueTaskIds.length) {
      throw new AppError('部分任务不存在', 400)
    }

    const [activeWaveRows] = await conn.query(
      `SELECT pwt.task_id, pw.wave_no, pw.status
       FROM picking_wave_tasks pwt
       INNER JOIN picking_waves pw ON pw.id = pwt.wave_id
       WHERE pwt.task_id IN (?) AND pw.status <> 5
       FOR UPDATE`,
      [uniqueTaskIds],
    )
    if (activeWaveRows.length) {
      const task = tasks.find(t => Number(t.id) === Number(activeWaveRows[0].task_id))
      throw new AppError(
        `任务 ${task?.task_no || activeWaveRows[0].task_id} 已在波次 ${activeWaveRows[0].wave_no} 中，不能重复创建波次`,
        409,
      )
    }

    // 校验：所有任务状态必须为 2（备货中）
    const invalid = tasks.find(t => Number(t.status) !== WT_STATUS.PICKING)
    if (invalid) {
      throw new AppError(`任务 ${invalid.task_no} 状态不是"备货中"，无法创建波次`, 400)
    }

    // 校验：所有任务必须同一仓库
    const whIds = [...new Set(tasks.map(t => t.warehouse_id))]
    if (whIds.length > 1) {
      throw new AppError('选中任务不属于同一仓库，无法创建波次', 400)
    }

    // 仓库数据权限（2026-08-21 审计 A.3 修复）：限仓用户不能用他人仓库的任务建波次
    assertInScope(scopeWarehouseIds, whIds[0], '波次')

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
      [uniqueTaskIds],
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

async function startPicking(id, { userId, userName }, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const wave = await lockWaveForTransition(conn, id)
    assertInScope(scopeWarehouseIds, wave.warehouse_id, '波次')
    if (Number(wave.status) !== WAVE_STATUS_CODE.PENDING) {
      throw new AppError('只有"待拣货"状态可以开始拣货', 409)
    }
    await casWaveStatus(conn, {
      id,
      fromStatus: WAVE_STATUS_CODE.PENDING,
      toStatus: WAVE_STATUS_CODE.PICKING,
      extraSet: 'operator_id = ?, operator_name = ?',
      extraParams: [userId, userName],
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 完成拣货（2 → 3 待分拣）────────────────────────────────────────────────────

async function finishPicking(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const wave = await lockWaveForTransition(conn, id)
    assertInScope(scopeWarehouseIds, wave.warehouse_id, '波次')
    if (Number(wave.status) !== WAVE_STATUS_CODE.PICKING) {
      throw new AppError('只有"拣货中"状态可以完成拣货', 409)
    }
    await refreshWavePickedFromTasks(conn, id)
    const [waveTasks] = await conn.query(
      `SELECT wt.id AS task_id, wt.status
       FROM picking_wave_tasks pwt
       JOIN warehouse_tasks wt ON wt.id = pwt.task_id
       WHERE pwt.wave_id = ? ORDER BY pwt.id ASC`,
      [id],
    )
    for (const t of waveTasks) {
      // 同 finish()：成员任务可能已被单独取消，跳过已终结的，不阻塞其余任务的拣货完成判定。
      if (!WT_STATUS_ACTIVE.includes(Number(t.status))) continue
      await assertTaskPickScanClosure(conn, t.task_id)
    }
    await casWaveStatus(conn, {
      id,
      fromStatus: WAVE_STATUS_CODE.PICKING,
      toStatus: WAVE_STATUS_CODE.SORTING,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 完成分拣（3 → 4 已完成）─ 将已拣数量回写到各任务 ──────────────────────────

async function finish(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const wave = await lockWaveForTransition(conn, id)
    assertInScope(scopeWarehouseIds, wave.warehouse_id, '波次')
    if (Number(wave.status) !== WAVE_STATUS_CODE.SORTING) {
      throw new AppError('只有"待分拣"状态可以完成波次', 409)
    }
    await refreshWavePickedFromTasks(conn, id)

    const [waveTasks] = await conn.query(
      `SELECT wt.id AS task_id, wt.status
       FROM picking_wave_tasks pwt
       JOIN warehouse_tasks wt ON wt.id = pwt.task_id
       WHERE pwt.wave_id = ? ORDER BY pwt.id ASC`,
      [id],
    )
    for (const t of waveTasks) {
      // 成员任务可能已经脱离波次被单独取消（/warehouse-tasks/:id/cancel 不会通知所属波次），
      // 此时它不再是 WT_STATUS_ACTIVE，强行推进会因非法状态迁移抛异常，导致整个波次永久卡在
      // 待分拣、无法完成也无法取消。跳过已终结的成员任务，不阻塞其余仍在进行中的任务。
      if (!WT_STATUS_ACTIVE.includes(Number(t.status))) continue
      await readyToShipWithinTransaction(conn, Number(t.task_id))
    }

    await casWaveStatus(conn, {
      id,
      fromStatus: WAVE_STATUS_CODE.SORTING,
      toStatus: WAVE_STATUS_CODE.DONE,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 取消波次 ──────────────────────────────────────────────────────────────────

async function cancel(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const wave = await lockWaveForTransition(conn, id)
    assertInScope(scopeWarehouseIds, wave.warehouse_id, '波次')
    const currentStatus = Number(wave.status)
    if (currentStatus === WAVE_STATUS_CODE.DONE || currentStatus === WAVE_STATUS_CODE.CANCELLED) {
      throw new AppError('波次已完成或已取消', 409)
    }
    // 波次取消必须联动取消其下仍在进行中的仓库任务，否则任务会脱离波次孤立卡在
    // 拣货中/待分拣等状态：容器锁被下面这行简单粗暴地清空，但任务本身既没有被取消，
    // 也没有别的入口能再管它，形成"半吊子"死状态（见拣货波次取消风险）。
    // 改为逐个走 warehouse-tasks 完整的 cancel 流程（释放容器/分拣格/联动销售单状态)。
    const [waveTasks] = await conn.query(
      `SELECT wt.id, wt.status
       FROM picking_wave_tasks pwt
       JOIN warehouse_tasks wt ON wt.id = pwt.task_id
       WHERE pwt.wave_id = ?`,
      [id],
    )
    for (const t of waveTasks) {
      if (WT_STATUS_ACTIVE.includes(Number(t.status))) {
        await cancelWarehouseTask(Number(t.id), { conn })
      }
    }
    await casWaveStatus(conn, {
      id,
      fromStatus: currentStatus,
      toStatus: WAVE_STATUS_CODE.CANCELLED,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  findAll,
  findById,
  create,
  startPicking,
  finishPicking,
  finish,
  cancel,
  refreshWavePickedFromTasks,
}
