const svc = require('./carriers.service')
const { successResponse } = require('../../utils/response')

const list       = async (req, res, next) => { try { return successResponse(res, await svc.findAll({ page: +req.query.page||1, pageSize: +req.query.pageSize||20, keyword: req.query.keyword||'' })) } catch(e) { next(e) } }
const listActive = async (req, res, next) => { try { return successResponse(res, await svc.findAllActive()) } catch(e) { next(e) } }
const detail     = async (req, res, next) => { try { return successResponse(res, await svc.findById(+req.params.id)) } catch(e) { next(e) } }
const create     = async (req, res, next) => { try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch(e) { next(e) } }
const update     = async (req, res, next) => { try { await svc.update(+req.params.id, req.body); return successResponse(res, null, '保存成功') } catch(e) { next(e) } }
const remove     = async (req, res, next) => { try { await svc.remove(+req.params.id); return successResponse(res, null, '删除成功') } catch(e) { next(e) } }

module.exports = { list, listActive, detail, create, update, remove }
