'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
process.env.JWT_SECRET = 'security-session-cleanup-fixture-secret-only-20261006'
const callbacks = [], queries = []
const families = [{ family_id: 'old-empty', old: true }, { family_id: 'old-retained', old: true }, { family_id: 'recent-empty', old: false }]
const sessions = [{ family_id: 'old-retained', revoked_at: new Date(), created_at: new Date() }]
const pool = { query: async sql => {
  queries.push(sql)
  if (/DELETE\s+(?:f\s+)?FROM auth_session_families/i.test(sql)) {
    for (let i = families.length - 1; i >= 0; i--) if (families[i].old && !sessions.some(s => s.family_id === families[i].family_id)) families.splice(i, 1)
  }
  return [{ affectedRows: 1 }]
} }
function substitute(relative, exports) { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports } }
substitute('../backend/src/config/db', { pool })
substitute('../backend/src/utils/operationRequest', { startCleanupSweeper() {} })
substitute('../backend/src/utils/logger', { info() {}, error() {} })
substitute('../backend/src/utils/requestContext', { runWithRequestContext: async (ctx, fn) => { if (ctx.requestId === 'scheduler:refresh-session-cleanup') return fn() } })
substitute('../backend/src/modules/logistics/logistics.worker', { runFetchWaybills() {}, runTrackWaybills() {} })
substitute('../backend/src/modules/fulfillment/fulfillment.worker', { runFulfillmentSync() {} })
substitute('../backend/src/modules/fulfillment/fulfillment.refresh', { runFulfillmentRefresh() {} })
const scheduler = require('../backend/src/scheduler')
test('scheduler removes only old families without any retained refresh row after existing JTI cleanup', async () => {
  const interval = global.setInterval
  global.setInterval = callback => { callbacks.push(callback); return { unref() {} } }
  try { scheduler.startScheduler() } finally { global.setInterval = interval }
  for (const fn of callbacks) await fn()
  assert.equal(queries.length, 2, 'refresh retention gains one exact family cleanup')
  assert.match(queries[0], /DELETE FROM refresh_token_sessions/)
  assert.match(queries[1], /NOT EXISTS/)
  assert.match(queries[1], /s\.family_id\s*=\s*f\.family_id/)
  assert.doesNotMatch(queries[1], /s\.revoked_at\s+IS\s+NULL/)
  assert.deepEqual(families.map(f => f.family_id), ['old-retained', 'recent-empty'])
})
