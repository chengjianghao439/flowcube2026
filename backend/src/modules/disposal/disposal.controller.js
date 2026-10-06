const svc = require('./disposal.service')
const handling = require('./disposal.handling')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')

async function suggestions(req, res, next) {
  try {
    const q = req.query || {}
    const result = await svc.getSuggestions({
      page: +q.page || 1,
      pageSize: +q.pageSize || 50,
      keyword: q.keyword || '',
      warehouseId: q.warehouseId ? +q.warehouseId : null,
      staleDays: q.staleDays ? +q.staleDays : 90,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function list(req, res, next) {
  try {
    const q = req.query || {}
    const result = await svc.findAll({
      page: +q.page || 1,
      pageSize: +q.pageSize || 20,
      keyword: q.keyword || '',
      status: q.status ? +q.status : null,
      warehouseId: q.warehouseId ? +q.warehouseId : null,
      startDate: q.startDate || '',
      endDate: q.endDate || '',
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function detail(req, res, next) {
  try {
    const result = await svc.findById(+req.params.id, req.user?.warehouseIds ?? null)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function create(req, res, next) {
  try {
    const body = req.body || {}
    const operator = getOperatorFromRequest(req)
    const result = await svc.create({
      warehouseId: body.warehouseId,
      remark: body.remark,
      items: body.items,
      operator,
      ...(body.disposalSource !== undefined ? { disposalSource: body.disposalSource, requestKey: extractRequestKey(req), disposalSourceAuthorized: require('../../middleware/auth').hasPermission(req, require('../../constants/permissions').PERMISSIONS.INVENTORY_DISPOSAL_VIEW) } : {}),
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '创建成功')
  } catch (e) { next(e) }
}

async function update(req, res, next) {
  try {
    const body = req.body || {}
    const result = await svc.update(+req.params.id, {
      warehouseId: body.warehouseId,
      remark: body.remark,
      items: body.items,
    }, req.user?.warehouseIds ?? null)
    return successResponse(res, result, '保存成功')
  } catch (e) { next(e) }
}

async function submit(req, res, next) {
  try {
    await svc.submit(+req.params.id, req.user?.warehouseIds ?? null)
    return successResponse(res, null, '已提交审批')
  } catch (e) { next(e) }
}

async function approve(req, res, next) {
  try {
    await svc.approve(+req.params.id, getOperatorFromRequest(req), req.user?.warehouseIds ?? null)
    return successResponse(res, null, '已审批通过')
  } catch (e) { next(e) }
}

async function reject(req, res, next) {
  try {
    await svc.reject(+req.params.id, {
      reason: (req.body || {}).reason,
      operator: getOperatorFromRequest(req),
    }, req.user?.warehouseIds ?? null)
    return successResponse(res, null, '已驳回')
  } catch (e) { next(e) }
}

async function dispose(req, res, next) {
  try {
    const result = await svc.dispose(+req.params.id, getOperatorFromRequest(req), req.user?.warehouseIds ?? null, extractRequestKey(req))
    return successResponse(res, result, '报废完成')
  } catch (e) { next(e) }
}

async function cancel(req, res, next) {
  try {
    await svc.cancel(+req.params.id, req.user?.warehouseIds ?? null)
    return successResponse(res, null, '已取消')
  } catch (e) { next(e) }
}

function handlingPermissions(req) {
  const { hasPermission } = require('../../middleware/auth')
  const { PERMISSIONS } = require('../../constants/permissions')
  return {
    targetViews: { sale_order: hasPermission(req, PERMISSIONS.SALE_ORDER_VIEW), purchase_return: hasPermission(req, PERMISSIONS.RETURN_ORDER_VIEW), inventory_disposal: hasPermission(req, PERMISSIONS.INVENTORY_DISPOSAL_VIEW) },
    authorization: { view: hasPermission(req, PERMISSIONS.INVENTORY_DISPOSAL_VIEW), create: hasPermission(req, PERMISSIONS.INVENTORY_DISPOSAL_CREATE), approve: hasPermission(req, PERMISSIONS.INVENTORY_DISPOSAL_APPROVE) },
  }
}
async function releaseHandlingLink(req, res, next) {
  try {
    const result = await handling.releaseLink(req.params.id, req.params.linkId, req.body, {
      requestKey: req.headers['x-request-key'] ?? req.headers['idempotency-key'], operator: getOperatorFromRequest(req), scopeWarehouseIds: req.user?.warehouseIds ?? null, authorization: handlingPermissions(req).authorization,
    })
    return successResponse(res, result, '原关联剩余量已解除')
  } catch (error) { next(error) }
}

// 不做 +value/first-value/默认真值折叠；单值安全ID与原UUID/key由领域服务核实。
async function handlingSources(req, res, next) {
  try {
    const q = req.query || {}
    const result = await handling.listSources({ page: q.page, pageSize: q.pageSize, productId: q.productId, warehouseId: q.warehouseId, handlingType: q.handlingType, targetViews: handlingPermissions(req).targetViews, scopeWarehouseIds: req.user?.warehouseIds ?? null })
    return successResponse(res, result, '查询成功')
  } catch (error) { next(error) }
}
async function handlingSource(req, res, next) {
  try { return successResponse(res, await handling.getSource(req.params.id, req.user?.warehouseIds ?? null, handlingPermissions(req).targetViews), '查询成功') }
  catch (error) { next(error) }
}
async function createHandlingSource(req, res, next) {
  try {
    const result = await handling.createSource(req.body, { requestKey: req.headers['x-request-key'] ?? req.headers['idempotency-key'], operator: getOperatorFromRequest(req), scopeWarehouseIds: req.user?.warehouseIds ?? null })
    return successResponse(res, result, '处理意图已保存')
  } catch (error) { next(error) }
}
async function ownHandlingOperation(req, res, next) {
  try {
    const q = req.query || {}
    const result = await handling.getOwnOperation({ operationUuid: req.params.operationUuid, intentUuid: q.intentUuid, action: q.action, requestKey: q.requestKey, userId: getOperatorFromRequest(req).userId, scopeWarehouseIds: req.user?.warehouseIds ?? null })
    return successResponse(res, result, '原操作结果')
  } catch (error) { next(error) }
}
async function conversionSnapshot(req, res, next) {
  try { return successResponse(res, await handling.getConversionSnapshot(req.params.id, req.user?.warehouseIds ?? null), '旧单签认快照') }
  catch (error) { next(error) }
}
async function signConversion(req, res, next) {
  try {
    const result = await handling.signConversion(req.params.id, req.body, { requestKey: extractRequestKey(req), operator: getOperatorFromRequest(req), authorization: handlingPermissions(req).authorization, scopeWarehouseIds: req.user?.warehouseIds ?? null })
    return successResponse(res, result, '旧整单签认已保存')
  } catch (error) { next(error) }
}
module.exports = { conversionSnapshot, signConversion, suggestions, list, detail, create, update, submit, approve, reject, dispose, cancel, handlingSources, handlingSource, createHandlingSource, ownHandlingOperation, releaseHandlingLink }
