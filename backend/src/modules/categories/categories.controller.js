const svc = require('./categories.service')
const { successResponse } = require('../../utils/response')

const tree   = async (req,res,next) => { try { return successResponse(res, await svc.getTree(),   '查询成功') } catch(e){next(e)} }
const flat   = async (req,res,next) => { try { return successResponse(res, await svc.getFlat(),   '查询成功') } catch(e){next(e)} }
const leaves = async (req,res,next) => { try { return successResponse(res, await svc.getLeaves(), '查询成功') } catch(e){next(e)} }
const detail = async (req,res,next) => { try { return successResponse(res, await svc.getById(+req.params.id), '查询成功') } catch(e){next(e)} }

const create = async (req,res,next) => { try { return successResponse(res, await svc.create(req.body, req.user?.userId), '创建成功', 201) } catch(e){next(e)} }
const update = async (req,res,next) => { try { await svc.update(+req.params.id, req.body, req.user?.userId); return successResponse(res, null, '更新成功') } catch(e){next(e)} }
const remove = async (req,res,next) => { try { await svc.remove(+req.params.id, req.user?.userId); return successResponse(res, null, '删除成功') } catch(e){next(e)} }
const toggle = async (req,res,next) => { try { await svc.toggleStatus(+req.params.id, req.body.status ? 1 : 0, req.user?.userId); return successResponse(res, null, '更新成功') } catch(e){next(e)} }

module.exports = { tree, flat, leaves, detail, create, update, remove, toggle }
