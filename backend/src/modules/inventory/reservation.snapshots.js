const { randomUUID } = require('node:crypto')
const AppError = require('../../utils/AppError')

const LIMITS = Object.freeze({ ttlMs: 120000, batchSize: 100, maxSources: 10000, maxBindings: 20000,
  maxSnapshotBytes: 8 * 1024 * 1024, maxCacheBytes: 32 * 1024 * 1024, maxSnapshots: 20, maxPerActor: 2, maxBuilders: 3, maxQueryRows: 50000 })
const restart = () => new AppError('预占明细读取已失效，请刷新后重新读取', 409, 'INVENTORY_RESERVATION_SNAPSHOT_RESTART')
const tooLarge = () => new AppError('来源超过安全读取范围，请筛选销售原单后重试', 413, 'INVENTORY_RESERVATION_SNAPSHOT_TOO_LARGE')
const busy = () => new AppError('预占明细读取繁忙，请稍后重试', 503, 'INVENTORY_RESERVATION_SNAPSHOT_BUSY')
const invalid = () => new AppError('预占明细不完整，请刷新后重新读取', 500, 'INVENTORY_RESERVATION_SNAPSHOT_INVALID')

/** 分块序列化缓存；不保留数据库连接或可变业务对象，不增加后台清理服务。 */
function createReservationSnapshots(options = {}) {
  const limits = { ...LIMITS, ...options }, now = options.now || Date.now
  const entries = new Map(), builders = new Set()
  let bytes = 0
  function remove(id) {
    const entry = entries.get(id)
    if (entry) { bytes -= entry.bytes; entries.delete(id) }
  }
  function prune() {
    for (const [id, entry] of entries) if (entry.expiresAt <= now()) remove(id)
  }
  function begin(actor) {
    prune()
    if (builders.has(actor) || builders.size >= limits.maxBuilders) throw busy()
    builders.add(actor)
    let finished = false
    return () => { if (!finished) { finished = true; builders.delete(actor) } }
  }
  function read(snapshotId, binding, offset) {
    prune()
    const entry = entries.get(snapshotId)
    if (!entry || entry.binding !== binding || !Number.isSafeInteger(offset) || offset < 0
      || offset % limits.batchSize !== 0 || (offset !== 0 && offset >= entry.totalRows)) throw restart()
    const metadata = JSON.parse(entry.metadata.toString())
    const rows = entry.chunks[offset / limits.batchSize]
    const nextOffset = Math.min(offset + limits.batchSize, entry.totalRows)
    return { ...metadata, rows: rows ? JSON.parse(rows.toString()) : [], snapshot: {
      snapshotId, readAt: entry.readAt, expiresAt: new Date(entry.expiresAt).toISOString(),
      totalRows: entry.totalRows, totalSources: entry.totalSources, offset,
      nextOffset: nextOffset < entry.totalRows ? nextOffset : null,
    } }
  }
  function save(binding, result, actor, readAt) {
    prune()
    if (result.list.length !== result.pagination.total) throw invalid()
    if (result.list.length > limits.maxSources) throw tooLarge()
    const rows = [], identities = new Set()
    let bindingCount = 0
    function add(row) {
      if (identities.has(row.id)) throw invalid()
      identities.add(row.id); rows.push(row)
    }
    for (const source of result.list) {
      const { bindings, ...details } = source
      if (!Number.isSafeInteger(source.saleOrderId) || source.saleOrderId < 1 || !Array.isArray(bindings)) throw invalid()
      add({ id: 'sale:' + source.saleOrderId, kind: 'sale', saleOrderId: source.saleOrderId, source: details })
      for (const item of bindings) {
        if (++bindingCount > limits.maxBindings) throw tooLarge()
        if (!Number.isSafeInteger(item.bindingId) || item.bindingId < 1) throw invalid()
        add({ id: 'binding:' + item.bindingId, kind: 'binding', saleOrderId: source.saleOrderId, orderNo: source.orderNo, binding: item })
      }
    }
    const metadata = Buffer.from(JSON.stringify({ productId: result.productId, warehouseId: result.warehouseId, summary: result.summary }))
    const chunks = []
    for (let i = 0; i < rows.length; i += limits.batchSize) chunks.push(Buffer.from(JSON.stringify(rows.slice(i, i + limits.batchSize))))
    const size = metadata.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (size > limits.maxSnapshotBytes) throw tooLarge()
    const expiresAt = readAt + limits.ttlMs
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw restart()
    const own = [...entries].filter(([, entry]) => entry.actor === actor)
    while (own.length >= limits.maxPerActor) remove(own.shift()[0])
    if (entries.size >= limits.maxSnapshots || bytes + size > limits.maxCacheBytes) throw busy()
    const snapshotId = randomUUID()
    entries.set(snapshotId, { binding, actor, metadata, chunks, bytes: size, expiresAt,
      readAt: new Date(readAt).toISOString(), totalRows: rows.length, totalSources: result.list.length })
    bytes += size
    return read(snapshotId, binding, 0)
  }
  return { begin, save, read, remove, prune }
}

module.exports = { LIMITS, createReservationSnapshots, restart, tooLarge }
