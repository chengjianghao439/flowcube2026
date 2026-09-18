const svc = require('./packages.service')
const printJobs = require('../print-jobs/print-jobs.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const {
  beginResourceOperationRequest,
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
    const result = await svc.createPackage(warehouseTaskId, remark, req.user?.warehouseIds ?? null)
    return successResponse(res, result, '箱子已创建')
  } catch (e) { next(e) }
}

async function addItem(req, res, next) {
  try {
    const packageId = +req.params.id
    const { productCode, qty } = req.body
    const result = await svc.addItem(packageId, { productCode, qty }, req.user?.warehouseIds ?? null)
    return successResponse(res, result, '商品已加入箱子')
  } catch (e) { next(e) }
}

async function removeItem(req, res, next) {
  try {
    const packageId = +req.params.id
    const { itemId, qty } = req.body
    const result = await svc.removeItem(packageId, { itemId, qty }, req.user?.warehouseIds ?? null)
    return successResponse(res, result, result.removed ? '商品已移出箱子' : '数量已调整')
  } catch (e) { next(e) }
}

async function voidPackage(req, res, next) {
  try {
    const packageId = +req.params.id
    const result = await svc.voidPackage(packageId, req.user?.warehouseIds ?? null)
    return successResponse(res, result, '箱子已作废')
  } catch (e) { next(e) }
}

async function finish(req, res, next) {
  const requestKey = extractRequestKey(req)
  const action = 'package.finish'
  try {
    const id = +req.params.id
    // 资源绑定用 package id：它在本单事务开始前就已存在，且 finishPackage 内部会校验归属。
    const requestState = await beginResourceOperationRequest(pool, {
      requestKey,
      action,
      userId: req.user?.userId ?? null,
      resourceType: 'package',
      resourceId: id,
    })
    if (requestState.replay) {
      return successResponse(res, requestState.responseData, requestState.responseMessage || '箱子已完成并已进入打印链')
    }
    const result = await svc.finishPackage(id, {
      createdBy: req.user.userId,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
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
    const packageId = +req.params.id
    // 资源绑定用 package id 而不是完成后才产生的 print_job id——job.id 在 begin 时刻未知。
    // 下方两处 completeOperationRequest 也必须传 package/packageId，保持与旧行兼容判断一致。
    const requestState = await beginResourceOperationRequest(pool, {
      requestKey,
      action,
      userId: req.user?.userId ?? null,
      resourceType: 'package',
      resourceId: packageId,
    })
    if (requestState.replay) {
      return successResponse(res, requestState.responseData, requestState.responseMessage || '已加入打印队列')
    }
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
    if (job.unprintable) {
      // 2026-09-14：没有可用打印机时后端也会留一条打印记录（保证箱贴始终有记录、之后可补打），
      // 但这不等于「已加入打印队列」——必须明确提示先去绑定打印机，别让现场以为已经在打。
      const payload = { queued: false, job: null, noPrinter: true }
      await completeOperationRequest(pool, requestState, {
        data: payload,
        message: '未绑定可用打印机，已记录本次打印',
        resourceType: 'package',
        resourceId: packageId,
      })
      return successResponse(res, payload, '未绑定可用打印机，已记录本次打印；请先绑定打印机，再到打印记录页补打')
    }
    const dispatchHint = await printJobs.getDispatchHintForJob(job.printerCode, job.id)
    const payload = { queued: true, job: { ...job, dispatchHint } }
    await completeOperationRequest(pool, requestState, {
      data: payload,
      message: '已加入打印队列',
      resourceType: 'package',
      resourceId: packageId,
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

module.exports = { list, create, addItem, removeItem, voidPackage, finish, printLabel, getByBarcode }
