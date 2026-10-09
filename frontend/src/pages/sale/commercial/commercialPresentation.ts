export const SALE_KIT_TABLE_CLASSES = '[&_tr:has([data-sale-kit-line])]:bg-primary/[0.025] [&_tr:has([data-sale-kit-line])]:hover:bg-primary/[0.05] [&_tr:has([data-sale-kit-line])>td:first-child]:border-l [&_tr:has([data-sale-kit-line])>td:first-child]:border-l-primary/25'

/** 展示本组成的需求量；不替代服务端数量校验或提交载荷。 */
export function componentDisplayQuantity(baseQty: number, count: number | string): number | null {
  if (String(count).trim() === '' || !/^\d+(?:\.\d{1,2})?$/.test(String(count))) return null
  const quantity = Number(count)
  if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isFinite(baseQty)) return null
  return Math.round(baseQty * 100) * quantity / 100
}
