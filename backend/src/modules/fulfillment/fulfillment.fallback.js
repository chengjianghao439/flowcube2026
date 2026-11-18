'use strict'

const BATCH_SIZE = 25

function createFallbackScanner(now = Date.now) {
  const byType = new Map()
  const scan = { running: false, lastStartedAt: null, lastCompletedAt: null, lastSuccessfulAt: null, lastFailureAt: null, failures: 0 }

  function stats() {
    return { ...scan, types: Object.fromEntries(Array.from(byType, ([type, progress]) => [type, { ...progress }])) }
  }

  async function run({ types, list, sync, onFailure = () => {} }) {
    if (scan.running) return
    scan.running = true
    scan.lastStartedAt = now()
    const failuresBefore = scan.failures
    const failed = (error, type, documentId) => {
      scan.failures++
      scan.lastFailureAt = now()
      onFailure(error, type, documentId)
    }
    try {
      for (const type of types) {
        const progress = byType.get(type) || { cursor: 0, more: false, processed: 0, lastSweepCompletedAt: null }
        byType.set(type, progress)
        let rows
        try {
          rows = await list(type, progress.cursor, BATCH_SIZE)
        } catch (error) {
          failed(error, type)
          continue
        }
        for (const row of rows) {
          try {
            await sync(type, row.id)
            progress.processed++
          } catch (error) {
            failed(error, type, row.id)
          }
          progress.cursor = row.id
        }
        progress.more = rows.length === BATCH_SIZE
        if (!progress.more) {
          progress.lastSweepCompletedAt = now()
          progress.cursor = 0
        }
      }
      scan.lastCompletedAt = now()
      if (scan.failures === failuresBefore) scan.lastSuccessfulAt = scan.lastCompletedAt
    } finally {
      scan.running = false
    }
  }
  return { run, stats }
}

const fulfillmentFallback = createFallbackScanner()
module.exports = { createFallbackScanner, fulfillmentFallback }
