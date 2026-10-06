const svc = require('./printers.service')
const { successResponse } = require('../../utils/response')

const scopeOf = (req) => req.user?.warehouseIds ?? null

const list   = async (req, res, next) => { try { return successResponse(res, await svc.findAll({ type: req.query.type ? +req.query.type : undefined, scopeWarehouseIds: scopeOf(req) })) } catch(e) { next(e) } }
const detail = async (req, res, next) => { try { return successResponse(res, await svc.findById(+req.params.id, scopeOf(req))) } catch(e) { next(e) } }
const create = async (req, res, next) => { try { return successResponse(res, await svc.create(req.body, scopeOf(req)), '创建成功', 201) } catch(e) { next(e) } }
const update = async (req, res, next) => { try { return successResponse(res, await svc.update(+req.params.id, req.body, scopeOf(req))) } catch(e) { next(e) } }
const remove = async (req, res, next) => { try { await svc.remove(+req.params.id, scopeOf(req)); return successResponse(res, null) } catch(e) { next(e) } }

const updateClientAlias = async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { aliasName } = req.body
    const row = await svc.updateClientAlias(clientId, aliasName, scopeOf(req))
    if (!row) return res.status(404).json({ success: false, message: '客户端不存在' })
    return successResponse(res, row)
  } catch (e) { next(e) }
}

const heartbeatClient = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const result = await svc.heartbeatClient({ identity: req.printClient, hostname: body.hostname, ip: req.ip, scopeWarehouseIds: scopeOf(req) })
    return successResponse(res, result)
  } catch (e) { next(e) }
}

const listOnlineClients = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listOnlineClients(scopeOf(req)))
  } catch (e) { next(e) }
}

const listAllClients = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listAllClients(scopeOf(req)))
  } catch (e) { next(e) }
}

const registrationWarehouses = async (req, res, next) => { try { return successResponse(res, await svc.registrationWarehouses(scopeOf(req))) } catch (e) { next(e) } }
const registerClient = async (req, res, next) => { try { return successResponse(res, await svc.registerClient(req.body, scopeOf(req)), '工作站已注册', 201) } catch (e) { next(e) } }
const revokeClient = async (req, res, next) => { try { return successResponse(res, await svc.revokeClient(req.params.clientId, scopeOf(req))) } catch (e) { next(e) } }
module.exports = { list, detail, create, update, remove, listOnlineClients, listAllClients, updateClientAlias, heartbeatClient, registrationWarehouses, registerClient, revokeClient }
