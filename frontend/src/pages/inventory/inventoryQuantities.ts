import type { InventoryOverviewResult } from '@/types/inventory'

export type InventoryQuantityField = 'onHand' | 'reserved' | 'available'
export interface InventoryQuantityGroup { unit: string; onHand: number; reserved: number; available: number }
export interface InventoryQuantitySummary {
  state: 'ready' | 'incomplete' | 'summary_unavailable' | 'unknown_unit' | 'unknown_quantity'
  groups: InventoryQuantityGroup[]
}

/** 只信同一 SQL 的完整单位统计；明细取齐不代表跨批数量处于同一快照。 */
export function summarizeInventoryQuantities(result?: InventoryOverviewResult): InventoryQuantitySummary {
  if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.pagination?.total)
    || result.pagination.total < 0) return { state: 'incomplete', groups: [] }
  const source = result.stats?.quantitiesByUnit
  if (!source) return { state: result.truncated || result.list.length !== result.pagination.total ? 'incomplete' : 'summary_unavailable', groups: [] }
  if (source.complete !== true || !Number.isSafeInteger(source.matchedRows) || source.matchedRows !== result.pagination.total
    || !Array.isArray(source.groups) || source.groups.length > source.matchedRows
    || (source.matchedRows > 0 && !source.groups.length)) return { state: 'summary_unavailable', groups: [] }
  const groups = new Map<string, { onHand: number; reserved: number }>()
  for (const row of source.groups) {
    if (!row || typeof row !== 'object') return { state: 'unknown_quantity', groups: [] }
    if (typeof row.unit !== 'string' || !row.unit.trim()) return { state: 'unknown_unit', groups: [] }
    if (groups.has(row.unit)) return { state: 'summary_unavailable', groups: [] }
    if (![row.onHand, row.reserved].every(value => typeof value === 'number' && Number.isFinite(value))) return { state: 'unknown_quantity', groups: [] }
    const onHand = Math.round(row.onHand * 100), reserved = Math.round(row.reserved * 100)
    const next = { onHand, reserved }
    if (![onHand, reserved, next.onHand, next.reserved, next.onHand - next.reserved].every(Number.isSafeInteger)) return { state: 'unknown_quantity', groups: [] }
    groups.set(row.unit, next)
  }
  return { state: 'ready', groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([unit, values]) => ({
    unit, onHand: values.onHand / 100, reserved: values.reserved / 100,
    available: Math.max(0, values.onHand - values.reserved) / 100,
  })) }
}
