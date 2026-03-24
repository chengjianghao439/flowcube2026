const svc = require('./packages.service')
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
    const result = await svc.finishPackage(+req.params.id)
    return successResponse(res, result, '打包完成')
  } catch (e) { next(e) }
}

async function getByBarcode(req, res, next) {
  try {
    const result = await svc.getByBarcode(req.params.barcode)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { list, create, addItem, finish, getByBarcode }
