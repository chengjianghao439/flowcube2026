export function inboundReadStatus(error: unknown): number | undefined {
  const value = error as { status?: number; response?: { status?: number } } | null
  return value?.status ?? value?.response?.status
}
export function inboundReadTitle(error: unknown, fallback = '收货订单读取失败'): string {
  const status = inboundReadStatus(error)
  return status === 403 ? '无权查看收货订单' : status === 404 ? '收货订单不存在或已删除' : fallback
}
export function blocksInboundRead(error: unknown): boolean {
  return [403, 404].includes(inboundReadStatus(error) ?? 0)
}
