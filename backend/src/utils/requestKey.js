function extractRequestKey(req) {
  const raw = req.headers['x-request-key'] || req.headers['idempotency-key'] || ''
  const key = String(Array.isArray(raw) ? raw[0] : raw || '').trim()
  return key || null
}

module.exports = {
  extractRequestKey,
}
