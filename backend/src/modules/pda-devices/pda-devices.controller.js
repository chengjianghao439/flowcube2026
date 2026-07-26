const svc = require('./pda-devices.service')
const { successResponse } = require('../../utils/response')

const scope = req => req.user?.warehouseIds ?? null

const list = async (req, res, next) => {
  try {
    return successResponse(res, await svc.findAll({
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
      keyword: req.query.keyword || '',
      status: req.query.status || null,
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
      scopeWarehouseIds: scope(req),
    }), '查询成功')
  } catch (e) { next(e) }
}

const detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id, scope(req)), '查询成功') } catch (e) { next(e) }
}

const create = async (req, res, next) => {
  try {
    const data = await svc.create({ ...req.body, scopeWarehouseIds: scope(req) })
    return successResponse(res, data, '设备已登记，请立即在 PDA 上扫码绑定（密钥仅显示这一次）', 201)
  } catch (e) { next(e) }
}

const update = async (req, res, next) => {
  try {
    return successResponse(res, await svc.update(+req.params.id, { ...req.body, scopeWarehouseIds: scope(req) }), '保存成功')
  } catch (e) { next(e) }
}

const setStatus = async (req, res, next) => {
  try {
    const data = await svc.setStatus(+req.params.id, req.body.status, scope(req))
    const msg = req.body.status === 'active'
      ? '设备已启用'
      : `设备已停用，同时吊销了 ${data.revokedSessions} 个在用会话`
    return successResponse(res, data, msg)
  } catch (e) { next(e) }
}

const resetSecret = async (req, res, next) => {
  try {
    const data = await svc.resetSecret(+req.params.id, scope(req))
    return successResponse(res, data, `新密钥已生成，旧密钥作废，已吊销 ${data.revokedSessions} 个在用会话`)
  } catch (e) { next(e) }
}

module.exports = { list, detail, create, update, setStatus, resetSecret }
