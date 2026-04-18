const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const {
  firstValue,
  mapWorkbenchItem,
  sortWorkbenchSections,
  pickTopWorkbenchCard,
  paymentStatusName,
  paymentTypeName,
  safeNum,
} = require('./reports.helpers')
const {
  fetchPurchaseStatsRows,
  fetchSaleStatsRows,
  fetchInventoryStatsRows,
  fetchPdaPerformanceRows,
  fetchWarehouseOpsRows,
  fetchRoleWorkbenchRows,
  fetchReconciliationRows,
  fetchProfitAnalysisRows,
} = require('./reports.query')

async function purchaseStats(params) {
  const { byMonth, bySupplier, byProduct } = await fetchPurchaseStatsRows(params)
  return {
    byMonth: byMonth.map(r => ({ month: r.month, orderCount: +r.order_count, totalAmount: +r.total_amount, receivedAmount: +r.received_amount })),
    bySupplier: bySupplier.map(r => ({ supplierName: r.supplier_name, orderCount: +r.order_count, totalAmount: +r.total_amount, receivedAmount: +r.received_amount })),
    byProduct: byProduct.map(r => ({ productName: r.product_name, totalQty: +r.total_qty, totalAmount: +r.total_amount })),
  }
}

async function saleStats(params) {
  const { byMonth, byCustomer, byProduct } = await fetchSaleStatsRows(params)
  return {
    byMonth: byMonth.map(r => ({ month: r.month, orderCount: +r.order_count, totalAmount: +r.total_amount, shippedAmount: +r.shipped_amount })),
    byCustomer: byCustomer.map(r => ({ customerName: r.customer_name, orderCount: +r.order_count, totalAmount: +r.total_amount })),
    byProduct: byProduct.map(r => ({ productName: r.product_name, totalQty: +r.total_qty, totalAmount: +r.total_amount })),
  }
}

async function inventoryStats(params) {
  const { turnover, byWarehouse } = await fetchInventoryStatsRows(params)
  return {
    turnover: turnover.map(r => ({ code: r.code, name: r.name, unit: r.unit, inboundQty: +r.inbound_qty, outboundQty: +r.outbound_qty, currentQty: +r.current_qty })),
    byWarehouse: byWarehouse.map(r => ({ warehouseName: r.warehouse_name, totalQty: +r.total_qty, totalValue: +r.total_value })),
  }
}

async function pdaPerformance() {
  const { todaySummary, byOperator, daily } = await fetchPdaPerformanceRows()
  const operators = byOperator.map(r => {
    const first = r.first_scan ? new Date(r.first_scan) : null
    const last = r.last_scan ? new Date(r.last_scan) : null
    const avgMinutes = (first && last && r.scan_count > 1)
      ? Math.round((last - first) / 1000 / 60)
      : null
    return {
      operatorId: r.operator_id,
      operatorName: r.operator_name || '未知',
      scanCount: Number(r.scan_count),
      pickQty: Number(r.pick_qty),
      avgMinutes,
    }
  })

  return {
    today: {
      scanCount: Number(todaySummary.scan_count),
      pickQty: Number(todaySummary.pick_qty),
    },
    topOperator: operators[0] || null,
    operators,
    daily: daily.map(d => ({
      date: d.date.toISOString ? d.date.toISOString().slice(0, 10) : String(d.date),
      scanCount: Number(d.scan_count),
      pickQty: Number(d.pick_qty),
    })),
  }
}

