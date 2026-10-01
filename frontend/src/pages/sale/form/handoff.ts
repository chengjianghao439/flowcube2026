export type SaleHandoff = { focus: 'fulfillment' | 'progress'; taskId?: number }
/** 仅读取本标签的本单交接；空值和重复值都不能被容错成有效任务。 */
export function readSaleHandoff(path: string, saleId: number): SaleHandoff | 'invalid' | null {
  const [pathname, search = ''] = path.split('?')
  if (pathname !== `/sale/${saleId}`) return null
  const params = new URLSearchParams(search)
  if (!params.has('focus') && !params.has('taskId')) return null
  const focus = params.getAll('focus'), tasks = params.getAll('taskId')
  if (focus.length !== 1 || !['fulfillment', 'progress'].includes(focus[0]) || tasks.length > 1) return 'invalid'
  if (params.has('taskId')) {
    if (focus[0] !== 'progress' || !/^[1-9]\d*$/.test(tasks[0])) return 'invalid'
    const taskId = Number(tasks[0])
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return 'invalid'
    return { focus: 'progress', taskId }
  }
  return { focus: focus[0] as SaleHandoff['focus'] }
}
