interface ListBatch {
  list: unknown[]
  pagination: { page: number; pageSize: number; total: number }
}
function isListBatch(value: unknown): value is ListBatch {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ListBatch>
  return Array.isArray(candidate.list) && !!candidate.pagination
}

/** 页面拿到完整列表；后端仍以有界批次读取，失败不返回残缺的成功结果。 */
export async function collectAllRecords<T>(fetchBatch: (page: number, pageSize?: number) => Promise<T>, signal?: { readonly aborted: boolean }): Promise<T> {
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
  for (let page = 2; rows.length < total; page++) {
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
  if (rows.length !== total) throw new Error('列表数据已变化，请刷新后重试')
  return { ...first, list: rows, pagination: { ...first.pagination, page: 1, pageSize: rows.length, total } }
}
