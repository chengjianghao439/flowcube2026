const svc = require('./credit-overrides.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const op = req => getOperatorFromRequest(req)

const list = async (req, res, next) => {
  try {
    return successResponse(res, await svc.findAll({
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
      status: req.query.status || '',
      keyword: req.query.keyword || '',
      saleOrderId: req.query.saleOrderId || '',
      startDate: req.query.startDate || '',
      endDate: req.query.endDate || '',
    }), '查询成功')
  } catch (e) { next(e) }
}
const detail = async (req, res, next) => { try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') } catch (e) { next(e) } }
const create = async (req, res, next) => { try { return successResponse(res, await svc.create(req.body, op(req)), '创建成功', 201) } catch (e) { next(e) } }
const submit = async (req, res, next) => { try { return successResponse(res, await svc.submit(+req.params.id, op(req)), '已提交审批') } catch (e) { next(e) } }
const cancel = async (req, res, next) => { try { return successResponse(res, await svc.cancel(+req.params.id, op(req)), '已取消') } catch (e) { next(e) } }
const approve = async (req, res, next) => { try { return successResponse(res, await svc.approve(+req.params.id, op(req)), '已批准') } catch (e) { next(e) } }
const reject = async (req, res, next) => { try { return successResponse(res, await svc.reject(+req.params.id, req.body, op(req)), '已驳回') } catch (e) { next(e) } }

module.exports = { list, detail, create, submit, cancel, approve, reject }
