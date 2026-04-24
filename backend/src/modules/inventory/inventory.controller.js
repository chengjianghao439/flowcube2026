const svc = require('./inventory.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

async function trace(req, res, next) {
  try {
    const productId = +req.params.productId
    if (!productId) return res.status(400).json({ success: false, message: 'productId 无效', data: null })
    const q = req.query || {}
    const includeLegacy = q.includeLegacy === '1' || q.includeLegacy === 'true'
    const containerId = q.containerId ? +q.containerId : null
    const sourceType = q.sourceType ? String(q.sourceType) : null
    const sourceRefId = q.sourceRefId != null && q.sourceRefId !== '' ? +q.sourceRefId : null
    const result = await svc.traceByProductId(productId, {
      containerId: containerId || null,
      sourceType: sourceType || null,
      sourceRefId: Number.isFinite(sourceRefId) && sourceRefId > 0 ? sourceRefId : null,
      includeLegacy,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function checkConsistency(req, res, next) {
  try {
    const q = req.query || {}
    const result = await svc.checkStockConsistency({
      productId: q.productId ? +q.productId : null,
      warehouseId: q.warehouseId ? +q.warehouseId : null,
      limit: q.limit ? +q.limit : 500,
    })
    return successResponse(res, result, result.ok ? '缓存与容器一致' : '发现差异')
  } catch (e) { next(e) }
}

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
    const result = await svc.changeStock({
      type: 1, ...req.body,
      operator: getOperatorFromRequest(req),
    })
    return successResponse(res, result, '入库成功')
  } catch(e){next(e)}
}

async function outbound(req, res, next) {
  try {
    const result = await svc.changeStock({
      type: 2, ...req.body,
      operator: getOperatorFromRequest(req),
    })
    return successResponse(res, result, '出库成功')
  } catch(e){next(e)}
}

async function adjust(req, res, next) {
  try {
    const result = await svc.changeStock({
      type: 3, ...req.body,
      operator: getOperatorFromRequest(req),
    })
    return successResponse(res, result, '调整成功')
  } catch(e){next(e)}
}

async function containers(req, res, next) {
  try {
    const productId   = req.query.productId   ? +req.query.productId   : null
    const warehouseId = req.query.warehouseId ? +req.query.warehouseId : null
    if (!productId) return res.status(400).json({ success: false, message: '缺少 productId', data: null })
    const includeLegacy = req.query.includeLegacy === '1' || req.query.includeLegacy === 'true'
    const result = await svc.getContainers({ productId, warehouseId, includeLegacy })
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

async function splitContainer(req, res, next) {
  try {
    const id = +req.params.id
    const { qty, remark, printLabel } = req.body
    const result = await svc.splitContainerOp(id, {
      qty,
      remark,
      printLabel: !!printLabel,
      userId:     req.user.userId,
    })
    return successResponse(res, result, '拆分成功')
  } catch (e) { next(e) }
}

module.exports = {
  trace,
  checkConsistency,
  stock,
  logs,
  inbound,
  outbound,
  adjust,
  overview,
  containers,
  containerByBarcode,
  assignContainerLocation,
  splitContainer,
}
