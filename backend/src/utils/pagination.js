/**
 * 列表分页参数归一化：page ≥ 1、pageSize 夹到 [1, 500]。
 *
 * 审计 4.1：前端曾大量用 pageSize=99999 全量拉取，后端各列表 service 对 pageSize
 * 不做上限控制。即使前端改成真分页，后端也必须 clamp——否则任何调用方传超大 pageSize
 * 都能让列表接口退化成全表拉取（内存 + 响应体积无界）。
 *
 * 所有列表 service 的 findAll 统一用它，替换手写的 `const offset = (page-1)*pageSize`。
 */
function normalizePagination({ page = 1, pageSize = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1)
  const ps = Math.min(500, Math.max(1, Number(pageSize) || 20))
  return { page: p, pageSize: ps, offset: (p - 1) * ps }
}

module.exports = { normalizePagination }
