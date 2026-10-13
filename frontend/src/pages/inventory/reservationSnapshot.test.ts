import { expect, test } from 'vitest'
import type { InventoryReservationSnapshotParams, InventoryReservationSnapshotResult } from '@/types/inventory'
const modules = import.meta.glob('./reservationSnapshot.ts', { eager: true })
function validate(data: InventoryReservationSnapshotResult, request: InventoryReservationSnapshotParams, previous: InventoryReservationSnapshotResult[] = []) {
  const fn = (modules['./reservationSnapshot.ts'] as { validateReservationBatch?: (d: InventoryReservationSnapshotResult, q: InventoryReservationSnapshotParams, p: InventoryReservationSnapshotResult[]) => InventoryReservationSnapshotResult })?.validateReservationBatch
  expect(fn).toBeTypeOf('function')
  return fn!(data, request, previous)
}
const token = '00000000-0000-4000-8000-000000000001'
function batch(offset = 0, total = 101): InventoryReservationSnapshotResult {
  return { productId: 7, warehouseId: 8, summary: Object.fromEntries(['activeQuantity','cacheOnHand','reserved','available','expected','atp','pickableQuantity','reservationQuantity','expectedBindingQuantity','expectedPoolBindingQuantity','cacheDifference','reservationDifference','bindingPoolDifference','visibleReservationQuantity','hiddenReservationQuantity','orphanReservationQuantity','unknownReservationQuantity','visibleBindingQuantity','hiddenBindingQuantity','orphanBindingQuantity'].map(key => [key, 0])) as unknown as InventoryReservationSnapshotResult['summary'],
    rows: Array.from({ length: Math.min(100, total - offset) }, (_, i) => ({ id: 'sale:' + (offset + i + 1), kind: 'sale', saleOrderId: offset + i + 1, source: { saleOrderId: offset + i + 1, orderNo: 'SO-' + i, customerName: null, status: 2, createdAt: null, reservationQuantity: 1, expectedBindingQuantity: 0, hiddenBindingQuantity: 0, orphanBindingQuantity: 0 } })),
    snapshot: { snapshotId: token, readAt: '2026-10-12T16:00:00.000Z', expiresAt: '2026-10-12T16:02:00.000Z', totalRows: total, totalSources: total, offset, nextOffset: offset + 100 < total ? offset + 100 : null } }
}
const input = { productId: 7, warehouseId: 8, offset: 0 }
test('validates complete contiguous prefix and its exact final row', () => {
  const first = validate(batch(), input)
  const end = validate(batch(100), { ...input, offset: 100, snapshotId: token }, [first])
  expect(end.rows[0].saleOrderId).toBe(101); expect(end.snapshot.nextOffset).toBeNull()
})
test.each(['token','count','expiry','offset','duplicate','length','summary'] as const)('refuses %s drift without accepting partial completeness', change => {
  const first = batch(), next = batch(100)
  if (change === 'token') next.snapshot.snapshotId = token.replace(/1$/, '2')
  if (change === 'count') next.snapshot.totalSources--
  if (change === 'expiry') next.snapshot.expiresAt = '2026-10-12T16:03:00.000Z'
  if (change === 'offset') next.snapshot.offset = 0
  if (change === 'duplicate') next.rows[0] = first.rows[0]
  if (change === 'length') next.rows = []
  if (change === 'summary') next.summary.reserved = 5
  expect(() => validate(next, { ...input, offset: 100, snapshotId: token }, [first])).toThrow()
})
test('refuses legacy page responses and unsafe capacities, identities or quantities', () => {
  for (const change of ['legacy','capacity','id','quantity']) {
    const value = batch()
    if (change === 'legacy') Object.assign(value, { snapshot: undefined })
    if (change === 'capacity') value.snapshot.totalSources = 10001
    if (change === 'id') value.rows[0].saleOrderId = 0
    if (change === 'quantity') value.summary.reserved = Number.NaN
    expect(() => validate(value, input)).toThrow()
  }
})
test('known empty snapshot is complete; no eager request for another batch', () => {
  expect(validate(batch(0,0), input).snapshot.nextOffset).toBeNull()
})
