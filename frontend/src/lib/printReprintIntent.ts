import apiClient from '@/api/client'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { useAuthStore } from '@/store/authStore'
interface Intent { version: 2; key: string; body: string; userId: number; baseURL: string; createdAt: number; phase: 'pending' | 'confirmed'; result?: unknown }
type Config = { baseURL: string; _erpApiFallbackTried: boolean; _authSessionGeneration: number; skipGlobalError: boolean }
const TTL = 7 * 86400000, listeners = new Set<() => void>(), flights = new Map<string, Promise<unknown>>()
let revision = 0
const notify = () => { revision++; listeners.forEach(fn => fn()) }
const endpoint = (baseURL: string) => new URL(baseURL, window.location.href).href.replace(/\/$/, '')
const owner = () => { const auth = useAuthStore.getState(); return { userId: auth.user?.id, token: auth.token, generation: auth.sessionGeneration, baseURL: apiClient.defaults.baseURL ?? '/api' } }
export const reprintOwnerIdentity = () => { const o = owner(); return JSON.stringify([o.userId, endpoint(o.baseURL), o.generation]) }
const storageKey = (resource: string, o = owner()) => `flowcube:reprint:v2:${encodeURIComponent(endpoint(o.baseURL))}:${o.userId}:${resource}`
export function subscribeReprintIntents(fn: () => void) { listeners.add(fn); const onStorage = () => notify(); window.addEventListener('storage', onStorage); return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage) } }
export const reprintIntentRevision = () => revision
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  const row = value as Record<string, unknown>
  return '{' + Object.keys(row).filter(k => row[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(row[k])).join(',') + '}'
}
function read(resource: string, o = owner()): Intent | null {
  const raw = localStorage.getItem(storageKey(resource, o))
  if (!raw) return null
  let r: Intent
  try { r = JSON.parse(raw) } catch { throw Error('原补打意图无法读取，请保留记录并核对') }
  if (r.version !== 2 || !r.key || typeof r.body !== 'string' || r.userId !== o.userId || endpoint(r.baseURL) !== endpoint(o.baseURL) || !Number.isSafeInteger(r.createdAt) || !['pending', 'confirmed'].includes(r.phase) || r.phase === 'confirmed' && r.result == null) throw Error('原补打意图身份或内容损坏，请保留记录并核对')
  return r
}
export function getReprintIntent(resource: string) {
  try { const r = read(resource); return r ? { key: r.key, phase: r.phase, payload: JSON.parse(r.body) as unknown, expired: r.phase === 'pending' && (!r.createdAt || Date.now() - r.createdAt >= TTL - 120000 || Date.now() < r.createdAt) } : null }
  catch { return { key: null, phase: 'pending' as const, expired: true } }
}
export function listReprintIntents() {
  const prefix = storageKey('')
  return Object.keys(localStorage).filter(key => key.startsWith(prefix)).flatMap(key => {
    const resource = key.slice(prefix.length), info = getReprintIntent(resource)
    return info ? [{ resource, ...info }] : []
  })
}
function receiptMetadata(value: unknown) {
  // 回执只持久保留身份/任务元数据，不把物流标签内容、认证令牌或其它正文落盘。
  const row = value as Record<string, unknown>, keys = ['queued', 'category', 'recordId', 'requestId', 'id', 'jobId', 'taskId', 'mode', 'count', 'jobIds', 'failedJobIds', 'containerIds', 'noPrinterCount']
  return Object.fromEntries(keys.filter(k => row[k] !== undefined).map(k => [k, row[k]]))
}
function persist(resource: string, r: Intent) {
  const value = JSON.stringify(r)
  localStorage.setItem(storageKey(resource), value)
  if (localStorage.getItem(storageKey(resource)) !== value) throw Error('无法保存补打意图，本次不能提交')
  notify()
}
const actionFor = (resource: string) => {
  const m = /^(?:barcode:(?:inbound|outbound|logistics):|inbound:)([1-9]\d*)$/.exec(resource)
  if (!m) throw Error('补打来源身份无效')
  return `${resource.startsWith('barcode:') ? 'print.barcodeReprint' : 'inbound.reprint'}.${m[1]}`
}
export async function submitReprintIntent<T>(resource: string, payload: unknown, submit: (key: string, config: Config) => Promise<T>, validate: (result: T) => boolean = () => true, options: { newIntent?: boolean; expectedKey?: string | null; expectedOwner?: string; queryOnly?: boolean } = {}): Promise<T | null> {
  const o = owner(), body = stable(payload), partition = storageKey(resource, o)
  if (!o.userId || !o.token) throw Error('请重新登录后补打')
  if (options.expectedOwner && options.expectedOwner !== reprintOwnerIdentity()) throw Error('原账号或服务器已变化，请重新核对')
  const currentOwner = () => { const n = owner(); return !!n.token && n.userId === o.userId && n.generation === o.generation && endpoint(n.baseURL) === endpoint(o.baseURL) }
  const config: Config = { baseURL: o.baseURL, _erpApiFallbackTried: true, _authSessionGeneration: o.generation, skipGlobalError: true }
  const pending = flights.get(partition)
  if (pending) return pending as Promise<T | null>
  if (!navigator.locks?.request) throw Error('当前环境不能安全协调多个页面，请使用支持的浏览器后核对原补打；本次未提交')
  const work = navigator.locks.request(partition, async () => {
    if (!currentOwner()) return null
    let intent = read(resource, o)
    // 升级前同页未知请求只能查询；不能补造时间后重新发送。
    const legacyKey = `flowcube:reprint:${encodeURIComponent(o.baseURL)}:${o.userId}:${resource}`
    const legacy = sessionStorage.getItem(legacyKey)
    if (!intent && legacy) {
      const old = JSON.parse(legacy) as { key: string; body: string; userId: number; baseURL: string }
      if (!old.key || old.userId !== o.userId || endpoint(old.baseURL) !== endpoint(o.baseURL)) throw Error('原补打意图身份损坏，请保留记录并核对')
      intent = { version: 2, key: old.key, body: stable(JSON.parse(old.body)), userId: o.userId!, baseURL: o.baseURL, createdAt: 0, phase: 'pending' }
      persist(resource, intent)
    }
    if (options.newIntent) {
      if ((intent?.key ?? null) !== options.expectedKey) throw Error('原补打意图已被其他页面处理，请重新核对后再另补')
      intent = null
    }
    if (intent && intent.body !== body) throw Error('原补打结果尚未确认，请按原正文核对；另补须明确选择另补一份')
    if (intent?.phase === 'confirmed' && !options.queryOnly) return intent.result as T
    if (intent) {
      const status = await getOperationRequestStatusApi(intent.key, actionFor(resource), config)
      if (!currentOwner() || read(resource, o)?.key !== intent.key) return null
      if (status.status === 'success') {
        const receipt = status.data as { version?: number; action?: string; result?: T; fingerprint?: string }
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
        const fingerprint = [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('')
        if (receipt.version !== 1 || receipt.action !== actionFor(resource) || receipt.fingerprint !== fingerprint || receipt.result == null || !validate(receipt.result)) throw Error('补打返回结果无法确认，请保留原键并核对')
        if (!currentOwner() || read(resource, o)?.key !== intent.key) return null
        persist(resource, { ...intent, phase: 'confirmed', result: receiptMetadata(receipt.result) })
        return receipt.result
      }
      if (status.status !== 'not_found') throw Error('原补打结果尚待确认，请核对原请求和现场纸张')
      if (options.queryOnly) throw Error('原补打结果暂无法查到，结果未知；请核对有效来源和现场纸张，勿重复补打')
      if (!intent.createdAt || Date.now() < intent.createdAt || Date.now() - intent.createdAt >= TTL - 120000) throw Error('原补打意图已过期，结果未知；禁止按旧意图重建。核对后如需另补，请明确选择另补一份')
    } else {
      if (options.queryOnly) throw Error('原补打意图已变化，请重新核对')
      const createdAt = Date.now()
      intent = { version: 2, key: `reprint-v2-${createdAt}-${crypto.randomUUID()}`, body, userId: o.userId!, baseURL: o.baseURL, createdAt, phase: 'pending' }
      persist(resource, intent)
    }
    if (!currentOwner() || read(resource, o)?.key !== intent.key) return null
    const result = await submit(intent.key, config)
    if (!currentOwner() || read(resource, o)?.key !== intent.key) return null
    if (result == null || !validate(result)) throw Error('补打返回结果无法确认，请按原请求查询')
    persist(resource, { ...intent, phase: 'confirmed', result: receiptMetadata(result) })
    return result
  })
  flights.set(partition, work)
  try { return await work } finally { if (flights.get(partition) === work) flights.delete(partition) }
}
