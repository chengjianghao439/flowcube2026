const { Router } = require('express')
const { pool } = require('../../config/db')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const router = Router()
router.use(authMiddleware)

function pushNotification(items, seen, item) {
  const dedupeKey = item.dedupeKey || `${item.category || 'general'}:${item.text}:${item.path}`
  if (seen.has(dedupeKey)) return
  seen.add(dedupeKey)
  items.push({
    ...item,
    dedupeKey,
  })
}

router.get('/', async (req, res, next) => {
  try {
    const threshold = 10 // 低库存阈值
    const inboundThresholds = await getInboundClosureThresholds()
    const items = []
    const seen = new Set()

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
       WHERE j.ref_type = 'inventory_container'
         AND (
           (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
           OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
           OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
         )`,
      [Number(inboundThresholds.printTimeoutMinutes)],
    )
    const [[failedInboundTarget]] = await pool.query(
      `SELECT c.inbound_task_id AS taskId
       FROM print_jobs j
       INNER JOIN inventory_containers c ON c.id = j.ref_id AND j.ref_type = 'inventory_container'
       WHERE c.inbound_task_id IS NOT NULL
         AND (
           (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
           OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
           OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
         )
       ORDER BY j.updated_at DESC
       LIMIT 1`,
      [Number(inboundThresholds.printTimeoutMinutes)],
    )
    const [[{ overdueInboundPutaway }]] = await pool.query(
      `SELECT COUNT(*) AS overdueInboundPutaway
       FROM inventory_containers
       WHERE deleted_at IS NULL
         AND status = 0
         AND inbound_task_id IS NOT NULL
         AND (
           (putaway_deadline_at IS NOT NULL AND putaway_deadline_at < NOW())
           OR (putaway_deadline_at IS NULL AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= ?)
         )`,
      [Number(inboundThresholds.putawayTimeoutHours)],
    )
    const [[putawayTimeoutTarget]] = await pool.query(
      `SELECT inbound_task_id AS taskId
       FROM inventory_containers
       WHERE deleted_at IS NULL
         AND status = 0
         AND inbound_task_id IS NOT NULL
         AND (
           (putaway_deadline_at IS NOT NULL AND putaway_deadline_at < NOW())
           OR (putaway_deadline_at IS NULL AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= ?)
         )
       ORDER BY created_at ASC
       LIMIT 1`,
      [Number(inboundThresholds.putawayTimeoutHours)],
    )
    const [[{ pendingInboundAudit }]] = await pool.query(
      `SELECT COUNT(*) AS pendingInboundAudit
       FROM inbound_tasks
       WHERE deleted_at IS NULL
         AND status = 4
         AND audit_status = 0
         AND TIMESTAMPDIFF(HOUR, updated_at, NOW()) >= ?`,
      [Number(inboundThresholds.auditTimeoutHours)],
    )
    const [[pendingAuditTarget]] = await pool.query(
      `SELECT id AS taskId
       FROM inbound_tasks
       WHERE deleted_at IS NULL
         AND status = 4
         AND audit_status = 0
         AND TIMESTAMPDIFF(HOUR, updated_at, NOW()) >= ?
       ORDER BY updated_at ASC
       LIMIT 1`,
      [Number(inboundThresholds.auditTimeoutHours)],
    )
    const [[{ rejectedInboundAudit }]] = await pool.query(
      `SELECT COUNT(*) AS rejectedInboundAudit
       FROM inbound_tasks
       WHERE deleted_at IS NULL
         AND status != 5
         AND audit_status = 2`,
    )
    const [[rejectedAuditTarget]] = await pool.query(
      `SELECT id AS taskId
       FROM inbound_tasks
       WHERE deleted_at IS NULL
         AND status != 5
         AND audit_status = 2
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    const [[{ outboundPrintFailures }]] = await pool.query(
      `SELECT COUNT(*) AS outboundPrintFailures
       FROM print_jobs j
       INNER JOIN packages p ON p.id = j.ref_id AND j.ref_type = 'package'
       WHERE (
         (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
         OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
         OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
       )`,
      [Number(inboundThresholds.printTimeoutMinutes)],
    )
    const [[failedOutboundTarget]] = await pool.query(
      `SELECT pw.id AS waveId, pw.wave_no AS waveNo, wt.task_no AS taskNo
       FROM print_jobs j
       INNER JOIN packages p ON p.id = j.ref_id AND j.ref_type = 'package'
       INNER JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
       LEFT JOIN picking_wave_tasks pwt ON pwt.task_id = wt.id
       LEFT JOIN picking_waves pw ON pw.id = pwt.wave_id
       WHERE (
         (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
         OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
         OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
       )
       ORDER BY j.updated_at DESC
       LIMIT 1`,
      [Number(inboundThresholds.printTimeoutMinutes)],
    )
    const [[{ staleWavePicking }]] = await pool.query(
      `SELECT COUNT(*) AS staleWavePicking
       FROM picking_waves
       WHERE status = 2
         AND created_at < DATE_SUB(NOW(), INTERVAL 8 HOUR)`,
    )
    const [[staleWavePickingTarget]] = await pool.query(
      `SELECT id AS waveId, wave_no AS waveNo
       FROM picking_waves
       WHERE status = 2
         AND created_at < DATE_SUB(NOW(), INTERVAL 8 HOUR)
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    const [[{ staleWaveSorting }]] = await pool.query(
      `SELECT COUNT(*) AS staleWaveSorting
       FROM picking_waves
       WHERE status = 3
         AND updated_at < DATE_SUB(NOW(), INTERVAL 4 HOUR)`,
    )
    const [[staleWaveSortingTarget]] = await pool.query(
      `SELECT id AS waveId, wave_no AS waveNo
       FROM picking_waves
       WHERE status = 3
         AND updated_at < DATE_SUB(NOW(), INTERVAL 4 HOUR)
      ORDER BY updated_at ASC
      LIMIT 1`,
    )
    const [[{ logisticsPrintFailures }]] = await pool.query(
      `SELECT COUNT(*) AS logisticsPrintFailures
       FROM print_jobs j
       WHERE (j.ref_type = 'waybill' OR j.job_type = 'waybill')
         AND (
           (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
           OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
           OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
         )`,
      [Number(inboundThresholds.printTimeoutMinutes)],
    )
    const [[{ healthAnomalies }]] = await pool.query(
      `SELECT COUNT(*) AS healthAnomalies
       FROM system_health_logs
       WHERE created_at >= NOW() - INTERVAL 24 HOUR
         AND severity IN ('danger', 'warning', 'fix_failed')`
    )

    // 组装通知列表
    if (overduePayable > 0) pushNotification(items, seen, { code: 'OVERDUE_PAYABLE', category: 'finance', priority: 10, type: 'danger', icon: '🚨', text: `${overduePayable} 笔应付账款已逾期！`, path: '/payments' })
    if (overdueReceivable > 0) pushNotification(items, seen, { code: 'OVERDUE_RECEIVABLE', category: 'finance', priority: 10, type: 'danger', icon: '🚨', text: `${overdueReceivable} 笔应收账款已逾期！`, path: '/payments' })
    if (lowStockCount > 0) pushNotification(items, seen, { code: 'LOW_STOCK', category: 'inventory', priority: 20, type: 'warning', icon: '⚠️', text: `${lowStockCount} 种商品库存不足`, path: '/inventory' })
    if (pendingPurchase > 0) pushNotification(items, seen, { code: 'PENDING_PURCHASE', category: 'operations', priority: 30, type: 'info', icon: '📦', text: `${pendingPurchase} 笔采购单待处理`, path: '/purchase' })
    if (pendingSale > 0) pushNotification(items, seen, { code: 'PENDING_SALE', category: 'operations', priority: 30, type: 'info', icon: '🚚', text: `${pendingSale} 笔销售单待处理`, path: '/sale' })
    if (unpaidPayable > 0) pushNotification(items, seen, { code: 'UNPAID_PAYABLE', category: 'finance', priority: 12, type: 'danger', icon: '💳', text: `${unpaidPayable} 笔应付账款未清`, path: '/payments' })
    if (unpaidReceivable > 0) pushNotification(items, seen, { code: 'UNPAID_RECEIVABLE', category: 'finance', priority: 12, type: 'danger', icon: '💰', text: `${unpaidReceivable} 笔应收账款未清`, path: '/payments' })
    if (pendingTransfer > 0) pushNotification(items, seen, { code: 'PENDING_TRANSFER', category: 'operations', priority: 30, type: 'info', icon: '🔄', text: `${pendingTransfer} 笔调拨单待处理`, path: '/transfer' })
    if (pendingInbound > 0) pushNotification(items, seen, { code: 'PENDING_INBOUND', category: 'operations', priority: 25, type: 'info', icon: '📥', text: `${pendingInbound} 笔收货订单待处理`, path: '/inbound-tasks' })
    if (failedPrintJobs > 0) pushNotification(items, seen, { code: 'PRINT_FAILED', category: 'operations', priority: 25, type: 'warning', icon: '🖨️', text: `${failedPrintJobs} 条打印任务失败，建议补打`, path: '/settings/barcode-print-query' })
    if (inboundPrintFailures > 0) pushNotification(items, seen, { code: 'INBOUND_PRINT_FAILED', category: 'operations', priority: 20, type: 'warning', icon: '🏷️', text: `${inboundPrintFailures} 条收货条码打印失败待补打`, path: failedInboundTarget?.taskId ? `/inbound-tasks/${failedInboundTarget.taskId}?focus=print-batches` : '/settings/barcode-print-query?category=inbound&status=failed' })
    if (overdueInboundPutaway > 0) pushNotification(items, seen, { code: 'INBOUND_PUTAWAY_TIMEOUT', category: 'operations', priority: 15, type: 'warning', icon: '📦', text: `${overdueInboundPutaway} 箱已打印未上架超时`, path: putawayTimeoutTarget?.taskId ? `/inbound-tasks/${putawayTimeoutTarget.taskId}?focus=waiting-putaway` : '/inbound-tasks' })
    if (pendingInboundAudit > 0) pushNotification(items, seen, { code: 'INBOUND_AUDIT_TIMEOUT', category: 'operations', priority: 15, type: 'warning', icon: '🧾', text: `${pendingInboundAudit} 笔收货订单待审核超时`, path: pendingAuditTarget?.taskId ? `/inbound-tasks/${pendingAuditTarget.taskId}?focus=audit-follow-up` : '/inbound-tasks' })
    if (rejectedInboundAudit > 0) pushNotification(items, seen, { code: 'INBOUND_AUDIT_REJECTED', category: 'operations', priority: 14, type: 'warning', icon: '↩️', text: `${rejectedInboundAudit} 笔收货订单已退回待处理`, path: rejectedAuditTarget?.taskId ? `/inbound-tasks/${rejectedAuditTarget.taskId}?focus=audit-follow-up` : '/inbound-tasks' })
    if (outboundPrintFailures > 0) pushNotification(items, seen, { code: 'OUTBOUND_PRINT_FAILED', category: 'operations', priority: 21, type: 'warning', icon: '📮', text: `${outboundPrintFailures} 条出库条码打印失败待补打`, path: failedOutboundTarget?.waveId ? `/picking-waves?waveId=${failedOutboundTarget.waveId}&focus=print-closure` : '/settings/barcode-print-query?category=outbound&status=failed' })
    if (logisticsPrintFailures > 0) pushNotification(items, seen, { code: 'LOGISTICS_PRINT_FAILED', category: 'operations', priority: 22, type: 'warning', icon: '🚛', text: `${logisticsPrintFailures} 条物流标签打印失败待补打`, path: '/settings/barcode-print-query?category=logistics&status=failed' })
    if (staleWavePicking > 0) pushNotification(items, seen, { code: 'WAVE_STALE_PICKING', category: 'operations', priority: 18, type: 'warning', icon: '🛒', text: `${staleWavePicking} 个波次拣货推进缓慢`, path: staleWavePickingTarget?.waveId ? `/picking-waves?waveId=${staleWavePickingTarget.waveId}&focus=wave-progress` : '/picking-waves' })
    if (staleWaveSorting > 0) pushNotification(items, seen, { code: 'WAVE_STALE_SORTING', category: 'operations', priority: 19, type: 'warning', icon: '📚', text: `${staleWaveSorting} 个波次待分拣超时`, path: staleWaveSortingTarget?.waveId ? `/picking-waves?waveId=${staleWaveSortingTarget.waveId}&focus=wave-progress` : '/picking-waves' })
    if (healthAnomalies > 0) pushNotification(items, seen, { code: 'SYSTEM_HEALTH_ANOMALY', category: 'system', priority: 5, type: 'warning', icon: '🩺', text: `近 24 小时发现 ${healthAnomalies} 条系统异常记录`, path: '/reports/pda-anomaly' })

    items.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))

    const total = items.length

    return successResponse(res, { total, items, counts: { lowStockCount, pendingPurchase, pendingSale, unpaidPayable, unpaidReceivable, pendingTransfer, overduePayable, overdueReceivable, pendingInbound, failedPrintJobs, inboundPrintFailures, overdueInboundPutaway, pendingInboundAudit, rejectedInboundAudit, outboundPrintFailures, staleWavePicking, staleWaveSorting, logisticsPrintFailures, healthAnomalies } }, '查询成功')
  } catch (e) { next(e) }
})

module.exports = router
