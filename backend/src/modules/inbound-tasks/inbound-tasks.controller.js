const svc = require('./inbound-tasks.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const { getOperatorFromRequest } = require('../../utils/operator')

const pendingContainers = async (req, res, next) => {
  try {
    const data = await svc.listAllPendingPutawayContainers()
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const list = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, keyword = '', status, productId } = req.query
    const data = await svc.findAll({
      page: +page, pageSize: +pageSize, keyword,
      status: status ? +status : null,
      productId: productId ? +productId : null,
    })
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const purchaseItems = async (req, res, next) => {
  try {
    const data = await svc.findPurchasableItems({
      supplierId: req.query.supplierId,
      keyword: req.query.keyword || '',
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
  try { return successResponse(res, await svc.findById(+req.params.id)) } catch (e) { next(e) }
}

const submit = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.submit(+req.params.id, operator)
    return successResponse(res, data, '已提交到 PDA')
  } catch (e) { next(e) }
}

const audit = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.audit(+req.params.id, req.body || {}, operator)
    return successResponse(res, data, req.body?.action === 'reject' ? '已退回收货订单' : '已审核通过')
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
    })
    return successResponse(res, data, '收货成功')
  } catch (e) { next(e) }
}

const putaway = async (req, res, next) => {
  try {
    const operator = getOperatorFromRequest(req)
    const data = await svc.putaway(+req.params.id, req.body, operator, {
      requestKey: extractRequestKey(req),
    })
    return successResponse(res, data, '上架成功')
  } catch (e) { next(e) }
}

const cancel = async (req, res, next) => {
  try {
    await svc.cancel(+req.params.id)
    return successResponse(res, null, '任务已取消')
  } catch (e) { next(e) }
}

module.exports = { pendingContainers, list, purchaseItems, create, detail, submit, audit, reprint, containers, receive, putaway, cancel }
