const svc = require('./packages.service')
const printJobs = require('../print-jobs/print-jobs.service')
const { successResponse } = require('../../utils/response')

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
  try {
    const id = +req.params.id
    const result = await svc.finishPackage(id)
    try {
      await printJobs.enqueuePackageLabelJob({
        packageId: id,
        tenantId: req.user.tenantId ?? 0,
        createdBy: req.user.userId,
      })
    } catch (_) { /* 打印队列失败不阻断完成装箱 */ }
    return successResponse(res, result, '打包完成')
  } catch (e) { next(e) }
}

async function printLabel(req, res, next) {
  try {
    const job = await printJobs.enqueuePackageLabelJob({
      packageId: +req.params.id,
      tenantId: req.user.tenantId ?? 0,
      createdBy: req.user.userId,
    })
    return successResponse(res, { queued: !!job, job: job ?? null }, job ? '已加入打印队列' : '未配置标签机，未创建打印任务')
  } catch (e) { next(e) }
}

async function getByBarcode(req, res, next) {
  try {
    const result = await svc.getByBarcode(req.params.barcode)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { list, create, addItem, finish, printLabel, getByBarcode }
