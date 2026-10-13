import type { InventoryReservationSnapshotParams, InventoryReservationSnapshotResult } from '@/types/inventory'

const fail = (): never => { throw new Error('预占明细读取不完整或已变化，请刷新后重新读取') }
const positiveId = (value: number) => Number.isSafeInteger(value) && value > 0
const summaryKeys = ['activeQuantity','cacheOnHand','reserved','available','expected','atp','pickableQuantity',
  'reservationQuantity','expectedBindingQuantity','expectedPoolBindingQuantity','cacheDifference','reservationDifference',
  'bindingPoolDifference','visibleReservationQuantity','hiddenReservationQuantity','orphanReservationQuantity',
  'unknownReservationQuantity','visibleBindingQuantity','hiddenBindingQuantity','orphanBindingQuantity'] as const

/** 同token的连续前缀；拒绝截断、漂移与重复，不通过去重伪装完整。 */
export function validateReservationBatch(data: InventoryReservationSnapshotResult, request: InventoryReservationSnapshotParams,
  previous: InventoryReservationSnapshotResult[] = []): InventoryReservationSnapshotResult {
  const offset = request.offset ?? 0, meta = data?.snapshot
  if (!meta || data.productId !== request.productId || data.warehouseId !== request.warehouseId
    || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(meta.snapshotId)
    || ![meta.totalRows, meta.totalSources, meta.offset].every(Number.isSafeInteger)
    || meta.totalSources < 0 || meta.totalSources > 10000 || meta.totalRows < meta.totalSources
    || meta.totalRows - meta.totalSources > 20000 || (meta.totalSources === 0 && meta.totalRows !== 0)
    || meta.offset !== offset || offset < 0 || offset > meta.totalRows || (offset > 0 && offset >= meta.totalRows)
    || !Array.isArray(data.rows) || data.rows.length !== Math.min(100, meta.totalRows - offset)
    || !data.summary || !summaryKeys.every(key => typeof data.summary[key] === 'number' && Number.isFinite(data.summary[key]))) fail()
  const readAt = Date.parse(meta.readAt), expires = Date.parse(meta.expiresAt)
  if (!Number.isFinite(readAt) || !Number.isFinite(expires) || expires <= readAt || expires - readAt > 120000) fail()
  const next = offset + data.rows.length
  if (meta.nextOffset !== (next < meta.totalRows ? next : null)) fail()
  const first = previous[0]
  if (first) {
    if (request.snapshotId !== first.snapshot.snapshotId || meta.snapshotId !== request.snapshotId
      || meta.readAt !== first.snapshot.readAt || meta.expiresAt !== first.snapshot.expiresAt
      || meta.totalRows !== first.snapshot.totalRows || meta.totalSources !== first.snapshot.totalSources
      || !summaryKeys.every(key => data.summary[key] === first.summary[key])) fail()
  } else if (offset !== 0 || request.snapshotId && meta.snapshotId !== request.snapshotId) fail()
  const ids = new Set<string>(), sales = new Set<number>()
  let prefix = 0
  for (const page of previous) {
    if (page.snapshot.offset !== prefix || page.snapshot.snapshotId !== meta.snapshotId) fail()
    prefix += page.rows.length
    for (const row of page.rows) {
      if (ids.has(row.id)) fail()
      ids.add(row.id); if (row.kind === 'sale') sales.add(row.saleOrderId)
    }
  }
  if (prefix !== offset) fail()
  for (const row of data.rows) {
    if (!row || !positiveId(row.saleOrderId) || ids.has(row.id)) fail()
    if (row.kind === 'sale') {
      if (row.id !== 'sale:' + row.saleOrderId || !row.source || row.source.saleOrderId !== row.saleOrderId
        || typeof row.source.orderNo !== 'string'
        || ![row.source.reservationQuantity, row.source.expectedBindingQuantity, row.source.hiddenBindingQuantity,
          row.source.orphanBindingQuantity].every(Number.isFinite)) fail()
      sales.add(row.saleOrderId)
    } else if (row.kind === 'binding') {
      const binding = row.binding
      if (!binding || !binding.purchase || !sales.has(row.saleOrderId) || row.id !== 'binding:' + binding.bindingId
        || ![binding.bindingId, binding.saleOrderItemId, binding.purchase.purchaseOrderId, binding.purchase.purchaseItemId].every(positiveId)
        || ![binding.quantity, binding.purchase.openQuantity, binding.purchase.boundQuantity].every(Number.isFinite)) fail()
    } else fail()
    ids.add(row.id)
  }
  if (meta.nextOffset === null && (ids.size !== meta.totalRows || sales.size !== meta.totalSources)) fail()
  return data
}
