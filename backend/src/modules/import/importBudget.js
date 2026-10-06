const { fork } = require('node:child_process')
const path = require('node:path')
const AppError = require('../../utils/AppError')

const LIMITS = Object.freeze({ uploadBytes: 5 * 1024 * 1024, zipEntries: 256, expandedBytes: 20 * 1024 * 1024, entryBytes: 8 * 1024 * 1024, compressionRatio: 100, rows: 1001, stringChars: 2048, stringBytes: 2 * 1024 * 1024, parseMs: 5000, heapMb: 96, concurrent: 2 })
const ENTITIES = Object.freeze({ products: { columns: 10, sheets: 1 }, stock: { columns: 3, sheets: 2 }, customers: { columns: 7, sheets: 1 }, suppliers: { columns: 8, sheets: 1 }, priceListItems: { columns: 3, sheets: 1 } })
function budgetError() { return new AppError('导入文件超过安全预算，请按模板拆分为每批最多1000条数据', 400, 'IMPORT_BUDGET_EXCEEDED') }
function invalidFile() { return new AppError('导入文件格式无效或已损坏', 400, 'IMPORT_FILE_INVALID') }

// Read only the bounded central directory; do not inflate in the API process.
function preflightZip(buffer) {
  if (buffer.length > LIMITS.uploadBytes) throw budgetError()
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break }
  }
  if (end < 0) throw invalidFile()
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16)
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count !== buffer.readUInt16LE(end + 8)) throw invalidFile()
  if (count > LIMITS.zipEntries || count === 65535 || size === 0xffffffff || start === 0xffffffff) throw budgetError()
  if (start + size !== end) throw invalidFile()
  const entries = [], names = new Set(), ranges = []
  let offset = start, total = 0, compressedTotal = 0
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw invalidFile()
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10)
    const compressed = buffer.readUInt32LE(offset + 20), expanded = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32)
    const local = buffer.readUInt32LE(offset + 42), next = offset + 46 + nameLength + extraLength + commentLength
    if (flags & 1 || ![0, 8].includes(method) || buffer.readUInt16LE(offset + 34) || next > end || !nameLength || nameLength > 256) throw invalidFile()
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (names.has(name) || name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.')) throw invalidFile()
    names.add(name)
    if (expanded > LIMITS.entryBytes || expanded / Math.max(compressed, 1) > LIMITS.compressionRatio) throw budgetError()
    total += expanded; compressedTotal += compressed
    if (total > LIMITS.expandedBytes || total / Math.max(compressedTotal, 1) > LIMITS.compressionRatio) throw budgetError()
    if (local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) throw invalidFile()
    const localNameLength = buffer.readUInt16LE(local + 26), localExtraLength = buffer.readUInt16LE(local + 28)
    const dataStart = local + 30 + localNameLength + localExtraLength
    if (dataStart + compressed > start || buffer.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) throw invalidFile()
    if (!(flags & 8) && (buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== expanded || buffer.readUInt32LE(local + 14) !== buffer.readUInt32LE(offset + 16))) throw invalidFile()
    ranges.push([local, dataStart + compressed])
    entries.push({ name, method, compressed, expanded, crc: buffer.readUInt32LE(offset + 16), dataStart })
    offset = next
  }
  if (offset !== end) throw invalidFile()
  ranges.sort((a, b) => a[0] - b[0])
  if (ranges.some((r, i) => i && r[0] < ranges[i - 1][1])) throw invalidFile()
  return entries
}

let parsing = 0
async function parseBudgetedRows(buffer, { entity, preserveSettlementLexeme = false, preserveRowNumbers = false, timeoutMs = LIMITS.parseMs } = {}) {
  const shape = ENTITIES[entity]
  if (!shape) throw invalidFile()
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw invalidFile()
  if (buffer.length > LIMITS.uploadBytes) throw budgetError()
  if (parsing >= LIMITS.concurrent) throw new AppError('导入任务繁忙，请稍后重试', 429, 'IMPORT_BUSY')
  const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b
  const entries = isXlsx ? preflightZip(buffer) : null
  parsing++
  try {
    return await new Promise((resolve, reject) => {
      const worker = fork(path.join(__dirname, 'importParseWorker.js'), [], { execArgv: [`--max-old-space-size=${LIMITS.heapMb}`], env: { NODE_ENV: process.env.NODE_ENV || 'development' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' })
      let result, error, settled = false
      const timer = setTimeout(() => { error = budgetError(); worker.kill('SIGKILL') }, Math.max(1, Math.min(Number(timeoutMs) || LIMITS.parseMs, LIMITS.parseMs)))
      const finish = (exitCode) => {
        if (settled) return
        settled = true; clearTimeout(timer)
        if (error) reject(error)
        else if (!result || exitCode !== 0) reject(budgetError())
        else if (result.error) reject(result.error === 'IMPORT_BUDGET_EXCEEDED' ? budgetError() : invalidFile())
        else resolve(result.rows)
      }
      worker.once('message', value => { result = value })
      worker.once('error', () => { error = invalidFile(); worker.kill('SIGKILL') })
      worker.once('exit', finish)
      // A failed spawn emits error/close without exit. Both events share the
      // idempotent completion; live workers still release only after termination.
      worker.once('close', finish)
      worker.send({ buffer, entries, shape, limits: LIMITS, preserveSettlementLexeme, preserveRowNumbers }, sendError => { if (sendError) { error ||= invalidFile(); worker.kill('SIGKILL') } })
    })
  } finally { parsing-- }
}

// Hold an HTTP import slot before multipart memory allocation, release on response/abort.
let admitted = 0
function importAdmission(req, res, next) {
  if (admitted >= LIMITS.concurrent) return next(new AppError('导入任务繁忙，请稍后重试', 429, 'IMPORT_BUSY'))
  admitted++
  let released = false
  const release = () => { if (!released) { released = true; admitted-- } }
  res.once('finish', release); res.once('close', release); req.once('aborted', release)
  next()
}
module.exports = { LIMITS, ENTITIES, preflightZip, parseBudgetedRows, importAdmission }
