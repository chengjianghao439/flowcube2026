const { successResponse } = require('../../utils/response')
const svc = require('./containers.service')

async function overdue(req, res, next) {
  try {
    const data = await svc.listOverduePending()
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { overdue }
