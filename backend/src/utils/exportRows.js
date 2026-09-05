const AppError = require('./AppError')

const EXPORT_MAX_ROWS = 10000
function assertExportLimit(total) {
  if (total > EXPORT_MAX_ROWS) throw new AppError(`导出超过 ${EXPORT_MAX_ROWS} 条，请缩小查询范围后重试`, 400, 'EXPORT_ROW_LIMIT_EXCEEDED')
}

/** 复用列表筛选与权限；不放宽公共列表上限，不静默丢弃后续页。 */
async function collectExportRows(findPage, query = {}) {
  const list = []
  const seen = new Set()
  let expectedTotal
  for (let page = 1; ; page++) {
    const result = await findPage({ ...query, page, pageSize: 500 })
    const total = Number(result.pagination.total)
    assertExportLimit(total)
    if (!Number.isSafeInteger(total) || total < 0 || (expectedTotal != null && total !== expectedTotal)) {
      throw new AppError('导出期间数据发生变化，请重新导出', 409, 'EXPORT_DATA_CHANGED')
    }
    expectedTotal = total
    for (const row of result.list) {
      if (row.id != null && seen.has(String(row.id))) throw new AppError('导出期间数据发生变化，请重新导出', 409, 'EXPORT_DATA_CHANGED')
      if (row.id != null) seen.add(String(row.id))
      list.push(row)
    }
    assertExportLimit(list.length)
    if (list.length === total) return { list }
    if (!result.list.length || list.length > total) throw new AppError('导出期间数据发生变化，请重新导出', 409, 'EXPORT_DATA_CHANGED')
  }
}

module.exports = { collectExportRows, assertExportLimit, EXPORT_MAX_ROWS }
