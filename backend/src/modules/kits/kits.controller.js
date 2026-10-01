'use strict'
const svc = require('./kits.service')
const { asyncRoute } = require('../../utils/route')
const { successResponse } = require('../../utils/response')
const context = req => ({ userId: req.user.userId, scopeWarehouseIds: req.user.warehouseIds, requestKey: req.headers['x-request-key'] })
const list = asyncRoute(async (req, res) => successResponse(res, await svc.findAll(req.query)))
const detail = asyncRoute(async (req, res) => successResponse(res, await svc.findById(req.params.id, req.query.versionId)))
const finder = asyncRoute(async (req, res) => successResponse(res, await svc.findForFinder({ ...req.query, ...context(req) })))
const preview = asyncRoute(async (req, res) => successResponse(res, await svc.preview(req.body, context(req))))
const create = asyncRoute(async (req, res) => successResponse(res, await svc.create(req.body, context(req)), '创建成功', 201))
const update = asyncRoute(async (req, res) => successResponse(res, await svc.update(req.params.id, req.body, context(req)), '更新成功'))
const remove = asyncRoute(async (req, res) => successResponse(res, await svc.softDelete(req.params.id, req.body, context(req)), '删除成功'))
module.exports = { list, detail, finder, preview, create, update, remove }
