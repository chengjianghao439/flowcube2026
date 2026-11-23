'use strict'

const { evidenceId, jsonObject, readBatchReceipts, batchReceipt, receiptReview, receiptStamp, proofRevision, originalBatchProof,
  markBatchIssue, batchIssues, batchProofVersion } = require('../../utils/batch-receipts')

function quantityUnits(value) {
  const text = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!text) return null
  return evidenceId(text[1] + (text[2] ?? '').padEnd(2, '0'))
}

function movementLines(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const lines = raw.map(row => ({
    itemId: evidenceId(row?.itemId), warehouseId: evidenceId(row?.warehouseId),
    unit: typeof row?.unit === 'string' ? row.unit : null, units: quantityUnits(row?.qty),
  }))
  if (lines.some(row => !row.itemId || !row.warehouseId || !row.units || !row.unit)
      || new Set(lines.map(row => row.itemId)).size !== lines.length) return null
  return lines.sort((a, b) => a.itemId - b.itemId)
}

function quantityEvidence(lines) {
  return lines.map(({ itemId, warehouseId, unit, units }) => ({ itemId, warehouseId, unit, qty: units / 100 }))
}

function releaseExcess(batch) {
  const overfilled = batch.lines.filter(line => line.left < 0)
  if (!overfilled.length) return new Map()
  const originalUnits = new Map()
  for (const movement of batch.movements) {
    if (!movement.original) continue
    for (const line of movement.lines) {
      originalUnits.set(line.itemId, (originalUnits.get(line.itemId) ?? 0) + line.units)
    }
  }
  const excess = new Map()
  const keepOriginal = batch.releaseRevision === '0'
  for (const line of overfilled) {
    const original = originalUnits.get(line.itemId) ?? 0
    excess.set(line.itemId, { itemId: line.itemId, warehouseId: line.warehouseId, unit: line.unit,
      qty: -line.left / 100, keepOriginal: keepOriginal && original > 0 && original <= line.units, affected: 0 })
  }
  return excess
}

