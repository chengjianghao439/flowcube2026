const svc = require('./customer-addresses.service')
const { successResponse } = require('../../utils/response')

const list       = async (req, res, next) => { try { return successResponse(res, await svc.findByCustomer(+req.query.customerId), '查询成功') } catch (e) { next(e) } }
const create     = async (req, res, next) => { try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch (e) { next(e) } }
const update     = async (req, res, next) => { try { await svc.update(+req.params.id, req.body); return successResponse(res, null, '更新成功') } catch (e) { next(e) } }
const setDefault = async (req, res, next) => { try { await svc.setDefault(+req.params.id); return successResponse(res, null, '已设为默认') } catch (e) { next(e) } }
const remove     = async (req, res, next) => { try { await svc.softDelete(+req.params.id); return successResponse(res, null, '删除成功') } catch (e) { next(e) } }

module.exports = { list, create, update, setDefault, remove }
