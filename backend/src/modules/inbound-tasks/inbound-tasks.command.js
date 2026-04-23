const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { enqueueContainerLabelJob } = require('../print-jobs/print-jobs.service')
const {
  genTaskNo,
  appendInboundEvent,
  fmtItem,
  fmtPurchasableItem,
} = require('./inbound-tasks.helpers')
const {
  distributeQtyToLines,
  ensureInboundTaskExists,
  assertTaskCanSubmit,
  assertTaskCanAudit,
  assertTaskCanReceive,
  assertTaskCanCancel,
} = require('./inbound-tasks.status')
const { findById } = require('./inbound-tasks.query')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')

async function assertPurchaseOrderOpen(conn, purchaseOrderId) {
  if (!Number.isFinite(Number(purchaseOrderId)) || Number(purchaseOrderId) <= 0) return
  const [[purchaseRow]] = await conn.query(
    'SELECT id, order_no, status FROM purchase_orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
    [purchaseOrderId],
  )
  if (!purchaseRow) throw new AppError('关联采购单不存在', 404)
  if (Number(purchaseRow.status) === 4) {
    throw new AppError(`采购单 ${purchaseRow.order_no} 已取消，不能继续收货`, 409)
  }
}

async function createFromPoId(purchaseOrderId) {
  const purchaseSvc = require('../purchase/purchase.service')
  const order = await purchaseSvc.findById(purchaseOrderId)
  assertStatusAction('purchase', 'createInboundTask', order.status)
  if (!order.items.length) throw new AppError('采购单无明细', 400)

  const [[dup]] = await pool.query(
    `SELECT id FROM inbound_tasks
     WHERE purchase_order_id = ? AND deleted_at IS NULL AND status NOT IN (4, 5) LIMIT 1`,
    [purchaseOrderId],
  )
  if (dup) throw new AppError('该采购单已有未完结的入库任务', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskNo = await genTaskNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status)
       VALUES (?,?,?,?,?,?,1)`,
      [taskNo, order.id, order.orderNo, order.supplierName, order.warehouseId, order.warehouseName],
    )
    const taskId = r.insertId
    for (const item of order.items) {
      await conn.query(
        `INSERT INTO inbound_task_items (task_id, purchase_order_id, purchase_order_no, purchase_item_id, product_id, product_code, product_name, unit, ordered_qty)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [taskId, order.id, order.orderNo, item.id, item.productId, item.productCode, item.productName, item.unit, item.quantity],
      )
    }
    await appendInboundEvent(conn, taskId, 'created', '创建收货订单', `收货订单 ${taskNo} 已创建，等待提交到 PDA`, null, {
      purchaseOrderNo: order.orderNo,
      warehouseName: order.warehouseName,
    })
    await conn.commit()
    return { taskId, taskNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function createManualTask({ supplierId, supplierName, remark, items }) {
  const supplierIdN = Number(supplierId)
  if (!Number.isFinite(supplierIdN) || supplierIdN <= 0) throw new AppError('请选择供应商', 400)
  if (!supplierName?.trim()) throw new AppError('供应商名称不能为空', 400)
  if (!Array.isArray(items) || items.length === 0) throw new AppError('请至少选择一条采购明细', 400)

  const normalized = items.map(item => ({
    purchaseItemId: Number(item.purchaseItemId),
    qty: Number(item.qty),
  }))

  if (normalized.some(item => !Number.isFinite(item.purchaseItemId) || item.purchaseItemId <= 0)) {
    throw new AppError('采购明细无效', 400)
  }
  if (normalized.some(item => !Number.isFinite(item.qty) || item.qty <= 0)) {
    throw new AppError('收货数量必须大于 0', 400)
  }

  const purchaseItemIds = [...new Set(normalized.map(item => item.purchaseItemId))]
  const placeholders = purchaseItemIds.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT
        poi.id AS purchase_item_id,
        po.id AS purchase_order_id,
        po.order_no AS purchase_order_no,
        po.supplier_id,
        po.supplier_name,
        po.warehouse_id,
        po.warehouse_name,
        poi.product_id,
        poi.product_code,
        poi.product_name,
        poi.unit,
        poi.quantity AS ordered_qty,
        COALESCE(SUM(
          CASE
            WHEN it.id IS NULL OR it.deleted_at IS NOT NULL OR it.status = 5 THEN 0
            ELSE iti.ordered_qty
          END
        ), 0) AS assigned_qty
      FROM purchase_order_items poi
      INNER JOIN purchase_orders po
        ON po.id = poi.order_id
       AND po.deleted_at IS NULL
       AND po.status = 2
      LEFT JOIN inbound_task_items iti
        ON iti.purchase_item_id = poi.id
      LEFT JOIN inbound_tasks it
        ON it.id = iti.task_id
      WHERE po.supplier_id = ?
        AND poi.id IN (${placeholders})
      GROUP BY
        poi.id, po.id, po.order_no, po.supplier_id, po.supplier_name,
        po.warehouse_id, po.warehouse_name,
        poi.product_id, poi.product_code, poi.product_name, poi.unit, poi.quantity`,
    [supplierIdN, ...purchaseItemIds],
  )

  if (rows.length !== purchaseItemIds.length) throw new AppError('存在不可用的采购明细，请刷新后重试', 400)

  const candidateMap = new Map(rows.map(row => [Number(row.purchase_item_id), fmtPurchasableItem({
    ...row,
    remaining_qty: Number(row.ordered_qty) - Number(row.assigned_qty),
  })]))

  const warehouseIds = new Set()
  const taskItems = normalized.map(item => {
    const candidate = candidateMap.get(item.purchaseItemId)
    if (!candidate) throw new AppError('存在不可用的采购明细，请刷新后重试', 400)
    if (candidate.remainingQty < item.qty) {
      throw new AppError(`${candidate.productName} 超出可建单数量，最多还能建 ${candidate.remainingQty}`, 400)
    }
    warehouseIds.add(candidate.warehouseId)
    return {
      ...candidate,
      qty: item.qty,
    }
  })

  if (warehouseIds.size !== 1) throw new AppError('同一张收货单仅支持同仓到货，请按仓库分别建单', 400)

  const warehouseId = taskItems[0].warehouseId
  const warehouseName = taskItems[0].warehouseName
  const purchaseOrders = [...new Set(taskItems.map(item => `${item.purchaseOrderId}:${item.purchaseOrderNo}`))]
  const headerPurchaseOrderId = purchaseOrders.length === 1 ? taskItems[0].purchaseOrderId : null
  const headerPurchaseOrderNo = purchaseOrders.length === 1
    ? taskItems[0].purchaseOrderNo
    : `${purchaseOrders.length} 单混合`

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskNo = await genTaskNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status, remark)
       VALUES (?,?,?,?,?,?,1,?)`,
      [taskNo, headerPurchaseOrderId, headerPurchaseOrderNo, supplierName.trim(), warehouseId, warehouseName, remark?.trim() || null],
    )
    const taskId = r.insertId

    for (const item of taskItems) {
      await conn.query(
        `INSERT INTO inbound_task_items (task_id, purchase_order_id, purchase_order_no, purchase_item_id, product_id, product_code, product_name, unit, ordered_qty)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          taskId,
          item.purchaseOrderId,
          item.purchaseOrderNo,
          item.purchaseItemId,
          item.productId,
          item.productCode,
          item.productName,
          item.unit,
          item.qty,
        ],
      )
    }

    await appendInboundEvent(conn, taskId, 'created', '创建收货订单', `收货订单 ${taskNo} 已创建，等待提交到 PDA`, null, {
      supplierName: supplierName.trim(),
      mixedPurchaseOrders: purchaseOrders.length,
      warehouseName,
    })

    await conn.commit()
    return { taskId, taskNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function submit(taskId, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, { table: 'inbound_tasks', id: taskId, entityName: '收货订单' })
    assertTaskCanSubmit(taskRow)
    await compareAndSetStatus(conn, {
      table: 'inbound_tasks',
      id: taskId,
      fromStatus: Number(taskRow.status),
      toStatus: Number(taskRow.status),
      entityName: '收货订单',
      extraSet: {
        submitted_at: new Date(),
        submitted_by: operator?.userId ?? null,
        submitted_by_name: operator?.realName ?? operator?.username ?? null,
        operator_id: operator?.userId ?? null,
        operator_name: operator?.realName ?? operator?.username ?? null,
      },
    })
    await appendInboundEvent(
      conn,
      taskId,
      'submitted_to_pda',
      '提交到PDA',
      `收货订单 ${taskRow.task_no} 已提交到 PDA，等待现场收货`,
      operator,
      null,
    )
    await conn.commit()
    return findById(taskId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function audit(taskId, { action = 'approve', remark = '' } = {}, operator) {
  const normalizedAction = String(action || 'approve').toLowerCase()
  if (!['approve', 'reject'].includes(normalizedAction)) throw new AppError('审核动作无效', 400)
  const normalizedRemark = String(remark || '').trim()
  if (normalizedAction === 'reject' && !normalizedRemark) throw new AppError('审核退回必须填写原因', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, { table: 'inbound_tasks', id: taskId, entityName: '收货订单' })
    assertTaskCanAudit(taskRow, normalizedAction)
    const auditRule = assertStatusAction('inboundTaskAudit', normalizedAction, Number(taskRow.audit_status || 0))
    const auditStatus = auditRule.to
    await conn.query(
      `UPDATE inbound_tasks
       SET audit_status = ?, audit_remark = ?, audited_at = NOW(), audited_by = ?, audited_by_name = ?
       WHERE id = ?`,
      [
        auditStatus,
        normalizedRemark || null,
        operator?.userId ?? null,
        operator?.realName ?? operator?.username ?? null,
        taskId,
      ],
    )
    await appendInboundEvent(
      conn,
      taskId,
      normalizedAction === 'approve' ? 'audit_approved' : 'audit_rejected',
      normalizedAction === 'approve' ? '审核通过' : '审核退回',
      normalizedRemark || (normalizedAction === 'approve' ? '收货订单已审核通过' : '收货订单已退回，请处理异常后重新审核'),
      operator,
      { auditStatus, remark: normalizedRemark || null },
    )
    await conn.commit()
    return findById(taskId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function receive(taskId, payload, { userId, requestKey } = {}) {
  const { productId, qty, packages: rawPackages } = payload
  const productIdN = Number(productId)
  const packages = Array.isArray(rawPackages) && rawPackages.length
    ? rawPackages
    : [{ qty }]
  const normalizedPackages = packages.map((pkg, index) => ({
    lineNo: index + 1,
    qty: Number(pkg.qty),
  }))
  const totalQty = normalizedPackages.reduce((sum, pkg) => sum + pkg.qty, 0)

  if (!Number.isFinite(productIdN) || productIdN <= 0) throw new AppError('请选择有效商品', 400)
  if (!normalizedPackages.length) throw new AppError('请至少填写一箱数量', 400)
  if (normalizedPackages.some(pkg => !Number.isFinite(pkg.qty) || pkg.qty <= 0)) throw new AppError('箱数量必须大于 0', 400)

  const conn = await pool.getConnection()
  let result = {
    containerCode: null,
    containerId: null,
    productName: '',
    qty: totalQty,
    totalQty,
    printJobId: null,
    printJobIds: [],
    containers: [],
  }
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'inbound.receive',
      userId: userId || null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const taskRow = await lockStatusRow(conn, { table: 'inbound_tasks', id: taskId, entityName: '入库任务' })
    assertTaskCanReceive(taskRow)
    await assertPurchaseOrderOpen(conn, Number(taskRow.purchase_order_id))

    if (Number(taskRow.status) === 1) {
      const receiveStartRule = assertStatusAction('inboundTask', 'receiveStart', taskRow.status)
      await compareAndSetStatus(conn, {
        table: 'inbound_tasks',
        id: taskId,
        fromStatus: receiveStartRule.from,
        toStatus: receiveStartRule.to,
        entityName: '入库任务',
      })
      await appendInboundEvent(
        conn,
        taskId,
        'receive_started',
        'PDA 开始收货',
        `现场开始收货 ${taskRow.task_no}`,
        { userId, realName: null },
        null,
      )
    }

    const [itemRowsFresh] = await conn.query(
      'SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id',
      [taskId],
    )
    if (!itemRowsFresh.length) throw new AppError('任务无明细', 400)
    const taskItems = itemRowsFresh.map(fmtItem)

    const warehouseId = Number(taskRow.warehouse_id)
    const taskNo = taskRow.task_no

    const updates = distributeQtyToLines(taskItems, productIdN, totalQty)
    for (const u of updates) {
      await conn.query(
        'UPDATE inbound_task_items SET received_qty = received_qty + ? WHERE id = ?',
        [u.add, u.itemId],
      )
      const ti = taskItems.find(x => x.id === u.itemId)
      if (ti) ti.receivedQty += u.add
    }

    const line = taskItems.find(i => i.productId === productIdN)
    const unit = line?.unit || null
    const productName = line?.productName || ''
    const itemCount = normalizedPackages.length

    const containers = []
    for (const pkg of normalizedPackages) {
      const { containerId, barcode } = await createContainer(conn, {
        productId: productIdN,
        warehouseId,
        initialQty: pkg.qty,
        unit,
        locationId: null,
        inboundTaskId: taskId,
        containerStatus: CONTAINER_STATUS.PENDING_PUTAWAY,
        sourceType: SOURCE_TYPE.INBOUND_TASK,
        sourceRefId: taskId,
        sourceRefType: 'inbound_task',
        sourceRefNo: taskNo,
        remark: `收货待上架 ${taskNo} 第${pkg.lineNo}箱`,
      })
      containers.push({
        containerId,
        containerCode: barcode,
        qty: pkg.qty,
      })
    }

    await appendInboundEvent(
      conn,
      taskId,
      'receive_recorded',
      '收货登记',
      `${productName} 已登记 ${itemCount} 箱，共 ${totalQty}${unit ? ` ${unit}` : ''}`,
      { userId, realName: null },
      {
        productId: productIdN,
        productName,
        totalQty,
        packages: normalizedPackages.length,
      },
    )

    const [updatedItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
    const allReceived = updatedItems.every(i => Number(i.received_qty) >= Number(i.ordered_qty))
    if (allReceived) {
      const receiveCompleteRule = assertStatusAction('inboundTask', 'receiveComplete', Number(taskRow.status) === 1 ? 2 : taskRow.status)
      await compareAndSetStatus(conn, {
        table: 'inbound_tasks',
        id: taskId,
        fromStatus: receiveCompleteRule.from,
        toStatus: receiveCompleteRule.to,
        entityName: '入库任务',
      })
    }

    await conn.query('UPDATE inbound_tasks SET lock_version = lock_version + 1 WHERE id = ?', [taskId])
    result = {
      containerCode: containers[0]?.containerCode ?? null,
      containerId: containers[0]?.containerId ?? null,
      productName,
      qty: totalQty,
      totalQty,
      warehouseId,
      printJobId: null,
      printJobIds: [],
      containers,
    }
    for (const container of containers) {
      const job = await enqueueContainerLabelJob({
        conn,
        type: 'container_label',
        containerId: container.containerId,
        warehouseId,
        data: {
          container_code: container.containerCode,
          product_name: productName,
          qty: container.qty,
        },
        createdBy: userId ?? null,
        jobUniqueKey: `inbound_receive:${taskId}:container:${container.containerId}`,
      })
      if (!job?.id) {
        throw new AppError(`容器 ${container.containerCode} 的打印任务创建失败`, 500)
      }
      result.printJobIds.push(Number(job.id))
    }
    result.printJobId = result.printJobIds[0] ?? null
    if (result.printJobIds.length > 0) {
      await appendInboundEvent(
        conn,
        taskId,
        'print_queued',
        '打印提交',
        `${productName} 已提交 ${result.printJobIds.length} 条库存条码打印任务`,
        { userId, realName: null },
        {
          printJobIds: result.printJobIds,
          containerCodes: containers.map(item => item.containerCode),
        },
      )
    }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '收货成功',
      resourceType: 'inbound_task',
      resourceId: taskId,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  return result
}

async function reprint(taskId, { mode = 'task', itemId = null, barcode = null } = {}, operator = null) {
  const normalizedMode = String(mode || 'task').trim().toLowerCase()
  if (!['task', 'item', 'barcode'].includes(normalizedMode)) throw new AppError('补打模式无效', 400)

  const conn = await pool.getConnection()
  try {
    const taskRow = await ensureInboundTaskExists(conn, taskId)

    let containers = []
    let title = '发起补打'
    let description = ''
    let payload = null

    if (normalizedMode === 'task') {
      const [rows] = await conn.query(
        `SELECT id, barcode, remaining_qty, warehouse_id, product_name
         FROM inventory_containers
         WHERE inbound_task_id = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         ORDER BY id ASC`,
        [taskId],
      )
      containers = rows
      title = '整单补打'
      description = `收货订单 ${taskRow.task_no} 发起整单补打`
      payload = { mode: 'task' }
    } else if (normalizedMode === 'item') {
      const [[item]] = await conn.query(
        `SELECT id, product_id, product_name
         FROM inbound_task_items
         WHERE id = ? AND task_id = ?`,
        [itemId, taskId],
      )
      if (!item) throw new AppError('收货明细不存在', 404)
      const [rows] = await conn.query(
        `SELECT id, barcode, remaining_qty, warehouse_id, product_name
         FROM inventory_containers
         WHERE inbound_task_id = ? AND product_id = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         ORDER BY id ASC`,
        [taskId, item.product_id],
      )
      containers = rows
      title = '明细补打'
      description = `收货订单 ${taskRow.task_no} 对商品 ${item.product_name} 发起补打`
      payload = { mode: 'item', itemId: Number(item.id), productId: Number(item.product_id) }
    } else {
      const code = String(barcode || '').trim()
      if (!code) throw new AppError('库存条码不能为空', 400)
      const [rows] = await conn.query(
        `SELECT id, barcode, remaining_qty, warehouse_id, product_name
         FROM inventory_containers
         WHERE inbound_task_id = ? AND barcode = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         LIMIT 1`,
        [taskId, code],
      )
      containers = rows
      title = '条码补打'
      description = `收货订单 ${taskRow.task_no} 对库存条码 ${code} 发起补打`
      payload = { mode: 'barcode', barcode: code }
    }

    if (!containers.length) throw new AppError('没有可补打的库存条码', 400)

    const jobs = []
    for (const container of containers) {
      const job = await enqueueContainerLabelJob({
        containerId: Number(container.id),
        warehouseId: container.warehouse_id != null ? Number(container.warehouse_id) : null,
        data: {
          container_code: container.barcode,
          product_name: container.product_name,
          qty: container.remaining_qty,
        },
        createdBy: operator?.userId ?? null,
        jobUniqueKey: `reprint_inbound:${taskId}:${normalizedMode}:${container.id}:${Date.now()}`,
      })
      if (job) jobs.push(job)
    }

    await appendInboundEvent(
      pool,
      taskId,
      'print_requeued',
      title,
      `${description}，共 ${jobs.length} 条`,
      operator,
      { ...payload, jobIds: jobs.map(job => Number(job.id)) },
    )
    return {
      taskId: Number(taskId),
      mode: normalizedMode,
      count: jobs.length,
      jobIds: jobs.map(job => Number(job.id)),
      barcodes: containers.map(item => item.barcode),
    }
  } finally {
    conn.release()
  }
}

async function cancel(taskId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, { table: 'inbound_tasks', id: taskId, entityName: '收货订单' })
    assertTaskCanCancel(taskRow)
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL',
      [taskId],
    )
    if (Number(n) > 0) throw new AppError('任务已产生容器，无法取消', 400)
    const cancelRule = assertStatusAction('inboundTask', 'cancel', taskRow.status)
    await compareAndSetStatus(conn, {
      table: 'inbound_tasks',
      id: taskId,
      fromStatus: cancelRule.from,
      toStatus: cancelRule.to,
      entityName: '收货订单',
    })
    await appendInboundEvent(
      conn,
      taskId,
      'cancelled',
      '取消收货订单',
      `收货订单 ${taskRow.task_no} 已取消`,
      null,
      null,
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  createFromPoId,
  createManualTask,
  submit,
  audit,
  receive,
  reprint,
  cancel,
}
