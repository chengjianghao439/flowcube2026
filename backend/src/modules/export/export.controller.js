const { exportXlsx } = require('../../utils/excelExport')
const exportService = require('./export.service')

async function sendExport(res, payload) {
  await exportXlsx(res, payload.filename, payload.sheetName, payload.columns, payload.rows)
}

async function exportPurchase(req, res, next) {
  try {
    await sendExport(res, await exportService.getPurchaseExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

async function exportSale(req, res, next) {
  try {
    await sendExport(res, await exportService.getSaleExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

async function exportReconciliation(req, res, next) {
  try {
    await sendExport(res, await exportService.getReconciliationExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

async function exportInboundTasks(req, res, next) {
  try {
    await sendExport(res, await exportService.getInboundTasksExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

async function exportStock(req, res, next) {
  try {
    await sendExport(res, await exportService.getStockExportPayload())
  } catch (error) {
    next(error)
  }
}

async function exportInventoryLogs(req, res, next) {
  try {
    await sendExport(res, await exportService.getInventoryLogsExportPayload(req.query))
  } catch (error) {
    next(error)
  }
}

async function exportTransfer(req, res, next) {
  try {
    await sendExport(res, await exportService.getTransferExportPayload())
  } catch (error) {
    next(error)
  }
}

async function exportPurchaseReturns(req, res, next) {
  try {
    await sendExport(res, await exportService.getPurchaseReturnsExportPayload())
  } catch (error) {
    next(error)
  }
}

async function exportSaleReturns(req, res, next) {
  try {
    await sendExport(res, await exportService.getSaleReturnsExportPayload())
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
}
