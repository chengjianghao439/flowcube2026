const svc = require('./printers.service')
const { successResponse } = require('../../utils/response')

const scopeOf = (req) => req.user?.warehouseIds ?? null

const list   = async (req, res, next) => { try { return successResponse(res, await svc.findAll({ type: req.query.type ? +req.query.type : undefined })) } catch(e) { next(e) } }
const detail = async (req, res, next) => { try { return successResponse(res, await svc.findById(+req.params.id, scopeOf(req))) } catch(e) { next(e) } }
const create = async (req, res, next) => { try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch(e) { next(e) } }
const update = async (req, res, next) => { try { return successResponse(res, await svc.update(+req.params.id, req.body, scopeOf(req))) } catch(e) { next(e) } }
const remove = async (req, res, next) => { try { await svc.remove(+req.params.id, scopeOf(req)); return successResponse(res, null) } catch(e) { next(e) } }

const updateClientAlias = async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { aliasName } = req.body
    const row = await svc.updateClientAlias(clientId, aliasName)
    if (!row) return res.status(404).json({ success: false, message: '客户端不存在' })
    return successResponse(res, row)
  } catch (e) { next(e) }
}

const heartbeatClient = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const clientId = String(body.clientId || '').trim().slice(0, 200)
    const hostname = String(body.hostname || '').trim().slice(0, 200)
    const printers = Array.isArray(body.printers) ? body.printers : []
    if (!clientId) return res.status(400).json({ success: false, message: 'clientId 必填' })
    if (!hostname) return res.status(400).json({ success: false, message: 'hostname 必填' })
    const result = await svc.heartbeatClient({ clientId, hostname, printerNames: printers, ip: req.ip })
    return successResponse(res, result)
  } catch (e) { next(e) }
}

const listOnlineClients = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listOnlineClients())
  } catch (e) { next(e) }
}

const listAllClients = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listAllClients())
  } catch (e) { next(e) }
}

module.exports = { list, detail, create, update, remove, listOnlineClients, listAllClients, updateClientAlias, heartbeatClient }
