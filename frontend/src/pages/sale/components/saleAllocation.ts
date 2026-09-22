import { hasQuantityPrecision, roundQuantity } from '@/lib/qtyStep'

export function isAllocationQtyValid(qty: number, limit: number) {
  return hasQuantityPrecision(qty) && qty > 0 && qty <= limit + 1e-6
}

export function clampAllocationQty(qty: number, limit: number) {
  return roundQuantity(Math.max(0, Math.min(Number(qty) || 0, Math.max(0, Number(limit) || 0))))
}
