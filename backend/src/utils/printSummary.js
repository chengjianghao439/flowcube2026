function createPackagePrintSummary(totalPackages = 0) {
  return {
    totalPackages: Number(totalPackages || 0),
    noJobCount: 0,
    pendingCount: 0,
    processingCount: 0,
    successCount: 0,
    failedCount: 0,
    timeoutCount: 0,
    recentError: null,
    recentPrinter: null,
  }
}

function addLatestPrintJobToSummary(summary, row, { timeoutMinutes } = {}) {
  if (!row || row.job_id == null) {
    summary.noJobCount += 1
    return summary
  }

  const status = Number(row.status)
  const timeoutMs = Number(timeoutMinutes || 0) * 60 * 1000
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0
  const timedOut = (status === 0 || status === 1) && timeoutMs > 0 && updatedAt > 0 && (Date.now() - updatedAt) >= timeoutMs

  if (status === 2) summary.successCount += 1
  else if (status === 3) summary.failedCount += 1
  else if (timedOut) summary.timeoutCount += 1
  else if (status === 0) summary.pendingCount += 1
  else if (status === 1) summary.processingCount += 1

  if (!summary.recentError && row.error_message) summary.recentError = row.error_message
  if (!summary.recentPrinter && (row.printer_code || row.printer_name)) summary.recentPrinter = row.printer_code || row.printer_name
  return summary
}

function buildPackagePrintSummary(rows, totalPackages, { timeoutMinutes } = {}) {
  const summary = createPackagePrintSummary(totalPackages)
  for (const row of rows || []) {
    addLatestPrintJobToSummary(summary, row, { timeoutMinutes })
  }
  return summary
}

module.exports = {
  createPackagePrintSummary,
  addLatestPrintJobToSummary,
  buildPackagePrintSummary,
}
