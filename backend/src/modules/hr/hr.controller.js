const svc = require('./hr.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const AppError = require('../../utils/AppError')
const { getOperatorFromRequest } = require('../../utils/operator')

const op = req => getOperatorFromRequest(req)
const cid = req => req.companyId || 1

const employeeList = async (req, res, next) => { try { return successResponse(res, await svc.listEmployees({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, keyword: req.query.keyword || '', companyId: cid(req) }), '查询成功') } catch (e) { next(e) } }
const employeeCreate = async (req, res, next) => { try { return successResponse(res, await svc.createEmployee(req.body, op(req), cid(req)), '创建成功', 201) } catch (e) { next(e) } }
const payrollList = async (req, res, next) => { try { return successResponse(res, await svc.listPayrolls({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, period: req.query.period || '', companyId: cid(req) }), '查询成功') } catch (e) { next(e) } }
const payrollCreate = async (req, res, next) => { try { return successResponse(res, await svc.createPayroll(req.body, op(req), cid(req)), '创建成功', 201) } catch (e) { next(e) } }
const payrollGet = async (req, res, next) => { try { return successResponse(res, await svc.getPayroll(+req.params.id, cid(req)), '查询成功') } catch (e) { next(e) } }
const payrollLineUpdate = async (req, res, next) => {
  try {
    const requestKey = extractRequestKey(req)
    if (!requestKey || requestKey.length > 80) throw new AppError('请提供有效的 X-Request-Key（最多80字符）以防重复提交', 400)
    return successResponse(res, await svc.updatePayrollLine(+req.params.id, +req.params.lineId, req.body, op(req), cid(req), requestKey), '保存成功')
  } catch (e) { next(e) }
}
const payrollCalculate = async (req, res, next) => { try { return successResponse(res, await svc.calculatePayroll(+req.params.id, op(req), cid(req)), '核算完成') } catch (e) { next(e) } }
const payrollPay = async (req, res, next) => { try { return successResponse(res, await svc.payPayroll(+req.params.id, req.body, op(req), cid(req)), '已发放') } catch (e) { next(e) } }

module.exports = { employeeList, employeeCreate, payrollList, payrollCreate, payrollGet, payrollLineUpdate, payrollCalculate, payrollPay }
