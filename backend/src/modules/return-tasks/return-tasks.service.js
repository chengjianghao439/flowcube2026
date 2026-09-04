const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer, syncStockFromContainers, lockStockDimension, SOURCE_TYPE, CONTAINER_STATUS } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { assertInScope } = require('../../utils/warehouseScope')
const { queueReturnLabels } = require('./return-tasks.labels')

const PENDING_QA = 5
const REJECTED = CONTAINER_STATUS.REJECTED

const RT_STATUS = { PENDING_RECEIVE: 1, RECEIVING: 2, PENDING_CHECK: 3, PENDING_PUTAWAY: 4, COMPLETED: 5, CANCELLED: 6 }
const RT_STATUS_NAME = { 1: '待收货', 2: '收货中', 3: '待质检', 4: '待上架', 5: '已完成', 6: '已取消' }

/**
 * PDA 设备绑定仓库与退货任务仓库一致性校验（与收货上架 inbound putaway 同口径）：
 * 绑定 A 仓的设备不得对 B 仓退货任务收货/质检/上架（这些都是写操作，会在别仓建容器/质检/入库）。
 * 旧调用在 pdaWarehouseId 为 null 时不由本辅助函数限定；扫码上架及其查询入口另行强制非空设备仓。
 */
function assertPdaWarehouse(pdaWarehouseId, taskWarehouseId) {
  if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(taskWarehouseId)) {
    throw new AppError('当前设备绑定仓库与该退货任务所属仓库不一致，无法操作', 403)
  }
}

