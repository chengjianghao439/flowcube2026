const svc = require('./hr.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const op = req => getOperatorFromRequest(req)
const cid = req => req.companyId || 1

const employeeList = async (req, res, next) => { try { return successResponse(res, await svc.listEmployees({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, keyword: req.query.keyword || '', companyId: cid(req) }), '查询成功') } catch (e) { next(e) } }
const employeeCreate = async (req, res, next) => { try { return successResponse(res, await svc.createEmployee(req.body, op(req), cid(req)), '创建成功', 201) } catch (e) { next(e) } }
const payrollList = async (req, res, next) => { try { return successResponse(res, await svc.listPayrolls({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, period: req.query.period || '', companyId: cid(req) }), '查询成功') } catch (e) { next(e) } }
const payrollCreate = async (req, res, next) => { try { return successResponse(res, await svc.createPayroll(req.body, op(req), cid(req)), '创建成功', 201) } catch (e) { next(e) } }
const payrollCalculate = async (req, res, next) => { try { return successResponse(res, await svc.calculatePayroll(+req.params.id, op(req), cid(req)), '核算完成') } catch (e) { next(e) } }
const payrollPay = async (req, res, next) => { try { return successResponse(res, await svc.payPayroll(+req.params.id, req.body, op(req), cid(req)), '已发放') } catch (e) { next(e) } }

module.exports = { employeeList, employeeCreate, payrollList, payrollCreate, payrollCalculate, payrollPay }
