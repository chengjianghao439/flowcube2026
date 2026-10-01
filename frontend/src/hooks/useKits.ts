import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVisibleQuery } from './useVisibleQuery'
import apiClient from '@/api/client'
import { createKitApi, deleteKitApi, getKitApi, getKitsApi, updateKitApi, type KitRequestContext, type KitReadOwner } from '@/api/kits'
import { createRequestKey } from '@/lib/requestKey'
import { PERMISSIONS } from '@/lib/permission-codes'
import { hasPermission } from '@/lib/permissions'
import { useAuthStore } from '@/store/authStore'
import type { CreateKitInput, KitListParams, UpdateKitInput, KitDefinition } from '@/types/kits'
export function captureKitReadOwner(): KitReadOwner {
  const auth = useAuthStore.getState()
  return { baseURL: apiClient.defaults.baseURL ?? '/api', userId: auth.user?.id ?? null, sessionGeneration: auth.sessionGeneration }
}
export function assertKitReadOwner(owner: KitReadOwner) {
  const auth = useAuthStore.getState()
  if (!auth.token || auth.user?.id !== owner.userId || auth.sessionGeneration !== owner.sessionGeneration) throw new Error('登录账号或会话已变化，当前草稿已保留，请重新打开资料')
  if ((apiClient.defaults.baseURL ?? '/api') !== owner.baseURL) throw new Error('服务器已切换，当前草稿已保留；请回原服务器核对或关闭后重新打开资料')
}
export async function readKitOwned(id: number, owner: KitReadOwner) {
  assertKitReadOwner(owner)
  const result = await getKitApi(id, owner)
  assertKitReadOwner(owner)
  if (result.id !== id) throw new Error('返回资料不属于原配件，当前草稿已保留')
  return result
}
export function useKits(params: KitListParams) {
  const [readOwner] = useState(captureKitReadOwner)
  const query = useVisibleQuery({
    queryKey: ['kits', 'list', readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration, params],
    queryFn: async ({ signal }) => {
      assertKitReadOwner(readOwner)
      const result = await getKitsApi(params, signal, readOwner)
      assertKitReadOwner(readOwner)
      return result
    },
  })
  return { ...query, readOwner }
}
export function useKit(id: number, source?: KitReadOwner) {
  const [readOwner] = useState(() => source ?? captureKitReadOwner())
  return useQuery({ queryKey: ['kits', 'detail', id, readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration], queryFn: () => readKitOwned(id, readOwner), enabled: id > 0, refetchOnMount: 'always', staleTime: 0 })
}
export type KitOperation = { kind: 'create'; data: CreateKitInput } | { kind: 'update'; id: number; data: UpdateKitInput } | { kind: 'delete'; id: number; data: { revision: number } }
interface FrozenKitRequest extends KitRequestContext { operation: KitOperation; userId: number; uncertain: boolean }
const permissionFor = (kind: KitOperation['kind']) => kind === 'create' ? PERMISSIONS.PRODUCT_CREATE : kind === 'delete' ? PERMISSIONS.PRODUCT_DELETE : PERMISSIONS.PRODUCT_UPDATE
/** 同一挂载页内保留原提交；未知结果不能因输入改变变成新键。 */
export function useKitWrite(source?: KitReadOwner) {
  const queryClient = useQueryClient()
  const recordRef = useRef<FrozenKitRequest | null>(null), busyRef = useRef(false), mounted = useRef(true)
  const readOwner = useRef(source ?? captureKitReadOwner())
  const [pendingRecord, setPendingRecord] = useState<FrozenKitRequest | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function currentSession(record: FrozenKitRequest) {
    const auth = useAuthStore.getState()
    return !!auth.token && auth.user?.id === record.userId && auth.sessionGeneration === record.sessionGeneration
  }
  function mayWrite(kind: KitOperation['kind']) {
    const { user, token, sessionGeneration } = useAuthStore.getState()
    return !!token && !!user && readOwner.current.sessionGeneration === sessionGeneration && readOwner.current.userId === user.id && hasPermission(user.permissions ?? [], permissionFor(kind), user.roleId)
  }
  async function execute(record: FrozenKitRequest): Promise<KitDefinition | null> {
    if (busyRef.current || !currentSession(record) || !mayWrite(record.operation.kind)) return null
    busyRef.current = true; setBusy(true); setError(''); setConflict(false)
    try {
      const op = record.operation
      const result = op.kind === 'create' ? await createKitApi(op.data, record) : op.kind === 'update' ? await updateKitApi(op.id, op.data, record) : await deleteKitApi(op.id, op.data, record)
      if (!mounted.current || !currentSession(record) || recordRef.current !== record) return null
      if (!result || !Number.isSafeInteger(result.id) || result.id <= 0 || (op.kind !== 'create' && result.id !== op.id) || !Number.isSafeInteger(result.revision) || result.revision < 1 || (op.kind === 'delete' && !result.deletedAt) || !result.version || result.version.id !== result.currentVersionId || !Number.isSafeInteger(result.version.versionNo) || result.version.versionNo < 1) throw new Error('返回资料无法确认原提交结果')
      recordRef.current = null; setPendingRecord(null)
      if ((apiClient.defaults.baseURL ?? '/api') !== record.baseURL) {
        setError(`原服务器已保存版本 ${result.version.versionNo}，当前服务器已切换，请回原服务器核对资料`)
        return null
      }
      void queryClient.invalidateQueries({ queryKey: ['kits'] })
      return result
    } catch (caught) {
      if (!mounted.current || !currentSession(record) || recordRef.current !== record) return null
      const e = caught as { status?: number; response?: { status?: number }; message?: string }
      const status = e.status ?? e.response?.status
      if (record.uncertain || status == null || status === 408 || status >= 500) {
        record.uncertain = true; setPendingRecord({ ...record })
        setError('提交结果未确认。已保留原请求，请按原请求重试；核对完成前不能修改或另发请求。')
      } else {
        recordRef.current = null; setPendingRecord(null); setConflict(status === 409)
        setError(e.message || '保存被拒绝，请核对输入后再操作')
      }
      return null
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }
  async function submit(operation: KitOperation) {
    if (recordRef.current || busyRef.current || !mayWrite(operation.kind)) return null
    if ((apiClient.defaults.baseURL ?? '/api') !== readOwner.current.baseURL) { setError('服务器已切换，请关闭并重新读取当前服务器资料后再操作'); return null }
    const auth = useAuthStore.getState()
    const record: FrozenKitRequest = { operation: JSON.parse(JSON.stringify(operation)) as KitOperation, requestKey: createRequestKey(`kit-${operation.kind}`), baseURL: apiClient.defaults.baseURL ?? '/api', sessionGeneration: auth.sessionGeneration, userId: auth.user!.id, uncertain: false }
    recordRef.current = record
    return execute(record)
  }
  const retry = () => recordRef.current ? execute(recordRef.current) : Promise.resolve(null)
  return { submit, retry, pendingRecord, busy, error, conflict }
}

interface KitBackupProof { generation: number; snapshot: string; text: string; confirmed: boolean }
/** 备份授权只承认当前精确草稿；复制的迟到成功/失败不能迁移到新输入。 */
export function useKitBackup(snapshot: string, owner: KitReadOwner) {
  const generation = useRef(0), currentSnapshot = useRef(snapshot), mounted = useRef(true), proofRef = useRef<KitBackupProof | null>(null)
  currentSnapshot.current = snapshot
  const [proof, setProof] = useState<KitBackupProof | null>(null), [error, setError] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function matchesSnapshot(candidate: KitBackupProof | null) {
    return !!candidate && mounted.current && candidate.generation === generation.current && candidate.snapshot === currentSnapshot.current
  }
  function isCurrent(candidate: KitBackupProof | null) {
    if (!matchesSnapshot(candidate)) return false
    try { assertKitReadOwner(owner); return true } catch { return false }
  }
  function publish(next: KitBackupProof | null) { proofRef.current = next; setProof(next) }
  function invalidate() { generation.current++; publish(null); setError('') }
  async function copy(text: string) {
    invalidate()
    const candidate: KitBackupProof = { generation: generation.current, snapshot: currentSnapshot.current, text, confirmed: false }
    try { assertKitReadOwner(owner) } catch (caught) { setError(caught instanceof Error ? caught.message : '备份来源已变化'); return }
    try {
      await navigator.clipboard.writeText(text)
      if (isCurrent(candidate)) publish({ ...candidate, confirmed: true })
    } catch {
      if (!isCurrent(candidate)) return
      publish(candidate); setError('自动复制不可用，请先复制下面的完整草稿，再点击“已备份草稿”。')
    }
  }
  function acknowledge(displayedText: string) {
    const current = proofRef.current
    if (isCurrent(current) && current!.text === displayedText && !current!.confirmed) { publish({ ...current!, confirmed: true }); setError('') }
  }
  const canReload = () => !!proofRef.current?.confirmed && isCurrent(proofRef.current)
  return { copy, acknowledge, invalidate, canReload, copied: !!proof?.confirmed && matchesSnapshot(proof), text: proof && !proof.confirmed && matchesSnapshot(proof) ? proof.text : '', error }
}
