const svc = require('./fixed-assets.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const op = req => getOperatorFromRequest(req)
const cid = req => req.companyId || 1

const list = async (req, res, next) => { try { return successResponse(res, await svc.listAssets({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, keyword: req.query.keyword || '', status: req.query.status || '', companyId: cid(req) }), '查询成功') } catch (e) { next(e) } }
const summary = async (req, res, next) => { try { return successResponse(res, await svc.depreciationSummary({ period: req.query.period || '', companyId: cid(req) }), '查询成功') } catch (e) { next(e) } }
const detail = async (req, res, next) => { try { return successResponse(res, await svc.findAsset(+req.params.id, cid(req)), '查询成功') } catch (e) { next(e) } }
const create = async (req, res, next) => { try { return successResponse(res, await svc.createAsset(req.body, op(req), cid(req)), '创建成功', 201) } catch (e) { next(e) } }
const runDepreciation = async (req, res, next) => { try { return successResponse(res, await svc.runDepreciation({ period: req.body.period || '', companyId: cid(req) }, op(req)), '计提完成') } catch (e) { next(e) } }
const dispose = async (req, res, next) => { try { return successResponse(res, await svc.disposeAsset(+req.params.id, req.body, op(req), cid(req)), '处置完成') } catch (e) { next(e) } }

module.exports = { list, summary, detail, create, runDepreciation, dispose }
