const { pool } = require('../../config/db')
const { getInboundPrintDispatchReasonLabel } = require('../inbound-tasks/inbound-tasks.status')
const { deriveInboundBarcodeStatus } = require('../print-jobs/print-jobs.status')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const difference = (a, b) => (Math.round(Number(a || 0) * 10000) - Math.round(Number(b || 0) * 10000)) / 10000
const identity = [['productCode', '编码'], ['articleNumber', '供应商型号'], ['spec', '型号'], ['productName', '名称'], ['color', '颜色'], ['unit', '单位']]
const productSql = 'i.product_code AS productCode,i.product_name AS productName,i.unit,p.article_number AS articleNumber,p.spec,p.color'
function section(group, title, columns, rows, description) {
  return { group, title, columns: columns.map(([key, label]) => ({ key, label, format: /At$|Time$/.test(key) ? 'date' : undefined })), rows, description }
}
async function containerSections(condition, params, taskStatus) {
  const [containers] = await pool.query(
    `SELECT c.id,c.barcode,p.code AS productCode,p.name AS productName,c.unit,
      p.article_number AS articleNumber,p.spec,p.color,c.initial_qty AS initialQty,c.remaining_qty AS remainingQty,
      c.status,l.code AS locationCode,c.created_at AS createdAt
     FROM inventory_containers c LEFT JOIN product_items p ON p.id=c.product_id
     LEFT JOIN warehouse_locations l ON l.id=c.location_id WHERE ${condition} ORDER BY c.id`, params)
  const states = { 1: '在库', 2: '已用尽', 3: '已作废', 4: '待上架', 5: '待质检', 6: '不合格隔离' }
  const thresholds = await getInboundClosureThresholds()
  const [prints] = await pool.query(
    `SELECT j.id,c.barcode,j.status AS print_status,j.updated_at AS print_updated_at,j.error_message,
      pr.name AS printerName,j.created_at AS createdAt,j.updated_at AS updatedAt,j.dispatch_reason AS reason
     FROM inventory_containers c LEFT JOIN print_jobs j ON j.ref_type='inventory_container' AND j.ref_id=c.id
     LEFT JOIN printers pr ON pr.id=j.printer_id WHERE ${condition} ORDER BY c.id,j.id DESC`, params)
  return [
    section('containers', '容器与库位', [['barcode', '条码'], ...identity, ['initialQty', '初始数量'], ['remainingQty', '当前余量'], ['state', '容器状态'], ['locationCode', '当前库位']], containers.map(c => ({ ...c, state: states[c.status] || '未知' })), '容器余量与库位为当前值，可能已被后续出库或调拨改变。'),
    section('print', '条码打印记录', [['barcode', '条码'], ['id', '打印任务'], ['state', '打印状态'], ['printerName', '打印机'], ['reason', '派发原因'], ['createdAt', '创建时间'], ['updatedAt', '更新时间'], ['error_message', '异常说明']], prints.map(p => ({ ...p, reason: p.reason ? getInboundPrintDispatchReasonLabel(p.reason) : null, state: deriveInboundBarcodeStatus({ ...p, inbound_task_status: taskStatus }, thresholds).printStateLabel }))),
  ]
}
async function warehouseTaskSections(taskIds) {
  if (!taskIds.length) return { sections: [], events: [] }
  const [rows] = await pool.query(
    `SELECT i.id,${productSql.replace(/p\.article_number|p\.spec|p\.color/g, field => field.replace('p.', 'i.'))},t.task_no AS taskNo,t.status AS taskStatus,
      i.required_qty AS requiredQty,i.picked_qty AS pickedQty
     FROM warehouse_task_items i JOIN warehouse_tasks t ON t.id=i.task_id
     LEFT JOIN product_items p ON p.id=i.product_id WHERE t.id IN (?) ORDER BY t.id,i.id`, [taskIds])
  const [scans] = await pool.query(
    `SELECT s.id,s.barcode,s.qty,s.operator_name AS operatorName,s.scanned_at AS scannedAt,s.location_code AS locationCode,
      t.task_no AS taskNo,p.code AS productCode,p.name AS productName,p.unit,p.article_number AS articleNumber,p.spec,p.color
     FROM scan_logs s JOIN warehouse_tasks t ON t.id=s.task_id LEFT JOIN product_items p ON p.id=s.product_id
     WHERE s.task_id IN (?) ORDER BY s.id DESC`, [taskIds])
  const [shipments] = await pool.query(
    `SELECT l.id,l.ref_no AS taskNo,p.code AS productCode,p.name AS productName,p.unit,p.article_number AS articleNumber,p.spec,p.color,
      ABS(l.quantity) AS shippedQty,l.operator_name AS operatorName,l.created_at AS shippedAt
     FROM inventory_logs l LEFT JOIN product_items p ON p.id=l.product_id
     WHERE l.ref_type='warehouse_task' AND l.ref_id IN (?) AND l.move_type=? ORDER BY l.id DESC`, [taskIds, MOVE_TYPE.TASK_OUT])
  const [events] = await pool.query('SELECT * FROM warehouse_task_events WHERE task_id IN (?) ORDER BY id DESC', [taskIds])
  const titles = { TASK_CREATED: '创建仓库任务', PICKING_STARTED: '开始拣货', PICKING_DONE: '拣货完成', SORT_PROGRESS: '分拣操作', SORT_DONE: '分拣完成', CHECK_PROGRESS: '复核操作', CHECK_DONE: '复核完成', PACK_PROGRESS: '装箱操作', PACK_DONE: '打包完成', SHIP_DONE: '确认出库', TASK_CANCELLED: '取消仓库任务', SORTING_BIN_ASSIGNED: '分配分拣格', SORTING_BIN_RELEASED: '释放分拣格', CANCEL_REQUESTED: '申请取消', CANCEL_RETURN_SCAN: '取消归还扫码', CANCEL_RETURN_BOX_SCAN: '取消归还整箱', CANCEL_FINALIZED: '取消归还完成', ADJUSTMENT_REQUESTED: '申请改单', ADJUSTMENT_REOPENED: '重新打开改单', ADJUSTMENT_RETURN_SCAN: '改单归还扫码', ADJUSTMENT_VOID_SCAN: '改单作废扫码', ADJUSTMENT_FINALIZED: '改单完成', SHORTAGE_REPORTED: '上报缺货', SHORTAGE_RESOLVED: '处理缺货' }
  const states = { 1: '待拣货', 2: '拣货中', 3: '待分拣', 4: '待复核', 5: '待打包', 6: '待出库', 7: '已出库', 8: '已取消' }
  return {
    sections: [section('progress', '实际出库记录', [['taskNo', '仓库任务'], ...identity, ['shippedQty', '出库数量'], ['operatorName', '操作人'], ['shippedAt', '出库时间']], shipments), section('progress', '仓库任务执行', [['taskNo', '仓库任务'], ...identity, ['requiredQty', '任务数量'], ['pickedQty', '已拣数量'], ['state', '任务状态']], rows.map(r => ({ ...r, state: states[r.taskStatus] || '未知' }))),
      section('scan', '扫码取货明细', [['taskNo', '仓库任务'], ...identity, ['barcode', '条码'], ['qty', '扫码数量'], ['locationCode', '库位'], ['operatorName', '操作人'], ['scannedAt', '时间']], scans)],
    events: events.map(e => ({ id: `warehouse-${e.id}`, title: titles[e.event_type] || '仓库作业记录', description: e.task_no, createdByName: e.operator_name, createdAt: e.created_at, source: '仓库业务事件' })),
  }
}
async function packageSections(taskIds) {
  if (!taskIds.length) return []
  const [rows] = await pool.query(
    `SELECT p.id,p.barcode,p.status AS packageStatus,t.task_no AS taskNo,j.id AS jobId,j.status AS print_status,j.updated_at AS print_updated_at,
      j.error_message,pr.name AS printerName,j.created_at AS createdAt,j.updated_at AS updatedAt
     FROM packages p JOIN warehouse_tasks t ON t.id=p.warehouse_task_id
     LEFT JOIN print_jobs j ON j.ref_type='package' AND j.ref_id=p.id
     LEFT JOIN printers pr ON pr.id=j.printer_id WHERE p.warehouse_task_id IN (?) ORDER BY p.id,j.id DESC`, [taskIds])
  const [items] = await pool.query(
    `SELECT i.id,p.barcode,p.status AS packageStatus,i.product_code AS productCode,i.product_name AS productName,i.unit,
      i.article_number AS articleNumber,i.spec,i.color,i.qty FROM package_items i JOIN packages p ON p.id=i.package_id
     WHERE p.warehouse_task_id IN (?) ORDER BY p.id,i.id`, [taskIds])
  const thresholds = await getInboundClosureThresholds()
  const withPackageState = r => ({ ...r, packageState: ({ 1: '打包中', 2: '已完成', 3: '已取消' })[r.packageStatus] || '未知' })
  return [section('print', '逐箱商品明细', [['barcode', '包裹条码'], ['packageState', '包裹状态'], ...identity, ['qty', '装箱数量']], items.map(withPackageState)), section('print', '装箱与箱贴打印', [['taskNo', '仓库任务'], ['barcode', '包裹条码'], ['packageState', '包裹状态'], ['jobId', '打印任务'], ['state', '打印状态'], ['printerName', '打印机'], ['createdAt', '任务创建'], ['updatedAt', '任务更新'], ['error_message', '异常说明']], rows.map(r => ({ ...withPackageState(r), state: deriveInboundBarcodeStatus(r, thresholds).printStateLabel })))]
}
async function buildProgress(type, id, doc, user) {
  const sections = []
  const events = []
  const items = doc.items || []
  if (type === 'purchase') {
    const [counts] = await pool.query(
      `SELECT i.purchase_item_id AS id,SUM(i.received_qty) AS receivedQty,SUM(i.putaway_qty) AS putawayQty
       FROM inbound_task_items i JOIN inbound_tasks t ON t.id=i.task_id
       WHERE i.purchase_order_id=? AND t.status<>5 AND t.deleted_at IS NULL GROUP BY i.purchase_item_id`, [id])
    const byId = new Map(counts.map(r => [Number(r.id), r]))
    sections.push(section('progress', '逐商品收货与上架', [...identity, ['quantity', '采购数量'], ['receivedQty', '已收数量'], ['remainingQty', '未收数量'], ['overQty', '超收数量'], ['putawayQty', '已上架数量']], items.map(i => {
      const c = byId.get(Number(i.id)) || {}
      return { ...i, receivedQty: Number(c.receivedQty || 0), putawayQty: Number(c.putawayQty || 0), remainingQty: Math.max(0, difference(i.quantity, c.receivedQty)), overQty: Math.max(0, difference(c.receivedQty, i.quantity)) }
    }), '未收数量为采购与实收差额；已关闭的剩余数量不再等待收货。'))
    sections.push(section('progress', '关联收货订单', [['taskNo', '收货单号'], ['state', '当前状态']], (doc.inboundTasks || []).map(t => ({ ...t, state: t.receiptStatus?.label || ({ 1: '待收货', 2: '收货中', 3: '待上架', 4: '已完成', 5: '已取消' })[t.status] }))))
  }
  if (type === 'inbound') {
    sections.push(section('progress', '收货 → 上架', [...identity, ['orderedQty', '应到数量'], ['receivedQty', '已收数量'], ['putawayQty', '已上架数量'], ['waitingQty', '未上架数量']], items.map(i => ({ ...i, waitingQty: Math.max(0, difference(i.receivedQty, i.putawayQty)) }))))
    sections.push(...await containerSections('c.inbound_task_id=?', [id], doc.status))
  }
  if (type === 'sale-return') {
    const [tasks] = await pool.query("SELECT id,task_no,status FROM return_tasks WHERE return_type='sale' AND return_id=? ORDER BY id", [id])
    if (tasks.length) {
      const ids = tasks.map(t => t.id)
      const [rows] = await pool.query(
        `SELECT i.id,${productSql},t.task_no AS taskNo,t.status AS taskStatus,i.expected_qty AS expectedQty,i.received_qty AS receivedQty,
          i.checked_qty AS checkedQty,i.rejected_qty AS rejectedQty,i.putaway_qty AS putawayQty
         FROM return_task_items i JOIN return_tasks t ON t.id=i.task_id LEFT JOIN product_items p ON p.id=i.product_id
         WHERE i.task_id IN (?) ORDER BY t.id,i.id`, [ids])
      sections.push(section('progress', '收货 → 质检 → 上架', [['taskNo', '退货任务'], ['taskState', '任务状态'], ...identity, ['expectedQty', '应退数量'], ['receivedQty', '已收数量'], ['passedQty', '质检合格'], ['rejectedQty', '拒收数量'], ['uncheckedQty', '待检数量'], ['putawayQty', '已上架数量']], rows.map(r => ({ ...r, taskState: ({ 1: '待收货', 2: '收货中', 3: '待质检', 4: '待上架', 5: '已完成', 6: '已取消' })[r.taskStatus] || '未知', passedQty: difference(r.checkedQty, r.rejectedQty), uncheckedQty: difference(r.receivedQty, r.checkedQty) }))))
      sections.push(...await containerSections("c.source_ref_type='sale_return' AND c.source_ref_id IN (?)", [ids]))
    }
  }
  if (type === 'wave') {
    sections.push(section('progress', '批次概况', [['taskCount', '任务数'], ['operatorName', '责任人'], ['statusName', '批次状态']], [{ taskCount: (doc.tasks || []).length, operatorName: doc.operatorName, statusName: doc.statusName }]))
    sections.push(section('progress', '关联销售订单', [['taskNo', '仓库任务'], ['saleOrderNo', '销售单号'], ['customerName', '客户']], doc.tasks || []))
  }
  if (['purchase-return', 'sale', 'wave'].includes(type)) {
    let taskIds
    if (type === 'purchase-return') {
      const [tasks] = await pool.query("SELECT id FROM warehouse_tasks WHERE task_type='purchase_return' AND return_id=? ORDER BY id", [id])
      taskIds = tasks.map(t => t.id)
    } else taskIds = (doc.tasks || []).map(t => t.taskId)
    const taskData = await warehouseTaskSections(taskIds)
    sections.push(...taskData.sections)
    events.push(...taskData.events)
    if (type !== 'purchase-return') sections.push(...await packageSections(taskIds))
  }
  if (type === 'transfer') sections.push(section('progress', '调出 → 在途 → 调入', [...identity, ['quantity', '计划数量'], ['deductedQty', '已调出'], ['inTransitQty', '在途数量'], ['receivedQty', '已调入']], items.map(i => ({ ...i, inTransitQty: Math.max(0, difference(i.deductedQty, i.receivedQty)) }))))
  if (type === 'transfer') {
    const [scans] = await pool.query("SELECT id,title,payload_json,created_by_name AS operatorName,created_at AS scannedAt FROM transfer_order_events WHERE transfer_order_id=? AND event_type IN ('TRANSFER_SCAN_OUT','TRANSFER_SCAN_IN') ORDER BY id DESC", [id])
    sections.push(section('scan', '调出与调入扫码记录', [['title', '操作'], ['barcode', '容器条码'], ['qty', '数量'], ['locationId', '调入库位 ID'], ['operatorName', '操作人'], ['scannedAt', '时间']], scans.map(r => {
      let payload = r.payload_json
      if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch { payload = {} } }
      return { id: r.id, title: r.title, barcode: payload?.barcode, qty: payload?.qty, locationId: payload?.locationId, operatorName: r.operatorName, scannedAt: r.scannedAt }
    })))
  }
  if (type === 'stockcheck') sections.push(section('progress', '盘点完成情况', [...identity, ['bookQty', '账面数量'], ['actualQty', '实盘数量'], ['diffQty', '差异数量'], ['state', '录入状态']], items.map(i => ({ ...i, state: i.actualQty == null ? '未盘点' : '已录入' }))))
  if (type === 'stockcheck') {
    const [scans] = await pool.query(
      `SELECT s.id,s.barcode,s.counted_qty AS countedQty,s.scanned_by_name AS operatorName,s.created_at AS scannedAt,
        i.product_code AS productCode,i.product_name AS productName,i.unit FROM inventory_check_item_containers s
       JOIN inventory_check_items i ON i.id=s.check_item_id WHERE i.check_id=? ORDER BY s.id DESC`, [id])
    sections.push(section('scan', '盘点扫码明细', [['productCode', '编码'], ['productName', '名称'], ['unit', '单位'], ['barcode', '条码'], ['countedQty', '实盘数量'], ['operatorName', '操作人'], ['scannedAt', '时间']], scans))
    events.push(...scans.map(r => ({ id: `stockcheck-scan-${r.id}`, title: '扫码盘点', description: `${r.barcode} · ${r.countedQty} ${r.unit}`, createdByName: r.operatorName, createdAt: r.scannedAt, source: '盘点扫码记录' })))
  }
  if (type === 'disposal') sections.push(section('progress', '处置执行', [...identity, ['quantity', '计划处置数量'], ['disposeTypeName', '处置方式'], ['state', '执行状态'], ['disposedAt', '处置时间']], items.map(i => ({ ...i, state: doc.statusName, disposedAt: doc.disposedAt }))))
  if (type === 'plan') sections.push(section('progress', '采购转单进度', [...identity, ['warehouseName', '仓库'], ['adjustedQty', '采购数量'], ['statusName', '转单状态'], ['purchaseOrderId', '关联采购单 ID']], items))
  if (type === 'requisition') sections.push(section('progress', '申请采购执行', [...identity, ['quantity', '申请数量'], ['convertedQty', '已转采购数量']], items))
  const bizType = { requisition: 'purchase_requisition', credit: 'sale_credit_override', price: 'product_price' }[type]
  if (bizType) {
    const [tasks] = await pool.query(
      `SELECT t.id,t.step_order AS stepOrder,t.status,t.approver_name AS approverName,t.action_at AS actionAt,t.comment,
        a.id AS instanceId,a.status AS instanceStatus FROM approval_instances a
       JOIN approval_instance_tasks t ON t.instance_id=a.id WHERE a.biz_type=? AND a.biz_id=? ORDER BY a.id DESC,t.step_order`, [bizType, id])
    const rows = tasks.map(t => ({ ...t, state: t.instanceStatus === 4 && t.status === 3 ? '已撤销' : ({ 1: '待审批', 2: '已通过', 3: '已驳回' })[t.status] || '未知' }))
    sections.push(section('progress', '审批节点', [['instanceId', '审批流程'], ['stepOrder', '级别'], ['state', '节点状态'], ['approverName', '审批人'], ['actionAt', '操作时间'], ['comment', '意见']], rows))
    events.push(...rows.filter(t => t.actionAt).map(t => ({ id: `approval-${t.id}`, title: `第 ${t.stepOrder} 级审批：${t.state}`, description: t.comment, createdAt: t.actionAt, createdByName: t.approverName, source: '审批记录' })))
  }
  // Only stored timestamps appear here; state numbers do not manufacture elapsed steps.
  const milestones = [['submittedAt', '提交', 'applicantName'], ['approvedAt', '审批通过', 'approvedByName'], ['paidAt', '付款', 'paidByName'], ['disposedAt', '执行处置', 'disposedByName'], ['confirmedAt', '确认退款', 'confirmedByName'], ['refundedAt', '执行退款', 'refundedByName']]
  const saved = milestones.filter(([key]) => doc[key]).map(([key, title, actor]) => ({ title, happenedAt: doc[key], operatorName: doc[actor] || null }))
  events.push(...saved.map((r, index) => ({ id: `milestone-${index}`, title: r.title, createdAt: r.happenedAt, createdByName: r.operatorName, source: '单据处理信息' })))
  if (saved.length) sections.push(section('progress', '已记录的处理节点', [['title', '事项'], ['happenedAt', '时间'], ['operatorName', '操作人']], saved))
  if (doc.rejectReason) sections.push(section('progress', '处理意见', [['reason', '驳回原因']], [{ reason: doc.rejectReason }]))
  if (type === 'logistics') {
    const tracks = await require('../logistics/logistics.service').getTrackEvents(id, { warehouseIds: user.warehouseIds ?? null })
    sections.push(section('progress', '物流轨迹', [['eventTime', '时间'], ['description', '轨迹说明'], ['location', '位置']], tracks))
  }
  return { sections, events }
}
module.exports = { buildProgress, difference }
