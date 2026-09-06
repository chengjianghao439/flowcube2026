const { successResponse } = require('../../utils/response')
const searchService = require('./search.service')

async function searchGlobal(req, res, next) {
  try {
    // 仓库数据权限（2026-08-21 审计 A.4 修复）：限仓用户只搜到自己仓库的单据；
    // 全局搜索不限制日期；旧客户端携带的日期参数不再参与过滤。
    const result = await searchService.searchGlobal(
      req.query.q,
      req.user?.warehouseIds ?? null,
      { type: req.query.type, beforeId: req.query.beforeId },
    )
    // 旧客户端保留数组响应；新客户端显式请求游标分页。
    return successResponse(res, req.query.paginated === '1'
      ? { items: result.data, nextCursors: result.nextCursors }
      : result.data, result.message)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  searchGlobal,
}
