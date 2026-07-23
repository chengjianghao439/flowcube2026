const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { WT_STATUS, WT_STATUS_NAME, WT_STATUS_PICK_POOL } = require('../../constants/warehouseTaskStatus')
const { buildPackagePrintSummary } = require('../../utils/printSummary')
const { fmt, optionalTaskDetailQuery } = require('./warehouse-tasks.helpers')

async function findAll({ page=1, pageSize=20, keyword='', status=null, warehouseId=null, scopeWarehouseIds=null }) {
  const offset = (page - 1) * pageSize
  const conds = ['deleted_at IS NULL']
  const params = []
  if (keyword) {
    const like = `%${keyword}%`
    conds.push('(task_no LIKE ? OR customer_name LIKE ? OR sale_order_no LIKE ?)')
    params.push(like, like, like)
  }
  if (status)      { conds.push('status=?');       params.push(status) }
  if (warehouseId) { conds.push('warehouse_id=?'); params.push(warehouseId) }
  if (Array.isArray(scopeWarehouseIds)) {
    if (scopeWarehouseIds.length) { conds.push('warehouse_id IN (?)'); params.push(scopeWarehouseIds) }
    else { conds.push('1=0') }
  }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(`SELECT * FROM warehouse_tasks WHERE ${where} ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM warehouse_tasks WHERE ${where}`, params)
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL', [id])
  if (!rows[0]) throw new AppError('仓库任务不存在', 404)
  const task = fmt(rows[0])
  const inboundThresholds = await getInboundClosureThresholds()
  const [items] = await pool.query('SELECT * FROM warehouse_task_items WHERE task_id=?', [id])
  task.items = items.map(r => ({
    id: r.id,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    unit: r.unit,
    articleNumber: r.article_number || null,
    spec: r.spec || null,
    color: r.color || null,
    requiredQty: Number(r.required_qty),
    pickedQty: Number(r.picked_qty),
    checkedQty: Number(r.checked_qty ?? 0),
  }))

  const [packageRows] = await pool.query(
    `SELECT id, status
     FROM packages
     WHERE warehouse_task_id = ?
     ORDER BY created_at ASC`,
    [id],
  )
  const [packageItemAgg] = await pool.query(
    `SELECT COALESCE(SUM(pi.qty), 0) AS total_items
     FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id = ?`,
    [id],
  )
  task.packageSummary = {
    totalPackages: packageRows.length,
    openPackages: packageRows.filter(row => Number(row.status) !== 2).length,
    donePackages: packageRows.filter(row => Number(row.status) === 2).length,
    totalItems: Number(packageItemAgg?.[0]?.total_items || 0),
  }

  const [printRows] = await pool.query(
    `SELECT
        j.id AS job_id,
        j.status,
        j.updated_at,
        j.error_message,
        pr.code AS printer_code,
        pr.name AS printer_name
     FROM packages p
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
     WHERE p.warehouse_task_id = ?`,
    [id],
  )
  task.printSummary = buildPackagePrintSummary(printRows, packageRows.length, {
    timeoutMinutes: inboundThresholds.printTimeoutMinutes,
  })
  return task
}

/**
 * PDA 任务池 — 返回所有待分配/备货中的任务（供 PDA 主页显示）
 * 使用 JOIN + GROUP BY 替代 N+1 子查询
 */
async function findMyTasks() {
  const [rows] = await pool.query(`
    SELECT wt.*,
      COUNT(wti.id)                     AS item_count,
      COALESCE(SUM(wti.required_qty),0) AS total_required,
      COALESCE(SUM(wti.picked_qty),0)   AS total_picked
    FROM warehouse_tasks wt
    LEFT JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status IN (${WT_STATUS_PICK_POOL.join(',')}) AND wt.deleted_at IS NULL
      AND wt.cancel_requested_at IS NULL
    GROUP BY wt.id
    ORDER BY wt.priority ASC, wt.created_at DESC
    LIMIT 50
  `)
  return rows.map(r => ({
    ...fmt(r),
    itemCount:     Number(r.item_count),
    totalRequired: Number(r.total_required),
    totalPicked:   Number(r.total_picked),
  }))
}

