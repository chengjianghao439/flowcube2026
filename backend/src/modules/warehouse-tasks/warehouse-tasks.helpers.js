const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { WT_STATUS_NAME } = require('../../constants/warehouseTaskStatus')
const logger = require('../../utils/logger')

const TASK_STATUS = WT_STATUS_NAME
const PRIORITY    = { 1:'紧急',   2:'普通',   3:'低优先级' }

/**
 * 仓库任务单据级数据权限 + PDA 设备仓库一致性校验（2026-08-21 审计高危修复）。
 * 每个拿到 taskRow 的写入口都必须调用：
 * - scopeWarehouseIds：限仓用户只能操作自己仓库的任务（assertInScope）
 * - pdaWarehouseId：PDA 设备绑定仓库与任务仓库必须一致（防跨仓出库/拣货）
 */
function assertTaskScope(taskRow, { scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '仓库任务')
  if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(taskRow.warehouse_id)) {
    throw new AppError('当前设备绑定仓库与该仓库任务所属仓库不一致，无法作业', 403, 'PDA_WAREHOUSE_MISMATCH')
  }
}

function logSideEffectFailure(message, error, meta = {}) {
  logger.error(
    message,
    error instanceof Error ? error : new Error(String(error)),
    { degradation: 'side_effect_failed', ...meta },
    'WarehouseTask',
  )
}

async function optionalTaskDetailQuery(metricName, promise, fallback) {
  try {
    return await promise
  } catch (e) {
    logger.warn(
      '仓库任务详情可选区块查询失败，已返回明确降级值',
      {
        metricName,
        degradation: 'task_detail_optional_block_failed',
        error: e?.message || String(e),
      },
      'WarehouseTask',
    )
    return fallback
  }
}

/**
 * 拣货闭环：已拣满 + 扫码合计与 picked_qty 一致 + 锁定容器集合与拣货扫码容器一致
 */
async function assertTaskPickScanClosure(conn, taskId) {
  const [items] = await conn.query(
    'SELECT id, required_qty, picked_qty FROM warehouse_task_items WHERE task_id=?',
    [taskId],
  )
  // 一次分组读取，取代「逐明细一次聚合查询」的 N+1：出库前置在每次推进时都会跑这条链路。
  // 明细没有扫码行时按 0 处理——原写法 `SELECT COALESCE(SUM(qty),0)` 是聚合查询，无匹配行也返回 0。
  const [pickScanAgg] = await conn.query(
    `SELECT item_id, COALESCE(SUM(qty),0) AS sq FROM scan_logs
     WHERE task_id=? AND COALESCE(scan_purpose,1)=1
     GROUP BY item_id`,
    [taskId],
  )
  const pickedScanByItem = new Map(pickScanAgg.map(r => [Number(r.item_id), Number(r.sq)]))
  for (const row of items) {
    if (Number(row.picked_qty) !== Number(row.required_qty)) {
      throw new AppError(`拣货未完成：存在未拣满明细（需 ${row.required_qty}，已拣 ${row.picked_qty}）`, 400)
    }
    if ((pickedScanByItem.get(Number(row.id)) ?? 0) !== Number(row.picked_qty)) {
      throw new AppError('拣货扫码合计与明细已拣数量不一致，无法推进', 400)
    }
  }
  const [locked] = await conn.query(
    'SELECT id FROM inventory_containers WHERE locked_by_task_id=? AND deleted_at IS NULL',
    [taskId],
  )
  const [pickedContainers] = await conn.query(
    `SELECT DISTINCT container_id AS cid FROM scan_logs
     WHERE task_id=? AND COALESCE(scan_purpose,1)=1`,
    [taskId],
  )
  const lockedIds = new Set(locked.map(r => r.id))
  const pickIds = new Set(pickedContainers.map(r => r.cid))
  if (lockedIds.size !== pickIds.size) {
    throw new AppError('锁定的库存条码与拣货扫码的库存条码不一致：每个锁定的库存条码都必须完成拣货扫码', 400)
  }
  for (const id of lockedIds) {
    if (!pickIds.has(id)) throw new AppError('存在未经拣货扫码的锁定库存条码', 400)
  }
  for (const id of pickIds) {
    if (!lockedIds.has(id)) throw new AppError('拣货扫码的库存条码必须全部锁定于本任务', 400)
  }
}

