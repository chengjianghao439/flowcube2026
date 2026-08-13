const { pool } = require('../../config/db')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { scopeFilter } = require('../../utils/warehouseScope')

function pushNotification(items, seen, item) {
  const dedupeKey = item.dedupeKey || `${item.category || 'general'}:${item.text}:${item.path}`
  if (seen.has(dedupeKey)) return
  seen.add(dedupeKey)
  items.push({ ...item, dedupeKey })
}

/**
 * 站内通知：按当前用户仓库 scope 过滤「仓库相关」的计数（采购/销售/库存/调拨/收货/打印）。
 * 账款、系统健康等无仓库维度的全局项不受影响。
 */
async function buildNotifications(scopeWarehouseIds = null) {
  const inboundThresholds = await getInboundClosureThresholds()
  const printTimeoutMinutes = Number(inboundThresholds.printTimeoutMinutes)
  const putawayTimeoutHours = Number(inboundThresholds.putawayTimeoutHours)

  const poSc = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const soSc = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const stSc = scopeFilter(scopeWarehouseIds, 's.warehouse_id')
  const trSc = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const inSc = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const cSc = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')

  const [[{ pendingPurchase }]] = await pool.query(
    `SELECT COUNT(*) AS pendingPurchase FROM purchase_orders WHERE status IN (1,2) AND deleted_at IS NULL${poSc.sql}`,
    poSc.params,
  )
  const [[{ pendingSale }]] = await pool.query(
    `SELECT COUNT(*) AS pendingSale FROM sale_orders WHERE status IN (1,2,3) AND deleted_at IS NULL${soSc.sql}`,
    soSc.params,
  )
  // 低于补货点的库存项数（按仓判定，补货点取 COALESCE(本仓行, warehouse_id=0 默认行, 0)，只算补货点>0 的）
  // 口径较补货建议报表保守：只看可用<补货点、不含在途，宁可多提醒；点进报表看含在途的精确清单。
  const [[{ lowStockCount }]] = await pool.query(
    `SELECT COUNT(*) AS lowStockCount FROM (
       SELECT s.product_id, s.warehouse_id
       FROM inventory_stock s
       LEFT JOIN product_stock_policies sp_wh  ON sp_wh.product_id = s.product_id AND sp_wh.warehouse_id = s.warehouse_id
       LEFT JOIN product_stock_policies sp_def ON sp_def.product_id = s.product_id AND sp_def.warehouse_id = 0
       WHERE COALESCE(sp_wh.reorder_point, sp_def.reorder_point, 0) > 0
         AND GREATEST(0, s.quantity - s.reserved) < COALESCE(sp_wh.reorder_point, sp_def.reorder_point, 0)${stSc.sql}
     ) t`,
    stSc.params,
  )
  // 临期预警（P2-8）：batch_managed 商品 30 天内到期的在库容器数（ACTIVE），提示尽快消化/处理
  const EXPIRY_WINDOW_DAYS = Number(process.env.EXPIRY_WARNING_DAYS || 30)
  const [[{ expiringCount }]] = await pool.query(
    `SELECT COUNT(*) AS expiringCount
     FROM inventory_containers c
     INNER JOIN product_items p ON p.id = c.product_id AND p.batch_managed = 1
     WHERE c.status = 1 AND c.deleted_at IS NULL
       AND c.exp_date IS NOT NULL
       AND c.exp_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)${cSc.sql}`,
    [EXPIRY_WINDOW_DAYS, ...cSc.params],
  )
  // 呆滞库存预警（文档09 Phase2）：某商品×仓仍有在库，且最后一次出库距今 > staleDays 天。
  // 口径与 inventory.aging 一致（last_outbound 取 inventory_logs type=2 出库方向的最近一次），
  // 无出库记录视为从未动销（也判呆滞）。提醒去呆滞报表确认处置。
  const STALE_DAYS = Number(process.env.STALE_WARNING_DAYS || 90)
  const [[{ staleCount }]] = await pool.query(
    `SELECT COUNT(*) AS staleCount FROM (
       SELECT c.product_id, c.warehouse_id
       FROM inventory_containers c
       LEFT JOIN (SELECT product_id, warehouse_id, MAX(created_at) AS last_out
                  FROM inventory_logs WHERE type=2 GROUP BY product_id, warehouse_id) lo
              ON lo.product_id=c.product_id AND lo.warehouse_id=c.warehouse_id
       WHERE c.status=1 AND c.remaining_qty>0 AND c.deleted_at IS NULL${cSc.sql}
       GROUP BY c.product_id, c.warehouse_id
       HAVING MAX(lo.last_out) IS NULL OR DATEDIFF(NOW(), MAX(lo.last_out)) > ?
     ) t`,
    [...cSc.params, STALE_DAYS],
  )
  const [[{ unpaidPayable }]] = await pool.query(
    `SELECT COUNT(*) AS unpaidPayable FROM payment_records WHERE type=1 AND status IN (1,2)`,
  )
  const [[{ unpaidReceivable }]] = await pool.query(
    `SELECT COUNT(*) AS unpaidReceivable FROM payment_records WHERE type=2 AND status IN (1,2)`,
  )
  const [[{ pendingTransfer }]] = await pool.query(
    `SELECT COUNT(*) AS pendingTransfer FROM transfer_orders WHERE status IN (1,2) AND deleted_at IS NULL${trSc.sql}`,
    trSc.params,
  )
  const [[{ overduePayable }]] = await pool.query(
    `SELECT COUNT(*) AS overduePayable FROM payment_records WHERE type=1 AND status IN (1,2) AND due_date IS NOT NULL AND due_date < CURDATE()`,
  )
  const [[{ overdueReceivable }]] = await pool.query(
    `SELECT COUNT(*) AS overdueReceivable FROM payment_records WHERE type=2 AND status IN (1,2) AND due_date IS NOT NULL AND due_date < CURDATE()`,
  )
  const [[{ pendingInbound }]] = await pool.query(
    `SELECT COUNT(*) AS pendingInbound FROM inbound_tasks WHERE status IN (1,2,3) AND deleted_at IS NULL${inSc.sql}`,
    inSc.params,
  )
  const [[{ failedPrintJobs }]] = await pool.query(
    `SELECT COUNT(*) AS failedPrintJobs FROM print_jobs WHERE status = 3`,
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
    [printTimeoutMinutes],
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
    [printTimeoutMinutes],
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
    [putawayTimeoutHours],
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
    [putawayTimeoutHours],
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
    [printTimeoutMinutes],
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
    [printTimeoutMinutes],
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
    [printTimeoutMinutes],
  )
  const [[{ healthAnomalies }]] = await pool.query(
    `SELECT COUNT(*) AS healthAnomalies
     FROM system_health_logs
     WHERE created_at >= NOW() - INTERVAL 24 HOUR
       AND severity IN ('danger', 'warning', 'fix_failed')`,
  )
  const items = []
  const seen = new Set()
  if (overduePayable > 0) pushNotification(items, seen, { code: 'OVERDUE_PAYABLE', category: 'finance', priority: 10, type: 'danger', icon: '🚨', text: `${overduePayable} 笔应付账款已逾期`, path: '/payments/payable' })
  if (overdueReceivable > 0) pushNotification(items, seen, { code: 'OVERDUE_RECEIVABLE', category: 'finance', priority: 10, type: 'danger', icon: '🚨', text: `${overdueReceivable} 笔应收账款已逾期`, path: '/payments/receivable' })
  if (lowStockCount > 0) pushNotification(items, seen, { code: 'LOW_STOCK', category: 'inventory', priority: 20, type: 'warning', icon: '⚠️', text: `${lowStockCount} 项库存低于补货点`, path: '/reports/replenishment' })
  if (expiringCount > 0) pushNotification(items, seen, { code: 'EXPIRING_STOCK', category: 'inventory', priority: 18, type: 'warning', icon: '⏳', text: `${expiringCount} 个批次库存 ${EXPIRY_WINDOW_DAYS} 天内到期，请尽快处理`, path: '/inventory?tab=containers' })
  if (staleCount > 0) pushNotification(items, seen, { code: 'STALE_STOCK', category: 'inventory', priority: 17, type: 'warning', icon: '🏚️', text: `${staleCount} 项库存已 ${STALE_DAYS} 天未动销（呆滞），建议处置`, path: '/reports/inventory-aging' })
  if (pendingPurchase > 0) pushNotification(items, seen, { code: 'PENDING_PURCHASE', category: 'operations', priority: 30, type: 'info', icon: '📦', text: `${pendingPurchase} 笔采购单待处理`, path: '/purchase' })
  if (pendingSale > 0) pushNotification(items, seen, { code: 'PENDING_SALE', category: 'operations', priority: 30, type: 'info', icon: '🚚', text: `${pendingSale} 笔销售单待处理`, path: '/sale' })
  if (unpaidPayable > 0) pushNotification(items, seen, { code: 'UNPAID_PAYABLE', category: 'finance', priority: 12, type: 'danger', icon: '💳', text: `${unpaidPayable} 笔应付账款未结清`, path: '/payments/payable' })
  if (unpaidReceivable > 0) pushNotification(items, seen, { code: 'UNPAID_RECEIVABLE', category: 'finance', priority: 12, type: 'danger', icon: '💰', text: `${unpaidReceivable} 笔应收账款未结清`, path: '/payments/receivable' })
  if (pendingTransfer > 0) pushNotification(items, seen, { code: 'PENDING_TRANSFER', category: 'operations', priority: 30, type: 'info', icon: '🔄', text: `${pendingTransfer} 笔调拨单待处理`, path: '/transfer' })
  if (pendingInbound > 0) pushNotification(items, seen, { code: 'PENDING_INBOUND', category: 'operations', priority: 25, type: 'info', icon: '📥', text: `${pendingInbound} 笔收货订单待处理`, path: '/inbound-tasks' })
  if (failedPrintJobs > 0) pushNotification(items, seen, { code: 'PRINT_FAILED', category: 'operations', priority: 25, type: 'warning', icon: '🖨️', text: `${failedPrintJobs} 条打印任务失败，建议补打`, path: '/settings/barcode-print-query' })
  if (inboundPrintFailures > 0) pushNotification(items, seen, { code: 'INBOUND_PRINT_FAILED', category: 'operations', priority: 20, type: 'warning', icon: '🏷️', text: `${inboundPrintFailures} 条收货条码打印失败待补打`, path: failedInboundTarget?.taskId ? `/inbound-tasks/${failedInboundTarget.taskId}?focus=print-batches` : '/settings/barcode-print-query?category=inbound&status=failed' })
  if (overdueInboundPutaway > 0) pushNotification(items, seen, { code: 'INBOUND_PUTAWAY_TIMEOUT', category: 'operations', priority: 15, type: 'warning', icon: '📦', text: `${overdueInboundPutaway} 箱打印后未上架超时`, path: putawayTimeoutTarget?.taskId ? `/inbound-tasks/${putawayTimeoutTarget.taskId}?focus=waiting-putaway` : '/inbound-tasks' })
  if (outboundPrintFailures > 0) pushNotification(items, seen, { code: 'OUTBOUND_PRINT_FAILED', category: 'operations', priority: 21, type: 'warning', icon: '📮', text: `${outboundPrintFailures} 条出库条码打印失败待补打`, path: failedOutboundTarget?.waveId ? `/picking-waves?waveId=${failedOutboundTarget.waveId}&focus=print-closure` : '/settings/barcode-print-query?category=outbound&status=failed' })
  if (logisticsPrintFailures > 0) pushNotification(items, seen, { code: 'LOGISTICS_PRINT_FAILED', category: 'operations', priority: 22, type: 'warning', icon: '🚛', text: `${logisticsPrintFailures} 条物流标签打印失败待补打`, path: '/settings/barcode-print-query?category=logistics&status=failed' })
  if (staleWavePicking > 0) pushNotification(items, seen, { code: 'WAVE_STALE_PICKING', category: 'operations', priority: 18, type: 'warning', icon: '🛒', text: `${staleWavePicking} 个波次拣货推进缓慢`, path: staleWavePickingTarget?.waveId ? `/picking-waves?waveId=${staleWavePickingTarget.waveId}&focus=wave-progress` : '/picking-waves' })
  if (staleWaveSorting > 0) pushNotification(items, seen, { code: 'WAVE_STALE_SORTING', category: 'operations', priority: 19, type: 'warning', icon: '📚', text: `${staleWaveSorting} 个波次分拣超时`, path: staleWaveSortingTarget?.waveId ? `/picking-waves?waveId=${staleWaveSortingTarget.waveId}&focus=wave-progress` : '/picking-waves' })
  if (healthAnomalies > 0) pushNotification(items, seen, { code: 'SYSTEM_HEALTH_ANOMALY', category: 'system', priority: 5, type: 'warning', icon: '🩺', text: `近 24 小时发现 ${healthAnomalies} 条系统异常记录`, path: '/reports/pda-anomaly' })

  items.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))

  return {
    total: items.length,
    items,
    counts: {
      lowStockCount,
      pendingPurchase,
      pendingSale,
      unpaidPayable,
      unpaidReceivable,
      pendingTransfer,
      overduePayable,
      overdueReceivable,
      pendingInbound,
      expiringCount,
      staleCount,
      failedPrintJobs,
      inboundPrintFailures,
      overdueInboundPutaway,
      outboundPrintFailures,
      staleWavePicking,
      staleWaveSorting,
      logisticsPrintFailures,
      healthAnomalies,
    },
  }
}

module.exports = {
  buildNotifications,
}
