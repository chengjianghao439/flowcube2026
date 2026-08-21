const { successResponse } = require('../../utils/response')
const searchService = require('./search.service')

async function searchGlobal(req, res, next) {
  try {
    // 仓库数据权限（2026-08-21 审计 A.4 修复）：限仓用户只搜到自己仓库的单据；
    // 时间筛选（YYYY-MM-DD）：默认由前端传当天，搜索最近创建的单据
    const result = await searchService.searchGlobal(
      req.query.q,
      req.user?.warehouseIds ?? null,
      { startDate: String(req.query.startDate || ''), endDate: String(req.query.endDate || '') },
    )
    return successResponse(res, result.data, result.message)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  searchGlobal,
}
