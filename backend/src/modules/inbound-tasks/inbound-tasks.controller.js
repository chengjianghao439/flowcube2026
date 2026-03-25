const svc = require('./inbound-tasks.service')
const { successResponse } = require('../../utils/response')
const { pool } = require('../../config/db')
const { getTenantId } = require('../../utils/tenantScope')

async function getOp(userId) {
  const [[u]] = await pool.query('SELECT id, username, real_name FROM sys_users WHERE id=?', [userId])
  return { userId: u.id, username: u.username, realName: u.real_name }
}

const pendingContainers = async (req, res, next) => {
  try {
    const data = await svc.listAllPendingPutawayContainers()
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const list = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, keyword = '', status } = req.query
    const data = await svc.findAll({
      page: +page, pageSize: +pageSize, keyword,
      status: status ? +status : null,
    })
    return successResponse(res, data)
  } catch (e) { next(e) }
}

const create = async (req, res, next) => {
  try {
    const data = await svc.createFromPoId(req.body.poId)
    return successResponse(res, data, '入库任务已创建', 201)
  } catch (e) { next(e) }
}

const detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id)) } catch (e) { next(e) }
}

const containers = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listContainers(+req.params.id))
  } catch (e) { next(e) }
}

const receive = async (req, res, next) => {
  try {
    const data = await svc.receive(+req.params.id, req.body, {
      userId: req.user?.userId ?? null,
      tenantId: getTenantId(req),
    })
    return successResponse(res, data, '收货成功')
  } catch (e) { next(e) }
}

const putaway = async (req, res, next) => {
  try {
    const operator = await getOp(req.user.userId)
    await svc.putaway(+req.params.id, req.body, operator)
    return successResponse(res, null, '上架成功')
  } catch (e) { next(e) }
}

const cancel = async (req, res, next) => {
  try {
    await svc.cancel(+req.params.id)
    return successResponse(res, null, '任务已取消')
  } catch (e) { next(e) }
}

module.exports = { pendingContainers, list, create, detail, containers, receive, putaway, cancel }
