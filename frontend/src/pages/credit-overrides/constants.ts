/**
 * 超额放行申请 — 模块内共享状态常量
 * 列表页与查询弹窗共用，避免两处各自定义一份导致漂移。
 */
export const CREDIT_OVERRIDE_STATUS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['1', '草稿'], ['2', '待审批'], ['3', '已批准'], ['4', '已驳回'], ['5', '已取消'],
]

export const CREDIT_OVERRIDE_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  CREDIT_OVERRIDE_STATUS_OPTIONS,
)
