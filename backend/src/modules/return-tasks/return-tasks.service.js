const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer, syncStockFromContainers, SOURCE_TYPE } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')

const PENDING_QA = 5

const RT_STATUS = { PENDING_RECEIVE: 1, RECEIVING: 2, PENDING_CHECK: 3, PENDING_PUTAWAY: 4, COMPLETED: 5, CANCELLED: 6 }
const RT_STATUS_NAME = { 1: '待收货', 2: '收货中', 3: '待质检', 4: '待上架', 5: '已完成', 6: '已取消' }

async function genTaskNo(conn) {
  return generateDailyCode(conn, 'return_tasks', 'task_no', 'RT')
}

const RT_TRANSITIONS = {
  [RT_STATUS.PENDING_RECEIVE]: [RT_STATUS.RECEIVING, RT_STATUS.CANCELLED],
  [RT_STATUS.RECEIVING]: [RT_STATUS.PENDING_CHECK, RT_STATUS.CANCELLED],
  [RT_STATUS.PENDING_CHECK]: [RT_STATUS.PENDING_PUTAWAY, RT_STATUS.CANCELLED],
  [RT_STATUS.PENDING_PUTAWAY]: [RT_STATUS.COMPLETED, RT_STATUS.CANCELLED],
  [RT_STATUS.COMPLETED]: [],
  [RT_STATUS.CANCELLED]: [],
}

function isValidTransition(from, to) {
  return (RT_TRANSITIONS[from] || []).includes(to)
}

// ─── 查询 PDA 待处理退货任务 ──────────────────────────────────────────
async function findPdaTasks(warehouseId) {
  const [rows] = await pool.query(
    `SELECT * FROM return_tasks
     WHERE warehouse_id = ? AND deleted_at IS NULL AND submitted_at IS NOT NULL
       AND status IN (1, 2, 3, 4)
     ORDER BY created_at DESC`,
    [warehouseId],
  )
  return rows.map(fmt)
}

async function findById(id) {
  const [[row]] = await pool.query(
    'SELECT * FROM return_tasks WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  if (!row) throw new AppError('退货任务不存在', 404)
  const [items] = await pool.query(
    'SELECT * FROM return_task_items WHERE task_id = ? ORDER BY id',
    [id],
  )
  return { ...fmt(row), items: items.map(fmtItem) }
}

// ─── 创建（由 confirmSR 调用）─────────────────────────────────────────
async function create(conn, { returnId, returnNo, returnType, warehouseId, warehouseName, partyName, items }) {
  const taskNo = await genTaskNo(conn)
  const [r] = await conn.query(
    `INSERT INTO return_tasks (task_no, return_type, return_id, return_no, warehouse_id, warehouse_name, party_name, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [taskNo, returnType, returnId, returnNo, warehouseId, warehouseName, partyName],
  )
  for (const item of items) {
    await conn.query(
      `INSERT INTO return_task_items (task_id, return_item_id, product_id, product_code, product_name, unit, expected_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.insertId, item.returnItemId || null, item.productId, item.productCode, item.productName, item.unit, item.quantity],
    )
  }
  return { taskId: r.insertId, taskNo }
}

// ─── 提交到 PDA ──────────────────────────────────────────────────────
async function submit(id, operator) {
  const row = await lockStatusRow(pool, {
    table: 'return_tasks', id,
    columns: 'id, task_no, status, submitted_at',
    entityName: '退货任务',
  })
  if (row.submitted_at) throw new AppError('任务已提交，无需重复提交', 400)
  await pool.query(
    'UPDATE return_tasks SET submitted_at = NOW(), submitted_by = ?, submitted_by_name = ? WHERE id = ?',
    [operator.userId, operator.realName, id],
  )
  return findById(id)
}

