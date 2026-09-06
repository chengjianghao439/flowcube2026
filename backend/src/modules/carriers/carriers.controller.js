const svc = require('./carriers.service')
const binding = require('./carriers.binding').createBindingService({ pool: require('../../config/db').pool })
const { successResponse } = require('../../utils/response')

const list       = async (req, res, next) => { try { return successResponse(res, await svc.findAll({ page: +req.query.page||1, pageSize: +req.query.pageSize||20, keyword: req.query.keyword||'' })) } catch(e) { next(e) } }
const listActive = async (req, res, next) => { try { return successResponse(res, await svc.findAllActive()) } catch(e) { next(e) } }
const detail     = async (req, res, next) => { try { return successResponse(res, await svc.findById(+req.params.id)) } catch(e) { next(e) } }
const create     = async (req, res, next) => { try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch(e) { next(e) } }
const update     = async (req, res, next) => { try { await svc.update(+req.params.id, req.body); return successResponse(res, null, '保存成功') } catch(e) { next(e) } }
const remove     = async (req, res, next) => { try { await svc.remove(+req.params.id); return successResponse(res, null, '删除成功') } catch(e) { next(e) } }

const accountBinding = async (req, res, next) => { try { return successResponse(res, await binding.get(+req.params.id, req.query.platform)) } catch (e) { next(e) } }
const saveAccountBinding = async (req, res, next) => { try { return successResponse(res, await binding.save(+req.params.id, req.body), '账号资料已保存') } catch (e) { next(e) } }
const createAccountBinding = async (req, res, next) => { try { return successResponse(res, await binding.create(req.body, { requestKey: require('../../utils/requestKey').extractRequestKey(req), userId: req.user.userId }), '账号已新增', 201) } catch (e) { next(e) } }
module.exports = { createAccountBinding, list, listActive, detail, create, update, remove, accountBinding, saveAccountBinding }
