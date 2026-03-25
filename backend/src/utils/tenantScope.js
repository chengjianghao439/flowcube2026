/**
 * 多租户：从 JWT / 用户上下文解析 tenant_id（可与 company_id 业务含义对齐）
 */
function getTenantId(req) {
  if (!req?.user) return 0
  const t = req.user.tenantId ?? req.user.companyId
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

module.exports = { getTenantId }
