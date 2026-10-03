import { useEffect, useRef, useState } from 'react'
import type { KitReadOwner } from '@/api/kits'
import {
  confirmSaleReturnApi,
  cancelSaleReturnApi,
  getSaleReturnDetailApi,
  type SaleReturn
} from '@/api/returns'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useAuthStore } from '@/store/authStore'
import { assertKitReadOwner } from './useKits'
import { kitQuerySession } from '@/lib/kitRecoveryIdentity'
interface FactRecord {
  version: 1
  id: number
  action: 'confirm' | 'cancel'
  baseURL: string
  userId: number
  sessionId: string
  nonce: string
}
/** These endpoints have no operation receipt. Keep current-fact verification
 * distinct from a claim about who executed the original request. */
export function useSourceReturnFacts(id: number, owner: KitReadOwner) {
  const key = `flowcube-source-return-facts-v1:${id}`
  function read(): FactRecord | null {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const r = JSON.parse(raw)
    if (
      r?.version !== 1 ||
      r.id !== id ||
      !['confirm', 'cancel'].includes(r.action) ||
      typeof r.baseURL !== 'string' ||
      typeof r.sessionId !== 'string' ||
      typeof r.nonce !== 'string' ||
      !Number.isSafeInteger(r.userId)
    )
      throw new Error('历史单据核对身份不完整，请人工核对')
    return r
  }
  const [initial] = useState(() => {
    try {
      return { record: read(), error: '' }
    } catch {
      return {
        record: null,
        error: '历史单据核对身份无法读取，请人工核对；暂勿重复提交'
      }
    }
  })
  const recordRef = useRef(initial.record),
    busyRef = useRef(false),
    mounted = useRef(true)
  const [record, setRecord] = useState(initial.record),
    [error, setError] = useState(initial.error),
    [busy, setBusy] = useState(false)
  const [fact, setFact] = useState<{
    nonce: string
    text: string
    satisfied: boolean
  } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useAuthStore((state) => state.sessionGeneration)
  function same(r: FactRecord, generation: number) {
    const auth = useAuthStore.getState()
    try {
      assertKitReadOwner({
        baseURL: r.baseURL,
        userId: r.userId,
        sessionGeneration: generation
      })
    } catch {
      return false
    }
    try {
      return (
        mounted.current &&
        recordRef.current === r &&
        auth.sessionGeneration === generation &&
        kitQuerySession() === r.sessionId &&
        JSON.stringify(read()) === JSON.stringify(r)
      )
    } catch {
      return false
    }
  }
  function clear(r: FactRecord) {
    if (JSON.stringify(read()) !== JSON.stringify(r))
      throw new Error('原核对身份已变化，请保留阻断')
    sessionStorage.removeItem(key)
    if (sessionStorage.getItem(key))
      throw new Error(
        '原结果已确认，但核对记录未清理；请保留阻断，不要重复提交'
      )
    recordRef.current = null
    setRecord(null)
    setFact(null)
  }
  function satisfies(r: FactRecord, current: SaleReturn) {
    if (current.id !== r.id) return false
    return r.action === 'confirm'
      ? (current.status === 2 || current.status === 3) && !!current.task?.id
      : current.status === 4 ||
          (!!current.reverseTask?.id && current.status === 2)
  }
  async function perform(action: FactRecord['action']) {
    if (busyRef.current || recordRef.current || initial.error) return null
    busyRef.current = true
    setBusy(true)
    setError('')
    let r: FactRecord | null = null
    try {
      assertKitReadOwner(owner)
      r = {
        version: 1,
        id,
        action,
        baseURL: owner.baseURL,
        userId: owner.userId!,
        sessionId: kitQuerySession(),
        nonce: crypto.randomUUID()
      }
      if (read()) throw new Error('该单据已有原操作待核对')
      sessionStorage.setItem(key, JSON.stringify(r))
      if (JSON.stringify(read()) !== JSON.stringify(r))
        throw new Error('原核对身份未保存，未提交')
      recordRef.current = r
      setRecord(r)
      const result =
        action === 'confirm'
          ? await confirmSaleReturnApi(id, commercialReadConfig(owner))
          : await cancelSaleReturnApi(id, commercialReadConfig(owner))
      if (!same(r, owner.sessionGeneration)) {
        setError('原响应已到达，当前账号或服务器已变化，请核对原单')
        return null
      }
      clear(r)
      return { action, result }
    } catch (caught) {
      const e = caught as {
        status?: number
        response?: { status?: number }
        message?: string
      }
      const status = e.status ?? e.response?.status
      if (
        r &&
        recordRef.current === r &&
        same(r, owner.sessionGeneration) &&
        status != null &&
        status !== 408 &&
        status < 500
      )
        clear(r)
      if (mounted.current)
        setError(
          e.message ||
            '原操作结果待核对。该操作无原请求回执，请只读查询当前单据，不要重复提交。'
        )
      return null
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function queryFacts() {
    const r = recordRef.current
    if (!r || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const generation = useAuthStore.getState().sessionGeneration
      if (!same(r, generation))
        throw new Error('原操作的账号、服务器或登录身份已变化，请人工核对')
      const current: SaleReturn = await getSaleReturnDetailApi(
        r.id,
        commercialReadConfig({
          baseURL: r.baseURL,
          userId: r.userId,
          sessionGeneration: generation
        })
      )
      if (!same(r, generation)) return
      if (current.id !== r.id) throw new Error('当前单据不属于原退货单')
      setFact({
        nonce: r.nonce,
        satisfied: satisfies(r, current),
        text: `${current.status === 3 ? '当前单据已完成' : current.status === 2 ? '当前单据已确认' : current.status === 4 ? '当前单据已取消' : '当前单据仍为草稿'}${current.task ? ` · 入库任务 ${current.task.taskNo}` : ''}${current.reverseTask ? ` · 返货出库 ${current.reverseTask.taskNo}` : ''}。这是当前事实，不代表原请求回执；也可能由其他员工操作。`
      })
      setError('')
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : '原单查询失败，结果仍未知')
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function acknowledge(refreshDetail: () => Promise<SaleReturn>) {
    const r = recordRef.current
    const generation = useAuthStore.getState().sessionGeneration
    if (
      busyRef.current ||
      !r ||
      !fact?.satisfied ||
      fact.nonce !== r.nonce ||
      !same(r, generation)
    )
      return false
    busyRef.current = true
    setBusy(true)
    try {
      // Keep the durable blocker until the visible detail has replaced its old
      // draft with an owned, matching current fact. This is not a receipt.
      const current = await refreshDetail()
      if (!same(r, generation))
        throw new Error('原账号、服务器、页面或核对身份已变化')
      if (!satisfies(r, current))
        throw new Error('更新后的详情尚未匹配原核对事实')
      clear(r)
      setError('')
      return true
    } catch (e) {
      if (mounted.current)
        setError(
          `当前事实已查询，但详情更新未完成，原记录仍保留。请只读重试核对，勿重复提交。${e instanceof Error ? ` ${e.message}` : ''}`
        )
      return false
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return {
    record,
    error,
    busy,
    fact,
    perform,
    queryFacts,
    acknowledge,
    blocked: !!record || !!initial.error || busy
  }
}
