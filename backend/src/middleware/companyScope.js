/**
 * 会计账套上下文（文档10 多账套地基）。
 *
 * 从请求头 X-Company-Id 取当前账套，挂 req.companyId（默认 1 = 主账套）。
 * 只对会计/固定资产等**账套隔离**的接口挂载（accounting / fixed-assets router 顶部）。
 * 账套 id 是内部维度，非安全边界——权限仍由 requirePermission 控制；
 * 这里只是让 service 层能按账套过滤，防止不同账套数据互相污染。
 */
const DEFAULT_COMPANY_ID = 1

function companyScope(req, res, next) {
  const raw = req.headers['x-company-id']
  const n = Number(raw)
  req.companyId = Number.isInteger(n) && n > 0 ? n : DEFAULT_COMPANY_ID
  next()
}

module.exports = { companyScope, DEFAULT_COMPANY_ID }
