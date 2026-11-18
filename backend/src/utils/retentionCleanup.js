'use strict'

const BATCH_SIZE = 500
const MAX_BATCHES = 4
const BUDGET_MS = 500
let running = false

// Each deletion is a separate autocommit statement. A started query is allowed
// to finish; the time budget prevents dispatching further batches this round.
async function cleanupRetentionRows(deleteBatch, { now = () => performance.now() } = {}) {
  if (running) return 0
  running = true
  const started = now()
  try {
    let deleted = 0
    for (let batch = 0; batch < MAX_BATCHES && now() - started < BUDGET_MS; batch++) {
      const [{ affectedRows }] = await deleteBatch(BATCH_SIZE)
      deleted += affectedRows
      if (affectedRows < BATCH_SIZE) break
    }
    return deleted
  } finally {
    running = false
  }
}

module.exports = { cleanupRetentionRows }