/**
 * 返货出库前置闭合（2026-09-26 一致性审查 · 任务 1 第二期）：
 * 扫描的容器必须与「本任务预锁的返货容器」逐个数量吻合。
 *
 * assertTaskPickScanClosure 已经保证「锁定集合 == 扫码集合」与「明细 picked_qty == required_qty」，
 * 但它不要求「容器里有多少就扫多少」。返货的语义是**整批退回客户**：退货入库时那个容器里剩下多少
 * 合格品，就应该全部退出去。少了这层核对，一处数量偏差要等到 deductFromTaskLockedContainers
 * 按明细数量扣减时才会以「本任务锁定库存条码可用量不足」的形式暴露出来——那时已无法判断是哪一批、
 * 差多少。这里提前逐容器核对：预锁集合与扫码集合必须完全相同，且每个容器的扫码合计等于其实存。
 *
 * 扫码本身不递减 remaining_qty（lockContainer 只锁不扣），所以此处 remaining_qty 仍是入库量。
 */
async function assertSaleReturnReverseClosure(conn, taskId) {
  const [locked] = await conn.query(
    `SELECT id, barcode, remaining_qty FROM inventory_containers
      WHERE locked_by_task_id = ? AND deleted_at IS NULL
      ORDER BY id`,
    [taskId],
  )
  if (locked.length === 0) {
    throw new AppError('返货出库任务的预锁库存条码已全部丢失，无法出库，请联系管理员核查', 409)
  }
  const [scanned] = await conn.query(
    `SELECT container_id, COALESCE(SUM(qty),0) AS sq FROM scan_logs
      WHERE task_id = ? AND COALESCE(scan_purpose,1)=1
      GROUP BY container_id`,
    [taskId],
  )
  const scanByContainer = new Map(scanned.map(r => [Number(r.container_id), Number(r.sq)]))
  for (const c of locked) {
    const took = scanByContainer.get(Number(c.id))
    if (took == null) {
      throw new AppError(`库存条码 ${c.barcode} 属于本批返货但尚未扫码，返货必须整批退回客户`, 400)
    }
    if (Math.abs(took - Number(c.remaining_qty)) > 1e-6) {
      throw new AppError(
        `库存条码 ${c.barcode} 扫码数量 ${took} 与该条码实存 ${Number(c.remaining_qty)} 不符，返货必须整批退回客户`,
        400,
      )
    }
  }
  if (scanByContainer.size !== locked.length) {
    throw new AppError('返货扫码的库存条码与预锁的返货条码不一致，无法出库', 400)
  }
}

/**
 * 复核闭环：checked_qty === picked_qty，且复核扫码合计与 checked_qty 一致
 */
async function assertTaskCheckScanClosure(conn, taskId) {
  const [items] = await conn.query(
    'SELECT id, picked_qty, required_qty, checked_qty FROM warehouse_task_items WHERE task_id=?',
    [taskId],
  )
  // 同上：一次分组读取取代逐明细聚合；无扫码行的明细按 0（scan_purpose=2 为复核扫码）。
  const [checkScanAgg] = await conn.query(
    `SELECT item_id, COALESCE(SUM(qty),0) AS sq FROM scan_logs
     WHERE task_id=? AND scan_purpose=2
     GROUP BY item_id`,
    [taskId],
  )
  const checkedScanByItem = new Map(checkScanAgg.map(r => [Number(r.item_id), Number(r.sq)]))
  for (const row of items) {
    const p = Number(row.picked_qty)
    const ch = Number(row.checked_qty)
    if (p !== Number(row.required_qty)) {
      throw new AppError('出库前置：存在未拣满明细', 400)
    }
    if (ch !== p) {
      throw new AppError('出库前置：复核未完成（已核须等于拣货数量）', 400)
    }
    if ((checkedScanByItem.get(Number(row.id)) ?? 0) !== ch) {
      throw new AppError('复核扫码合计与已核数量不一致', 400)
    }
  }
}

