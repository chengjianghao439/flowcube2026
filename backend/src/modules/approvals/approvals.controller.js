const svc = require('./approvals.service')
const { successResponse } = require('../../utils/response')

const listFlows = async (req, res, next) => { try { return successResponse(res, await svc.listFlows({ bizType: req.query.bizType || '' }), '查询成功') } catch (e) { next(e) } }
const getFlow = async (req, res, next) => { try { return successResponse(res, await svc.getFlow(+req.params.id), '查询成功') } catch (e) { next(e) } }
const createFlow = async (req, res, next) => { try { return successResponse(res, await svc.createFlow(req.body), '创建成功', 201) } catch (e) { next(e) } }
const updateFlow = async (req, res, next) => { try { await svc.updateFlow(+req.params.id, req.body); return successResponse(res, null, '保存成功') } catch (e) { next(e) } }
const removeFlow = async (req, res, next) => { try { await svc.removeFlow(+req.params.id); return successResponse(res, null, '已删除') } catch (e) { next(e) } }
const listPending = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listPending({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20 }, req.user?.userId ?? null), '查询成功')
  } catch (e) { next(e) }
}
const getBizApproval = async (req, res, next) => {
  try {
    return successResponse(res, await svc.getBizApproval({ bizType: req.params.bizType, bizId: +req.params.bizId }), '查询成功')
  } catch (e) { next(e) }
}

module.exports = { listFlows, getFlow, createFlow, updateFlow, removeFlow, listPending, getBizApproval }
