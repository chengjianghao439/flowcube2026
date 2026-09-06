const svc = require('./purchase-requisitions.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')

// operator 补上 warehouseIds（getOperatorFromRequest 不含仓库数据权限，service 的 assertInScope 需要）
const op = req => ({ ...getOperatorFromRequest(req), warehouseIds: req.user?.warehouseIds ?? null })

const list = async (req, res, next) => { try { return successResponse(res, await svc.findAll({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, status: req.query.status || '', keyword: req.query.keyword || '', warehouseId: req.query.warehouseId || '', applicantId: req.query.applicantId || '', startDate: req.query.startDate || '', endDate: req.query.endDate || '' }, req.user?.warehouseIds ?? null), '查询成功') } catch (e) { next(e) } }
const detail = async (req, res, next) => { try { return successResponse(res, await svc.findById(+req.params.id, req.user?.warehouseIds ?? null), '查询成功') } catch (e) { next(e) } }
const create = async (req, res, next) => { try { return successResponse(res, await svc.create({ ...req.body, requestKey: extractRequestKey(req) }, op(req)), '创建成功', 201) } catch (e) { next(e) } }
const update = async (req, res, next) => { try { await svc.update(+req.params.id, req.body, op(req)); return successResponse(res, null, '保存成功') } catch (e) { next(e) } }
const submit = async (req, res, next) => { try { return successResponse(res, await svc.submit(+req.params.id, op(req)), '已提交审批') } catch (e) { next(e) } }
const withdraw = async (req, res, next) => { try { return successResponse(res, await svc.withdraw(+req.params.id, op(req)), '已撤回') } catch (e) { next(e) } }
const cancel = async (req, res, next) => { try { return successResponse(res, await svc.cancel(+req.params.id, op(req)), '已取消') } catch (e) { next(e) } }
const approve = async (req, res, next) => { try { return successResponse(res, await svc.approve(+req.params.id, op(req)), '已批准') } catch (e) { next(e) } }
const reject = async (req, res, next) => { try { return successResponse(res, await svc.reject(+req.params.id, req.body, op(req)), '已驳回') } catch (e) { next(e) } }
const convert = async (req, res, next) => { try { return successResponse(res, await svc.convert(+req.params.id, { ...req.body, requestKey: extractRequestKey(req) }, op(req)), '转采购单成功') } catch (e) { next(e) } }

module.exports = { list, detail, create, update, submit, withdraw, cancel, approve, reject, convert }
