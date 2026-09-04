export function isAllocationQtyValid(qty: number, limit: number) {
  return Number.isFinite(qty) && qty > 0 && qty <= limit + 1e-6 && Math.abs(qty - Math.round(qty * 10000) / 10000) < 1e-10
}

export function clampAllocationQty(qty: number, limit: number) {
  return Math.round(Math.max(0, Math.min(Number(qty) || 0, Math.max(0, Number(limit) || 0))) * 10000) / 10000
}