async function genTaskNo(conn) {
  return generateDailyCode(conn, 'RT', 'return_tasks', 'task_no')
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
/** warehouseId 为空（无设备会话绑定仓库）时不按仓库过滤，与其它模块 PDA 列表口径一致 */
async function findPdaTasks(warehouseId) {
  const conds = ['deleted_at IS NULL', 'submitted_at IS NOT NULL', 'status IN (1, 2, 3, 4)']
  const params = []
  if (warehouseId) {
    conds.push('warehouse_id = ?')
    params.push(warehouseId)
  }
  const [rows] = await pool.query(
    `SELECT * FROM return_tasks WHERE ${conds.join(' AND ')} ORDER BY created_at DESC`,
    params,
  )
  return rows.map(fmt)
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query(
    'SELECT * FROM return_tasks WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  if (!row) throw new AppError('退货任务不存在', 404)
  assertInScope(scopeWarehouseIds, row.warehouse_id, '退货任务')
  const [items] = await pool.query(
    `SELECT rti.*, p.article_number, p.spec, p.color
       FROM return_task_items rti
       JOIN product_items p ON p.id = rti.product_id
      WHERE rti.task_id = ? ORDER BY rti.id`,
    [id],
  )
  const [rejectedContainers] = await pool.query(
    `SELECT c.id, c.barcode, c.remaining_qty, c.product_id, p.name AS product_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     WHERE c.source_ref_type = 'sale_return' AND c.source_ref_id = ? AND c.status = ?
     ORDER BY c.id`,
    [id, REJECTED],
  )
  const [pendingPutawayContainers] = await pool.query(
    `SELECT c.id, c.barcode, c.remaining_qty, c.product_id, p.name AS product_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     WHERE c.source_ref_type = 'sale_return' AND c.source_ref_id = ? AND c.status = ?
       AND c.deleted_at IS NULL AND c.remaining_qty > 0
     ORDER BY c.id`,
    [id, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  return {
    ...fmt(row),
    items: items.map(fmtItem),
    pendingPutawayContainers: pendingPutawayContainers.map(r => ({
      id: Number(r.id), barcode: r.barcode, qty: Number(r.remaining_qty),
      productId: Number(r.product_id), productName: r.product_name,
    })),
    rejectedContainers: rejectedContainers.map(r => ({
      id: Number(r.id), barcode: r.barcode, qty: Number(r.remaining_qty),
      productId: Number(r.product_id), productName: r.product_name,
    })),
  }
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
async function submitWithinTransaction(conn, id, operator, scopeWarehouseIds = null) {
  const row = await lockStatusRow(conn, {
    table: 'return_tasks', id,
    columns: 'id, task_no, status, submitted_at, warehouse_id',
    entityName: '退货任务',
  })
  assertInScope(scopeWarehouseIds, row.warehouse_id, '退货任务')
  if (row.submitted_at) throw new AppError('任务已提交，无需重复提交', 400)
  await conn.query(
    'UPDATE return_tasks SET submitted_at = NOW(), submitted_by = ?, submitted_by_name = ? WHERE id = ?',
    [operator.userId, operator.realName, id],
  )
}

async function submit(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await submitWithinTransaction(conn, id, operator, scopeWarehouseIds)
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return findById(id)
}

// ─── PDA 收货 ────────────────────────────────────────────────────────
async function receive(conn, taskId, { productId, packages, requestKey, userId, pdaWarehouseId = null }) {
  const requestState = requestKey
    ? await beginOperationRequest(conn, { requestKey, action: 'return.receive', userId })
    : { enabled: false }
  if (requestState.replay) return requestState.responseData

  const taskRow = await lockStatusRow(conn, {
    table: 'return_tasks', id: taskId,
    columns: 'id, task_no, status, warehouse_id',
    entityName: '退货任务',
  })
  assertPdaWarehouse(pdaWarehouseId, taskRow.warehouse_id)
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
    const { containerId: createdContainerId, barcode: newBarcode } = await createContainer(conn, {
      productId,
      productName: product?.name || taskItems[0].product_name,
      warehouseId: Number(taskRow.warehouse_id),
      initialQty: Number(pkg.qty),
      unit: product?.unit || taskItems[0].unit,
      sourceType: SOURCE_TYPE.RETURN,
      sourceRefType: 'sale_return',
      sourceRefId: taskId,
      sourceRefNo: taskRow.task_no,
      containerStatus: PENDING_QA,
      barcodePrefix: 'I',
      remark: `销售退货收货 ${taskRow.task_no}`,
    })
    containers.push({ containerId: createdContainerId, barcode: newBarcode, qty: Number(pkg.qty), status: PENDING_QA })
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

  const printing = await queueReturnLabels(conn, { taskId, warehouseId: Number(taskRow.warehouse_id),
    productName: product?.name || taskItems[0].product_name, containers, userId, phase: 'receive' })
  const payload = { taskId, containers, ...printing, status: Number(stillRemaining) <= 0 ? 3 : 2 }
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
/**
 * 按 productId 把该退货任务下的 PENDING_QA 容器分配为「合格→待上架」/「不合格→REJECTED」。
 * 部分质检保留未检分量；跨合格/不合格/未检边界时拆分容器，始终保持数量守恒。
 */
async function allocateQaContainers(conn, { taskId, taskNo, productId, passedQty, rejectedQty }) {
  let passRemaining = Number(passedQty)
  let rejRemaining = Number(rejectedQty)
  if (passRemaining <= 0 && rejRemaining <= 0) return []
  const changed = []

  const [containers] = await conn.query(
    `SELECT id, barcode, product_id, warehouse_id, location_id, unit,
            batch_no, mfg_date, exp_date, remaining_qty
     FROM inventory_containers
     WHERE source_ref_type = 'sale_return' AND source_ref_id = ? AND status = ? AND product_id = ?
     ORDER BY id
     FOR UPDATE`,
    [taskId, PENDING_QA, productId],
  )

  for (const c of containers) {
    if (passRemaining <= 0 && rejRemaining <= 0) break
    const rem = Number(c.remaining_qty)
    if (rem <= 0) continue
    const passTake = Math.min(passRemaining, rem)
    const rejTake = Math.min(rejRemaining, rem - passTake)

    // 每次只处理本次质检量。未检量保留原条码；合格/拒收各自独立容器，三者总和不变。
    const unchecked = Number((rem - passTake - rejTake).toFixed(4))
    const parts = [
      { qty: unchecked, status: PENDING_QA, label: '待质检' },
      { qty: passTake, status: CONTAINER_STATUS.PENDING_PUTAWAY, label: '合格' },
      { qty: rejTake, status: REJECTED, label: '不合格' },
    ].filter(part => part.qty > 0)
    const [original, ...splits] = parts
    await conn.query(
      'UPDATE inventory_containers SET remaining_qty = ?, status = ? WHERE id = ?',
      [original.qty, original.status, c.id],
    )
    changed.push({ containerId: Number(c.id), barcode: c.barcode, qty: original.qty, status: original.status })
    for (const part of splits) {
      const created = await createContainer(conn, {
        productId: c.product_id,
        warehouseId: c.warehouse_id,
        initialQty: part.qty,
        unit: c.unit,
        batchNo: c.batch_no,
        mfgDate: fmtSqlDate(c.mfg_date),
        expDate: fmtSqlDate(c.exp_date),
        sourceType: SOURCE_TYPE.RETURN,
        sourceRefType: 'sale_return',
        sourceRefId: taskId,
        sourceRefNo: taskNo,
        containerStatus: part.status,
        barcodePrefix: 'I',
        remark: `退货质检${part.label}，自 ${c.barcode} 拆分`,
      })
      changed.push({ containerId: Number(created.containerId), barcode: created.barcode, qty: part.qty, status: part.status })
    }
    passRemaining = Number((passRemaining - passTake).toFixed(4))
    rejRemaining = Number((rejRemaining - rejTake).toFixed(4))
  }
  if (passRemaining > 0 || rejRemaining > 0) {
    throw new AppError('质检数量超出待质检容器可用数量', 409)
  }
  return changed
}

function fmtSqlDate(d) {
  if (!d) return null
  // Date 对象直接透传：连接池 timezone=+08:00 会把本地午夜序列化为当天的日期字符串，
  // 写进 DATE 列不错位（同 containerEngine.fmtSqlDate 的结论）。
  // 此前 toISOString().slice(0,10) 先转 UTC，+08 下日期回退一天。
  if (d instanceof Date) return d
  return String(d).slice(0, 10)
}

/**
 * 待上架量归零（不合格部分永不计入）时把任务从「待上架」推进到「已完成」并同步退货单。
 * check() 和 putaway() 都可能是"最后一次让任务归零"的那个动作（比如某条明细整行都不合格，
 * 从没有容器进入过待上架状态，putaway() 根本不会被调用），所以两处都要收口检查。
 */
async function tryFinishReturnTaskPutaway(conn, taskId, taskNo, returnId) {
  const [[{ remaining }]] = await conn.query(
    `SELECT COALESCE(SUM(checked_qty - rejected_qty - putaway_qty), 0) AS remaining
     FROM return_task_items WHERE task_id = ?`,
    [taskId],
  )
  if (Number(remaining) > 0) return false

  await compareAndSetStatus(conn, {
    table: 'return_tasks', id: taskId,
    fromStatus: 4, toStatus: 5, entityName: '退货任务',
  })
  if (returnId) {
    const returnSvc = require('../returns/returns-sale.service')
    await returnSvc.syncSaleReturnCompleted(conn, Number(returnId), { taskId, taskNo })
  }
  return true
}

async function check(conn, taskId, { productId, passedQty, rejectedQty = 0, requestKey, userId, pdaWarehouseId = null }) {
  const requestState = requestKey
    ? await beginOperationRequest(conn, { requestKey, action: 'return.check', userId })
    : { enabled: false }
  if (requestState.replay) return requestState.responseData

  const taskRow = await lockStatusRow(conn, {
    table: 'return_tasks', id: taskId,
    // return_id 必须取：整行全部不合格时，本 check() 是唯一让任务归零的动作（putaway 永不被
    // 调用），下面 tryFinishReturnTaskPutaway 靠 taskRow.return_id 触发 syncSaleReturnCompleted。
    // 漏取会让 return_id=undefined → 跳过退货单收口 → return_tasks 已完成而 sale_returns 永卡已确认。
    columns: 'id, task_no, status, return_id, warehouse_id',
    entityName: '退货任务',
  })
  assertPdaWarehouse(pdaWarehouseId, taskRow.warehouse_id)
  if (Number(taskRow.status) !== 3) {
    throw new AppError('只有待质检状态可以质检确认', 400)
  }

  const passed = Number(passedQty) || 0
  const rejected = Number(rejectedQty) || 0
  if (passed < 0 || rejected < 0) throw new AppError('质检数量不能为负数', 400)
  if (passed <= 0 && rejected <= 0) throw new AppError('质检数量必须大于 0', 400)

  // 按 FIFO 分配质检数量到明细行：checked_qty = 已质检处理量（合格+不合格），rejected_qty 单独记录不合格量
  const [items] = await conn.query(
    'SELECT * FROM return_task_items WHERE task_id = ? AND product_id = ? ORDER BY id FOR UPDATE',
    [taskId, productId],
  )
  let remaining = passed + rejected
  let rejRemaining = rejected
  for (const item of items) {
    if (remaining <= 0) break
    const cap = Number(item.received_qty) - Number(item.checked_qty)
    if (cap <= 0) continue
    const take = Math.min(remaining, cap)
    const rejTake = Math.min(rejRemaining, take)
    await conn.query(
      'UPDATE return_task_items SET checked_qty = checked_qty + ?, rejected_qty = rejected_qty + ? WHERE id = ?',
      [take, rejTake, item.id],
    )
    remaining = Number((remaining - take).toFixed(4))
    rejRemaining = Number((rejRemaining - rejTake).toFixed(4))
  }
  if (remaining > 0) throw new AppError('质检数量超出已收货数量', 409)

  // 质检确认 → 容器按合格/不合格分别转 PENDING_PUTAWAY / REJECTED
  const containers = await allocateQaContainers(conn, { taskId, taskNo: taskRow.task_no, productId, passedQty: passed, rejectedQty: rejected })

  // 全部质检完成 → 待上架
  const [[{ remaining: stillRemaining }]] = await conn.query(
    `SELECT COALESCE(SUM(received_qty - checked_qty), 0) AS remaining
     FROM return_task_items WHERE task_id = ?`,
    [taskId],
  )
  let finalStatus = Number(taskRow.status)
  if (Number(stillRemaining) <= 0) {
    await compareAndSetStatus(conn, {
      table: 'return_tasks', id: taskId,
      fromStatus: 3, toStatus: 4, entityName: '退货任务',
    })
    finalStatus = 4
    // 质检刚完成就顺带检查是否已经不需要任何物理上架（比如整行全部不合格，永远不会有容器进入待上架）
    const finished = await tryFinishReturnTaskPutaway(conn, taskId, taskRow.task_no, taskRow.return_id)
    if (finished) finalStatus = 5
  }

  const printing = await queueReturnLabels(conn, { taskId, warehouseId: Number(taskRow.warehouse_id),
    productName: items[0]?.product_name || '退货商品', containers, userId, phase: 'check' })
  const payload = { taskId, status: finalStatus, containers, ...printing }
  if (requestState.enabled) {
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: rejected > 0 ? `质检确认 合格${passed} 不合格${rejected}` : `质检确认 ${passed}`,
      resourceType: 'return_task',
      resourceId: taskId,
    })
  }
  return payload
}

// ─── PDA 上架 ────────────────────────────────────────────────────────
async function putaway(conn, taskId, { containerId, locationId, requestKey, userId, pdaWarehouseId = null, scopeWarehouseIds = null }) {
  const requestState = requestKey
    ? await beginOperationRequest(conn, { requestKey, action: 'return.putaway', userId })
    : { enabled: false }
  if (requestState.replay) return requestState.responseData

  const taskRow = await lockStatusRow(conn, {
    table: 'return_tasks', id: taskId,
    columns: 'id, task_no, status, return_id, warehouse_id',
    entityName: '退货任务',
  })
  if (pdaWarehouseId == null) throw new AppError('设备尚未绑定仓库，无法扫码上架', 403)
  assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '退货任务')
  assertPdaWarehouse(pdaWarehouseId, taskRow.warehouse_id)
  if (Number(taskRow.status) !== 4) {
    throw new AppError('只有待上架状态可以执行上架', 400)
  }

  // 先确定容器所属「商品+仓库」维度并取维度锁，再做单容器加锁读——顺序不能反。
  // 上架最后一步 syncStockFromContainers 会汇总该维度全部在库容器刷新缓存；若先锁住自己
  // 这只容器再去请求汇总范围锁，就与标准上架/出库（先锁 inventory_stock 维度、后锁容器）
  // 的顺序相反，并发上架同一商品会 ABBA 死锁（详见 containerEngine.lockStockDimension，
  // 与 inbound-tasks.putaway.js 的处理一致）。product_id / warehouse_id 是容器不可变字段，
  // 无锁预读安全，真正的状态/归属校验仍由下面的加锁读负责。
  const [[cRef]] = await conn.query(
    `SELECT product_id, warehouse_id FROM inventory_containers
     WHERE id = ? AND source_ref_type = 'sale_return' AND source_ref_id = ? AND deleted_at IS NULL`,
    [containerId, taskId],
  )
  if (!cRef) throw new AppError('容器不存在', 404)
  if (Number(cRef.warehouse_id) !== Number(taskRow.warehouse_id)) throw new AppError('容器和退货任务不在同一仓库', 400)
  await lockStockDimension(conn, cRef.product_id, cRef.warehouse_id)

  // 验证容器
  const [[container]] = await conn.query(
    `SELECT * FROM inventory_containers
     WHERE id = ? AND source_ref_type = 'sale_return' AND source_ref_id = ? AND deleted_at IS NULL
     FOR UPDATE`,
    [containerId, taskId],
  )
  if (!container) throw new AppError('容器不存在', 404)
  if (Number(container.status) !== 4) throw new AppError('容器不是待上架状态', 400)

  // 验证库位
  const [[location]] = await conn.query(
    'SELECT * FROM warehouse_locations WHERE id = ? AND status = 1 AND deleted_at IS NULL',
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
    // checked_qty 里含 rejected_qty（不合格部分永远不会走上架），可上架量须先扣除
    const cap = Number(item.checked_qty) - Number(item.rejected_qty) - Number(item.putaway_qty)
    if (cap <= 0) continue
    const take = Math.min(remaining, cap)
    await conn.query(
      'UPDATE return_task_items SET putaway_qty = putaway_qty + ? WHERE id = ?',
      [take, item.id],
    )
    remaining -= take
  }

  // 全部上架完成 → 退货入仓完成（不合格部分不计入待上架量，否则任务永远无法完成）
  const finished = await tryFinishReturnTaskPutaway(conn, taskId, taskRow.task_no, taskRow.return_id)

  const payload = { taskId, containerId, locationId, status: finished ? 5 : 4 }
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
/** options.conn 传入时复用调用方已开启的事务（供 returns.service.cancelSR 联动取消调用），否则自管事务。 */
async function cancel(id, operator, options = {}) {
  const manageConn = !options.conn
  const conn = options.conn || await pool.getConnection()
  try {
    if (manageConn) await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, {
      table: 'return_tasks', id,
      columns: 'id, task_no, status, warehouse_id',
      entityName: '退货任务',
    })
    // 数据范围：ERP 直连取消要校验任务所属仓库；cancelSR 联动取消传 {conn} 不带 scope，
    // 因其在 returns 侧已 assertInScope，此处放行（scopeWarehouseIds 为 null 即不校验）。
    assertInScope(options.scopeWarehouseIds ?? null, taskRow.warehouse_id, '退货任务')
    if (!isValidTransition(Number(taskRow.status), RT_STATUS.CANCELLED)) {
      throw new AppError('当前状态不允许取消', 400)
    }
    // 取消关联的容器：待质检(PENDING_QA)和质检已通过但尚未上架(PENDING_PUTAWAY)的都要作废，
    // 否则后者会永久卡在 PENDING_PUTAWAY——任务变 CANCELLED 后 putaway() 要求任务状态=4 不再满足，
    // 这些容器既不计入库存也无法再被上架，货物实收但系统里永久找不到。
    await conn.query(
      `UPDATE inventory_containers SET status = 3
       WHERE source_ref_type = 'sale_return' AND source_ref_id = ? AND status IN (?, ?)`,
      [id, PENDING_QA, CONTAINER_STATUS.PENDING_PUTAWAY],
    )
    await compareAndSetStatus(conn, {
      table: 'return_tasks', id,
      fromStatus: Number(taskRow.status),
      toStatus: RT_STATUS.CANCELLED,
      entityName: '退货任务',
    })
    if (manageConn) await conn.commit()
  } catch (e) {
    if (manageConn) await conn.rollback()
    throw e
  } finally {
    if (manageConn) conn.release()
  }
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
    articleNumber: row.article_number || null,
    spec: row.spec || null,
    color: row.color || null,
    expectedQty: Number(row.expected_qty),
    receivedQty: Number(row.received_qty),
    checkedQty: Number(row.checked_qty),
    rejectedQty: Number(row.rejected_qty),
    putawayQty: Number(row.putaway_qty),
  }
}

/** 扫码查询只读校验；真正写入仍在 putaway 的事务内重新核对归属与状态。 */
async function findPutawayTask(taskId, { pdaWarehouseId = null, scopeWarehouseIds = null } = {}) {
  const [[task]] = await pool.query(
    'SELECT id, status, warehouse_id FROM return_tasks WHERE id = ? AND deleted_at IS NULL',
    [taskId],
  )
  if (!task) throw new AppError('退货任务不存在', 404)
  assertInScope(scopeWarehouseIds, task.warehouse_id, '退货任务')
  if (pdaWarehouseId == null) throw new AppError('设备尚未绑定仓库，无法扫码上架', 403)
  assertPdaWarehouse(pdaWarehouseId, task.warehouse_id)
  if (Number(task.status) !== RT_STATUS.PENDING_PUTAWAY) throw new AppError('只有待上架状态可以执行上架', 400)
  return task
}

async function findPutawayContainer(taskId, barcode, access = {}) {
  const task = await findPutawayTask(taskId, access)
  const [[container]] = await pool.query(
    'SELECT id, barcode, warehouse_id, status, source_ref_type, source_ref_id FROM inventory_containers WHERE UPPER(barcode) = UPPER(?) AND deleted_at IS NULL LIMIT 1',
    [String(barcode).trim()],
  )
  if (!container) throw new AppError('容器条码不存在', 404)
  if (container.source_ref_type !== 'sale_return' || Number(container.source_ref_id) !== Number(task.id)) {
    throw new AppError('容器不属于当前退货任务', 400)
  }
  if (Number(container.warehouse_id) !== Number(task.warehouse_id)) throw new AppError('容器和退货任务不在同一仓库', 400)
  if (Number(container.status) !== CONTAINER_STATUS.PENDING_PUTAWAY) throw new AppError('容器不是待上架状态', 400)
  return { containerId: Number(container.id), barcode: container.barcode, taskId: Number(task.id), warehouseId: Number(container.warehouse_id), status: Number(container.status) }
}

async function findPutawayLocation(taskId, barcode, access = {}) {
  const task = await findPutawayTask(taskId, access)
  const { findByCode } = require('../locations/locations.service')
  const location = await findByCode(String(barcode).trim())
  if (Number(location.warehouseId) !== Number(task.warehouse_id)) throw new AppError('库位和退货任务不在同一仓库', 400)
  return { id: Number(location.id), code: location.code, warehouseId: Number(location.warehouseId), status: Number(location.status) }
}

module.exports = {
  RT_STATUS, RT_STATUS_NAME, isValidTransition,
  findPutawayContainer, findPutawayLocation,
  findPdaTasks, findById, create, submit, submitWithinTransaction, receive, check, putaway, cancel,
}
