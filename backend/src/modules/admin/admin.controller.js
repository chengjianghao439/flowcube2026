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
      // 管理员补录上架同样是真实库存写操作，必须带上调用方的仓库范围
      // （2026-09-18 审计 P1：此前只有权限码，限仓账号可对任意仓收货任务上架）
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, null, '补录上架成功')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  putaway,
}
