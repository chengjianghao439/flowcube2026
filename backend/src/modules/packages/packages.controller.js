const svc = require('./packages.service')
const printJobs = require('../print-jobs/print-jobs.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const {
  beginOperationRequest,
  completeOperationRequest,
  failOperationRequest,
} = require('../../utils/operationRequest')
const { pool } = require('../../config/db')

async function list(req, res, next) {
  try {
    const taskId = +req.query.taskId
    if (!taskId) return res.status(400).json({ success: false, message: '缺少 taskId', data: null })
    const result = await svc.listByTask(taskId)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function create(req, res, next) {
  try {
    const { warehouseTaskId, remark } = req.body
    const result = await svc.createPackage(warehouseTaskId, remark)
    return successResponse(res, result, '箱子已创建')
  } catch (e) { next(e) }
}

async function addItem(req, res, next) {
  try {
    const packageId = +req.params.id
    const { productCode, qty } = req.body
    const result = await svc.addItem(packageId, { productCode, qty })
    return successResponse(res, result, '商品已加入箱子')
  } catch (e) { next(e) }
}

async function finish(req, res, next) {
  const requestKey = extractRequestKey(req)
  const action = 'package.finish'
  try {
    const id = +req.params.id
    const requestState = await beginOperationRequest(pool, {
      requestKey,
      action,
      userId: req.user?.userId ?? null,
    })
    if (requestState.replay) {
      return successResponse(res, requestState.responseData, requestState.responseMessage || '箱子已完成并已进入打印链')
    }
    const result = await svc.finishPackage(id, {
      createdBy: req.user.userId,
    })
    await completeOperationRequest(pool, requestState, {
      data: result,
      message: '箱子已完成并已进入打印链',
      resourceType: 'package',
      resourceId: id,
    })
    return successResponse(res, result, '箱子已完成并已进入打印链')
  } catch (e) {
    await failOperationRequest({
      requestKey,
      action,
      userId: req.user?.userId ?? null,
      errorMessage: e?.message || '完成箱子失败',
    }).catch(() => {})
    next(e)
  }
}

async function printLabel(req, res, next) {
  const requestKey = extractRequestKey(req)
  const action = 'package.print-label'
  try {
    const requestState = await beginOperationRequest(pool, {
      requestKey,
      action,
      userId: req.user?.userId ?? null,
    })
    if (requestState.replay) {
      return successResponse(res, requestState.responseData, requestState.responseMessage || '已加入打印队列')
    }
    await printJobs.assertQueueReady({
      jobType: 'package_label',
      contentType: 'zpl',
    })
    const job = await printJobs.enqueuePackageLabelJob({
      packageId: +req.params.id,
      createdBy: req.user.userId,
      jobUniqueKey: (() => {
        const requestKey = extractRequestKey(req)
        return requestKey ? `package_label:${requestKey}` : null
      })(),
    })
    if (!job) {
      return res.status(409).json({ success: false, message: '箱贴未进入打印链，请检查打印配置后重试', data: null })
    }
    const payload = { queued: true, job }
    await completeOperationRequest(pool, requestState, {
      data: payload,
      message: '已加入打印队列',
      resourceType: 'print_job',
      resourceId: job.id,
    })
    return successResponse(res, payload, '已加入打印队列')
  } catch (e) {
    await failOperationRequest({
      requestKey,
      action,
      userId: req.user?.userId ?? null,
      errorMessage: e?.message || '箱贴打印失败',
    }).catch(() => {})
    next(e)
  }
}

async function getByBarcode(req, res, next) {
  try {
    const result = await svc.getByBarcode(req.params.barcode)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { list, create, addItem, finish, printLabel, getByBarcode }