async function findMyTaskSkuSummary() {
  const [rows] = await pool.query(`
    SELECT
      wti.product_id AS product_id,
      wti.product_code AS product_code,
      wti.product_name AS product_name,
      wti.unit AS unit,
      COALESCE(SUM(wti.required_qty),0) AS total_required,
      COALESCE(SUM(wti.picked_qty),0) AS total_picked,
      COUNT(DISTINCT wt.id) AS order_count,
      GROUP_CONCAT(DISTINCT wt.id ORDER BY wt.id ASC) AS task_ids
    FROM warehouse_tasks wt
    INNER JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status IN (${WT_STATUS_PICK_POOL.join(',')})
      AND wt.deleted_at IS NULL
      AND wt.cancel_requested_at IS NULL
    GROUP BY wti.product_id, wti.product_code, wti.product_name, wti.unit
    ORDER BY
      CASE WHEN COALESCE(SUM(wti.picked_qty),0) >= COALESCE(SUM(wti.required_qty),0) THEN 1 ELSE 0 END ASC,
      wti.product_name ASC,
      wti.product_code ASC
  `)
  return rows.map((row) => ({
    productId: Number(row.product_id),
    productCode: row.product_code,
    productName: row.product_name,
    unit: row.unit,
    totalRequired: Number(row.total_required),
    totalPicked: Number(row.total_picked),
    orderCount: Number(row.order_count),
    taskIds: String(row.task_ids || '')
      .split(',')
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0),
  }))
}

