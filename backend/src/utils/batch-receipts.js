'use strict'

const { createHash } = require('node:crypto')

function evidenceId(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
}

function jsonObject(raw) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw ?? null
}

async function readBatchReceipts(db, references, lock = false) {
  const ids = [...new Set(references.map(evidenceId).filter(Boolean))]
  if (!ids.length) return new Map()
  const [rows] = await db.query(
    `SELECT id, user_id, action, status, resource_type, resource_id, response_json, batch_proof_revision
       FROM operation_requests WHERE id IN (?) ORDER BY id${lock ? ' FOR SHARE' : ''}`, [ids],
  )
  return new Map(rows.map(row => [Number(row.id), row]))
}

function batchReceipt(receipts, receiptId, { actorId, actions, resourceType, resourceId }) {
  const receipt = receipts.get(evidenceId(receiptId))
  return receipt && evidenceId(actorId) && Number(receipt.user_id) === Number(actorId)
    && Number(receipt.status) === 1 && receipt.resource_type === resourceType
    && Number(receipt.resource_id) === Number(resourceId) && actions.includes(receipt.action)
    ? jsonObject(receipt.response_json) : null
}

function receiptReview(receipts, receiptId, movementId, conflict) {
  if (conflict) return { id: movementId, reason: 'conflict' }
  const saved = receipts.get(evidenceId(receiptId))
  return { id: movementId, reason: 'receipt', check: Number(saved?.status) === 1 ? 'mismatch' : 'missing' }
}

function receiptStamp(receipts, id) {
  const row = receipts.get(evidenceId(id))
  return [row?.id ?? null, proofRevision(row)]
}

function proofRevision(row) {
  return String(row?.batch_proof_revision ?? '0')
}

// The event is inserted and the receipt changes from pending to successful in the same transaction.
// An older or edited pair cannot establish the original assignment for an over-capacity batch.
function originalBatchProof(event, receipt) {
  return event?.batch_proof_revision != null && proofRevision(event) === '0' && receipt[1] === '1'
}

function markBatchIssue(reviews, batchId, issue) {
  if (!reviews.has(batchId)) reviews.set(batchId, new Map())
  reviews.get(batchId).set(issue.id, issue)
}

function batchIssues(reviews, batchId) {
  const issues = [...(reviews.get(batchId)?.values() ?? [])].sort((a, b) => a.id - b.id)
  return issues.length ? { issue: issues[0], issues } : {}
}

function batchProofVersion(batchId, facts, receipts, issues) {
  return createHash('sha256').update(JSON.stringify([batchId, facts, receipts, issues ?? null])).digest('hex')
}

module.exports = { evidenceId, jsonObject, readBatchReceipts, batchReceipt, receiptReview, receiptStamp, proofRevision, originalBatchProof,
  markBatchIssue, batchIssues, batchProofVersion }
