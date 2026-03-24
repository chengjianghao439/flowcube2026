const svc = require('./inventory.service')
const { successResponse } = require('../../utils/response')
const { pool } = require('../../config/db')

async function stock(req, res, next) {
  try {
    const result = await svc.getStock({
      page: +req.query.page||1, pageSize: +req.query.pageSize||20,
      keyword: req.query.keyword||'',
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
    })
    return successResponse(res, result, '查询成功')
  } catch(e){next(e)}
}

async function logs(req, res, next) {
  try {
    const result = await svc.getLogs({
      page: +req.query.page||1, pageSize: +req.query.pageSize||20,
      type: req.query.type ? +req.query.type : null,
      productId: req.query.productId ? +req.query.productId : null,
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
    })
    return successResponse(res, result, '查询成功')
  } catch(e){next(e)}
}

async function inbound(req, res, next) {
  try {
    // 获取操作人真实姓名
    const [[user]] = await pool.query('SELECT real_name FROM sys_users WHERE id=?', [req.user.userId])
    const result = await svc.changeStock({
      type: 1, ...req.body,
      operator: { userId: req.user.userId, realName: user?.real_name || '未知' },
    })
    return successResponse(res, result, '入库成功')
  } catch(e){next(e)}
}

async function outbound(req, res, next) {
  try {
    const [[user]] = await pool.query('SELECT real_name FROM sys_users WHERE id=?', [req.user.userId])
    const result = await svc.changeStock({
      type: 2, ...req.body,
      operator: { userId: req.user.userId, realName: user?.real_name || '未知' },
    })
    return successResponse(res, result, '出库成功')
  } catch(e){next(e)}
}

async function adjust(req, res, next) {
  try {
    const [[user]] = await pool.query('SELECT real_name FROM sys_users WHERE id=?', [req.user.userId])
    const result = await svc.changeStock({
      type: 3, ...req.body,
      operator: { userId: req.user.userId, realName: user?.real_name || '未知' },
    })
    return successResponse(res, result, '调整成功')
  } catch(e){next(e)}
}

async function containers(req, res, next) {
  try {
    const productId   = req.query.productId   ? +req.query.productId   : null
    const warehouseId = req.query.warehouseId ? +req.query.warehouseId : null
    if (!productId) return res.status(400).json({ success: false, message: '缺少 productId', data: null })
    const result = await svc.getContainers({ productId, warehouseId })
    return successResponse(res, result, '查询成功')
  } catch(e){next(e)}
}

async function overview(req, res, next) {
  try {
    const result = await svc.getOverview({
      page:        +req.query.page        || 1,
      pageSize:    +req.query.pageSize    || 20,
      keyword:      req.query.keyword     || '',
      warehouseId:  req.query.warehouseId ? +req.query.warehouseId : null,
      categoryId:   req.query.categoryId  ? +req.query.categoryId  : null,
    })
    return successResponse(res, result, '查询成功')
  } catch(e){next(e)}
}

async function containerByBarcode(req, res, next) {
  try {
    const result = await svc.getContainerByBarcode(req.params.bc)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function assignContainerLocation(req, res, next) {
  try {
    const containerId = +req.params.containerId
    const { locationId } = req.body
    if (!containerId || !locationId) return res.status(400).json({ success: false, message: 'containerId 和 locationId 必填', data: null })
    const result = await svc.assignContainerLocation(containerId, locationId)
    return successResponse(res, result, '上架成功')
  } catch (e) { next(e) }
}

module.exports = { stock, logs, inbound, outbound, adjust, overview, containers, containerByBarcode, assignContainerLocation }
