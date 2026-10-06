import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiClientError, getApiClientBaseURL } from '@/api/client'
import { createSaleApi } from '@/api/sale'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { useAuthStore } from '@/store/authStore'
import { createRequestKey } from '@/lib/requestKey'
import { assertReorderOwner, mayCreateReorder, positiveReorderId, reorderConfig, reorderEpoch, reorderOwnerCurrent, subscribeReorder, type ReorderOwner } from '@/lib/saleReorder'
import type { CreateSaleParams } from '@/types/sale'
import type { CommercialBody } from '@/types/sale-commercial'
export const REPEAT_CREATE_STORAGE = 'flowcube-repeat-sale-query-v1'
const TTL = 7 * 24 * 60 * 60 * 1000
export interface QueryRecord { version: 1; scope: string; sourceId: number; model: 'ordinary' | 'kit-v1'; userId: number; baseURL: string; requestKey: string; createdAt: number }
export interface RepeatSaleAck { id: number; orderNo: string }
type Payload = CreateSaleParams | CommercialBody
export interface RepeatSaleCreate {
  submit: (payload: Payload) => Promise<RepeatSaleAck | null>; retry: () => Promise<RepeatSaleAck | null>; queryOriginal: () => Promise<RepeatSaleAck | null>
  blocked: boolean; busy: boolean; pending: boolean; canRetry: boolean; error: string; result: RepeatSaleAck | null; canApply: (ack: RepeatSaleAck) => boolean; canView: (ack: RepeatSaleAck) => boolean
}
function records(): QueryRecord[] {
  const raw = sessionStorage.getItem(REPEAT_CREATE_STORAGE)
  if (!raw) return []
  const list = JSON.parse(raw)
  if (!Array.isArray(list) || list.some(r => !r || r.version !== 1 || !positiveReorderId(r.sourceId) || !positiveReorderId(r.userId) || !['ordinary', 'kit-v1'].includes(r.model) || ![r.scope, r.baseURL, r.requestKey].every(v => typeof v === 'string' && v.length > 0))) throw new Error('原创建查询记录不完整，请人工核对；不要另发保存')
  return list
}
const same = (a: QueryRecord, b: QueryRecord) => JSON.stringify(a) === JSON.stringify(b)
const stored = (record: QueryRecord) => records().some(r => same(r, record))
const recordListeners = new Set<() => void>()
const notifyRecords = () => recordListeners.forEach(listener => listener())
function subscribeRecords(listener: () => void) {
  recordListeners.add(listener)
  const unsubscribeOwner = subscribeReorder(listener)
  const onStorage = (event: StorageEvent) => { if (event.storageArea === sessionStorage && (event.key === REPEAT_CREATE_STORAGE || event.key === null)) listener() }
  window.addEventListener('storage', onStorage)
  return () => { recordListeners.delete(listener); unsubscribeOwner(); window.removeEventListener('storage', onStorage) }
}
function recordsSnapshot() { try { return `${reorderEpoch()}|${sessionStorage.getItem(REPEAT_CREATE_STORAGE) ?? ''}` } catch { return `${reorderEpoch()}|unreadable` } }
export function ownRepeatSaleQueries(): { records: QueryRecord[]; error: string } {
  const auth = useAuthStore.getState(), baseURL = getApiClientBaseURL() ?? '/api'
  if (!auth.token || !auth.user) return { records: [], error: '' }
  try { return { records: records().filter(record => record.userId === auth.user?.id && record.baseURL === baseURL), error: '' } }
  catch { return { records: [], error: '原创建查询记录无法读取，请人工核对；不要另发保存' } }
}
export function useOwnRepeatSaleQueries() { useSyncExternalStore(subscribeRecords, recordsSnapshot); return ownRepeatSaleQueries() }
function save(record: QueryRecord) { sessionStorage.setItem(REPEAT_CREATE_STORAGE, JSON.stringify([...records().filter(r => !(r.scope === record.scope && r.userId === record.userId && r.baseURL === record.baseURL)), record])); if (!stored(record)) throw new Error('原请求身份未保存，保存已阻止'); notifyRecords() }
function remove(record: QueryRecord) { if (!stored(record)) throw new Error('原请求身份已变化，请保留阻断并人工核对'); sessionStorage.setItem(REPEAT_CREATE_STORAGE, JSON.stringify(records().filter(r => !same(r, record)))); notifyRecords() }
const fresh = (record: QueryRecord) => Number.isSafeInteger(record.createdAt) && record.createdAt > 0 && record.createdAt <= Date.now() && Date.now() - record.createdAt < TTL
function ack(value: unknown, sourceId: number): value is RepeatSaleAck { return !!value && typeof value === 'object' && 'id' in value && 'orderNo' in value && positiveReorderId(value.id) && value.id !== sourceId && typeof value.orderNo === 'string' && value.orderNo.trim().length > 0 }
/** 仅重复新建：磁盘保存查询身份；完整body仅本实例冻结，重挂只查询、不拼旧表单重试。 */
export function useRepeatSaleCreate(sourceId: number, model: QueryRecord['model'], owner: ReorderOwner, scope: string, queryKey?: string): RepeatSaleCreate {
  const cache = useQueryClient(), mounted = useRef(true), running = useRef(false)
  useSyncExternalStore(subscribeReorder, reorderEpoch)
  const [initial] = useState(() => { try { return { record: records().find(r => r.scope === scope && r.sourceId === sourceId && r.model === model && r.userId === owner.userId && r.baseURL === owner.baseURL && (queryKey === undefined || r.requestKey === queryKey)) ?? null, error: '' } } catch { return { record: null, error: '原创建查询记录无法读取，请人工核对；不要另发保存' } } })
  const recordRef = useRef<QueryRecord | null>(initial.record), body = useRef<{ json: string; record: QueryRecord; uncertain: boolean } | null>(null)
  const [pending, setPending] = useState(!!initial.record), [busy, setBusy] = useState(false), [error, setError] = useState(initial.error), [result, setResult] = useState<RepeatSaleAck | null>(null)
  const resultRef = useRef<RepeatSaleAck | null>(null)
  const resultEpoch = useRef<number | null>(null)
  const resultApplicable = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function owns(record: QueryRecord) { return mounted.current && recordRef.current === record && stored(record) }
  function finish(record: QueryRecord, answer: RepeatSaleAck) {
    resultApplicable.current = !!body.current && reorderOwnerCurrent(owner)
    remove(record); recordRef.current = null; body.current = null
    resultRef.current = answer; resultEpoch.current = reorderEpoch(); setResult(answer); setPending(false); setError('原销售单已创建，请查看新单；当前草稿禁止重复保存')
    if (reorderOwnerCurrent(owner)) void cache.invalidateQueries({ queryKey: ['sale'] })
    return answer
  }
  async function send(record: QueryRecord) {
    const snapshot = body.current
    if (!snapshot || snapshot.record !== record || !owns(record)) throw new Error('原完整载荷已不可用，只能查询或人工核对')
    assertReorderOwner(owner)
    if (!mayCreateReorder()) throw new Error('当前没有销售创建权限，原请求保留；仍可查询本人结果')
    try {
      const answer = await createSaleApi(JSON.parse(snapshot.json), record.requestKey, { ...reorderConfig(owner), headers: { 'X-Sale-Repeat-Create': '1' } })
      if (!owns(record) || !reorderOwnerCurrent(owner)) { snapshot.uncertain = true; if (mounted.current) setError('原结果已收到，但读取上下文变化；请查询原请求，草稿保留'); return null }
      if (!ack(answer, sourceId)) throw new Error('返回成功身份不明，请查询原请求；不要再次保存')
      return finish(record, answer)
    } catch (e) {
      if (!owns(record)) return null
      const details = e instanceof ApiClientError ? e.data : null
      const proof = details && typeof details === 'object' && 'saleCreateNotExecuted' in details && details.saleCreateNotExecuted === true
      const definite = e instanceof ApiClientError && e.status != null && e.status >= 400 && e.status < 500 && (proof || ['VALIDATION_ERROR', 'PERMISSION_DENIED', 'WAREHOUSE_SCOPE_DENIED'].includes(e.code ?? ''))
      if (!snapshot.uncertain && reorderOwnerCurrent(owner) && definite) { remove(record); recordRef.current = null; body.current = null; setPending(false) }
      else snapshot.uncertain = true
      setError(e instanceof Error ? e.message : '结果未确认，请查询原请求'); return null
    }
  }
  async function guard(run: () => Promise<RepeatSaleAck | null>) {
    if (running.current) return null
    running.current = true; setBusy(true)
    try { return await run() } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '原请求无法核对'); return null }
    finally { running.current = false; if (mounted.current) setBusy(false) }
  }
  async function submit(payload: Payload) {
    if (recordRef.current || resultRef.current || initial.error) return null
    return guard(async () => {
      assertReorderOwner(owner)
      if (!mayCreateReorder() || !positiveReorderId(owner.userId)) throw new Error('当前没有销售创建权限，草稿保留')
      if (records().some(r => r.scope === scope && r.userId === owner.userId && r.baseURL === owner.baseURL)) throw new Error('该来源已有未确认创建，请先核对原结果')
      const record: QueryRecord = { version: 1, scope, sourceId, model, userId: owner.userId, baseURL: owner.baseURL, requestKey: createRequestKey('sale-repeat'), createdAt: Date.now() }
      save(record); recordRef.current = record; body.current = { json: JSON.stringify(payload), record, uncertain: false }; setPending(true); setError('')
      return send(record)
    })
  }
  async function queryOriginal(retry = false) {
    const record = recordRef.current
    if (!record) return null
    return guard(async () => {
      const currentAuth = useAuthStore.getState(), before = reorderEpoch()
      if (!currentAuth.token || currentAuth.user?.id !== record.userId || (getApiClientBaseURL() ?? '/api') !== record.baseURL || !owns(record)) throw new Error('请回原账号和服务器查询本人原请求')
      const receipt = await getOperationRequestStatusApi(record.requestKey, 'sale.create', reorderConfig({ ...owner, sessionGeneration: currentAuth.sessionGeneration }))
      if (reorderEpoch() !== before || !owns(record)) return null
      if (receipt.status === 'success') {
        if (receipt.resourceType !== 'sale_order' || !ack(receipt.data, sourceId) || receipt.resourceId !== receipt.data.id) throw new Error('原创建结果对应的销售单不一致，保留待确认记录并人工核对')
        return finish(record, receipt.data)
      }
      if (receipt.status === 'failed') {
        if (receipt.resourceType != null || receipt.resourceId != null) throw new Error('失败结果含未知资源，请人工核对原请求')
        remove(record); recordRef.current = null; body.current = null; setPending(false); setError(receipt.message || '原操作已确认失败，可修正草稿'); return null
      }
      if (receipt.status === 'not_found' && retry && fresh(record) && body.current && body.current.record === record && reorderOwnerCurrent(owner) && mayCreateReorder()) return send(record)
      setError(receipt.status === 'not_found' ? '暂未找到原结果；超7天、时间异常或重挂后缺少原完整载荷时只能继续查询／人工核对，不可重新保存' : '原请求仍在处理中，请继续查询，勿另发保存'); return null
    })
  }
  return { submit, queryOriginal: () => queryOriginal(), retry: () => queryOriginal(true), get blocked() { return running.current || !!recordRef.current || !!resultRef.current || !!initial.error }, busy, pending, error, result: resultEpoch.current === reorderEpoch() ? result : null, canRetry: !!recordRef.current && fresh(recordRef.current) && !!body.current && reorderOwnerCurrent(owner) && mayCreateReorder(), canApply: answer => mounted.current && resultApplicable.current && resultRef.current === answer && reorderOwnerCurrent(owner), canView: answer => mounted.current && resultRef.current === answer && resultEpoch.current === reorderEpoch() }
}