async function releaseBatches(db, orderId, rows, scope, lock = false) {
  const events = rows.filter(row => ['reserved', 'released'].includes(row.event_type) && evidenceId(row.id))
    .map(row => ({ ...row, id: Number(row.id), payload: jsonObject(row.payload_json) }))
    .sort((a, b) => a.id - b.id)
  const receipts = await readBatchReceipts(db, events.map(event => event.payload?.supplement?.receiptId), lock)
  const sources = new Map()
  const reviews = new Map()
  const visible = lines => lines && lines.every(line => scope == null || scope.some(id => Number(id) === line.warehouseId))
  let ordinal = 0
  for (const event of events) {
    if (event.event_type !== 'released') continue
    ordinal++
    const lines = movementLines(event.payload?.released)
    if (lines) sources.set(event.id, { id: event.id, ordinal,
      lines: lines.map(line => ({ ...line, left: line.units })), movements: [], releaseRevision: proofRevision(event) })
  }
  for (const event of events) {
    if (event.event_type !== 'reserved') continue
    const lines = movementLines(event.payload?.reserved)
    const marker = event.payload?.supplement
    const source = sources.get(evidenceId(marker?.releaseId))
    const bound = source && lines?.map(line => source.lines.find(original => original.itemId === line.itemId
      && original.warehouseId === line.warehouseId && original.unit === line.unit))
    const ack = batchReceipt(receipts, marker?.receiptId, {
      actorId: event.created_by, actions: [`sale.reserve:${orderId}`, `sale.reserve.${orderId}`], resourceType: 'sale_order', resourceId: orderId,
    })
    const ackSource = Number(ack?.reservationEventId) === event.id ? sources.get(evidenceId(ack.releaseEventId)) : null
    const outOfSequence = source?.id >= event.id || ackSource?.id >= event.id
    const matchesReceipt = ackSource != null && ackSource === source
      && JSON.stringify(movementLines(ack?.reserved)) === JSON.stringify(lines)
    // The order event and these lines were persisted by the same locked reserve transaction.
    // Without a matching receipt, the marker can narrow review only to a source that could fit the movement.
    const attributed = source?.id < event.id && evidenceId(marker?.receiptId) && evidenceId(event.created_by)
      && bound?.every((original, index) => original && (matchesReceipt || original.units >= lines[index].units))
    if (!attributed) {
      const issue = { id: event.id, reason: outOfSequence ? 'sequence' : marker ? 'receipt' : 'unassigned' }
      for (const batch of sources.values()) {
        if (batch === source || batch === ackSource || batch.id < event.id && batch.lines.some(original => original.left > 0
          && (!lines || lines.some(line => line.itemId === original.itemId)))) {
          markBatchIssue(reviews, batch.id, issue)
        }
      }
      continue
    }
    if (!matchesReceipt) {
      const issue = outOfSequence ? { id: event.id, reason: 'sequence' }
        : receiptReview(receipts, marker.receiptId, event.id, ackSource && ackSource !== source)
      markBatchIssue(reviews, source.id, issue.reason === 'receipt' ? { ...issue, movement: quantityEvidence(lines) } : issue)
      if (ackSource && ackSource !== source) markBatchIssue(reviews, ackSource.id, issue)
      continue
    }
    lines.forEach((line, index) => { bound[index].left -= line.units })
    const receipt = receiptStamp(receipts, marker.receiptId)
    source.movements.push({ id: event.id, operator: event.created_by_name, lines, original: originalBatchProof(event, receipt),
      stamp: [event.id, proofRevision(event), Number(event.created_by), receipt,
        lines.map(line => [line.itemId, line.warehouseId, line.unit, line.units])] })
  }
  return [...sources.values()].filter(batch => visible(batch.lines)).map(batch => {
    const excess = releaseExcess(batch)
    const conflicts = []
    const confirmed = new Map()
    const verified = batch.movements.filter(movement => {
      const affected = movement.lines.map(line => excess.get(line.itemId)).filter(line => line && !(movement.original && line.keepOriginal))
      if (affected.length) {
        for (const line of affected) line.affected++
        conflicts.push({ movement, affected })
        return false
      }
      if (excess.size) for (const line of movement.lines) {
        confirmed.set(line.itemId, (confirmed.get(line.itemId) ?? 0) + line.units)
      }
      return true
    })
    for (const { movement, affected } of conflicts) {
      markBatchIssue(reviews, batch.id, { id: movement.id, reason: 'capacity',
        movement: quantityEvidence(movement.lines),
        proofVersion: batchProofVersion(batch.id, movement.stamp),
        excess: affected.map(({ itemId, warehouseId, unit, qty }) => ({ itemId, warehouseId, unit, qty })),
        ...(affected.some(line => line.affected > 1) ? { shared: true } : {}) })
    }
    const review = batchIssues(reviews, batch.id)
    const confirmedCapacity = [...excess.values()].some(line => line.keepOriginal && confirmed.has(line.itemId))
    const lines = batch.lines.map(line => ({ itemId: line.itemId, warehouseId: line.warehouseId, unit: line.unit,
      qty: line.units / 100, remaining: review.issue ? null : line.left / 100,
      ...(confirmedCapacity ? { confirmedRemaining: (line.units - (confirmed.get(line.itemId) ?? 0)) / 100 } : {}) }))
    const supplements = verified.map(({ id, operator, lines, stamp }) => ({ id, operator,
      lines: quantityEvidence(lines),
      proofVersion: batchProofVersion(batch.id, stamp) }))
    return { id: batch.id, ordinal: batch.ordinal, lines, supplements, ...review,
      proofVersion: batchProofVersion(batch.id, [batch.releaseRevision, lines], verified.map(row => row.stamp), review.issues) }
  })
}

function canSupplementRelease(batch, reserveItems) {
  return batch && !batch.issue && reserveItems.length > 0
    && new Set(reserveItems.map(item => Number(item.id))).size === reserveItems.length && reserveItems.every(item => batch.lines.some(line =>
    Number(item.id) === line.itemId && Number(item.warehouseId) === line.warehouseId
    && item.unit === line.unit && quantityUnits(item.reserveQty) <= quantityUnits(line.remaining)
    && quantityUnits(item.reserveQty) != null))
}

module.exports = { releaseBatches, canSupplementRelease, movementLines }
