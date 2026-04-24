const query = require('./print-jobs.query')
const command = require('./print-jobs.command')
const dispatch = require('./print-jobs.dispatch')
const printDispatch = require('./print-dispatch')
const template = require('./print-jobs.template')
const labelCommand = require('./print-jobs.label-command')
const { STATUS, parseListStatus, EXPIRE_MESSAGE } = require('./print-jobs.status')

dispatch.startPrintJobSweeper()

/**
 * @deprecated 打印域兼容门面。
 * 新代码应按职责直接依赖：
 * - print-jobs.query：查询
 * - print-jobs.command：创建、状态变更、回执
 * - print-jobs.dispatch：客户端领取、分发提示、过期扫描
 * - print-jobs.label-command：标签打印任务入队、补打
 * - print-jobs.template：纯打印内容生成
 */

async function findAll(params) {
  return query.findAll(params)
}

async function getStatsCounts() {
  return query.getStatsCounts()
}

module.exports = {
  findAll,
  findById: query.findById,
  create: command.create,
  assertQueueReady: command.assertQueueReady,
  complete: command.complete,
  completeLocalDesktop: command.completeLocalDesktop,
  fail: command.fail,
  retry: command.retry,
  claimClientJobs: dispatch.claimClientJobs,
  expireStaleJobs: dispatch.expireStaleJobs,
  getStatsCounts,
  listPrinterHealth: query.listPrinterHealth,
  findBarcodeRecords: query.findBarcodeRecords,
  reprintBarcodeRecord: labelCommand.reprintBarcodeRecord,
  STATUS,
  parseListStatus,
  enqueueContainerLabelJob: labelCommand.enqueueContainerLabelJob,
  enqueueRackLabelJob: labelCommand.enqueueRackLabelJob,
  enqueueProductLabelJob: labelCommand.enqueueProductLabelJob,
  getDispatchHintForJob: dispatch.getDispatchHintForJob,
  enqueuePackageLabelJob: labelCommand.enqueuePackageLabelJob,
  buildContainerLabelZpl: template.buildContainerLabelZpl,
  buildRackLabelZpl: template.buildRackLabelZpl,
  buildProductLabelZpl: template.buildProductLabelZpl,
  buildPackageLabelZpl: template.buildPackageLabelZpl,
  EXPIRE_MESSAGE,
  normalizeJobType: printDispatch.normalizeJobType,
  resolvePrinterForJob: printDispatch.resolvePrinterForJob,
}
