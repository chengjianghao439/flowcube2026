const { beijingTodayYmd } = require('../../utils/backendTime')
const { dateOnly } = require('./fulfillment.rules')
const { saleDelivery } = require('./fulfillment.delivery')
const { definition } = require('./fulfillment.access')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')

async function detect(conn, type, row) {
  const today = beijingTodayYmd()
  const path = `${definition(type).path}/${row.id}`
  const issues = []
  const add = (key, title, reason, actionPath = `${path}?focus=fulfillment`, dueDate = today) => issues.push({ key, title, reason, actionPath, dueDate })
  if (type === 'sale' && ![4, 5].includes(Number(row.status))) {
    const [tasks] = await conn.query('SELECT id,task_no,adjustment_requested_at,cancel_requested_at FROM warehouse_tasks WHERE sale_order_id=? AND deleted_at IS NULL AND status<>8', [row.id])
    for (const task of tasks) {
      if (task.adjustment_requested_at) add(`adjust:${task.id}`, '改单等待仓库确认', `${task.task_no} 需完成拆箱或实物归还`, `${path}?focus=fulfillment`)
      if (task.cancel_requested_at) add(`return:${task.id}`, '取消等待实物归还', `${task.task_no} 需完成 PDA 实物归还`, `${path}?focus=fulfillment`)
    }
    const [credits] = await conn.query('SELECT id,created_at FROM sale_credit_overrides WHERE sale_order_id=? AND status=2 AND deleted_at IS NULL', [row.id])
    for (const credit of credits) add(`credit:${credit.id}`, '授信申请待审批', `超额放行申请 #${credit.id} 尚未处理`, '/credit-overrides')
    const delivery = await saleDelivery(conn, row, { roleId: 1 })
    for (const item of delivery.items) {
      if (item.shortage > 0) add(`shortage:${item.id}`, '销售供应未覆盖', `${item.productCode} · ${item.warehouseName} 尚缺 ${item.shortage} ${item.unit}；可查看采购建议或调整供应`, `${path}?focus=fulfillment`, item.promisedDate || today)
      if (item.delayed) add(`delay:${item.id}`, '承诺发货日期有风险', `${item.productCode} 承诺 ${item.promisedDate}，预计全部可发 ${item.allDate || '待确认'}`, `${path}?focus=fulfillment`, item.promisedDate)
      for (const s of item.sources.filter(s => s.bound && s.date && s.date < today)) add(`purchase-delay:${item.id}:${s.orderId}`, '关联采购已延期', `${item.productCode} 依赖的采购有 ${s.quantity} ${item.unit}，原预计 ${s.date}；需采购确认新交期`)
    }
  }
  if (type === 'purchase' && [2, 5].includes(Number(row.status)) && dateOnly(row.expected_date) && dateOnly(row.expected_date) < today) {
    const [[{ remaining }]] = await conn.query(`SELECT COUNT(*) AS remaining FROM purchase_order_items p WHERE p.order_id=? AND p.quantity >
      COALESCE((SELECT SUM(i.received_qty) FROM inbound_task_items i JOIN inbound_tasks t ON t.id=i.task_id
      WHERE i.purchase_item_id=p.id AND t.deleted_at IS NULL AND t.status<>5),0)`, [row.id])
    if (Number(remaining)) add('purchase-delay', '采购到货延期', `预计到货 ${dateOnly(row.expected_date)}，仍有 ${remaining} 条明细未收齐`, `${path}?focus=fulfillment`, dateOnly(row.expected_date))
  }
  if (type === 'inbound' && ![4, 5].includes(Number(row.status))) {
    const [containers] = await conn.query('SELECT id,barcode,putaway_deadline_at FROM inventory_containers WHERE inbound_task_id=? AND deleted_at IS NULL AND status=4 AND putaway_deadline_at<NOW()', [row.id])
    for (const c of containers) add(`putaway:${c.id}`, '收货上架超时', `容器 ${c.barcode} 等待上架`, `${path}?focus=waiting-putaway`)
    const thresholds = await getInboundClosureThresholds()
    const [prints] = await conn.query(`SELECT j.id,c.barcode,j.status FROM print_jobs j JOIN inventory_containers c ON c.id=j.ref_id
      WHERE j.ref_type='inventory_container' AND c.inbound_task_id=? AND c.deleted_at IS NULL AND c.status=4
      AND (j.status=3 OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE,j.updated_at,NOW())>=?))
      AND NOT EXISTS(SELECT 1 FROM print_jobs newer WHERE newer.ref_type=j.ref_type AND newer.ref_id=j.ref_id AND newer.id>j.id)`, [row.id, thresholds.printTimeoutMinutes])
    for (const p of prints) add(`print:${p.id}`, '库存条码打印待处理', `${p.barcode} ${Number(p.status) === 3 ? '打印失败' : '打印超时待确认'}`, `${path}?focus=print`)
  }
  // 调拨运输时效无既定标准，首版只处理人工登记的延期/交接异常，不凭创建时间杜撰超时。
  return issues
}
module.exports = { detect }
