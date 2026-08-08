const { exportXlsx, exportStatementXlsx } = require('../../utils/excelExport')
const exportService = require('./export.service')

async function sendExport(res, payload) {
  await exportXlsx(res, payload.filename, payload.sheetName, payload.columns, payload.rows)
}

async function exportPurchase(req, res, next) {
  try {
    await sendExport(res, await exportService.getPurchaseExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportSale(req, res, next) {
  try {
    await sendExport(res, await exportService.getSaleExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportReconciliation(req, res, next) {
  try {
    await sendExport(res, await exportService.getReconciliationExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportInboundTasks(req, res, next) {
  try {
    await sendExport(res, await exportService.getInboundTasksExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportStock(req, res, next) {
  try {
    await sendExport(res, await exportService.getStockExportPayload(req.user?.warehouseIds ?? null))
  } catch (error) {
    next(error)
  }
}

async function exportInventoryLogs(req, res, next) {
  try {
    await sendExport(res, await exportService.getInventoryLogsExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportTransfer(req, res, next) {
  try {
    await sendExport(res, await exportService.getTransferExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportPurchaseReturns(req, res, next) {
  try {
    await sendExport(res, await exportService.getPurchaseReturnsExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportSaleReturns(req, res, next) {
  try {
    await sendExport(res, await exportService.getSaleReturnsExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null }))
  } catch (error) {
    next(error)
  }
}

async function exportPayments(req, res, next) {
  try {
    await sendExport(res, await exportService.getPaymentsExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

async function exportPaymentReceipts(req, res, next) {
  try {
    await sendExport(res, await exportService.getPaymentReceiptsExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

async function exportStatements(req, res, next) {
  try {
    await sendExport(res, await exportService.getStatementsExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

/** 单张对账单：正式单据格式，可直接发给往来方签字确认 */
async function exportStatementDetail(req, res, next) {
  try {
    const payload = await exportService.getStatementDetailExportPayload(Number(req.params.id))
    await exportStatementXlsx(res, payload.meta, payload.items)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  exportPurchase,
  exportSale,
  exportReconciliation,
  exportInboundTasks,
  exportStock,
  exportInventoryLogs,
  exportTransfer,
  exportPurchaseReturns,
  exportSaleReturns,
  exportPayments,
  exportPaymentReceipts,
  exportStatements,
  exportStatementDetail,
}
