const { successResponse } = require('../../utils/response')
const adminService = require('./admin.service')
const { getOperatorFromRequest } = require('../../utils/operator')

async function putaway(req, res, next) {
  try {
    const { taskId, containerId, locationId } = req.body
    await adminService.executePutaway({
      operator: getOperatorFromRequest(req),
      taskId,
      containerId,
      locationId,
    })
    return successResponse(res, null, '补录上架成功')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  putaway,
}
