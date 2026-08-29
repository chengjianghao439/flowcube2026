const svc = require('./inventory.service')
const aging = require('./inventory.aging')
const procurement = require('./inventory.procurement')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')

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

/**
 * 修复缓存漂移（成本对账页「修复缓存」按钮后端）：
 * 仅重算存在漂移的组合;非超管只修自己 scope 内的仓库(scopeWarehouseIds 由 auth 中间件注入,
 * 超管恒 null=全仓)。与 check-consistency 同权限(INVENTORY_TRACE_VIEW)。
 */
async function resyncStock(req, res, next) {
  try {
    const result = await svc.resyncStock({ scopeWarehouseIds: req.user?.warehouseIds ?? null })
    return successResponse(res, result, result.fixed > 0 ? `已修复 ${result.fixed} 项漂移` : '缓存与容器一致，无需修复')
  } catch (e) { next(e) }
}

async function stock(req, res, next) {
  try {
    const result = await svc.getStock({
      page: +req.query.page||1, pageSize: +req.query.pageSize||20,
      keyword: req.query.keyword||'',
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
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
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
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
      requestKey: extractRequestKey(req),
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

async function containerLogs(req, res, next) {
  try {
    return successResponse(res, await svc.getContainerLogs(+req.params.id), '查询成功')
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
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
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

async function queryByBarcode(req, res, next) {
  try {
    const barcode = String(req.query.barcode || '').trim()
    if (!barcode) return res.status(400).json({ success: false, message: '缺少条码参数', data: null })
    const result = await svc.queryByBarcode(barcode, {
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function queryByProduct(req, res, next) {
  try {
    const productId = req.query.productId ? +req.query.productId : null
    if (!productId) return res.status(400).json({ success: false, message: '缺少 productId 参数', data: null })
    const warehouseId = req.query.warehouseId ? +req.query.warehouseId : null
    const result = await svc.queryByProduct({
      productId,
      warehouseId,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
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
    const { qty, remark, printLabel, targetContainerId } = req.body
    const result = await svc.splitContainerOp(id, {
      qty,
      remark,
      printLabel: !!printLabel,
      targetContainerId: targetContainerId != null ? Number(targetContainerId) : null,
      userId:     req.user.userId,
      userName:   req.user.realName || req.user.username || null,
    })
    return successResponse(res, result, '拆分成功')
  } catch (e) { next(e) }
}

async function replenishment(req, res, next) {
  try {
    const result = await svc.getReplenishment({
      page:        +req.query.page     || 1,
      pageSize:    +req.query.pageSize  || 20,
      keyword:      req.query.keyword   || '',
      warehouseId:  req.query.warehouseId ? +req.query.warehouseId : null,
      categoryId:   req.query.categoryId  ? +req.query.categoryId  : null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function stockPolicies(req, res, next) {
  try {
    const productId = req.query.productId ? +req.query.productId : null
    if (!productId) return res.status(400).json({ success: false, message: '缺少 productId', data: null })
    const result = await svc.getStockPolicies({ productId })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function saveStockPolicies(req, res, next) {
  try {
    const result = await svc.saveStockPolicies(req.body.items)
    return successResponse(res, result, '保存成功')
  } catch (e) { next(e) }
}

async function inventoryAging(req, res, next) {
  try {
    const result = await aging.getInventoryAging({
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
      keyword: req.query.keyword || '',
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
      staleDays: req.query.staleDays ? +req.query.staleDays : 90,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function expiryAlerts(req, res, next) {
  try {
    const result = await aging.getExpiryAlerts({
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
      warnDays: req.query.warnDays ? +req.query.warnDays : 30,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function procurementPlan(req, res, next) {
  try {
    const result = await procurement.getProcurementPlan({
      window: req.query.window ? +req.query.window : 30,
      horizon: req.query.horizon ? +req.query.horizon : 30,
      keyword: req.query.keyword || '',
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
      defaultLeadTime: req.query.defaultLeadTime ? +req.query.defaultLeadTime : 7,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

module.exports = {
  trace,
  replenishment,
  stockPolicies,
  saveStockPolicies,
  inventoryAging,
  expiryAlerts,
  procurementPlan,
  checkConsistency,
  resyncStock,
  stock,
  logs,
  inbound,
  outbound,
  adjust,
  overview,
  containers,
  containerLogs,
  containerByBarcode,
  queryByBarcode,
  queryByProduct,
  assignContainerLocation,
  splitContainer,
}
