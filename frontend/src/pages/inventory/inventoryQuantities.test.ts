import { expect, test } from 'vitest'
import { collectAllRecords } from '@/api/allRecords'
import type { InventoryOverviewItem, InventoryOverviewResult } from '@/types/inventory'
import { summarizeInventoryQuantities } from './inventoryQuantities'

const row = (id: number, onHand: number): InventoryOverviewItem => ({ id, productId: id, productCode: `G-${id}`, productName: `合成商品${id}`, warehouseId: 8, warehouseName: '合成仓', unit: '个', onHand, reserved: 0, available: onHand, articleNumber: null, color: null, spec: null, categoryId: null, categoryPath: '', updatedAt: null })
function batch(page: number, onHand: number, source = false): InventoryOverviewResult {
  return { list: [row(page, onHand)], pagination: { page, pageSize: 1, total: 2 }, stats: {
    totalSkus: 2, totalOnHand: 100, totalReserved: 0, totalAvailable: 100,
    ...(source ? { quantitiesByUnit: { complete: true, matchedRows: 2, groups: [{ unit: '个', onHand: 100, reserved: 0 }] } } : {}),
  } }
}
test('没有snapshotId且记录数不变，跨批数量变化的完整明细不能变成精确全局数量', async () => {
  const data = await collectAllRecords(async page => page === 1 ? batch(1, 100) : batch(2, 200))
  expect(data.list).toHaveLength(2); expect(data.list.reduce((sum, item) => sum + item.onHand, 0)).toBe(300)
  expect(summarizeInventoryQuantities(data)).toEqual({ state: 'summary_unavailable', groups: [] })
})
test('单SQL完整统计保留首批来源，不使用后批变动明细拼接或叠加该统计', async () => {
  const data = await collectAllRecords(async page => page === 1 ? batch(1, 100, true) : batch(2, 200))
  expect(data.list.reduce((sum, item) => sum + item.onHand, 0)).toBe(300)
  expect(summarizeInventoryQuantities(data)).toEqual({ state: 'ready', groups: [{ unit: '个', onHand: 100, reserved: 0, available: 100 }] })
})
test.each([
  { complete: false, matchedRows: 2, groups: [{ unit: '个', onHand: 100, reserved: 0 }] },
  { complete: true, matchedRows: 3, groups: [{ unit: '个', onHand: 100, reserved: 0 }] },
  { complete: true, matchedRows: 2, groups: [] },
  { complete: true, matchedRows: 2, groups: [{ unit: '个', onHand: 100, reserved: 0 }, { unit: '个', onHand: 100, reserved: 0 }] },
])('完整标记、覆盖数量或单位身份不一致时不回退猜量：%s', source => {
  const data = batch(1, 100, true); data.stats.quantitiesByUnit = source
  expect(summarizeInventoryQuantities(data).state).toBe('summary_unavailable')
})
