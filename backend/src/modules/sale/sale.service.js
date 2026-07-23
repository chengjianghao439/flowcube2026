const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { reserve, releaseByRef } = require('../../engine/reservationEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { SALE_STATUS_NAME } = require('../../constants/saleOrderStatus')
const { WT_STATUS_NAME, WT_STATUS_ACTIVE } = require('../../constants/warehouseTaskStatus')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const adjustSvc = require('../warehouse-tasks/warehouse-tasks.adjust')
const { WT_EVENT, record: recordWtEvent } = require('../warehouse-tasks/warehouse-task-events.service')

const FREIGHT_TYPE = { 1:'寄付', 2:'到付', 3:'第三方付' }
const fmt = row => ({
  id:row.id, orderNo:row.order_no,
  customerId:row.customer_id, customerName:row.customer_name,
  warehouseId:row.warehouse_id, warehouseName:row.warehouse_name,
  status:row.status, statusName:SALE_STATUS_NAME[row.status],
  saleDate:row.sale_date, totalAmount:Number(row.total_amount), remark:row.remark,
  taskId:row.warehouse_task_id||row.task_id||null,
  taskNo:row.warehouse_task_no||row.task_no||null,
  warehouseTaskStatus: row.warehouse_task_status != null ? Number(row.warehouse_task_status) : null,
  warehouseTaskStatusName: row.warehouse_task_status != null
    ? (WT_STATUS_NAME[Number(row.warehouse_task_status)] || null)
    : null,
  warehouseTaskCancelRequestedAt: row.warehouse_task_cancel_requested_at || null,
  warehouseTaskAdjustmentRequestedAt: row.warehouse_task_adjustment_requested_at || null,
  carrierId:row.carrier_id||null,
  carrier: row.carrier_name || row.carrier || null,   // 优先承运商表名称，回退文本字段
  freightType:row.freight_type||null,
  freightTypeName:row.freight_type ? (FREIGHT_TYPE[row.freight_type]||null) : null,
  receiverName:row.receiver_name||null, receiverPhone:row.receiver_phone||null,
  receiverAddress:row.receiver_address||null,
  operatorId:row.operator_id, operatorName:row.operator_name, createdAt:row.created_at,
})

// 一个销售单终生最多对应一个仓库任务：ship() 用 sale_orders.task_id 是否已置位来防止重复创建
// （见 ship() 里 `if (orderRow.task_id) throw ...`），且 createForSaleOrder 是唯一会写
// warehouse_tasks.sale_order_id 的地方、只被 ship() 调用一次。所以直接按 so.task_id 主键点查
// 即可拿到对应仓库任务，不需要再对整张 warehouse_tasks 表做 MAX(id) GROUP BY 聚合。
const latestWarehouseTaskJoin = `
  LEFT JOIN warehouse_tasks wt_by_id ON wt_by_id.id = so.task_id AND wt_by_id.deleted_at IS NULL
`

const warehouseTaskProjection = `
  wt_by_id.id AS warehouse_task_id,
  wt_by_id.task_no AS warehouse_task_no,
  wt_by_id.status AS warehouse_task_status,
  wt_by_id.cancel_requested_at AS warehouse_task_cancel_requested_at,
  wt_by_id.adjustment_requested_at AS warehouse_task_adjustment_requested_at
`

const genOrderNo = conn => generateDailyCode(conn, 'SO', 'sale_orders', 'order_no')

async function appendSaleEvent(conn, saleOrderId, eventType, title, description, operator = null, payload = null) {
  await conn.query(
    `INSERT INTO sale_order_events (sale_order_id,event_type,title,description,payload_json,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?)`,
    [
      saleOrderId,
      eventType,
      title,
      description || null,
      payload ? JSON.stringify(payload) : null,
      operator?.userId || null,
      operator?.realName || null,
    ],
  )
}

async function buildPricingEvents(conn, saleOrderId, items, operator) {
  for (const item of items) {
    const costPrice = Number(item.costPrice ?? 0)
    const resolvedPrice = item.resolvedPrice != null ? Number(item.resolvedPrice) : null
    const unitPrice = Number(item.unitPrice || 0)
    if (item.priceSource === 'manual') {
      const parts = [`${item.productName} 单价手工改为 ¥${unitPrice.toFixed(2)}`]
      if (resolvedPrice != null) parts.push(`等级价参考 ¥${resolvedPrice.toFixed(2)}`)
      await appendSaleEvent(conn, saleOrderId, 'pricing_override', '手工改价', parts.join('，'), operator, {
        productId: item.productId,
        productName: item.productName,
        unitPrice,
        resolvedPrice,
        resolvedPriceLevel: item.resolvedPriceLevel || null,
      })
    }
    if (costPrice > 0 && unitPrice < costPrice) {
      await appendSaleEvent(
        conn,
        saleOrderId,
        'below_cost',
        '低于进价销售预警',
        `${item.productName} 销售价 ¥${unitPrice.toFixed(2)} 低于当前进价 ¥${costPrice.toFixed(2)}`,
        operator,
        { productId: item.productId, productName: item.productName, unitPrice, costPrice },
      )
    }
  }
}

async function syncPickingByWarehouseTaskWithinTransaction(conn, id, { taskId = null, taskNo = null } = {}) {
  const orderRow = await lockStatusRow(conn, {
    table: 'sale_orders',
    id,
    columns: 'id, order_no, status, task_id, task_no',
    entityName: '销售单',
  })
  if (Number(orderRow.status) === 3) return fmt(orderRow)
  const rule = assertStatusAction('sale', 'ship', orderRow.status)
  await compareAndSetStatus(conn, {
    table: 'sale_orders',
    id,
    fromStatus: rule.from,
    toStatus: rule.to,
    entityName: '销售单',
    extraSet: {
      ...(taskId ? { task_id: Number(taskId) } : {}),
      ...(taskNo ? { task_no: String(taskNo) } : {}),
    },
  })
  await appendSaleEvent(
    conn,
    id,
    'warehouse_ready_to_sort',
    '拣货完成',
    `销售单 ${orderRow.order_no} 已进入待分拣阶段`,
    null,
    { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
  )
  return {
    ...fmt(orderRow),
    status: rule.to,
    statusName: SALE_STATUS_NAME[rule.to],
    taskId: taskId != null ? Number(taskId) : (orderRow.task_id || null),
    taskNo: taskNo || orderRow.task_no || null,
  }
}

async function syncShippedByWarehouseTaskWithinTransaction(conn, id, { taskId = null, taskNo = null } = {}) {
  const orderRow = await lockStatusRow(conn, {
    table: 'sale_orders',
    id,
    columns: 'id, order_no, status, task_id, task_no',
    entityName: '销售单',
  })
  const rule = assertStatusAction('sale', 'completeShip', orderRow.status)
  await compareAndSetStatus(conn, {
    table: 'sale_orders',
    id,
    fromStatus: rule.from,
    toStatus: rule.to,
    entityName: '销售单',
  })
  await appendSaleEvent(
    conn,
    id,
    'warehouse_shipped',
    '已完成出库',
    `销售单 ${orderRow.order_no} 已完成出库`,
    null,
    { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
  )
  return {
    ...fmt(orderRow),
    status: rule.to,
    statusName: SALE_STATUS_NAME[rule.to],
  }
}

async function syncCancelledByWarehouseTaskWithinTransaction(conn, id, { taskId = null, taskNo = null } = {}) {
  const orderRow = await lockStatusRow(conn, {
    table: 'sale_orders',
    id,
    columns: 'id, order_no, status',
    entityName: '销售单',
  })
  if (Number(orderRow.status) === 5) return fmt(orderRow)
  const rule = assertStatusAction('sale', 'cancel', orderRow.status)
  await compareAndSetStatus(conn, {
    table: 'sale_orders',
    id,
    fromStatus: rule.from,
    toStatus: rule.to,
    entityName: '销售单',
  })
  await appendSaleEvent(
    conn,
    id,
    'warehouse_task_cancelled',
    '仓库任务已取消',
    `销售单 ${orderRow.order_no} 对应的仓库任务已取消`,
    null,
    { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
  )
  return {
    ...fmt(orderRow),
    status: rule.to,
    statusName: SALE_STATUS_NAME[rule.to],
  }
}

function mapTimeline(rows, order) {
  const base = rows.some(r => r.event_type === 'created') ? [] : [{
    id: `created-${order.id}`,
    eventType: 'created',
    title: '创建订单',
    description: `销售单 ${order.orderNo} 已创建`,
    createdBy: order.operatorId,
    createdByName: order.operatorName,
    createdAt: order.createdAt,
    payload: null,
  }]
  const mapped = rows.map(r => ({
    id: r.id,
    eventType: r.event_type,
    title: r.title,
    description: r.description,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    payload: r.payload_json
      ? (typeof r.payload_json === 'string'
        ? (() => { try { return JSON.parse(r.payload_json) } catch { return null } })()
        : r.payload_json)
      : null,
  }))
  return [...base, ...mapped].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

async function findAll({ page=1, pageSize=20, keyword='', status=null, productId=null, customerId=null, warehouseId=null, startDate=null, endDate=null, remark=null, operatorId=null }) {
  const offset=(page-1)*pageSize
  const params=[]
  const countParams=[]
  let cond=''
  let countCond=''
  if (keyword) {
    const like = `%${keyword}%`
    cond += ' AND (so.order_no LIKE ? OR so.customer_name LIKE ?)'
    countCond += ' AND (order_no LIKE ? OR customer_name LIKE ?)'
    params.push(like, like)
    countParams.push(like, like)
  }
  if (status) {
    cond += ' AND so.status=?'
    countCond += ' AND status=?'
    params.push(status)
    countParams.push(status)
  }
  if (productId) {
    cond += ' AND EXISTS (SELECT 1 FROM sale_order_items soi WHERE soi.order_id = so.id AND soi.product_id = ?)'
    countCond += ' AND EXISTS (SELECT 1 FROM sale_order_items soi WHERE soi.order_id = sale_orders.id AND soi.product_id = ?)'
    params.push(productId)
    countParams.push(productId)
  }
  if (customerId) {
    cond += ' AND so.customer_id=?'
    countCond += ' AND customer_id=?'
    params.push(customerId)
    countParams.push(customerId)
  }
  if (warehouseId) {
    cond += ' AND so.warehouse_id=?'
    countCond += ' AND warehouse_id=?'
    params.push(warehouseId)
    countParams.push(warehouseId)
  }
  if (startDate) {
    cond += ' AND DATE(so.created_at)>=?'
    countCond += ' AND DATE(created_at)>=?'
    params.push(startDate)
    countParams.push(startDate)
  }
  if (endDate) {
    cond += ' AND DATE(so.created_at)<=?'
    countCond += ' AND DATE(created_at)<=?'
    params.push(endDate)
    countParams.push(endDate)
  }
  if (remark) {
    cond += ' AND so.remark LIKE ?'
    countCond += ' AND remark LIKE ?'
    params.push(`%${remark}%`)
    countParams.push(`%${remark}%`)
  }
  if (operatorId) {
    cond += ' AND so.operator_id=?'
    countCond += ' AND operator_id=?'
    params.push(operatorId)
    countParams.push(operatorId)
  }
  const [rows] = await pool.query(
    `SELECT so.*, ${warehouseTaskProjection}
     FROM sale_orders so
     ${latestWarehouseTaskJoin}
     WHERE so.deleted_at IS NULL ${cond}
     ORDER BY so.created_at DESC LIMIT ? OFFSET ?`,
    [...params,pageSize,offset],
  )
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_orders WHERE deleted_at IS NULL ${countCond}`,countParams)
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT so.*, c.name AS carrier_name, ${warehouseTaskProjection}
     FROM sale_orders so
     LEFT JOIN carriers c ON c.id = so.carrier_id AND c.deleted_at IS NULL
     ${latestWarehouseTaskJoin}
     WHERE so.id=? AND so.deleted_at IS NULL`,
    [id]
  )
  if(!rows[0]) throw new AppError('销售单不存在',404)
  const order = fmt(rows[0])
  const [items] = await pool.query(
    `SELECT soi.*, p.cost_price
     FROM sale_order_items soi
     LEFT JOIN product_items p ON p.id = soi.product_id
     WHERE soi.order_id=?`,
    [id],
  )
  // 查询扫描记录
  let scans = []
  if (order.taskId) {
    const [scanRows] = await pool.query(
      `SELECT item_id, product_id, barcode, qty, operator_name, scanned_at
       FROM scan_logs WHERE task_id=? ORDER BY scanned_at ASC`,
      [order.taskId],
    )
    scans = scanRows
  }
  order.items = items.map(r=>({
    id:r.id,
    productId:r.product_id,
    productCode:r.product_code,
    productName:r.product_name,
    articleNumber:r.article_number||null,
    spec:r.spec||null,
    color:r.color||null,
    unit:r.unit,
    quantity:Number(r.quantity),
    unitPrice:Number(r.unit_price),
    amount:Number(r.amount),
    remark:r.remark,
    costPrice: r.cost_price != null ? Number(r.cost_price) : null,
    belowCost: r.cost_price != null ? Number(r.unit_price) < Number(r.cost_price) : false,
    scans: scans
      .filter(s => s.product_id === r.product_id)
      .map(s => ({
        barcode: s.barcode,
        qty: Number(s.qty),
        operatorName: s.operator_name,
        scannedAt: s.scanned_at,
      })),
  }))
  // 装箱数据
  let packages = []
  if (order.taskId) {
    const [pkgRows] = await pool.query(
      `SELECT id, barcode, status FROM packages WHERE warehouse_task_id=? AND status != 3 ORDER BY id`,
      [order.taskId],
    )
    if (pkgRows.length > 0) {
      const pkgIds = pkgRows.map(p => p.id)
      const [itemRows] = await pool.query(
        `SELECT pi.package_id, pi.product_code, pi.product_name, pi.unit, pi.qty, pi.created_at,
                pi.article_number, pi.spec, pi.color
         FROM package_items pi
         WHERE pi.package_id IN (?) ORDER BY pi.id`,
        [pkgIds],
      )
      packages = pkgRows.map(p => ({
        id: p.id,
        barcode: p.barcode,
        status: p.status,
        items: itemRows.filter(i => i.package_id === p.id).map(i => ({
          productCode: i.product_code,
          productName: i.product_name,
          articleNumber: i.article_number || null,
          spec: i.spec || null,
          color: i.color || null,
          unit: i.unit,
          packedAt: i.created_at,
          qty: Number(i.qty),
        })),
      }))
    }
  }
  order.packages = packages
  const [events] = await pool.query(
    `SELECT id,event_type,title,description,payload_json,created_by,created_by_name,created_at
     FROM sale_order_events WHERE sale_order_id=? ORDER BY created_at DESC, id DESC`,
    [id],
  )
  order.timeline = mapTimeline(events, order)
  return order
}

async function create({ customerId, customerName, warehouseId, warehouseName, remark,
  carrierId, carrier, freightType, receiverName, receiverPhone, receiverAddress, items, operator, requestKey }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'sale.create',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }
    // 前端选择器已过滤停用客户，这里补一道后端校验，防止绕过前端直接调 API 建单（禁用客户未在下单流程过滤）
    const [[customerRow]] = await conn.query(
      'SELECT is_active FROM sale_customers WHERE id = ? AND deleted_at IS NULL',
      [customerId],
    )
    if (!customerRow) throw new AppError('客户不存在', 404)
    if (!customerRow.is_active) throw new AppError('该客户已停用，无法新建销售单', 400)
    const orderNo = await genOrderNo(conn)
    const total = items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r] = await conn.query(
      `INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,sale_date,total_amount,remark,carrier_id,carrier,freight_type,receiver_name,receiver_phone,receiver_address,operator_id,operator_name) VALUES (?,?,?,?,?,CURDATE(),?,?,?,?,?,?,?,?,?,?)`,
      [orderNo,customerId,customerName,warehouseId,warehouseName,total,remark||null,carrierId||null,carrier||null,freightType||null,receiverName||null,receiverPhone||null,receiverAddress||null,operator.userId,operator.realName]
    )
    const orderId = r.insertId
    for(const item of items) {
      await conn.query(`INSERT INTO sale_order_items (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[orderId,item.productId,item.productCode,item.productName,item.unit,item.articleNumber||null,item.spec||null,item.color||null,item.quantity,item.unitPrice,item.quantity*item.unitPrice,item.remark||null])
    }
    await appendSaleEvent(conn, orderId, 'created', '创建订单', `共 ${items.length} 条明细`, operator)
    await buildPricingEvents(conn, orderId, items, operator)
    const result = { id:orderId, orderNo }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '创建成功',
      resourceType: 'sale_order',
      resourceId: orderId,
    })
    await conn.commit()
    return result
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

// 编辑草稿：仅在 status=1（草稿）时允许，整体替换明细行
async function update(id, { customerId, customerName, warehouseId, warehouseName, remark,
  carrierId, carrier, freightType, receiverName, receiverPhone, receiverAddress, items, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, columns: 'id, status', entityName: '销售单' })
    assertStatusAction('sale', 'edit', orderRow.status)
    if (!items || !items.length) throw new AppError('至少需要一条商品明细', 400)
    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    await conn.query(
      `UPDATE sale_orders SET customer_id=?,customer_name=?,warehouse_id=?,warehouse_name=?,total_amount=?,remark=?,carrier_id=?,carrier=?,freight_type=?,receiver_name=?,receiver_phone=?,receiver_address=? WHERE id=?`,
      [customerId, customerName, warehouseId, warehouseName, total, remark||null, carrierId||null, carrier||null, freightType||null, receiverName||null, receiverPhone||null, receiverAddress||null, id]
    )
    await conn.query('DELETE FROM sale_order_items WHERE order_id=?', [id])
    for (const item of items) {
      await conn.query(
        `INSERT INTO sale_order_items (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, item.productId, item.productCode, item.productName, item.unit, item.articleNumber||null, item.spec||null, item.color||null, item.quantity, item.unitPrice, item.quantity*item.unitPrice, item.remark||null]
      )
    }
    await appendSaleEvent(conn, id, 'updated', '编辑订单', `现有 ${items.length} 条明细`, operator)
    await buildPricingEvents(conn, id, items, operator)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 执行期改单：已占库/拣货中（对应仓库任务在活跃阶段）均可修改明细——增减数量、
// 新增/删除商品行。按 product_id 聚合新旧明细算出净变化，逐 product 委托
// warehouse-tasks.adjust.js 分层处理（增量直接生效补拣；减量视命中深度决定是否需要
// PDA 物理确认）。sale_order_items 本身仍是整表删除重建（同 update() 的模式），
// 因为这是唯一用户可见的"行"，WMS 侧只认按商品聚合后的净数量，详见方案说明。
async function requestAdjustment(id, { items, operator, requestKey }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'sale.adjust',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const orderRow = await lockStatusRow(conn, {
      table: 'sale_orders', id,
      columns: 'id, order_no, status, task_id, task_no, warehouse_id, warehouse_name',
      entityName: '销售单',
    })
    assertStatusAction('sale', 'adjust', orderRow.status)
    if (!orderRow.task_id) throw new AppError('销售单尚未发起出库，没有关联的仓库任务', 400)

    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks', id: orderRow.task_id,
      columns: 'id, task_no, status, cancel_requested_at, adjustment_requested_at',
      entityName: '仓库任务',
    })
    if (taskRow.cancel_requested_at) throw new AppError('该任务正在取消收尾中，暂不能改单', 409)
    if (taskRow.adjustment_requested_at) throw new AppError('该任务已有改单在等待仓库确认，请先处理完成', 409)
    if (!WT_STATUS_ACTIVE.includes(Number(taskRow.status))) {
      throw new AppError('当前仓库任务状态不支持改单', 400)
    }

    if (!items || !items.length) throw new AppError('至少需要一条商品明细', 400)

    const [oldItemRows] = await conn.query('SELECT product_id, quantity FROM sale_order_items WHERE order_id=?', [id])
    const oldQtyByProduct = new Map()
    for (const r of oldItemRows) {
      const pid = Number(r.product_id)
      oldQtyByProduct.set(pid, (oldQtyByProduct.get(pid) || 0) + Number(r.quantity))
    }
    const newQtyByProduct = new Map()
    const productMeta = new Map()
    for (const item of items) {
      const pid = Number(item.productId)
      newQtyByProduct.set(pid, (newQtyByProduct.get(pid) || 0) + Number(item.quantity))
      if (!productMeta.has(pid)) {
        productMeta.set(pid, {
          productCode: item.productCode, productName: item.productName, unit: item.unit,
          articleNumber: item.articleNumber || null, spec: item.spec || null, color: item.color || null,
        })
      }
    }

    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    await conn.query('UPDATE sale_orders SET total_amount=? WHERE id=?', [total, id])
    await conn.query('DELETE FROM sale_order_items WHERE order_id=?', [id])
    for (const item of items) {
      await conn.query(
        `INSERT INTO sale_order_items (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, item.productId, item.productCode, item.productName, item.unit, item.articleNumber||null, item.spec||null, item.color||null, item.quantity, item.unitPrice, item.quantity*item.unitPrice, item.remark||null]
      )
    }

    const allProductIds = new Set([...oldQtyByProduct.keys(), ...newQtyByProduct.keys()])
    const descriptors = []
    for (const pid of allProductIds) {
      const oldQty = oldQtyByProduct.get(pid) || 0
      const newQty = newQtyByProduct.get(pid) || 0
      if (Math.abs(newQty - oldQty) < 1e-6) continue
      let meta = productMeta.get(pid)
      if (!meta) {
        const [[ti]] = await conn.query(
          'SELECT product_code, product_name, unit FROM warehouse_task_items WHERE task_id=? AND product_id=?',
          [orderRow.task_id, pid],
        )
        meta = ti
          ? { productCode: ti.product_code, productName: ti.product_name, unit: ti.unit }
          : { productCode: '', productName: `商品#${pid}`, unit: '' }
      }
      const descriptor = await adjustSvc.applyProductDeltaWithinTransaction(conn, {
        taskId: Number(orderRow.task_id),
        warehouseId: Number(orderRow.warehouse_id),
        saleOrderId: id,
        saleOrderNo: orderRow.order_no,
        productId: pid,
        productCode: meta.productCode,
        productName: meta.productName,
        unit: meta.unit,
        articleNumber: meta.articleNumber || null,
        spec: meta.spec || null,
        color: meta.color || null,
        oldRequiredQty: oldQty,
        newRequiredQty: newQty,
      })
      if (descriptor) descriptors.push(descriptor)
    }

    if (!descriptors.length) {
      await appendSaleEvent(conn, id, 'adjusted', '修改明细', '本次修改未涉及数量变化', operator)
      const result = { adjustmentId: null, adjustmentNo: null, pending: false }
      await completeOperationRequest(conn, requestState, {
        data: result, message: '修改成功', resourceType: 'sale_order', resourceId: id,
      })
      await conn.commit()
      return result
    }

    await adjustSvc.finalizeTaskStatusAfterAdjustment(conn, {
      taskId: Number(orderRow.task_id), taskNo: orderRow.task_no, descriptors,
    })

    const needsPending = descriptors.some(d => d.pendingReturnQty > 0 || d.packageVoids.length || d.containerReturns.length)
    let adjustmentId = null
    let adjustmentNo = null
    if (needsPending) {
      adjustmentNo = await generateDailyCode(conn, 'ADJ', 'sale_order_adjustments', 'adjustment_no')
      const [adjRes] = await conn.query(
        `INSERT INTO sale_order_adjustments (sale_order_id, warehouse_task_id, adjustment_no, status, requested_by, requested_by_name)
         VALUES (?,?,?,1,?,?)`,
        [id, orderRow.task_id, adjustmentNo, operator?.userId ?? null, operator?.realName ?? null],
      )
      adjustmentId = adjRes.insertId
      for (const d of descriptors) {
        const hasPending = d.pendingReturnQty > 0 || d.packageVoids.length > 0 || d.containerReturns.length > 0
        const [itemRes] = await conn.query(
          `INSERT INTO sale_order_adjustment_items
             (adjustment_id, product_id, product_code, product_name, old_required_qty, new_required_qty, pending_return_qty, pending_pick_qty, status)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [adjustmentId, d.productId, d.productCode, d.productName, d.oldRequiredQty, d.newRequiredQty,
            d.pendingReturnQty, d.pendingPickQty, hasPending ? 1 : 3],
        )
        const itemId = itemRes.insertId
        for (const v of d.packageVoids) {
          await conn.query(
            `INSERT INTO sale_order_adjustment_package_voids (adjustment_item_id, package_id, barcode, other_products_snapshot)
             VALUES (?,?,?,?)`,
            [itemId, v.packageId, v.barcode, JSON.stringify(v.otherProducts || [])],
          )
        }
        for (const c of d.containerReturns) {
          await conn.query(
            `INSERT INTO sale_order_adjustment_container_returns (adjustment_item_id, source_container_id, original_container_id, qty)
             VALUES (?,?,?,?)`,
            [itemId, c.containerId, c.originalContainerId ?? c.containerId, c.qty],
          )
        }
      }
      await conn.query('UPDATE warehouse_tasks SET adjustment_requested_at=NOW() WHERE id=?', [orderRow.task_id])
      try {
        await recordWtEvent(conn, {
          taskId: Number(orderRow.task_id), taskNo: orderRow.task_no,
          eventType: WT_EVENT.ADJUSTMENT_REQUESTED,
          operatorId: operator?.userId ?? null, operatorName: operator?.realName ?? null,
          detail: { adjustmentId, adjustmentNo, saleOrderId: id, productCount: descriptors.length },
        })
      } catch (eventErr) {
        // 事件写入失败不阻断主流程，仅记录降级日志（与仓库任务模块内其它事件写入保持一致口径）
        require('../warehouse-tasks/warehouse-tasks.helpers').logSideEffectFailure(
          '仓库任务事件写入失败：改单发起事件', eventErr, { taskId: orderRow.task_id, adjustmentId },
        )
      }
    }

    await appendSaleEvent(
      conn, id, 'adjusted', '修改明细',
      needsPending
        ? `已提交改单 ${adjustmentNo}，等待仓库确认后生效`
        : '已修改明细，变更已直接生效',
      operator,
      { adjustmentId, adjustmentNo, productCount: descriptors.length, pending: needsPending },
    )

    const result = { adjustmentId, adjustmentNo, pending: needsPending }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: needsPending ? '改单已提交，等待仓库确认' : '修改成功',
      resourceType: 'sale_order',
      resourceId: id,
    })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ① 占用库存：仅调用 reservationEngine.reserve()，不创建仓库任务
async function reserveStock(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const rule = assertStatusAction('sale', 'reserve', orderRow.status)
    const [itemRows] = await conn.query('SELECT * FROM sale_order_items WHERE order_id = ? ORDER BY id', [id])
    if (!itemRows.length) throw new AppError('销售单无明细，无法占用库存', 400)
    for (const item of itemRows) {
      await reserve(conn, {
        productId:   item.product_id,
        productName: item.product_name,
        warehouseId: Number(orderRow.warehouse_id),
        qty:         Number(item.quantity),
        refType:     'sale_order',
        refId:       Number(orderRow.id),
        refNo:       orderRow.order_no,
      })
    }
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(conn, id, 'reserved', '确认占库', `已预占库存`, operator)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ② 发起出库：仅创建仓库任务，不扣减库存，订单进入拣货中（status=3）
async function ship(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const rule = assertStatusAction('sale', 'ship', orderRow.status)
    if (orderRow.task_id) throw new AppError(`已存在仓库任务（${orderRow.task_no}），请勿重复操作`, 409)

    const [itemRows] = await conn.query('SELECT * FROM sale_order_items WHERE order_id = ? ORDER BY id', [id])
    if (!itemRows.length) throw new AppError('销售单无明细', 400)
    const items = itemRows.map(r => ({
      id: r.id,
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      unit: r.unit,
      articleNumber: r.article_number || null,
      spec: r.spec || null,
      color: r.color || null,
      quantity: Number(r.quantity),
    }))

    const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
    const { taskId, taskNo } = await taskSvc.createForSaleOrder({
      saleOrderId:   Number(orderRow.id),
      saleOrderNo:   orderRow.order_no,
      customerId:    Number(orderRow.customer_id),
      customerName:  orderRow.customer_name,
      warehouseId:   Number(orderRow.warehouse_id),
      warehouseName: orderRow.warehouse_name,
      items,
      conn,
    })
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
      extraSet: {
        task_id: taskId,
        task_no: taskNo,
      },
    })
    await appendSaleEvent(conn, id, 'ship_requested', '发起出库', `已创建仓库任务，等待拣货`, operator, { taskId, taskNo })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消占库：RESERVED(2) → DRAFT(1)，释放预占
async function releaseStock(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const rule = assertStatusAction('sale', 'release', orderRow.status)
    await releaseByRef(conn, 'sale_order', id)
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(conn, id, 'released', '取消占库', `销售单 ${orderRow.order_no} 已取消占库并恢复草稿`, operator)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消订单：仅 DRAFT(1) → CANCELLED(5)
async function cancel(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'sale_orders', id, entityName: '销售单' })
    const rule = assertStatusAction('sale', 'cancel', orderRow.status)

    if (Number(orderRow.status) === 2) {
      await releaseByRef(conn, 'sale_order', id)
    }

    if (Number(orderRow.status) === 3) {
      if (!orderRow.task_id) {
        throw new AppError('销售单处于拣货中但未关联仓库任务，请先排查异常', 409)
      }
      const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
      // taskSvc.cancel 内部已经会释放该销售单的库存预占，这里不用再调一次 releaseByRef
      await taskSvc.cancel(orderRow.task_id, { conn, syncSaleStatus: false, operator })
    }

    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(conn, id, 'cancelled', '取消订单', `销售单已取消`, operator)
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// 删除订单：仅 CANCELLED(5) 可删
async function deleteOrder(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 在事务内读取并锁定订单行，防止并发状态变更
    const [[order]] = await conn.query(
      'SELECT id, status, order_no FROM sale_orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [id],
    )
    if (!order) throw new AppError('订单不存在', 404)
    assertStatusAction('sale', 'delete', order.status)
    await conn.query('UPDATE sale_orders SET deleted_at=NOW() WHERE id=?', [id])
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
  update,
  requestAdjustment,
  reserveStock,
  releaseStock,
  ship,
  cancel,
  deleteOrder,
  syncPickingByWarehouseTaskWithinTransaction,
  syncShippedByWarehouseTaskWithinTransaction,
  syncCancelledByWarehouseTaskWithinTransaction,
}
