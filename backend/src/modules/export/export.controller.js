const { exportXlsx, exportStatementXlsx } = require('../../utils/excelExport')
const exportService = require('./export.service')
const { PERMISSIONS } = require('../../constants/permissions')
const { getOperatorFromRequest } = require('../../utils/operator')

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

// ── 后加实体导出（v0.4.79 批量补齐）───────────────────────────────────────────
async function exportWaybills(req, res, next) {
  try { await sendExport(res, await exportService.getWaybillsExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null })) } catch (e) { next(e) }
}
async function exportFixedAssets(req, res, next) {
  try { await sendExport(res, await exportService.getFixedAssetsExportPayload(req.query)) } catch (e) { next(e) }
}
async function exportExpenseClaims(req, res, next) {
  try {
    // 越权读防护（对齐 finance 列表口径）：无 VIEW_ALL 时强制导出自己的报销单
    const canViewAll = Number(req.user?.roleId) === 1 || (req.user?.permissions || []).includes(PERMISSIONS.FINANCE_EXPENSE_VIEW_ALL)
    const query = canViewAll ? req.query : { ...req.query, applicantId: getOperatorFromRequest(req).operatorId }
    await sendExport(res, await exportService.getExpenseClaimsExportPayload(query))
  } catch (e) { next(e) }
}
async function exportFinanceAccounts(req, res, next) {
  try { await sendExport(res, await exportService.getFinanceAccountsExportPayload()) } catch (e) { next(e) }
}
async function exportDisposals(req, res, next) {
  try { await sendExport(res, await exportService.getDisposalsExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null })) } catch (e) { next(e) }
}
async function exportAbc(req, res, next) {
  try { await sendExport(res, await exportService.getAbcExportPayload({ ...req.query, scopeWarehouseIds: req.user?.warehouseIds ?? null })) } catch (e) { next(e) }
}
async function exportCreditOverrides(req, res, next) {
  try { await sendExport(res, await exportService.getCreditOverridesExportPayload(req.query)) } catch (e) { next(e) }
}
async function exportPickingWaves(req, res, next) {
  try { await sendExport(res, await exportService.getPickingWavesExportPayload(req.query)) } catch (e) { next(e) }
}
async function exportUsers(req, res, next) {
  try { await sendExport(res, await exportService.getUsersExportPayload(req.query)) } catch (e) { next(e) }
}
async function exportOplogs(req, res, next) {
  try { await sendExport(res, await exportService.getOplogsExportPayload(req.query)) } catch (e) { next(e) }
}
async function exportCarriers(req, res, next) {
  try { await sendExport(res, await exportService.getCarriersExportPayload()) } catch (e) { next(e) }
}
async function exportPlasticBoxes(req, res, next) {
  try { await sendExport(res, await exportService.getPlasticBoxesExportPayload(req.query)) } catch (e) { next(e) }
}
async function exportLocations(req, res, next) {
  try { await sendExport(res, await exportService.getLocationsExportPayload()) } catch (e) { next(e) }
}
async function exportRacks(req, res, next) {
  try { await sendExport(res, await exportService.getRacksExportPayload()) } catch (e) { next(e) }
}
async function exportSortingBins(req, res, next) {
  try { await sendExport(res, await exportService.getSortingBinsExportPayload()) } catch (e) { next(e) }
}
async function exportSuppliers(req, res, next) {
  try { await sendExport(res, await exportService.getSuppliersExportPayload()) } catch (e) { next(e) }
}
async function exportCustomers(req, res, next) {
  try { await sendExport(res, await exportService.getCustomersExportPayload()) } catch (e) { next(e) }
}
async function exportAccountingPeriods(req, res, next) {
  try { await sendExport(res, await exportService.getAccountingPeriodsExportPayload()) } catch (e) { next(e) }
}
async function exportTaxAdjustments(req, res, next) {
  try { await sendExport(res, await exportService.getTaxAdjustmentsExportPayload(req.query)) } catch (e) { next(e) }
}
async function exportCompanies(req, res, next) {
  try { await sendExport(res, await exportService.getCompaniesExportPayload()) } catch (e) { next(e) }
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
  exportWaybills,
  exportFixedAssets,
  exportExpenseClaims,
  exportFinanceAccounts,
  exportDisposals,
  exportAbc,
  exportCreditOverrides,
  exportPickingWaves,
  exportUsers,
  exportOplogs,
  exportCarriers,
  exportPlasticBoxes,
  exportLocations,
  exportRacks,
  exportSortingBins,
  exportSuppliers,
  exportCustomers,
  exportAccountingPeriods,
  exportTaxAdjustments,
  exportCompanies,
}