async function getTaskStats() {
  const counts = { picking: 0, sorting: 0, checking: 0, packing: 0, shipping: 0, done: 0, urgent: 0 }
  const [rows] = await pool.query(`
    SELECT status, COUNT(*) AS total
    FROM warehouse_tasks
    WHERE deleted_at IS NULL
    GROUP BY status
  `)
  for (const row of rows) {
    const status = Number(row.status)
    const total = Number(row.total)
    if (status === WT_STATUS.PICKING) counts.picking = total
    else if (status === WT_STATUS.SORTING) counts.sorting = total
    else if (status === WT_STATUS.CHECKING) counts.checking = total
    else if (status === WT_STATUS.PACKING) counts.packing = total
    else if (status === WT_STATUS.SHIPPING) counts.shipping = total
    else if (status === WT_STATUS.SHIPPED) counts.done = total
  }
  const [[urgentRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM warehouse_tasks
     WHERE deleted_at IS NULL
       AND priority = 1
       AND status < ?`,
    [WT_STATUS.SHIPPED],
  )
  counts.urgent = Number(urgentRow?.total || 0)
  return counts
}

async function findEvents(taskId) {
  const [events] = await pool.query(
    `SELECT id, event_type, from_status, to_status, operator_name, detail, created_at
     FROM warehouse_task_events
     WHERE task_id=?
     ORDER BY created_at ASC`,
    [taskId],
  )
  return events
}

async function getDebugSnapshot(taskId) {
  const [[task]] = await pool.query(
    `SELECT t.*,
            wh.name AS warehouse_name_full,
            sb.code AS sorting_bin_code_live,
            sb.status AS sorting_bin_status_live,
            sb.current_task_id AS sorting_bin_task_id_live
     FROM warehouse_tasks t
     LEFT JOIN inventory_warehouses wh ON wh.id = t.warehouse_id
     LEFT JOIN sorting_bins         sb ON sb.current_task_id = t.id
     WHERE t.id = ?`,
    [taskId],
  )
  if (!task) throw new AppError('任务不存在', 404)

  const [items] = await pool.query(
    `SELECT id, product_id, product_code, product_name, unit,
            article_number, spec, color,
            required_qty, picked_qty, sorted_qty, checked_qty
     FROM warehouse_task_items WHERE task_id=? ORDER BY id`,
    [taskId],
  )
  const [lockedContainers] = await pool.query(
    `SELECT ic.id, ic.barcode, ic.remaining_qty, ic.status,
            ic.locked_by_task_id, ic.locked_at,
            p.name AS product_name,
            loc.code AS location_code
     FROM inventory_containers ic
     LEFT JOIN product_items        p   ON p.id   = ic.product_id
     LEFT JOIN warehouse_locations  loc ON loc.id = ic.location_id
     WHERE ic.locked_by_task_id = ?
       AND ic.deleted_at IS NULL`,
    [taskId],
  )
  const [packages] = await pool.query(
    `SELECT p.id, p.barcode, p.status,
            COUNT(pi.id) AS item_types,
            SUM(pi.qty)  AS total_qty
     FROM packages p
     LEFT JOIN package_items pi ON pi.package_id = p.id
     WHERE p.warehouse_task_id = ?
     GROUP BY p.id`,
    [taskId],
  )
  const [[sortingBin]] = await optionalTaskDetailQuery('detail.sortingBin', pool.query(
    `SELECT id, code, status, current_task_id
     FROM sorting_bins WHERE id = ?`,
    [task.sorting_bin_id || 0],
  ), [[null]])
  const [events] = await optionalTaskDetailQuery('detail.events', pool.query(
    `SELECT id, event_type, from_status, to_status, operator_name, detail, created_at
     FROM warehouse_task_events
     WHERE task_id=?
     ORDER BY created_at DESC LIMIT 20`,
    [taskId],
  ), [[]])
  const [scanLogs] = await optionalTaskDetailQuery('detail.scanLogs', pool.query(
    `SELECT id, barcode, action, result, operator_name, created_at
     FROM scan_logs
     WHERE task_id=?
     ORDER BY created_at DESC LIMIT 10`,
    [taskId],
  ), [[]])

  const checks = []
  if (items.some(i => Number(i.sorted_qty) > Number(i.picked_qty))) {
    checks.push({ level: 'error', msg: 'sorted_qty 超出 picked_qty，数据异常' })
  }
  if (items.some(i => Number(i.checked_qty) > Number(i.required_qty))) {
    checks.push({ level: 'error', msg: 'checked_qty 超出 required_qty，数据异常' })
  }
  if (task.sorting_bin_id && sortingBin && sortingBin.current_task_id !== taskId) {
    checks.push({ level: 'warn', msg: `分拣格 ${sortingBin.code} 的 current_task_id 与任务不一致` })
  }
  if ([2, 3, 4, 5].includes(task.status) && items.length === 0) {
    checks.push({ level: 'error', msg: '进行中任务无明细记录，流程无法推进' })
  }
  if (checks.length === 0) checks.push({ level: 'ok', msg: '数据一致性检查通过' })

  return {
    snapshot: {
      task: {
        id: task.id,
        taskNo: task.task_no,
        status: task.status,
        statusName: WT_STATUS_NAME[task.status] ?? task.status,
        priority: task.priority,
        customerName: task.customer_name,
        warehouseId: task.warehouse_id,
        warehouseName: task.warehouse_name_full,
        assignedName: task.assigned_name,
        sortingBinId: task.sorting_bin_id,
        sortingBinCode: task.sorting_bin_code,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        shippedAt: task.shipped_at,
      },
      items: items.map(i => ({
        id: i.id,
        productCode: i.product_code,
        productName: i.product_name,
        unit: i.unit,
        articleNumber: i.article_number || null,
        spec: i.spec || null,
        color: i.color || null,
        requiredQty: Number(i.required_qty),
        pickedQty: Number(i.picked_qty),
        sortedQty: Number(i.sorted_qty ?? 0),
        checkedQty: Number(i.checked_qty ?? 0),
        pickProgress: `${i.picked_qty}/${i.required_qty}`,
        sortProgress: `${i.sorted_qty ?? 0}/${i.picked_qty}`,
        checkProgress: `${i.checked_qty ?? 0}/${i.required_qty}`,
      })),
      sortingBin: sortingBin ? {
        id: sortingBin.id,
        code: sortingBin.code,
        status: sortingBin.status,
        statusName: sortingBin.status === 1 ? '空闲' : '占用',
        currentTaskId: sortingBin.current_task_id,
        consistent: sortingBin.current_task_id === taskId,
      } : null,
      lockedContainers: lockedContainers.map(c => ({
        id: c.id,
        barcode: c.barcode,
        productName: c.product_name,
        remainingQty: Number(c.remaining_qty),
        status: c.status,
        locationCode: c.location_code,
        lockedAt: c.locked_at,
      })),
      packages: packages.map(p => ({
        id: p.id,
        barcode: p.barcode,
        status: p.status,
        statusName: p.status === 2 ? '已完成' : '打包中',
        itemTypes: Number(p.item_types ?? 0),
        totalQty: Number(p.total_qty ?? 0),
      })),
      recentEvents: events,
      recentScanLogs: scanLogs,
      consistencyChecks: checks,
    },
  }
}

module.exports = {
  findAll,
  findById,
  findEvents,
  getDebugSnapshot,
  findMyTasks,
  findMyTaskSkuSummary,
  getTaskStats,
}
