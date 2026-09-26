const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { normalizePagination } = require('../../utils/pagination')
const { WT_STATUS, WT_STATUS_NAME, WT_STATUS_PICK_POOL } = require('../../constants/warehouseTaskStatus')
const { buildPackagePrintSummary } = require('../../utils/printSummary')
const { fmt, optionalTaskDetailQuery } = require('./warehouse-tasks.helpers')

async function findAll({ page=1, pageSize=20, keyword='', status=null, warehouseId=null, scopeWarehouseIds=null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
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

  const [rows] = await pool.query(`SELECT * FROM warehouse_tasks WHERE ${where} ORDER BY priority ASC, created_at DESC, id DESC LIMIT ? OFFSET ?`, [...params, ps, offset])
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM warehouse_tasks WHERE ${where}`, params)
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total } }
}

async function findById(id, scopeWarehouseIds = null) {
  const [rows] = await pool.query('SELECT * FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL', [id])
  if (!rows[0]) throw new AppError('仓库任务不存在', 404)
  // 单据级数据权限（2026-08-21 审计高危）：限仓用户只能看自己仓库的任务
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '仓库任务')
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
async function findMyTasks(scopeWarehouseIds = null) {
  // 仓库范围（2026-09-18 审计 P1）：2026-08-21 的「warehouse-tasks 唯一不过 scope」修复
  // 只覆盖了 list/detail/cancel/ship，任务池与会话统计这三个读接口漏了——限仓账号能看到
  // 别仓的待拣任务与商品明细。这里与 findAll 同口径。
  const params = []
  let scopeSql = ''
  if (Array.isArray(scopeWarehouseIds)) {
    if (scopeWarehouseIds.length) { scopeSql = ' AND wt.warehouse_id IN (?)'; params.push(scopeWarehouseIds) }
    else scopeSql = ' AND 1=0'
  }
  const [rows] = await pool.query(`
    SELECT wt.*,
      COUNT(wti.id)                     AS item_count,
      COALESCE(SUM(wti.required_qty),0) AS total_required,
      COALESCE(SUM(wti.picked_qty),0)   AS total_picked
    FROM warehouse_tasks wt
    LEFT JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status IN (${WT_STATUS_PICK_POOL.join(',')}) AND wt.deleted_at IS NULL
      AND wt.cancel_requested_at IS NULL${scopeSql}
    GROUP BY wt.id
    ORDER BY wt.priority ASC, wt.created_at DESC
    LIMIT 50
  `, params)
  return rows.map(r => ({
    ...fmt(r),
    itemCount:     Number(r.item_count),
    totalRequired: Number(r.total_required),
    totalPicked:   Number(r.total_picked),
  }))
}

/**
 * 待出库的退货任务（采购退货 / 销售退货返货）。
 *
 * 这两类任务跳过分拣/复核/打包，因而**没有包裹、没有物流箱码**，PDA 出库页原来的入口是
 * 「扫物流条码 → 反查包裹 → 出库」，对它们无从下手：货拣完了却出不了库，退货单永远收不了口。
 * 所以另给一个列表入口，让仓库能直接对着任务点出库。
 *
 * 只列状态=待出库(6) 的：拣货完成(2→6)由 readyToShip 推进，未完成拣货的不该出现在出库页。
 *
 * 必须按设备仓过滤：本列表在「不限仓」账号登录的**绑定单仓 PDA** 上，若只套用户仓库范围，
 * 会把别的仓的返货单也列出来；点了出库又被 ship 的设备仓校验拒掉——看得到、做不了。
 *
 * 返回 { list, total, page, pageSize }，不是裸数组：原先是写死 LIMIT 50 的裸数组，前端 15 秒轮询
 * 全量替换、无分页。待出库单排队超过 50 张时，后面的单在列表里根本不存在，操作员无从得知也点不到。
 * 必须真分页（page/offset）而不是「加长 limit」——排队量没有上界，靠抬高上限只是把截断点往后推，
 * 第 N+1 张之后照样够不着。分页下任意排队长都能逐页翻到并出库，total 只作提示。
 */
// 默认 100 与前端一致：AGENTS.md §0.2 要求轮询页面的分页批量不得小于 100
const RETURN_OUT_PAGE_SIZE = 100
const RETURN_OUT_PAGE_SIZE_MAX = 200

async function listReturnOutPending({ scopeWarehouseIds = null, warehouseId = null, page = 1, pageSize = RETURN_OUT_PAGE_SIZE } = {}) {
  const params = []
  let whereSql = ''
  if (Array.isArray(scopeWarehouseIds)) {
    if (scopeWarehouseIds.length) { whereSql += ' AND wt.warehouse_id IN (?)'; params.push(scopeWarehouseIds) }
    else whereSql += ' AND 1=0'
  }
  const deviceWarehouseId = warehouseId ? Number(warehouseId) : null
  if (deviceWarehouseId) { whereSql += ' AND wt.warehouse_id = ?'; params.push(deviceWarehouseId) }
  const size = Math.min(Math.max(Number(pageSize) || RETURN_OUT_PAGE_SIZE, 1), RETURN_OUT_PAGE_SIZE_MAX)
  const current = Math.max(Number(page) || 1, 1)

  const [rows] = await pool.query(`
    SELECT wt.id, wt.task_no, wt.task_type, wt.return_id,
           wt.customer_name, wt.warehouse_id, wt.warehouse_name,
           wt.priority, wt.created_at,
           COUNT(wti.id)                     AS item_count,
           COALESCE(SUM(wti.required_qty),0) AS total_required
      FROM warehouse_tasks wt
      LEFT JOIN warehouse_task_items wti ON wti.task_id = wt.id
     WHERE wt.task_type IN ('purchase_return','sale_return_out')
       AND wt.status = ? AND wt.deleted_at IS NULL
       AND wt.cancel_requested_at IS NULL${whereSql}
     GROUP BY wt.id
     ORDER BY wt.priority ASC, wt.created_at ASC, wt.id ASC
     LIMIT ? OFFSET ?
  `, [WT_STATUS.SHIPPING, ...params, size, (current - 1) * size])

  const [[{ total }]] = await pool.query(`
    SELECT COUNT(*) AS total
      FROM warehouse_tasks wt
     WHERE wt.task_type IN ('purchase_return','sale_return_out')
       AND wt.status = ? AND wt.deleted_at IS NULL
       AND wt.cancel_requested_at IS NULL${whereSql}
  `, [WT_STATUS.SHIPPING, ...params])

  const list = rows.map(r => ({
    id: Number(r.id),
    taskNo: r.task_no,
    taskType: r.task_type,
    returnId: r.return_id != null ? Number(r.return_id) : null,
    // 返货任务落的是退货单上的客户名；采购退货无客户名，前端据此显示"供应商"占位
    partyName: r.customer_name || null,
    warehouseId: Number(r.warehouse_id),
    warehouseName: r.warehouse_name || '',
    priority: Number(r.priority),
    itemCount: Number(r.item_count),
    totalRequired: Number(r.total_required),
    createdAt: r.created_at,
  }))
  return { list, total: Number(total), page: current, pageSize: size }
}

async function findMyTaskSkuSummary(scopeWarehouseIds = null) {
  const params = []
  let scopeSql = ''
  if (Array.isArray(scopeWarehouseIds)) {
    if (scopeWarehouseIds.length) { scopeSql = ' AND wt.warehouse_id IN (?)'; params.push(scopeWarehouseIds) }
    else scopeSql = ' AND 1=0'
  }
  const [rows] = await pool.query(`
    SELECT
      wti.product_id AS product_id,
      wti.product_code AS product_code,
      wti.product_name AS product_name,
      wti.unit AS unit,
      wti.article_number AS article_number,
      wti.spec AS spec,
      wti.color AS color,
      COALESCE(SUM(wti.required_qty),0) AS total_required,
      COALESCE(SUM(wti.picked_qty),0) AS total_picked,
      COUNT(DISTINCT COALESCE(
        CONCAT('sale:', NULLIF(wt.sale_order_id, 0)),
        CONCAT('return:', wt.task_type, ':', NULLIF(wt.return_id, 0)),
        CONCAT('task:', wt.id)
      )) AS order_count,
      JSON_ARRAYAGG(wt.id) AS task_ids
    FROM warehouse_tasks wt
    INNER JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status IN (${WT_STATUS_PICK_POOL.join(',')})
      AND wt.deleted_at IS NULL
      AND wt.cancel_requested_at IS NULL${scopeSql}
    GROUP BY wti.product_id, wti.product_code, wti.product_name, wti.unit, wti.article_number, wti.spec, wti.color
    ORDER BY
      CASE WHEN COALESCE(SUM(wti.picked_qty),0) >= COALESCE(SUM(wti.required_qty),0) THEN 1 ELSE 0 END ASC,
      wti.product_name ASC,
      wti.product_code ASC
  `, params)
  const summaries = rows.map((row) => ({
    productId: Number(row.product_id),
    productCode: row.product_code,
    productName: row.product_name,
    unit: row.unit,
    articleNumber: row.article_number || null,
    spec: row.spec || null,
    color: row.color || null,
    totalRequired: Number(row.total_required),
    totalPicked: Number(row.total_picked),
    orderCount: Number(row.order_count),
    taskIds: [...new Set((Array.isArray(row.task_ids) ? row.task_ids : JSON.parse(row.task_ids || '[]'))
      .map((v) => Number(v))
      .filter((v) => Number.isSafeInteger(v) && v > 0))].sort((a, b) => a - b),
  }))
  const taskIds = [...new Set(summaries.flatMap((summary) => summary.taskIds))]
  if (!taskIds.length) return summaries.map((summary) => ({ ...summary, taskOptions: [] }))
  const [taskRows] = await pool.query(`
    SELECT wt.id, wt.task_no, wt.sale_order_no, wt.customer_name, wt.warehouse_name, wt.status
    FROM warehouse_tasks wt
    WHERE wt.id IN (?) AND wt.deleted_at IS NULL
      AND wt.status IN (${WT_STATUS_PICK_POOL.join(',')})
      AND wt.cancel_requested_at IS NULL${scopeSql}
  `, [taskIds, ...params])
  const optionsById = new Map(taskRows.map((task) => [Number(task.id), {
    id: Number(task.id),
    taskNo: task.task_no,
    saleOrderNo: task.sale_order_no,
    customerName: task.customer_name,
    warehouseName: task.warehouse_name,
    status: Number(task.status),
    statusName: WT_STATUS_NAME[task.status] ?? String(task.status),
  }]))
  return summaries.map((summary) => ({
    ...summary,
    taskOptions: summary.taskIds.map((id) => optionsById.get(id)).filter(Boolean),
  }))
}

async function getTaskStats(scopeWarehouseIds = null) {
  const counts = { picking: 0, sorting: 0, checking: 0, packing: 0, shipping: 0, done: 0, urgent: 0 }
  const params = []
  let scopeSql = ''
  if (Array.isArray(scopeWarehouseIds)) {
    if (scopeWarehouseIds.length) { scopeSql = ' AND warehouse_id IN (?)'; params.push(scopeWarehouseIds) }
    else scopeSql = ' AND 1=0'
  }
  const [rows] = await pool.query(`
    SELECT status, COUNT(*) AS total
    FROM warehouse_tasks
    WHERE deleted_at IS NULL${scopeSql}
    GROUP BY status
  `, params)
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
       AND status < ?${scopeSql}`,
    [WT_STATUS.SHIPPED, ...params],
  )
  counts.urgent = Number(urgentRow?.total || 0)
  return counts
}

async function findEvents(taskId, scopeWarehouseIds = null) {
  const [events] = await pool.query(
    `SELECT id, event_type, from_status, to_status, operator_name, detail, created_at
     FROM warehouse_task_events
     WHERE task_id=?
     ORDER BY created_at ASC`,
    [taskId],
  )
  // 越权读防护（2026-08-30 审计）：限仓用户只能看自己仓库任务的事件。
  // 先查任务归属再 assertInScope；事件本身无 warehouse_id 列，须回查 task。
  const [[taskRow]] = await pool.query('SELECT warehouse_id FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL', [taskId])
  if (taskRow) assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '仓库任务')
  return events
}

async function getDebugSnapshot(taskId, scopeWarehouseIds = null) {
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
  // 越权读防护：调试快照泄露锁定容器/分拣格/扫码流水，必须校验仓库归属（2026-08-30 审计）
  assertInScope(scopeWarehouseIds, task.warehouse_id, '仓库任务')

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
  listReturnOutPending,
  getTaskStats,
}
