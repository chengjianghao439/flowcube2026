const svc = require('./price-change.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const list = async (req, res, next) => {
  try {
    const q = req.query || {}
    // 非超管：只看自己的申请
    const isAdmin = Number(req.user?.roleId) === 1
    const result = await svc.findAll({
      page: +q.page || 1,
      pageSize: +q.pageSize || 20,
      keyword: q.keyword || '',
      status: q.status ? +q.status : null,
      productId: q.productId ? +q.productId : null,
      applicantId: isAdmin ? null : req.user?.userId ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

const detail = async (req, res, next) => {
  try {
    return successResponse(res, await svc.findById(+req.params.id), '查询成功')
  } catch (e) { next(e) }
}

const create = async (req, res, next) => {
  try {
    const result = await svc.create(req.body || {}, getOperatorFromRequest(req))
    return successResponse(res, result, '改价申请已创建', 201)
  } catch (e) { next(e) }
}

const submit = async (req, res, next) => {
  try {
    const result = await svc.submit(+req.params.id, getOperatorFromRequest(req))
    return successResponse(res, result, '已提交审批')
  } catch (e) { next(e) }
}

const approve = async (req, res, next) => {
  try {
    const result = await svc.approve(+req.params.id, getOperatorFromRequest(req))
    return successResponse(res, result, result.finished ? '审批通过，价格已生效' : '审批已通过本步骤')
  } catch (e) { next(e) }
}

const reject = async (req, res, next) => {
  try {
    const result = await svc.reject(+req.params.id, {
      reason: (req.body || {}).reason,
      operator: getOperatorFromRequest(req),
    })
    return successResponse(res, result, '已驳回')
  } catch (e) { next(e) }
}

const cancel = async (req, res, next) => {
  try {
    const result = await svc.cancel(+req.params.id, getOperatorFromRequest(req))
    return successResponse(res, result, '已取消')
  } catch (e) { next(e) }
}

module.exports = { list, detail, create, submit, approve, reject, cancel }
