/** operationRequest cleanup uses original created_at, seven days, immediately and every six hours. */
export const OPERATION_RETENTION_MS = 7 * 86400000
export const OPERATION_CLOCK_MARGIN_MS = 120000
export const TERMINAL_MAX_COUNT = 4096
export const TERMINAL_MAX_BYTES = 1024 * 1024
const CLOCK_KEY = 'flowcube-critical-terminal-clock-v2'
const PREFIXES = ['flowcube-inventory-outbound-v1:terminal:', 'pda_owned_terminal_v3:', 'flowcube-ordinary-sale-v1:terminal:', 'flowcube-procurement-intent-v1:terminal:']
type RecordObject = Record<string, unknown>
export interface TerminalReservation { key: string; requestHash: string; createdAt: number; requestSnapshot: string }
export interface CompactTerminal { terminalVersion: 2; requestHash: string; createdAt: number; state: 'reserved' | 'success' | 'failed'; clockSeal?: number }
const object = (v: unknown): v is RecordObject => !!v && typeof v === 'object' && !Array.isArray(v)
const stable = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v ?? null) : Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : `{${Object.keys(v).filter(k => (v as RecordObject)[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable((v as RecordObject)[k])).join(',')}}`
const pc = (key: string) => key.startsWith(PREFIXES[0])
function immutable(key: string, record: object) {
  const value = { ...record } as RecordObject
  if (pc(key)) { delete value.phase; delete value.result }
  return value
}
export function originalCreatedAt(record: object): number {
  const value = (record as RecordObject).createdAt
  const date = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isSafeInteger(date) || date <= 0) throw Error('原操作时间不完整，请保留记录并人工核对')
  return date
}
async function digest(key: string, record: object) {
  if (!crypto.subtle) throw Error('此客户端无法安全保存原操作，本次不发送')
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(immutable(key, record))))
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('')
}
export function isCompactTerminal(value: unknown): value is CompactTerminal {
  return object(value) && value.terminalVersion === 2 && typeof value.requestHash === 'string' && /^[a-f0-9]{64}$/.test(value.requestHash)
    && typeof value.createdAt === 'number' && Number.isSafeInteger(value.createdAt) && value.createdAt > 0 && ['reserved','success','failed'].includes(String(value.state))
    && (Object.keys(value).length === 4 && !('clockSeal' in value) || Object.keys(value).length === 5 && value.state !== 'reserved' && typeof value.clockSeal === 'number' && Number.isSafeInteger(value.clockSeal) && value.clockSeal > 0)
}
export function compactTerminalAt(key: string): CompactTerminal | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const value: unknown = JSON.parse(raw)
  if (!object(value) || !('terminalVersion' in value)) return null // v4 full terminals remain readable.
  if (!isCompactTerminal(value)) throw Error('原操作确认记录损坏，请保留记录并人工核对')
  return value
}
export async function matchingCompactTerminal(key: string, record: object) {
  const terminal = compactTerminalAt(key)
  if (!terminal) return null
  if (terminal.createdAt !== originalCreatedAt(record) || terminal.requestHash !== await digest(key, record)) throw Error('原操作确认身份与正文不一致，请保留记录并核对')
  return terminal
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value)
  localStorage.setItem(key, raw)
  if (localStorage.getItem(key) !== raw) throw Error('原操作记录未能保存，本次不发送；请恢复本地存储')
}
function ownKeys() {
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => !!key && PREFIXES.some(prefix => key.startsWith(prefix)))
}
function clockHighWater() {
  const raw = localStorage.getItem(CLOCK_KEY)
  if (raw != null) {
    const last: unknown = JSON.parse(raw)
    if (typeof last !== 'number' || !Number.isSafeInteger(last) || last <= 0) throw Error('设备时间已变化，请只查询原结果并人工核对，暂勿重新提交')
    return last
  }
  // A quota interrupted promotion may leave the verified clock inside one atomic compact replacement.
  // Normal operations with the global clock only read that clock; old full bodies are not parsed here.
  let high = 0
  for (const key of ownKeys()) {
    const value = localStorage.getItem(key)
    if (!value?.includes('"clockSeal"')) continue
    const parsed: unknown = JSON.parse(value)
    if (!object(parsed) || !('terminalVersion' in parsed) || !('clockSeal' in parsed)) continue
    if (!isCompactTerminal(parsed)) throw Error('原操作最高时间记录损坏，请保留记录并人工核对')
    high = Math.max(high, parsed.clockSeal!)
  }
  return high
}
function assertClock(now = Date.now()) {
  if (clockHighWater() > now + OPERATION_CLOCK_MARGIN_MS) throw Error('设备时间已变化，请只查询原结果并人工核对，暂勿重新提交')
  return now
}
async function locked<T>(fn: () => Promise<T>) {
  if (!navigator.locks?.request) throw Error('此客户端无法安全保存原操作，本次不发送')
  return navigator.locks.request('flowcube-critical-terminal-v2', fn)
}
async function legacyTerminal(key: string, parsed: unknown): Promise<CompactTerminal> {
  if (!object(parsed) || 'terminalVersion' in parsed) throw Error('原操作确认记录损坏，请保留记录并人工核对')
  const record = pc(key) ? parsed : parsed.record, state = pc(key) ? parsed.phase : parsed.status
  if (!object(record) || !['success','failed'].includes(String(state))) throw Error('原操作确认记录不完整，请保留记录并人工核对')
  return { terminalVersion: 2, requestHash: await digest(key, record), createdAt: originalCreatedAt(record), state: state as 'success' | 'failed' }
}
async function sealClock(now: number) {
  const high = Math.max(now, clockHighWater())
  try { write(CLOCK_KEY, high); return }
  catch (error) {
    // Only exact quota bootstrap with an absent global clock. Permission/readback/corrupt-clock failures stay closed.
    if ((error as { name?: string })?.name !== 'QuotaExceededError' || localStorage.getItem(CLOCK_KEY) != null) throw error
    for (const key of ownKeys()) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { continue }
      if (!object(parsed) || 'terminalVersion' in parsed) continue
      const source = pc(key) ? parsed : parsed.record, state = pc(key) ? parsed.phase : parsed.status
      if (!object(source) || !['success', 'failed'].includes(String(state))) continue
      let createdAt: number
      try { createdAt = originalCreatedAt(source) } catch { continue }
      if (createdAt > now + OPERATION_CLOCK_MARGIN_MS) continue
      const terminal = await legacyTerminal(key, parsed), sealed = { ...terminal, clockSeal: high }
      // This same-key write both preserves the original success/failed identity and seals time BEFORE any GC.
      // Sufficient conservative UTF16 space for the global clock must be freed; no pending/reserved is touched.
      if (raw.length - JSON.stringify(sealed).length < CLOCK_KEY.length + JSON.stringify(high).length) continue
      if (localStorage.getItem(key) !== raw) throw Error('原操作确认记录已变化，请只查询原结果并人工核对')
      write(key, sealed)
      write(CLOCK_KEY, high) // If promotion still fails, the embedded seal remains readable and no GC has run.
      write(key, terminal) // Drop the temporary seal only AFTER global-clock readback succeeded.
      return
    }
    throw error
  }
}
async function migrateAndCollect(now: number) {
  // Only the owned terminal namespaces; pending, old unclaimed records and other app data are never deleted.
  for (const key of ownKeys()) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    const parsed: unknown = JSON.parse(raw)
    let terminal: CompactTerminal
    if (isCompactTerminal(parsed)) terminal = parsed
    else {
      terminal = await legacyTerminal(key, parsed)
      // Atomic replacement at the SAME key shrinks old full records without an unsafe delete/write gap.
      write(key, terminal)
    }
    if (terminal.createdAt > now + OPERATION_CLOCK_MARGIN_MS) throw Error('原操作时间异常，请只查询原结果并人工核对')
    // Creation time, not confirmation time. No pruning while a key can still be retried by this client.
    if (terminal.state !== 'reserved' && now - terminal.createdAt > OPERATION_RETENTION_MS + OPERATION_CLOCK_MARGIN_MS) localStorage.removeItem(key)
  }
}
export async function reserveTerminalSlot(key: string, record: object, forRetry = false) {
  return locked(async () => {
    const now = assertClock(), createdAt = originalCreatedAt(record), requestSnapshot = stable(immutable(key, record))
    if (createdAt > now + OPERATION_CLOCK_MARGIN_MS || forRetry && now - createdAt >= OPERATION_RETENTION_MS - OPERATION_CLOCK_MARGIN_MS) throw Error('原操作已超出安全重试时限，请只查询并人工核对')
    await sealClock(now) // Seal BEFORE any GC; later corrupt records/budget/quota failures cannot erase time history.
    await migrateAndCollect(now)
    const existing = await matchingCompactTerminal(key, record)
    if (existing && existing.state !== 'reserved') throw Error('原操作已有确认记录，请只查询原结果，暂勿再次提交')
    const slot: CompactTerminal = existing ?? { terminalVersion: 2, requestHash: await digest(key, record), createdAt, state: 'reserved' }
    const keys = ownKeys(), bytes = keys.reduce((sum, k) => sum + 2 * (k.length + (localStorage.getItem(k)?.length ?? 0)), 0)
    const extra = existing ? 0 : 2 * (key.length + JSON.stringify(slot).length)
    if (keys.length + (existing ? 0 : 1) > TERMINAL_MAX_COUNT || bytes + extra > TERMINAL_MAX_BYTES) throw Error('本地确认记录容量已满，请先核对原操作或等待安全保留期结束；本次没有发送')
    write(key, slot) // Reserved slots are never expired or evicted; unknown operations retain their place.
    return { key, requestHash: slot.requestHash, createdAt, requestSnapshot } as TerminalReservation
  })
}
/** Synchronous final check AFTER every awaited fingerprint/storage/query and immediately before POST. */
export function assertTerminalReadyForPost(key: string, record: object, reservation: TerminalReservation) {
  const now = assertClock(), createdAt = originalCreatedAt(record)
  if (createdAt > now + OPERATION_CLOCK_MARGIN_MS || now - createdAt >= OPERATION_RETENTION_MS - OPERATION_CLOCK_MARGIN_MS) throw Error('原操作已超出安全重试时限，请只查询并人工核对')
  const slot = compactTerminalAt(key)
  if (reservation.key !== key || reservation.createdAt !== createdAt || reservation.requestSnapshot !== stable(immutable(key, record))
    || !slot || slot.requestHash !== reservation.requestHash || slot.createdAt !== createdAt || slot.state !== 'reserved') throw Error('原操作内容或确认记录已变化，请只查询原结果，暂勿再次提交')
}
export async function completeTerminalSlot(key: string, record: object, state: 'success' | 'failed') {
  return locked(async () => {
    // Read-only receipt confirmation can complete an old reserved slot even when the local clock is abnormal.
    let slot = await matchingCompactTerminal(key, record)
    if (!slot) {
      // Existing v4 pending requests have no reservation; preserve their full body if storage cannot accept the marker.
      const now = assertClock(); await sealClock(now); await migrateAndCollect(now)
      slot = await matchingCompactTerminal(key, record)
      const keys = ownKeys(), marker = { terminalVersion: 2 as const, requestHash: await digest(key, record), createdAt: originalCreatedAt(record), state }
      const bytes = keys.reduce((sum, k) => sum + 2 * (k.length + (localStorage.getItem(k)?.length ?? 0)), 0)
      if (!keys.includes(key) && (keys.length >= TERMINAL_MAX_COUNT || bytes + 2 * (key.length + JSON.stringify(marker).length) > TERMINAL_MAX_BYTES)) throw Error('原结果已返回，但确认记录容量不足，请保留原内容并继续核对')
      slot ??= marker
    }
    if (slot.state !== 'reserved' && slot.state !== state) throw Error('原操作确认结果冲突，请保留记录并人工核对')
    write(key, { ...slot, state }) // success/failed are no larger than reserved, preventing post-commit budget overflow.
  })
}
export async function cancelUnsentTerminalSlot(key: string, record: object) {
  return locked(async () => { const slot = await matchingCompactTerminal(key, record); if (slot?.state === 'reserved') localStorage.removeItem(key) })
}
