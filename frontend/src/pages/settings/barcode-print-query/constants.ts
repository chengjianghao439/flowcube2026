/**
 * 条码打印查询 — 模块内共享状态常量
 * 列表页与查询弹窗共用，避免两处各自定义一份导致漂移。
 * 含「全部状态（__all__）」占位项，两份使用方均需要它。
 */
export const BARCODE_PRINT_STATUS_OPTIONS = [
  { value: '__all__', label: '全部状态' },
  { value: 'no_job', label: '未生成任务' },
  { value: 'queued', label: '待派发' },
  { value: 'printing', label: '打印中' },
  { value: 'success', label: '已打印' },
  { value: 'failed', label: '打印失败' },
  { value: 'timeout', label: '超时待确认' },
  { value: 'cancelled', label: '已取消' },
] as const
