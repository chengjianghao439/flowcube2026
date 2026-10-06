import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { DisposalExecutionResult } from '@/types/disposal'

export const DISPOSAL_EXECUTION_STORAGE = 'flowcube-disposal-execution-v1'
export const DISPOSAL_REQUEST_TTL = 7 * 86400000
export interface DisposalExecutionRecord {
  version: 1
  id: number
  userId: number
  baseURL: string
  action: string
  path: string
  method: 'post'
  body?: Record<string, never>
  requestKey: string
  createdAt: number
  phase: 'pending' | 'confirmed'
  result?: DisposalExecutionResult
}
export interface DisposalOwner { userId: number | null; baseURL: string; sessionGeneration: number; epoch: number }
const confirmed = new Map<string, DisposalExecutionResult>()
export const confirmedDisposal = (record: Pick<DisposalExecutionRecord, 'userId' | 'baseURL' | 'id'>) => confirmed.get(recordIdentity(record))
export function rememberConfirmedDisposal(record: DisposalExecutionRecord, result: DisposalExecutionResult) { confirmed.set(recordIdentity(record), result) }
const listeners = new Set<() => void>()
let generation = 0, revision = 0
const actor = () => { const a = useAuthStore.getState(); return JSON.stringify([a.token, a.sessionGeneration, a.user?.id, a.user?.roleId, a.user?.permissions]) }
let lastActor = actor()
function notify() { revision++; listeners.forEach(listener => listener()) }
function ownerChanged() { generation++; confirmed.clear(); notify() }
subscribeApiClientBaseURL(ownerChanged)
useAuthStore.subscribe(() => { const next = actor(); if (next !== lastActor) { lastActor = next; ownerChanged() } })
export const subscribeDisposalRecovery = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const disposalRevision = () => revision
export const disposalEpoch = () => generation
export function captureDisposalOwner(): DisposalOwner { const a = useAuthStore.getState(); return { userId: a.user?.id ?? null, baseURL: getApiClientBaseURL() ?? '/api', sessionGeneration: a.sessionGeneration, epoch: generation } }
export function disposalOwnerCurrent(owner: DisposalOwner) { const a = useAuthStore.getState(); return !!a.token && owner.userId === a.user?.id && owner.baseURL === (getApiClientBaseURL() ?? '/api') && owner.sessionGeneration === a.sessionGeneration && owner.epoch === generation }
export function mayExecuteDisposal() { const a = useAuthStore.getState(); return !!a.token && hasPermission(a.user?.permissions, PERMISSIONS.INVENTORY_DISPOSAL_EXECUTE, a.user?.roleId) }
export const disposalConfig = (owner: DisposalOwner) => ({ baseURL: owner.baseURL, _authSessionGeneration: owner.sessionGeneration, _erpApiFallbackTried: true, automaticReplay: false as const, skipGlobalError: true })
export const positiveDisposalId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
export function isDisposalResult(value: unknown, id: number): value is DisposalExecutionResult {
  return !!value && typeof value === 'object' && 'id' in value && value.id === id && 'disposalNo' in value && typeof value.disposalNo === 'string' && !!value.disposalNo.trim() && 'disposedValue' in value && typeof value.disposedValue === 'number' && Number.isFinite(value.disposedValue)
}
export const recordIdentity = (r: Pick<DisposalExecutionRecord, 'userId' | 'baseURL' | 'id'>) => JSON.stringify([r.userId, r.baseURL, r.id])
function validRecord(value: unknown): value is DisposalExecutionRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<DisposalExecutionRecord>
  return r.version === 1 && positiveDisposalId(r.id) && positiveDisposalId(r.userId) && typeof r.baseURL === 'string' && !!r.baseURL
    && r.action === `disposal.dispose.${r.id}` && r.path === `/disposals/${r.id}/dispose` && r.method === 'post'
    && typeof r.requestKey === 'string' && !!r.requestKey.trim() && typeof r.createdAt === 'number' && Number.isSafeInteger(r.createdAt)
    && (r.phase === 'pending' || r.phase === 'confirmed') && (r.body === undefined || (!!r.body && typeof r.body === 'object' && !Array.isArray(r.body) && Object.keys(r.body).length === 0))
    && (r.phase !== 'confirmed' || isDisposalResult(r.result, r.id))
}
export function readDisposalRecords(): DisposalExecutionRecord[] {
  const raw = localStorage.getItem(DISPOSAL_EXECUTION_STORAGE)
  if (!raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('原报废请求记录损坏，请人工核对；禁止另发执行') }
  if (!Array.isArray(parsed) || parsed.some(r => !validRecord(r))) throw new Error('原报废请求身份不完整，请人工核对；禁止另发执行')
  const ids = parsed.map(recordIdentity)
  if (new Set(ids).size !== ids.length) throw new Error('同单存在多条原报废请求，请人工核对；禁止另发执行')
  return parsed
}
function write(records: DisposalExecutionRecord[]) {
  if (records.length) localStorage.setItem(DISPOSAL_EXECUTION_STORAGE, JSON.stringify(records))
  else localStorage.removeItem(DISPOSAL_EXECUTION_STORAGE)
  notify()
}
export function saveDisposalRecord(record: DisposalExecutionRecord) {
  const records = readDisposalRecords()
  if (records.some(r => recordIdentity(r) === recordIdentity(record))) throw new Error('本单已有待确认报废请求，请先核对原结果')
  write([...records, record])
}
export function replaceDisposalRecord(record: DisposalExecutionRecord) { write(readDisposalRecords().map(r => recordIdentity(r) === recordIdentity(record) && r.requestKey === record.requestKey ? record : r)) }
export function removeDisposalRecord(record: DisposalExecutionRecord) { write(readDisposalRecords().filter(r => !(recordIdentity(r) === recordIdentity(record) && r.requestKey === record.requestKey))) }
export function freshDisposalRecord(record: DisposalExecutionRecord) { return record.createdAt > 0 && record.createdAt <= Date.now() && Date.now() - record.createdAt < DISPOSAL_REQUEST_TTL && record.body !== undefined && record.phase === 'pending' }
export function ownDisposalRecords() {
  const owner = captureDisposalOwner()
  try { return { records: readDisposalRecords().filter(r => r.userId === owner.userId && r.baseURL === owner.baseURL), error: '' } }
  catch (e) { return { records: [] as DisposalExecutionRecord[], error: e instanceof Error ? e.message : '原报废记录不可读取，请人工核对' } }
}

if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === DISPOSAL_EXECUTION_STORAGE || event.key === null) notify() })
