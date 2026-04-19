const svc = require('./scan-logs.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')

const create = async (req, res, next) => {
  try {
    const operator = req.user || {}
    const data = await svc.createScanLog({
      ...req.body,
      operatorId:   operator.userId,
      operatorName: operator.realName || operator.username,
      requestKey: extractRequestKey(req),
    })
    return successResponse(res, data, '扫描记录已保存', 201)
  } catch (e) { next(e) }
}

const createCheckScan = async (req, res, next) => {
  try {
    const operator = req.user || {}
    const data = await svc.createCheckScanLog({
      taskId: req.body.taskId,
      barcode: req.body.barcode.trim(),
      operatorId:   operator.userId,
      operatorName: operator.realName || operator.username,
      requestKey: extractRequestKey(req),
    })
    return successResponse(res, data, data.allChecked ? '复核完成，已进入待打包' : '复核扫码已记录', 201)
  } catch (e) { next(e) }
}

const listByTask = async (req, res, next) => {
  try {
    const data = await svc.findByTask(+req.params.taskId)
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const logError = async (req, res, next) => {
  try {
    const operator = req.user || {}
    await svc.logScanError({
      ...req.body,
      operatorId:   operator.userId,
      operatorName: operator.realName || operator.username,
    })
    return successResponse(res, null, '错误日志已记录', 201)
  } catch (e) { next(e) }
}

const logUndo = async (req, res, next) => {
  try {
    const operator = req.user || {}
    await svc.logUndo({
      ...req.body,
      operatorId:   operator.userId,
      operatorName: operator.realName || operator.username,
    })
    return successResponse(res, null, '撤销日志已记录', 201)
  } catch (e) { next(e) }
}

const getStats = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query
    const data = await svc.getStats({ startDate, endDate })
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const getAnomalyReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query
    const data = await svc.getAnomalyReport({ startDate, endDate })
    return successResponse(res, data)
  } catch (e) { next(e) }
}

module.exports = { create, createCheckScan, listByTask, logError, logUndo, getStats, getAnomalyReport }
