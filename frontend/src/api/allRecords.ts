interface ListBatch {
  list: unknown[]
  pagination: { page: number; pageSize: number; total: number }
}
function isListBatch(value: unknown): value is ListBatch {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ListBatch>
  return Array.isArray(candidate.list) && !!candidate.pagination
}

/**
 * 单个列表自动取齐的默认行数上限。
 *
 * 日志类表（operation_logs / inventory_logs / scan_logs）只增不减：没有上限时首屏要按
 * `总数 ÷ 200` 串行拉完全表，3.8 万条就是 190+ 次请求、几十秒才出结果——用户看到的是
 * 「查询不到东西」而不是「加载中」（2026-09-17 生产实际发生）。而且这个机制的设计是
 * "任一批失败或总数变化就整体报错、不返回残缺结果"，只增不减的表在拉取期间总数几乎必然变化，
 * 数据越多越容易整体失败。
 *
 * 超过上限时返回已取到的前 N 行并在 `truncated` 标记出来，由页面提示用户用筛选缩小范围——
 * 比"什么都不显示"或"等到超时"都更可用，也没有改变"后端仍以有界批次读取"的约定。
 */
const MAX_COLLECT_ROWS = 5000

/** 页面拿到完整列表；后端仍以有界批次读取，失败不返回残缺的成功结果。 */
export async function collectAllRecords<T>(
  fetchBatch: (page: number, pageSize?: number) => Promise<T>,
  signal?: { readonly aborted: boolean },
  maxRows: number = MAX_COLLECT_ROWS,
): Promise<T> {
  const assertActive = () => { if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError') }
  assertActive()
  const first = await fetchBatch(1)
  assertActive()
  if (!isListBatch(first)) return first
  const total = Number(first.pagination.total)
  const size = Number(first.pagination.pageSize)
  if (!Number.isSafeInteger(total) || total < 0 || (!Number.isSafeInteger(size) || size < 1) && total > 0) {
    throw new Error('列表数量信息无效，请刷新后重试')
  }
  const rows = [...first.list]
  const signatures = new Set<string>()
  const remember = (list: unknown[]) => {
    const signature = JSON.stringify([list.length, list[0], list[list.length - 1]])
    if (signatures.has(signature)) throw new Error('列表返回重复批次，请刷新后重试')
    signatures.add(signature)
  }
  if (rows.length) remember(rows)
  // 取到上限即停（不是取满 total）：超出部分由页面提示用户用筛选缩小范围
  const target = Math.min(total, Number.isSafeInteger(maxRows) && maxRows > 0 ? maxRows : MAX_COLLECT_ROWS)
  for (let page = 2; rows.length < target; page++) {
    if (!rows.length) throw new Error('列表数据不完整，请刷新后重试')
    assertActive()
    const next = await fetchBatch(page, size)
    assertActive()
    if (!isListBatch(next) || Number(next.pagination.total) !== total || Number(next.pagination.pageSize) !== size || Number(next.pagination.page) !== page) {
      throw new Error('列表数据已变化，请刷新后重试')
    }
    if (!next.list.length) throw new Error('列表数据不完整，请刷新后重试')
    remember(next.list)
    rows.push(...next.list)
  }
  if (rows.length > total) throw new Error('列表数据已变化，请刷新后重试')
  return {
    ...first,
    list: rows,
    pagination: { ...first.pagination, page: 1, pageSize: rows.length, total },
    // 只取到上限时标记出来（total 仍是真实总数），页面据此提示"仅显示前 N 条"
    truncated: rows.length < total,
  }
}