async function warehouseOps() {
  const {
    todayShipped,
    todayPicking,
    todayInbound,
    scanSummary,
    errSummary,
    undoSummary,
    byOperator,
    errByOp,
    flowRows,
    hourlyRows,
    recentErrors,
  } = await fetchWarehouseOpsRows()

  const totalScans = Number(scanSummary.scan_count)
  const totalErrors = Number(errSummary.error_count)
  const errorRate = totalScans > 0 ? `${(totalErrors / totalScans * 100).toFixed(1)}%` : '0%'

  const errOpMap = Object.fromEntries(errByOp.map(r => [r.operatorId, Number(r.errCount)]))
  const operators = byOperator.map(r => {
    const first = r.firstScan ? new Date(r.firstScan) : null
    const last = r.lastScan ? new Date(r.lastScan) : null
    const durationMin = (first && last) ? Math.round((last - first) / 60000) : null
    const sc = Number(r.scanCount)
    const ec = errOpMap[r.operatorId] ?? 0
    return {
      operatorId: r.operatorId,
      operatorName: r.operatorName || '未知',
      scanCount: sc,
      pickQty: Number(r.pickQty),
      errorCount: ec,
      errorRate: sc > 0 ? `${(ec / sc * 100).toFixed(1)}%` : '0%',
      durationMin,
      efficiency: (durationMin && durationMin > 0) ? (Number(r.pickQty) / durationMin).toFixed(1) : null,
    }
  })

  const STATUS_LABEL = { 1: '待拣货', 2: '拣货中', 3: '待复核', 4: '打包中', 5: '已完成' }
  const flowBottleneck = [1, 2, 3, 4, 5].map(s => ({
    status: s,
    label: STATUS_LABEL[s],
    count: Number(flowRows.find(r => r.status === s)?.cnt ?? 0),
  }))

  const hourlyTrend = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}:00`,
    count: Number(hourlyRows.find(r => r.hr === h)?.cnt ?? 0),
  })).filter((_, h) => h >= 6 && h <= 22)

  return {
    summary: {
      shippedToday: Number(todayShipped.shipped_count),
      pickingNow: Number(todayPicking.picking_count),
      inboundToday: Number(todayInbound.inbound_count),
      scanCount: totalScans,
      pickQty: Number(scanSummary.pick_qty),
      errorCount: totalErrors,
      undoCount: Number(undoSummary.undo_count),
      errorRate,
    },
    operators,
    flowBottleneck,
    hourlyTrend,
    recentErrors: recentErrors.map(r => ({
      id: r.id,
      taskId: r.taskId,
      barcode: r.barcode,
      reason: r.reason,
      operatorName: r.operatorName,
      createdAt: r.createdAt,
    })),
  }
}

async function roleWorkbench() {
  const thresholds = await getInboundClosureThresholds()
  const highRiskWindowHours = 24
  const rows = await fetchRoleWorkbenchRows({ thresholds, highRiskWindowHours })

  const sections = [
    {
      key: 'warehouse',
      title: '仓库角色',
      description: '收货、上架、审核和补打，聚焦一线仓库收口。',
      cards: [
        {
          key: 'warehouse-pending-receive',
          title: '待收货',
          description: '已建但尚未进入收货闭环的收货订单。',
          count: firstValue(rows.pendingReceiveCount, 'count'),
          path: rows.pendingReceiveRows[0] ? `/inbound-tasks/${rows.pendingReceiveRows[0].id}` : '/inbound-tasks',
          actionLabel: rows.pendingReceiveRows[0] ? '打开首单' : '查看收货订单',
          accent: 'blue',
          items: rows.pendingReceiveRows.map(mapWorkbenchItem),
        },
        {
          key: 'warehouse-putaway',
          title: '待上架',
          description: '已打印库存条码但尚未完成上架的容器。',
          count: firstValue(rows.waitingPutawayCount, 'count'),
          path: rows.waitingPutawayRows[0]?.path ?? '/inbound-tasks',
          actionLabel: rows.waitingPutawayRows[0] ? '打开首条' : '查看收货订单',
          accent: 'amber',
          items: rows.waitingPutawayRows.map(mapWorkbenchItem),
        },
        {
          key: 'warehouse-audit',
          title: '待复核',
          description: '已上架但还未完成审核的收货订单。',
          count: firstValue(rows.pendingAuditCount, 'count'),
          path: rows.pendingAuditRows[0]?.path ?? '/inbound-tasks',
          actionLabel: rows.pendingAuditRows[0] ? '打开首单' : '查看收货订单',
          accent: 'emerald',
          items: rows.pendingAuditRows.map(mapWorkbenchItem),
        },
        {
          key: 'warehouse-print',
          title: '打印失败待补打',
          description: '收货库存条码打印异常或超时待确认。',
          count: firstValue(rows.printFailureCount, 'count'),
          path: rows.printFailureRows[0]?.path ?? '/settings/barcode-print-query?category=inbound&status=failed',
          actionLabel: rows.printFailureRows[0] ? '打开首单' : '打开补打中心',
          accent: 'rose',
          items: rows.printFailureRows.map(mapWorkbenchItem),
        },
      ],
    },
    {
      key: 'sale',
      title: '销售/客服',
      description: '出库推进、价格风险和销售异常，优先看影响业务结果的单据。',
      cards: [
        {
          key: 'sale-pending-ship',
          title: '待出库',
          description: '已确认或已进入出库流程的销售单。',
          count: firstValue(rows.pendingShipCount, 'count'),
          path: rows.pendingShipRows[0]?.path ?? '/sale',
          actionLabel: rows.pendingShipRows[0] ? '打开首单' : '查看销售单',
          accent: 'blue',
          items: rows.pendingShipRows.map(mapWorkbenchItem),
        },
        {
          key: 'sale-anomaly',
          title: '异常销售单',
          description: '近期命中的销售相关高风险巡检问题。',
          count: firstValue(rows.saleAnomalyCount, 'count'),
          path: rows.saleAnomalyRows[0]?.path ?? '/reports/exception-workbench',
          actionLabel: rows.saleAnomalyRows[0] ? '查看首条' : '打开异常工作台',
          accent: 'rose',
          items: rows.saleAnomalyRows.map(mapWorkbenchItem),
        },
        {
          key: 'sale-below-cost',
          title: '低于进价单据',
          description: '存在低于成本价销售行的销售单。',
          count: firstValue(rows.belowCostCount, 'count'),
          path: rows.belowCostRows[0]?.path ?? '/sale',
          actionLabel: rows.belowCostRows[0] ? '打开首单' : '查看销售单',
          accent: 'amber',
          items: rows.belowCostRows.map(mapWorkbenchItem),
        },
      ],
    },
    {
      key: 'management',
      title: '管理角色',
      description: '看收口进度、异常任务和高风险问题，优先盯住会拖慢闭环的点。',
      cards: [
        {
          key: 'management-audit',
          title: '待审核收货单',
          description: '完成上架后等待管理审核的收货订单。',
          count: firstValue(rows.pendingAuditCount, 'count'),
          path: rows.pendingAuditRows[0]?.path ?? '/inbound-tasks',
          actionLabel: rows.pendingAuditRows[0] ? '打开首单' : '查看收货订单',
          accent: 'emerald',
          items: rows.pendingAuditRows.map(mapWorkbenchItem),
        },
        {
          key: 'management-anomaly-task',
          title: '异常任务',
          description: '销售/仓库流程中的巡检异常与任务延迟。',
          count: Math.max(firstValue(rows.saleAnomalyCount, 'count'), firstValue(rows.highRiskCount, 'count')),
          path: '/reports/exception-workbench',
          actionLabel: '打开异常工作台',
          accent: 'rose',
          items: rows.highRiskRows.map(mapWorkbenchItem),
        },
        {
          key: 'management-stock',
          title: '库存异常',
          description: '负库存、负预占和可用库存为负的风险项。',
          count: firstValue(rows.inventoryAnomalyCount, 'count'),
          path: '/inventory/overview',
          actionLabel: '查看库存总览',
          accent: 'amber',
          items: rows.inventoryAnomalyRows.map(mapWorkbenchItem),
        },
        {
          key: 'management-high-risk',
          title: '近期高风险问题',
          description: '最近 24 小时内的高风险巡检结果。',
          count: firstValue(rows.highRiskCount, 'count'),
          path: '/reports/exception-workbench',
          actionLabel: '打开异常工作台',
          accent: 'slate',
          items: rows.highRiskRows.map(mapWorkbenchItem),
        },
      ],
    },
  ]

  const summary = {
    totalAlerts: sections.reduce((sum, section) => sum + section.cards.reduce((cardSum, card) => cardSum + card.count, 0), 0),
    warehouseCount: sections[0].cards.reduce((sum, card) => sum + card.count, 0),
    saleCount: sections[1].cards.reduce((sum, card) => sum + card.count, 0),
    managementCount: sections[2].cards.reduce((sum, card) => sum + card.count, 0),
  }

  const sortedSections = sortWorkbenchSections(sections)
  return {
    summary,
    topAlert: pickTopWorkbenchCard(sortedSections),
    sections: sortedSections,
  }
}

async function reconciliationReport(params = {}) {
  const { typeNum, pageNum, pageSizeNum, summaryRow, countRow, rows } = await fetchReconciliationRows(params)
  const list = rows.map(row => ({
    id: Number(row.id),
    type: Number(row.type),
    typeName: paymentTypeName(row.type),
    orderId: row.order_id != null ? Number(row.order_id) : null,
    orderNo: row.order_no,
    partyName: row.party_name,
    totalAmount: safeNum(row.total_amount),
    paidAmount: safeNum(row.paid_amount),
    balance: safeNum(row.balance),
    status: Number(row.status),
    statusName: row.status_name || paymentStatusName(row.status),
    dueDate: row.due_date || null,
    remark: row.remark || null,
    statementName: row.statement_name,
    sourceOrderId: row.source_order_id != null ? Number(row.source_order_id) : null,
    sourceOrderNo: row.source_order_no || row.order_no,
    sourcePath: row.source_path || null,
    receiptTaskId: row.receipt_task_id != null ? Number(row.receipt_task_id) : null,
    receiptTaskNo: row.receipt_task_no || null,
    receiptPath: row.receipt_path || null,
    createdAt: row.created_at,
  }))

  return {
    summary: {
      totalRecords: Number(summaryRow.totalRecords || 0),
      totalAmount: safeNum(summaryRow.totalAmount),
      paidAmount: safeNum(summaryRow.paidAmount),
      balance: safeNum(summaryRow.balance),
      overdueCount: Number(summaryRow.overdueCount || 0),
      pendingCount: Number(summaryRow.pendingCount || 0),
    },
    list,
    type: typeNum,
    pagination: {
      page: pageNum,
      pageSize: pageSizeNum,
      total: Number(countRow.total || 0),
    },
  }
}

async function profitAnalysis(params = {}) {
  const { summaryRow, saleRows, productRows, stockRows, slowRows } = await fetchProfitAnalysisRows(params)
  const saleAmount = safeNum(summaryRow.saleAmount)
  const costAmount = safeNum(summaryRow.costAmount)

  return {
    summary: {
      saleAmount,
      costAmount,
      grossProfit: saleAmount - costAmount,
      stockValue: stockRows.reduce((sum, row) => sum + safeNum(row.total_value), 0),
      slowMovingValue: slowRows.reduce((sum, row) => sum + safeNum(row.stock_value), 0),
      slowMovingCount: slowRows.length,
    },
    saleOrders: saleRows.map(row => ({
      id: Number(row.id),
      orderNo: row.order_no,
      customerName: row.customer_name,
      warehouseName: row.warehouse_name,
      totalAmount: safeNum(row.total_amount),
      costAmount: safeNum(row.cost_amount),
      grossProfit: safeNum(row.gross_profit),
      marginRate: safeNum(row.total_amount) > 0 ? ((safeNum(row.gross_profit) / safeNum(row.total_amount)) * 100) : 0,
      path: `/sale/${row.id}`,
    })),
    products: productRows.map(row => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      unit: row.unit,
      totalQty: safeNum(row.total_qty),
      revenueAmount: safeNum(row.revenue_amount),
      costAmount: safeNum(row.cost_amount),
      grossProfit: safeNum(row.gross_profit),
      marginRate: safeNum(row.revenue_amount) > 0 ? ((safeNum(row.gross_profit) / safeNum(row.revenue_amount)) * 100) : 0,
      path: '/products',
    })),
    stockValue: stockRows.map(row => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      unit: row.unit,
      warehouseName: row.warehouse_name,
      totalQty: safeNum(row.total_qty),
      totalValue: safeNum(row.total_value),
      path: '/inventory/overview',
    })),
    slowMoving: slowRows.map(row => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      unit: row.unit,
      currentQty: safeNum(row.current_qty),
      stockValue: safeNum(row.stock_value),
      lastOutboundAt: row.last_outbound_at || null,
      outbound90d: safeNum(row.outbound_90d),
      path: '/inventory/overview',
    })),
  }
}

module.exports = {
  purchaseStats,
  saleStats,
  inventoryStats,
  pdaPerformance,
  warehouseOps,
  roleWorkbench,
  reconciliationReport,
  profitAnalysis,
}