// ─── PDA 收货 ────────────────────────────────────────────────────────
async function receive(conn, taskId, { productId, packages, requestKey, userId }) {
  const requestState = requestKey
    ? await beginOperationRequest(conn, { requestKey, action: 'return.receive', userId })
    : { enabled: false }
  if (requestState.replay) return requestState.responseData

  const taskRow = await lockStatusRow(conn, {
    table: 'return_tasks', id: taskId,
    columns: 'id, task_no, status, warehouse_id',
    entityName: '退货任务',
  })
  if (![1, 2].includes(Number(taskRow.status))) {
    throw new AppError('当前状态不允许收货', 400)
  }
  if (Number(taskRow.status) === 1) {
    await compareAndSetStatus(conn, {
      table: 'return_tasks', id: taskId,
      fromStatus: 1, toStatus: 2, entityName: '退货任务',
    })
  }

  const [taskItems] = await conn.query(
    'SELECT * FROM return_task_items WHERE task_id = ? AND product_id = ? ORDER BY id FOR UPDATE',
    [taskId, productId],
  )
  if (!taskItems.length) throw new AppError('该商品不在退货任务中', 400)

  const totalQty = packages.reduce((s, p) => s + Number(p.qty || 0), 0)
  let remaining = totalQty
  const containers = []

  for (const item of taskItems) {
    if (remaining <= 0) break
    const cap = Number(item.expected_qty) - Number(item.received_qty)
    if (cap <= 0) continue
    const take = Math.min(remaining, cap)
    await conn.query(
      'UPDATE return_task_items SET received_qty = received_qty + ? WHERE id = ?',
      [take, item.id],
    )
    remaining -= take
  }
  if (remaining > 0) throw new AppError(`收货数量超出应退数量，超出 ${Number(remaining.toFixed(4))}`, 409)

  // 创建容器（状态=PENDING_QA）
  const [[product]] = await conn.query(
    'SELECT code, name, unit FROM product_items WHERE id = ? AND deleted_at IS NULL',
    [productId],
  )
  for (const pkg of packages) {
    const { createdContainerId, newBarcode } = await createContainer(conn, {
      productId,
      productName: product?.name || taskItems[0].product_name,
      warehouseId: Number(taskRow.warehouse_id),
      qty: Number(pkg.qty),
      unit: product?.unit || taskItems[0].unit,
      sourceType: SOURCE_TYPE.RETURN,
      sourceRefType: 'sale_return',
      sourceRefId: taskId,
      sourceRefNo: taskRow.task_no,
      containerStatus: PENDING_QA,
      barcodePrefix: 'I',
      remark: `销售退货收货 ${taskRow.task_no}`,
    })
    containers.push({ containerId: createdContainerId, barcode: newBarcode, qty: Number(pkg.qty) })
  }

  // 全部收货完成 → 待质检
  const [[{ remaining: stillRemaining }]] = await conn.query(
    `SELECT COALESCE(SUM(expected_qty - received_qty), 0) AS remaining
     FROM return_task_items WHERE task_id = ?`,
    [taskId],
  )
  if (Number(stillRemaining) <= 0) {
    await compareAndSetStatus(conn, {
      table: 'return_tasks', id: taskId,
      fromStatus: 2, toStatus: 3, entityName: '退货任务',
    })
  }

  const payload = { taskId, containers, status: Number(stillRemaining) <= 0 ? 3 : 2 }
  if (requestState.enabled) {
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: `已收货 ${totalQty}，生成 ${containers.length} 个容器`,
      resourceType: 'return_task',
      resourceId: taskId,
    })
  }
  return payload
}

// ─── PDA 质检确认 ────────────────────────────────────────────────────
async function check(conn, taskId, { productId, passedQty, requestKey, userId }) {
  const requestState = requestKey
    ? await beginOperationRequest(conn, { requestKey, action: 'return.check', userId })
    : { enabled: false }
  if (requestState.replay) return requestState.responseData

  const taskRow = await lockStatusRow(conn, {
    table: 'return_tasks', id: taskId,
    columns: 'id, task_no, status',
    entityName: '退货任务',
  })
  if (Number(taskRow.status) !== 3) {
    throw new AppError('只有待质检状态可以质检确认', 400)
  }

  // 按 FIFO 分配质检数量到明细行
  const [items] = await conn.query(
    'SELECT * FROM return_task_items WHERE task_id = ? AND product_id = ? ORDER BY id FOR UPDATE',
    [taskId, productId],
  )
  let remaining = Number(passedQty)
  for (const item of items) {
    if (remaining <= 0) break
    const cap = Number(item.received_qty) - Number(item.checked_qty)
    if (cap <= 0) continue
    const take = Math.min(remaining, cap)
    await conn.query(
      'UPDATE return_task_items SET checked_qty = checked_qty + ? WHERE id = ?',
      [take, item.id],
    )
    remaining -= take
  }
  if (remaining > 0) throw new AppError('质检数量超出已收货数量', 409)

  // 质检通过 → 容器状态 PENDING_QA → PENDING_PUTAWAY
  await conn.query(
    `UPDATE inventory_containers
     SET status = 4
     WHERE source_ref_type = 'sale_return' AND source_ref_id = ? AND status = ? AND product_id = ?`,
    [taskId, PENDING_QA, productId],
  )

  // 全部质检完成 → 待上架
  const [[{ remaining: stillRemaining }]] = await conn.query(
    `SELECT COALESCE(SUM(received_qty - checked_qty), 0) AS remaining
     FROM return_task_items WHERE task_id = ?`,
    [taskId],
  )
  if (Number(stillRemaining) <= 0) {
    await compareAndSetStatus(conn, {
      table: 'return_tasks', id: taskId,
      fromStatus: 3, toStatus: 4, entityName: '退货任务',
    })
  }

  const payload = { taskId, status: Number(stillRemaining) <= 0 ? 4 : 3 }
  if (requestState.enabled) {
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: `质检确认 ${passedQty}`,
      resourceType: 'return_task',
      resourceId: taskId,
    })
  }
  return payload
}

