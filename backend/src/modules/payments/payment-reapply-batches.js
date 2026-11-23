'use strict'

const { storedCashCents } = require('../../utils/cashMoney')
const { evidenceId, jsonObject, readBatchReceipts, batchReceipt, receiptReview, receiptStamp, proofRevision, originalBatchProof,
  markBatchIssue, batchIssues, batchProofVersion } = require('../../utils/batch-receipts')

function signedCents(value) {
  try {
    const cents = storedCashCents(value)
    return Number.isSafeInteger(Number(cents)) ? Number(cents) : null
  } catch { return null }
}

async function reversalBatches(db, receiptId, rows, lock = false) {
  const negatives = rows.filter(row => Number(row.amount) < 0 && row.statement_id == null)
  if (!negatives.length) return []
  const records = [...new Set(negatives.map(row => Number(row.record_id)))].sort((a, b) => a - b)
  const [events] = await db.query(
    `SELECT payment_record_id, order_no, payload_json, created_by, created_by_name, batch_proof_revision
       FROM payment_record_events WHERE payment_record_id IN (?) AND event_type = 'PAYMENT_RECORDED'
        AND payload_json->>'$.receiptId' = ? AND payload_json->>'$.reapply' IS NOT NULL
        ORDER BY payment_record_id, id${lock ? ' FOR SHARE' : ''}`, [records, String(receiptId)],
  )
  const markers = new Map()
  const reconciled = events.map(event => ({ ...event, proof: jsonObject(event.payload_json)?.reapply }))
  const receipts = await readBatchReceipts(db, reconciled.map(event => event.proof?.receiptId), lock)
  for (const event of reconciled) {
    const id = evidenceId(event.proof?.entryId)
    if (id) markers.set(id, markers.has(id) ? {} : event)
  }
  const result = []
  for (const recordId of records) {
    const batches = new Map()
    const reviews = new Map()
    const sources = new Set(negatives.filter(row => Number(row.record_id) === recordId).map(row => evidenceId(row.id)).filter(Boolean))
    let net = 0, originalId = null, multiple = false, ordinal = 0
    const group = rows.filter(row => Number(row.record_id) === recordId && row.statement_id == null)
      .sort((a, b) => Number(a.id) - Number(b.id))
    const malformed = group.some(row => !evidenceId(row.id) || !signedCents(row.amount))
    for (const row of group) {
      const cents = signedCents(row.amount)
      const entryId = Number(row.id)
      if (cents < 0) {
        const issue = malformed || multiple || !originalId || net + cents < 0 ? { id: entryId, reason: 'origin', ordinal: ordinal + 1 } : undefined
        if (issue) {
          for (const batchId of batches.keys()) markBatchIssue(reviews, batchId, issue)
          markBatchIssue(reviews, entryId, issue)
        }
        batches.set(entryId, { id: entryId, recordId, orderNo: row.order_no, ordinal: ++ordinal, originalEntryId: issue ? null : originalId,
          amountCents: -cents, open: -cents, movements: [] })
      } else if (cents > 0) {
        if (net === 0) { originalId = entryId; multiple = false } else multiple = true
        const marker = markers.get(entryId)
        const sourceId = evidenceId(marker?.proof?.reversalId)
        const source = batches.get(sourceId)
        const ack = batchReceipt(receipts, marker?.proof?.receiptId, {
          actorId: marker?.created_by, actions: [`payment.receipt.settle.${receiptId}`], resourceType: 'payment_receipt', resourceId: receiptId,
        })
        const posted = Array.isArray(ack?.applied) && ack.applied.length === 1 ? ack.applied[0] : null
        const matchesEntry = Number(ack?.id) === Number(receiptId) && Number(posted?.entryId) === entryId
          && Number(posted?.recordId) === recordId && posted.orderNo === row.order_no
        const ackSourceId = matchesEntry ? evidenceId(ack.reversalEntryId) : null
        const outOfSequence = sources.has(sourceId) && sourceId >= entryId || sources.has(ackSourceId) && ackSourceId >= entryId
        const matchesReceipt = ackSourceId != null && ackSourceId === source?.id && signedCents(posted.amount) === cents
        // The payment event and amount must agree with the actual posted entry before its batch can be isolated.
        const attributed = source && (matchesReceipt || source.amountCents >= cents) && Number(marker.payment_record_id) === recordId
          && marker.order_no === row.order_no && signedCents(marker.proof.amount) === cents
          && evidenceId(marker.created_by) && evidenceId(marker.proof.receiptId)
        if (!attributed) {
          const issue = { id: entryId, reason: outOfSequence ? 'sequence' : marker ? 'receipt' : 'unassigned' }
          for (const candidate of batches.values()) {
            if (candidate.open > 0) markBatchIssue(reviews, candidate.id, issue)
          }
          if (sources.has(sourceId)) markBatchIssue(reviews, sourceId, issue)
          if (sources.has(ackSourceId)) markBatchIssue(reviews, ackSourceId, issue)
        } else if (matchesReceipt) {
          source.open -= cents
          const receipt = receiptStamp(receipts, marker.proof.receiptId)
          source.movements.push({ id: entryId, cents, operator: marker.created_by_name,
            original: originalBatchProof(marker, receipt),
            stamp: [entryId, proofRevision(marker), Number(marker.created_by), cents, receipt] })
        } else {
          const conflict = sources.has(ackSourceId) && ackSourceId !== source.id
          const issue = outOfSequence ? { id: entryId, reason: 'sequence' } : receiptReview(receipts, marker.proof.receiptId, entryId, conflict)
          markBatchIssue(reviews, source.id, issue.reason === 'receipt' ? { ...issue, movementCents: cents } : issue)
          if (conflict) markBatchIssue(reviews, ackSourceId, issue)
        }
      }
      net += cents ?? 0
      if (net === 0) { originalId = null; multiple = false }
    }
    for (const batch of batches.values()) {
      const { id, recordId, orderNo, ordinal, originalEntryId, amountCents, open, movements } = batch
      let verified = movements
      let confirmedOpen
      if (open < 0) {
        const original = movements.filter(movement => movement.original)
        const originalCents = original.reduce((sum, movement) => sum + movement.cents, 0)
        const keepOriginal = originalEntryId != null && originalCents > 0 && originalCents <= amountCents
        const held = keepOriginal ? movements.filter(movement => !movement.original) : movements
        verified = keepOriginal ? original : []
        if (keepOriginal) confirmedOpen = amountCents - originalCents
        for (const movement of held) markBatchIssue(reviews, id, { id: movement.id, reason: 'capacity', excessCents: -open,
          movementCents: movement.cents, proofVersion: batchProofVersion(id, movement.stamp),
          ...(held.length > 1 ? { shared: true } : {}) })
      }
      const review = batchIssues(reviews, id)
      const posted = verified.map(({ id: movementId, cents, operator, stamp }) =>
        ({ id: movementId, cents, operator, proofVersion: batchProofVersion(id, stamp) }))
      result.push({ id, recordId, orderNo, ordinal, originalEntryId, amountCents, posted, open: review.issue ? null : open, ...review,
        ...(confirmedOpen == null ? {} : { confirmedOpen }),
        proofVersion: batchProofVersion(id, [Number(receiptId), recordId, orderNo, originalEntryId, amountCents, open],
          verified.map(row => row.stamp), review.issues) })
    }
  }
  return result
}

module.exports = { reversalBatches }
