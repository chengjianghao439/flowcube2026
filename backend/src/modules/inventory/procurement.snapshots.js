const { randomUUID } = require('node:crypto')
const AppError = require('../../utils/AppError')

function restart() {
  return new AppError('列表已失效，请刷新后重新加载', 409, 'PROCUREMENT_SNAPSHOT_RESTART')
}

/** 仅供只读采购预览分页；保留序列化 Buffer，避免缓存整棵可变业务对象。 */
function createProcurementSnapshots({ ttlMs = 120000, maxSnapshots = 8, maxRows = 20000, maxBytes = 16 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map()
  let bytes = 0, rows = 0
  function remove(id) {
    const entry = entries.get(id)
    if (!entry) return
    bytes -= entry.payload.length
    rows -= entry.rows
    entries.delete(id)
  }
  function prune() {
    for (const [id, entry] of entries) if (entry.expiresAt <= now()) remove(id)
  }
  function save(binding, result) {
    prune()
    const payload = Buffer.from(JSON.stringify({ binding, result }))
    if (result.list.length > maxRows || payload.length > maxBytes) {
      throw new AppError('结果过多，请缩小筛选范围后重试', 413, 'PROCUREMENT_PREVIEW_TOO_LARGE')
    }
    while (entries.size >= maxSnapshots || bytes + payload.length > maxBytes || rows + result.list.length > maxRows) {
      remove(entries.keys().next().value)
    }
    const snapshotId = randomUUID()
    const expiresAt = now() + ttlMs
    entries.set(snapshotId, { payload, rows: result.list.length, expiresAt })
    bytes += payload.length
    rows += result.list.length
    return { snapshotId, expiresAt }
  }
  function read(snapshotId, binding) {
    prune()
    const entry = entries.get(snapshotId)
    if (!entry) throw restart()
    const stored = JSON.parse(entry.payload.toString())
    if (stored.binding !== binding) throw restart()
    return { result: stored.result, expiresAt: entry.expiresAt }
  }
  return { save, read, prune }
}

module.exports = { createProcurementSnapshots, restart }
