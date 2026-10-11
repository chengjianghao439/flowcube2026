export type InboundFreightType = 1 | 2 | 3 | null
export const INBOUND_FREIGHT_LABEL = { 1: '寄付', 2: '到付', 3: '第三方付' } as const
/** 保留原输入做精度校验；空值和0各自保存，不将三位金额四舍五入。 */
export function parseInboundFreightAmount(raw: string): number | null {
  const value = raw.trim()
  if (!value) return null
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error('运费金额须为非负数，最多两位小数')
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount > 999999999999.99 || !Number.isSafeInteger(Math.round(amount * 100))) throw Error('运费金额超出可记录范围')
  return amount
}
