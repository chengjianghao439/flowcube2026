const metrics = require('./reports.metrics')
const trends = require('./reports.trends')

module.exports = {
  purchaseStats: metrics.purchaseStats,
  saleStats: metrics.saleStats,
  inventoryStats: metrics.inventoryStats,
  pdaPerformance: metrics.pdaPerformance,
  wavePerformance: trends.wavePerformance,
  warehouseOps: metrics.warehouseOps,
  roleWorkbench: metrics.roleWorkbench,
  reconciliationReport: metrics.reconciliationReport,
  profitAnalysis: metrics.profitAnalysis,
}
