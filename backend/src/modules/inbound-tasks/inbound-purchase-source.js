const AppError = require('../../utils/AppError')

const validId = id => Number.isSafeInteger(Number(id)) && Number(id) > 0
const invalidSource = () => new AppError('收货明细的采购来源缺失或不一致，请先修复来源关联', 409, 'INBOUND_PURCHASE_SOURCE_INVALID')

function validateSourceItems(rows) {
  if (!rows.length) throw invalidSource()
  for (const r of rows) {
    if (!validId(r.purchase_order_id) || !validId(r.purchase_item_id)
      || Number(r.source_item_id) !== Number(r.purchase_item_id)
      || Number(r.source_order_id) !== Number(r.purchase_order_id)
      || Number(r.source_product_id) !== Number(r.product_id)) throw invalidSource()
  }
  return [...new Set(rows.map(r => Number(r.purchase_order_id)))].sort((a, b) => a - b)
}

async function assertPurchaseOrderOpen(conn, purchaseOrderId, actionLabel = '收货') {
  if (!validId(purchaseOrderId)) throw invalidSource()
  const [[purchaseRow]] = await conn.query(
    'SELECT id, order_no, status FROM purchase_orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
    [purchaseOrderId],
  )
  if (!purchaseRow) throw new AppError('关联采购单不存在', 404)
  if (Number(purchaseRow.status) === 4) throw new AppError(`采购单 ${purchaseRow.order_no} 已取消，不能继续${actionLabel}`, 409)
}

const SOURCE_COLUMNS = `i.id,i.purchase_order_id,i.purchase_item_id,i.product_id,
  p.id AS source_item_id,p.order_id AS source_order_id,p.product_id AS source_product_id`

// 调用方先锁收货任务。不能只取 DISTINCT purchase_order_id 后跳过 NULL：
// 历史单没有行来源时会漏掉取消校验，且上架后结算 JOIN 无法找到采购价格。
async function assertPurchaseOrdersOpen(conn, taskId, actionLabel = '收货') {
  const [rows] = await conn.query(`SELECT ${SOURCE_COLUMNS} FROM inbound_task_items i
    LEFT JOIN purchase_order_items p ON p.id=i.purchase_item_id
    WHERE i.task_id=? ORDER BY i.purchase_order_id,i.id`, [taskId])
  for (const id of validateSourceItems(rows)) await assertPurchaseOrderOpen(conn, id, actionLabel)
}

// 重算必须先证明来源完整，不能用空 JOIN 汇总的 0 冲掉历史应付。
// 仓库/采购业务仍负责原有锁顺序和事务，本校验不新增容器写入或库存维度锁。
async function assertPurchaseSettlementSources(conn, purchaseOrderId) {
  const [rows] = await conn.query(`SELECT ${SOURCE_COLUMNS} FROM inbound_task_items i
    JOIN inbound_tasks t ON t.id=i.task_id
    LEFT JOIN purchase_order_items p ON p.id=i.purchase_item_id
    WHERE t.deleted_at IS NULL AND t.status<>5
      AND (i.purchase_order_id=? OR (i.purchase_order_id IS NULL AND t.purchase_order_id=?))`,
  [purchaseOrderId, purchaseOrderId])
  if (rows.length) validateSourceItems(rows)
  const [[legacy]] = await conn.query(`SELECT id FROM inventory_containers
    WHERE source_ref_type='purchase_order' AND source_ref_id=? AND deleted_at IS NULL
      AND status<>3 AND inbound_task_item_id IS NULL LIMIT 1`, [purchaseOrderId])
  if (legacy) throw new AppError('采购单存在尚未归入收货明细的历史入库，请先核对后再结算', 409, 'PURCHASE_LEGACY_RECEIPT_UNRECONCILED')
}

module.exports = { validateSourceItems, assertPurchaseOrderOpen, assertPurchaseOrdersOpen, assertPurchaseSettlementSources }
