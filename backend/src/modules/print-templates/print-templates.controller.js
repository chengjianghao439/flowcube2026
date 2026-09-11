const svc = require('./print-templates.service')
const preview = require('./print-templates.preview')
const { renderLabelAsync } = require('../print-jobs/labelRasterService')
const { successResponse } = require('../../utils/response')

const list      = async (req, res, next) => { try { return successResponse(res, await svc.findAll({ type: req.query.type ? +req.query.type : null }), '查询成功') } catch (e) { next(e) } }
const detail    = async (req, res, next) => { try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') } catch (e) { next(e) } }
const create    = async (req, res, next) => { try { return successResponse(res, await svc.create({ ...req.body, createdBy: req.user?.username }), '创建成功', 201) } catch (e) { next(e) } }
const update    = async (req, res, next) => { try { await svc.update(+req.params.id, req.body); return successResponse(res, null, '保存成功') } catch (e) { next(e) } }
const setDefault= async (req, res, next) => { try { await svc.setDefault(+req.params.id); return successResponse(res, null, '已设为默认') } catch (e) { next(e) } }
const remove    = async (req, res, next) => { try { await svc.remove(+req.params.id); return successResponse(res, null, '删除成功') } catch (e) { next(e) } }

const previewData = async (req, res, next) => {
  try {
    return successResponse(res, await preview.findPreviewData(Number(req.query.type), req.user?.warehouseIds ?? null), '查询成功')
  } catch (error) { next(error) }
}

const renderLabel = async (req, res, next) => {
  try {
    const { layout, data, paperSize } = req.body || {}
    const { zpl: _zpl, ...result } = await renderLabelAsync({ layout, data, paperSize })
    res.set('Cache-Control', 'no-store')
    return successResponse(res, result, '绘制成功')
  } catch (error) { next(error) }
}

module.exports = { renderLabel, previewData, list, detail, create, update, setDefault, remove }
