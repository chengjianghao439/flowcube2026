const { Router } = require('express')
const { pool } = require('../../config/db')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
const router = Router()
router.use(authMiddleware)

router.get('/', async (req, res, next) => {
  try {
    const threshold = 10 // 低库存阈值

    const [[{ pendingPurchase }]] = await pool.query(
      `SELECT COUNT(*) AS pendingPurchase FROM purchase_orders WHERE status IN (1,2) AND deleted_at IS NULL`
    )
    const [[{ pendingSale }]] = await pool.query(
      `SELECT COUNT(*) AS pendingSale FROM sale_orders WHERE status IN (1,2,3) AND deleted_at IS NULL`
    )
    const [[{ lowStockCount }]] = await pool.query(
      `SELECT COUNT(*) AS lowStockCount FROM (
         SELECT product_id, SUM(quantity) AS total FROM inventory_stock GROUP BY product_id HAVING total < ?
       ) t`, [threshold]
    )
    const [[{ unpaidPayable }]] = await pool.query(
      `SELECT COUNT(*) AS unpaidPayable FROM payment_records WHERE type=1 AND status IN (1,2)`
    )
    const [[{ unpaidReceivable }]] = await pool.query(
      `SELECT COUNT(*) AS unpaidReceivable FROM payment_records WHERE type=2 AND status IN (1,2)`
    )
    const [[{ pendingTransfer }]] = await pool.query(
      `SELECT COUNT(*) AS pendingTransfer FROM transfer_orders WHERE status IN (1,2) AND deleted_at IS NULL`
    )
    const [[{ overduePayable }]] = await pool.query(
      `SELECT COUNT(*) AS overduePayable FROM payment_records WHERE type=1 AND status IN (1,2) AND due_date IS NOT NULL AND due_date < CURDATE()`
    )
    const [[{ overdueReceivable }]] = await pool.query(
      `SELECT COUNT(*) AS overdueReceivable FROM payment_records WHERE type=2 AND status IN (1,2) AND due_date IS NOT NULL AND due_date < CURDATE()`
    )
    const [[{ pendingInbound }]] = await pool.query(
      `SELECT COUNT(*) AS pendingInbound FROM inbound_tasks WHERE status IN (1,2,3) AND deleted_at IS NULL`
    )
    const [[{ failedPrintJobs }]] = await pool.query(
      `SELECT COUNT(*) AS failedPrintJobs FROM print_jobs WHERE status = 3`
    )
    const [[{ inboundPrintFailures }]] = await pool.query(
      `SELECT COUNT(*) AS inboundPrintFailures
       FROM print_jobs j
       WHERE j.ref_type = 'inventory_container' AND j.status = 3`
    )
    const [[{ overdueInboundPutaway }]] = await pool.query(
      `SELECT COUNT(*) AS overdueInboundPutaway
       FROM inventory_containers
       WHERE deleted_at IS NULL
         AND is_overdue = 1
         AND status = 0
         AND inbound_task_id IS NOT NULL`
    )
    const [[{ pendingInboundAudit }]] = await pool.query(
      `SELECT COUNT(*) AS pendingInboundAudit
       FROM inbound_tasks
       WHERE deleted_at IS NULL
         AND status = 4
         AND audit_status = 0
         AND updated_at < NOW() - INTERVAL 24 HOUR`
    )
    const [[{ healthAnomalies }]] = await pool.query(
      `SELECT COUNT(*) AS healthAnomalies
       FROM system_health_logs
       WHERE created_at >= NOW() - INTERVAL 24 HOUR
         AND severity IN ('danger', 'warning', 'fix_failed')`
    )

    // 组装通知列表
    const items = []
    if (overduePayable > 0) items.push({ type: 'danger', icon: '🚨', text: `${overduePayable} 笔应付账款已逾期！`, path: '/payments' })
    if (overdueReceivable > 0) items.push({ type: 'danger', icon: '🚨', text: `${overdueReceivable} 笔应收账款已逾期！`, path: '/payments' })
    if (lowStockCount > 0) items.push({ type: 'warning', icon: '⚠️', text: `${lowStockCount} 种商品库存不足`, path: '/inventory' })
    if (pendingPurchase > 0) items.push({ type: 'info', icon: '📦', text: `${pendingPurchase} 笔采购单待处理`, path: '/purchase' })
    if (pendingSale > 0) items.push({ type: 'info', icon: '🚚', text: `${pendingSale} 笔销售单待处理`, path: '/sale' })
    if (unpaidPayable > 0) items.push({ type: 'danger', icon: '💳', text: `${unpaidPayable} 笔应付账款未清`, path: '/payments' })
    if (unpaidReceivable > 0) items.push({ type: 'danger', icon: '💰', text: `${unpaidReceivable} 笔应收账款未清`, path: '/payments' })
    if (pendingTransfer > 0) items.push({ type: 'info', icon: '🔄', text: `${pendingTransfer} 笔调拨单待处理`, path: '/transfer' })
    if (pendingInbound > 0) items.push({ type: 'info', icon: '📥', text: `${pendingInbound} 笔收货订单待处理`, path: '/inbound-tasks' })
    if (failedPrintJobs > 0) items.push({ type: 'warning', icon: '🖨️', text: `${failedPrintJobs} 条打印任务失败，建议补打`, path: '/settings/barcode-print-query' })
    if (inboundPrintFailures > 0) items.push({ type: 'warning', icon: '🏷️', text: `${inboundPrintFailures} 条收货条码打印失败待补打`, path: '/settings/barcode-print-query?category=inbound&status=failed' })
    if (overdueInboundPutaway > 0) items.push({ type: 'warning', icon: '📦', text: `${overdueInboundPutaway} 箱已打印未上架超时`, path: '/inbound-tasks' })
    if (pendingInboundAudit > 0) items.push({ type: 'warning', icon: '🧾', text: `${pendingInboundAudit} 笔收货订单待审核超时`, path: '/inbound-tasks' })
    if (healthAnomalies > 0) items.push({ type: 'warning', icon: '🩺', text: `近 24 小时发现 ${healthAnomalies} 条系统异常记录`, path: '/reports/pda-anomaly' })

    const total = items.length

    return successResponse(res, { total, items, counts: { lowStockCount, pendingPurchase, pendingSale, unpaidPayable, unpaidReceivable, pendingTransfer, overduePayable, overdueReceivable, pendingInbound, failedPrintJobs, inboundPrintFailures, overdueInboundPutaway, pendingInboundAudit, healthAnomalies } }, '查询成功')
  } catch (e) { next(e) }
})

module.exports = router
