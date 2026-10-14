const { createHash } = require('node:crypto')
const AppError = require('../../utils/AppError')

const ACTION = 'purchase.requisition.create'
const MATCHED_ACTION = /^purchase\.requisition\.create(?:\.[a-f0-9]{16})?$/
const FINGERPRINT = /^[a-f0-9]{64}$/
const review = () => new AppError('原请购创建内容无法完整确认，请保留原请求并核对', 409, 'PURCHASE_REQUISITION_CREATE_REVIEW_REQUIRED')
const conflict = () => new AppError('此请求键已用于另一份请购内容，请先核对原操作结果', 409, 'PURCHASE_REQUISITION_CREATE_REQUEST_CONFLICT')

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}
// The validated wire object is the identity. No service defaults or self-reported
// client digest are included; missing and explicitly null fields remain distinct.
function requestFingerprint(body) {
  return createHash('sha256').update(stableStringify(body)).digest('hex')
}
function assertCreateFingerprint(stored, requested) {
  if (!FINGERPRINT.test(String(stored ?? ''))) throw review()
  if (!FINGERPRINT.test(String(requested ?? '')) || stored !== requested) throw conflict()
}
async function readCreateCandidates(db, { requestKey, userId, lock = false }) {
  const key = String(requestKey ?? '').trim()
  if (!key) return []
  const [rows] = await db.query(`SELECT id,action,user_id,status,response_json,resource_type,resource_id FROM operation_requests
    WHERE request_key=? AND user_id <=> ? AND (action=? OR action REGEXP ?)
    ORDER BY id${lock ? ' FOR SHARE' : ''}`, [key, userId == null ? null : Number(userId), ACTION, '^purchase\\.requisition\\.create\\.[a-f0-9]{16}$'])
  return rows.map(row => {
    let data = null
    try { data = typeof row.response_json === 'string' ? JSON.parse(row.response_json) : row.response_json } catch { /* fail closed below */ }
    return { ...row, data }
  })
}
module.exports = { ACTION, MATCHED_ACTION, FINGERPRINT, review, conflict, requestFingerprint, readCreateCandidates, assertCreateFingerprint }
