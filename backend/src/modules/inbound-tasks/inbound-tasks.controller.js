const svc = require('./inbound-tasks.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const { getOperatorFromRequest } = require('../../utils/operator')

const pendingContainers = async (req, res, next) => {
  try {
    const data = await svc.listAllPendingPutawayContainers(req.user?.warehouseIds ?? null)
    return successResponse(res, data)
  } catch (e) { next(e) }
}

/** status 支持单值或数组（?status=1&status=2），过滤掉非法值 */
function normalizeStatusParam(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const list = (Array.isArray(raw) ? raw : [raw]).map(v => +v).filter(n => Number.isFinite(n) && n > 0)
  return list.length ? list : null
}

const list = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, keyword = '', status, productId, warehouseId, operatorId, startDate, endDate, remark, supplierId } = req.query
    const data = await svc.findAll({
      page: +page, pageSize: +pageSize, keyword,
      status: normalizeStatusParam(status),
      productId: productId ? +productId : null,
      warehouseId: warehouseId ? +warehouseId : null,
      operatorId: operatorId ? +operatorId : null,
      startDate: startDate || null,
      endDate: endDate || null,
      remark: remark || null,
      supplierId: supplierId ? +supplierId : null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const purchaseItems = async (req, res, next) => {
  try {
    const data = await svc.findPurchasableItems({
      supplierId: req.query.supplierId,
      keyword: req.query.keyword || '',
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const create = async (req, res, next) => {
  try {
    const data = 'poId' in req.body
      ? await svc.createFromPoId(req.body.poId)
      : await svc.createManualTask(req.body)
    return successResponse(res, data, '入库任务已创建', 201)
  } catch (e) { next(e) }
}

const detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id, req.user?.warehouseIds ?? null)) } catch (e) { next(e) }
}

const submit = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.submit(+req.params.id, operator, req.user?.warehouseIds ?? null)
    return successResponse(res, data, '已提交到 PDA')
  } catch (e) { next(e) }
}

const reprint = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.reprint(+req.params.id, req.body || {}, operator)
    return successResponse(res, data, '补打任务已加入打印队列')
  } catch (e) { next(e) }
}

const containers = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listContainers(+req.params.id))
  } catch (e) { next(e) }
}

const receive = async (req, res, next) => {
  try {
    const data = await svc.receive(+req.params.id, req.body, {
      userId: req.user?.userId ?? null,
      requestKey: extractRequestKey(req),
      pdaWarehouseId: req.pda?.warehouseId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data, '收货成功')
  } catch (e) { next(e) }
}

const putaway = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.putaway(+req.params.id, req.body, operator, {
      requestKey: extractRequestKey(req),
      pdaWarehouseId: req.pda?.warehouseId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data, '上架成功')
  } catch (e) { next(e) }
}

const qaCheck = async (req, res, next) => {
  try {
    const data = await svc.qaCheck(+req.params.id, {
      productId: req.body.productId,
      passedQty: req.body.passedQty,
      rejectedQty: req.body.rejectedQty,
      concessionQty: req.body.concessionQty,
      reason: req.body.reason || null,
      userId: req.user?.userId ?? null,
      requestKey: extractRequestKey(req),
      pdaWarehouseId: req.pda?.warehouseId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data, '质检确认成功')
  } catch (e) { next(e) }
}

const cancel = async (req, res, next) => {
  try {
    await svc.cancel(+req.params.id, req.user?.warehouseIds ?? null)
    return successResponse(res, null, '任务已取消')
  } catch (e) { next(e) }
}

const voidReceipt = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.voidReceipt(+req.params.id, operator, req.user?.warehouseIds ?? null)
    return successResponse(res, data, '已撤回收货，恢复为待收货')
  } catch (e) { next(e) }
}

const closeReceiving = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    await svc.closeReceiving(+req.params.id, operator, req.user?.warehouseIds ?? null)
    return successResponse(res, null, '已结束收货，进入待上架')
  } catch (e) { next(e) }
}

const qaDispose = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.qaDispose(+req.params.id, {
      dispositionType: req.body.dispositionType,
      productIds: req.body.productIds || null,
      reason: req.body.reason || null,
      remark: req.body.remark || null,
      operator,
      requestKey: extractRequestKey(req),
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data, '拒收品处置成功')
  } catch (e) { next(e) }
}

const qaDispositions = async (req, res, next) => {
  try {
    const data = await svc.qaDispositionsByTask(+req.params.id)
    return successResponse(res, data)
  } catch (e) { next(e) }
}

// 拒收处置 PDA 物理扫出（文档07 Phase3）
const qaDisposePending = async (req, res, next) => {
  try {
    const data = await svc.qaDisposePending({ scopeWarehouseIds: req.user?.warehouseIds ?? null })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

const qaDisposeScanDetail = async (req, res, next) => {
  try {
    const data = await svc.qaDisposeScanDetail(+req.params.dispositionId, req.user?.warehouseIds ?? null)
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

const qaDisposeScanOut = async (req, res, next) => {
  try {
    const data = await svc.qaDisposeScanOut(+req.params.dispositionId, {
      barcode: req.body.barcode,
      requestKey: extractRequestKey(req),
      operator: getOperatorFromRequest(req),
      pdaWarehouseId: req.pda?.warehouseId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data, '扫出成功')
  } catch (e) { next(e) }
}

const qaSupplierReport = async (req, res, next) => {
  try {
    const data = await svc.qaSupplierReport({
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, data)
  } catch (e) { next(e) }
}

module.exports = { pendingContainers, list, purchaseItems, create, detail, submit, reprint, containers, receive, putaway, qaCheck, qaDispose, qaDispositions, qaDisposePending, qaDisposeScanDetail, qaDisposeScanOut, qaSupplierReport, cancel, voidReceipt, closeReceiving }