// ─── PDA 上架 ────────────────────────────────────────────────────────
async function putaway(conn, taskId, { containerId, locationId, requestKey, userId }) {
  const requestState = requestKey
    ? await beginOperationRequest(conn, { requestKey, action: 'return.putaway', userId })
    : { enabled: false }
  if (requestState.replay) return requestState.responseData

  const taskRow = await lockStatusRow(conn, {
    table: 'return_tasks', id: taskId,
    columns: 'id, task_no, status, return_id',
    entityName: '退货任务',
  })
  if (Number(taskRow.status) !== 4) {
    throw new AppError('只有待上架状态可以执行上架', 400)
  }

  // 验证容器
  const [[container]] = await conn.query(
    `SELECT * FROM inventory_containers
     WHERE id = ? AND source_ref_type = 'sale_return' AND source_ref_id = ?
     FOR UPDATE`,
    [containerId, taskId],
  )
  if (!container) throw new AppError('容器不存在', 404)
  if (Number(container.status) !== 4) throw new AppError('容器不是待上架状态', 400)

  // 验证库位
  const [[location]] = await conn.query(
    'SELECT * FROM warehouse_locations WHERE id = ? AND status = 1',
    [locationId],
  )
  if (!location) throw new AppError('库位不存在或已停用', 404)
  if (Number(location.warehouse_id) !== Number(container.warehouse_id)) {
    throw new AppError('库位和容器不在同一仓库', 400)
  }

  // 容器上架
  await conn.query(
    `UPDATE inventory_containers
     SET status = 1, location_id = ?
     WHERE id = ? AND source_ref_type = 'sale_return' AND source_ref_id = ?`,
    [locationId, containerId, taskId],
  )
  await syncStockFromContainers(conn, container.product_id, container.warehouse_id)

  // 分配上架数量
  const [items] = await conn.query(
    'SELECT * FROM return_task_items WHERE task_id = ? AND product_id = ? ORDER BY id FOR UPDATE',
    [taskId, container.product_id],
  )
  let remaining = Number(container.remaining_qty)
  for (const item of items) {
    if (remaining <= 0) break
    const cap = Number(item.checked_qty) - Number(item.putaway_qty)
    if (cap <= 0) continue
    const take = Math.min(remaining, cap)
    await conn.query(
      'UPDATE return_task_items SET putaway_qty = putaway_qty + ? WHERE id = ?',
      [take, item.id],
    )
    remaining -= take
  }

  // 全部上架完成 → 退货入仓完成
  const [[{ remaining: stillRemaining }]] = await conn.query(
    `SELECT COALESCE(SUM(checked_qty - putaway_qty), 0) AS remaining
     FROM return_task_items WHERE task_id = ?`,
    [taskId],
  )
  if (Number(stillRemaining) <= 0) {
    await compareAndSetStatus(conn, {
      table: 'return_tasks', id: taskId,
      fromStatus: 4, toStatus: 5, entityName: '退货任务',
    })
    // 同步退货单完成
    if (taskRow.return_id) {
      const returnSvc = require('../returns/returns.service')
      await returnSvc.syncSaleReturnCompleted(conn, Number(taskRow.return_id), { taskId, taskNo: taskRow.task_no })
    }
  }

  const payload = { taskId, containerId, locationId, status: Number(stillRemaining) <= 0 ? 5 : 4 }
  if (requestState.enabled) {
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: '上架成功',
      resourceType: 'return_task',
      resourceId: taskId,
    })
  }
  return payload
}

// ─── 取消 ────────────────────────────────────────────────────────────
async function cancel(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, {
      table: 'return_tasks', id,
      columns: 'id, task_no, status',
      entityName: '退货任务',
    })
    if (!isValidTransition(Number(taskRow.status), RT_STATUS.CANCELLED)) {
      throw new AppError('当前状态不允许取消', 400)
    }
    // 取消关联的待质检容器
    await conn.query(
      `UPDATE inventory_containers SET status = 3
       WHERE source_ref_type = 'sale_return' AND source_ref_id = ? AND status = ?`,
      [id, PENDING_QA],
    )
    await compareAndSetStatus(conn, {
      table: 'return_tasks', id,
      fromStatus: Number(taskRow.status),
      toStatus: RT_STATUS.CANCELLED,
      entityName: '退货任务',
    })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ─── 格式化 ──────────────────────────────────────────────────────────
function fmt(row) {
  return {
    id: Number(row.id),
    taskNo: row.task_no,
    returnType: row.return_type,
    returnId: Number(row.return_id),
    returnNo: row.return_no,
    warehouseId: Number(row.warehouse_id),
    warehouseName: row.warehouse_name,
    partyName: row.party_name,
    status: Number(row.status),
    statusName: RT_STATUS_NAME[Number(row.status)] || '',
    submittedAt: row.submitted_at || null,
    createdAt: row.created_at,
  }
}

function fmtItem(row) {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    productCode: row.product_code,
    productName: row.product_name,
    unit: row.unit,
    expectedQty: Number(row.expected_qty),
    receivedQty: Number(row.received_qty),
    checkedQty: Number(row.checked_qty),
    putawayQty: Number(row.putaway_qty),
  }
}

module.exports = {
  RT_STATUS, RT_STATUS_NAME, isValidTransition,
  findPdaTasks, findById, create, submit, receive, check, putaway, cancel,
}
