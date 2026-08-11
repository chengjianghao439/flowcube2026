const svc = require('./departments.service')
const { successResponse } = require('../../utils/response')

const list = async (req, res, next) => { try { return successResponse(res, await svc.findAll(), '查询成功') } catch (e) { next(e) } }
const options = async (req, res, next) => { try { return successResponse(res, await svc.listOptions(), '查询成功') } catch (e) { next(e) } }
const create = async (req, res, next) => { try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch (e) { next(e) } }
const update = async (req, res, next) => { try { await svc.update(+req.params.id, req.body); return successResponse(res, null, '保存成功') } catch (e) { next(e) } }
const remove = async (req, res, next) => { try { await svc.remove(+req.params.id); return successResponse(res, null, '已删除') } catch (e) { next(e) } }

module.exports = { list, options, create, update, remove }
