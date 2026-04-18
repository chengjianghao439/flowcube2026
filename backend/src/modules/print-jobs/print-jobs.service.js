const query = require('./print-jobs.query')
const command = require('./print-jobs.command')
const dispatch = require('./print-jobs.dispatch')
const template = require('./print-jobs.template')
const { STATUS, parseListStatus, EXPIRE_MESSAGE } = require('./print-jobs.status')

dispatch.startPrintJobSweeper()

async function findAll(params) {
  await dispatch.expireStaleJobs()
  return query.findAll(params)
}

async function getStatsCounts() {
  await dispatch.expireStaleJobs()
  return query.getStatsCounts()
}

module.exports = {
  findAll,
  findById: query.findById,
  create: command.create,
  complete: command.complete,
  completeLocalDesktop: command.completeLocalDesktop,
  fail: command.fail,
  retry: command.retry,
  claimClientJobs: dispatch.claimClientJobs,
  expireStaleJobs: dispatch.expireStaleJobs,
  getStatsCounts,
  listPrinterHealth: query.listPrinterHealth,
  findBarcodeRecords: query.findBarcodeRecords,
  reprintBarcodeRecord: template.reprintBarcodeRecord,
  STATUS,
  parseListStatus,
  enqueueContainerLabelJob: template.enqueueContainerLabelJob,
  enqueueRackLabelJob: template.enqueueRackLabelJob,
  enqueueProductLabelJob: template.enqueueProductLabelJob,
  getDispatchHintForJob: dispatch.getDispatchHintForJob,
  enqueuePackageLabelJob: template.enqueuePackageLabelJob,
  buildContainerLabelZpl: template.buildContainerLabelZpl,
  buildRackLabelZpl: template.buildRackLabelZpl,
  buildProductLabelZpl: template.buildProductLabelZpl,
  buildPackageLabelZpl: template.buildPackageLabelZpl,
  EXPIRE_MESSAGE,
  normalizeJobType: command.normalizeJobType,
  resolvePrinterForJob: command.resolvePrinterForJob,
}