/** 打包闭环：全部箱子已完成，且存在装箱明细 */
async function assertTaskPackagingClosure(conn, taskId) {
  const [[{ open }]] = await conn.query(
    `SELECT COUNT(*) AS open FROM packages WHERE warehouse_task_id=? AND status = 1`,
    [taskId],
  )
  if (Number(open) > 0) {
    throw new AppError('存在未完成的装箱，请先完成全部箱子打包', 400)
  }
  const [[{ cnt }]] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id = ? AND p.status = 2`,
    [taskId],
  )
  if (Number(cnt) === 0) {
    throw new AppError('没有已完成的装箱明细，无法进入待出库', 400)
  }
  // 装箱总量必须逐商品等于复核量：只校验「有箱有明细」挡不住「复核 10 只装 3」就发货、
  // 客户少收货（业务决策 2026-07-28）。用整数单位比较避免 DECIMAL 浮点误差。
  const SCALE = 100
  const [packedRows] = await conn.query(
    `SELECT pi.product_id, COALESCE(SUM(pi.qty), 0) AS packed
     FROM package_items pi INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id = ? AND p.status = 2
     GROUP BY pi.product_id`,
    [taskId],
  )
  const packedUnits = new Map(packedRows.map(r => [Number(r.product_id), Math.round(Number(r.packed) * SCALE)]))
  const [reqRows] = await conn.query(
    'SELECT product_id, product_name, checked_qty FROM warehouse_task_items WHERE task_id = ?',
    [taskId],
  )
  for (const r of reqRows) {
    const need = Math.round(Number(r.checked_qty) * SCALE)
    const got = packedUnits.get(Number(r.product_id)) || 0
    if (got !== need) {
      throw new AppError(
        `「${r.product_name}」装箱数量 ${got / SCALE} 与复核数量 ${Number(r.checked_qty)} 不一致，请装齐后再进入待出库`,
        400,
      )
    }
  }
}

async function assertTaskPackagePrintClosure(conn, taskId) {
  const [rows] = await conn.query(
    `SELECT
        p.id AS package_id,
        p.barcode,
        j.id AS job_id,
        j.status,
        j.error_message
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
     WHERE p.warehouse_task_id = ? AND p.status = 2
     ORDER BY p.id ASC`,
    [taskId],
  )
  if (!rows.length) {
    throw new AppError('没有已完成的箱子，无法推进到待出库', 400)
  }
  const missing = rows.find((row) => row.job_id == null)
  if (missing) {
    throw new AppError(`箱贴未进入打印链：箱号 ${missing.barcode} 还没有打印任务`, 409)
  }
  const failed = rows.find((row) => Number(row.status) === 3)
  if (failed) {
    throw new AppError(
      `箱贴打印失败：箱号 ${failed.barcode}${failed.error_message ? `，${failed.error_message}` : ''}`,
      409,
    )
  }
  const pending = rows.find((row) => Number(row.status) !== 2)
  if (pending) {
    throw new AppError(`箱贴仍待确认：箱号 ${pending.barcode} 尚未打印完成，请先收口打印任务`, 409)
  }
}

const fmt = r => ({
  id: r.id,
  taskNo: r.task_no,
  taskType: r.task_type || 'sale_out',
  returnId: r.return_id != null ? Number(r.return_id) : null,
  saleOrderId: r.sale_order_id,
  saleOrderNo: r.sale_order_no,
  customerId: r.customer_id,
  customerName: r.customer_name,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name,
  status: r.status,
  statusName: TASK_STATUS[r.status],
  priority: r.priority,
  priorityName: PRIORITY[r.priority],
  assignedTo: r.assigned_to || null,
  assignedName: r.assigned_name || null,
  expectedShipDate: r.expected_ship_date,
  remark: r.remark,
  sortingBinId:   r.sorting_bin_id   || null,
  sortingBinCode: r.sorting_bin_code || null,
  cancelRequestedAt: r.cancel_requested_at || null,
  shippedAt: r.shipped_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const genTaskNo = conn => generateDailyCode(conn, 'WT', 'warehouse_tasks', 'task_no')

module.exports = {
  PRIORITY,
  fmt,
  genTaskNo,
  logSideEffectFailure,
  optionalTaskDetailQuery,
  assertTaskPickScanClosure,
  assertSaleReturnReverseClosure,
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
  assertTaskPackagePrintClosure,
  assertTaskScope,
}
