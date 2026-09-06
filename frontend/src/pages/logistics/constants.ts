/**
 * 物流运单 — 模块内共享状态常量
 * 列表页与查询弹窗共用，避免两处各自定义一份导致漂移。
 * 注意：本表不含「全部状态」项——列表页（value='all'）与查询弹窗（value='__all__'）
 * 各自维护这个占位值，这里只收敛真实的 6 个状态。
 */
export const WAYBILL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: '待取号' },
  { value: '2', label: '取号中' },
  { value: '3', label: '已取号' },
  { value: '4', label: '取号失败' },
  { value: '5', label: '已作废' },
  { value: '6', label: '下单待核实' },
]
