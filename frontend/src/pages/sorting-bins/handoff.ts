const safeId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function sortingBinHandoffPath(taskId: unknown, warehouseId: unknown): string | null {
  return safeId(taskId) && safeId(warehouseId) ? `/sorting-bins?taskId=${taskId}&warehouseId=${warehouseId}` : null
}

export function readSortingBinHandoff(path: string): { taskId: number; warehouseId: number } | 'invalid' | null {
  const params = new URLSearchParams(path.split('?')[1] ?? '')
  if (!params.has('taskId') && !params.has('warehouseId')) return null
  const parse = (key: string) => {
    const values = params.getAll(key)
    if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null
    const value = Number(values[0])
    return safeId(value) ? value : null
  }
  const taskId = parse('taskId'), warehouseId = parse('warehouseId')
  return taskId && warehouseId ? { taskId, warehouseId } : 'invalid'
}
