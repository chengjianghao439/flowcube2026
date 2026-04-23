import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNetworkStatus } from './useNetworkStatus'
import { usePendingRequests, type PendingRequestRecord } from './usePendingRequests'
import { createRequestKey } from '@/lib/requestKey'
import { getOperationRequestStatusApi, type OperationRequestStatus } from '@/api/operation-requests'

function isTransientFailure(message: string) {
  return [
    '无法连接服务器',
    '请求超时',
    'Network Error',
    'ERR_NETWORK',
    'ECONNABORTED',
  ].some((part) => message.includes(part))
}

type ConfirmContext = { recovered: boolean; requestKey: string }
export type CriticalPdaActionPhase = 'idle' | 'submitting' | 'pending' | 'confirming' | 'failed'

export function useCriticalPdaAction<T>({
  action,
  label,
  onConfirmed,
}: {
  action: string
  label: string
  onConfirmed?: (data: T, ctx: ConfirmContext) => void | Promise<void>
}) {
  const networkStatus = useNetworkStatus()
  const { records, addPending, removePending } = usePendingRequests()
  const pendingRecord = useMemo(
    () => records.find((item) => item.action === action) ?? null,
    [records, action],
  )
  const [confirming, setConfirming] = useState(false)
  const [phase, setPhase] = useState<CriticalPdaActionPhase>('idle')
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null)
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null)
  const autoConfirmRef = useRef<string | null>(null)

  const confirmPending = useCallback(async (): Promise<OperationRequestStatus | null> => {
    if (!pendingRecord || networkStatus !== 'online' || confirming) return null
    setConfirming(true)
    setPhase('confirming')
    setPhaseMessage(`正在确认${pendingRecord.label}的结果，请勿重复提交。`)
    setLastErrorMessage(null)
    try {
      const res = await getOperationRequestStatusApi(pendingRecord.requestKey, pendingRecord.action)
      const status = res.data.data!
      if (status.status === 'success') {
        removePending(action)
        setPhase('idle')
        setPhaseMessage(null)
        if (onConfirmed) {
          await onConfirmed(status.data as T, {
            recovered: true,
            requestKey: pendingRecord.requestKey,
          })
        }
      }
      if (status.status === 'failed') {
        removePending(action)
        setPhase('failed')
        setPhaseMessage(null)
        setLastErrorMessage(status.message || `${pendingRecord.label}未成功，请检查后重试。`)
      }
      if (status.status === 'not_found') {
        removePending(action)
        setPhase('failed')
        setPhaseMessage(null)
        setLastErrorMessage(`系统未找到 ${pendingRecord.label} 的提交记录。请先刷新任务状态，再决定是否重试。`)
      }
      if (status.status === 'pending') {
        setPhase('pending')
        setPhaseMessage(`服务端仍未确认${pendingRecord.label}结果，请稍后重试确认，暂勿重复提交。`)
      }
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      if (isTransientFailure(message)) {
        setPhase('pending')
        setPhaseMessage(`网络波动，暂时无法确认${pendingRecord.label}结果。请恢复网络后再次确认。`)
        return null
      }
      setPhase('failed')
      setPhaseMessage(null)
      setLastErrorMessage(message || `确认 ${pendingRecord.label} 结果失败，请稍后重试。`)
      return null
    } finally {
      setConfirming(false)
    }
  }, [action, confirming, networkStatus, onConfirmed, pendingRecord, removePending])

  useEffect(() => {
    if (networkStatus !== 'online' || !pendingRecord) return
    if (autoConfirmRef.current === pendingRecord.requestKey) return
    autoConfirmRef.current = pendingRecord.requestKey
    void confirmPending()
  }, [networkStatus, pendingRecord, confirmPending])

  const blockedReason = useMemo(() => {
    if (networkStatus !== 'online') {
      return '网络已断开，关键操作已强制阻断。请恢复网络后再提交。'
    }
    if (pendingRecord) {
      return `${pendingRecord.label} 结果待确认。请先确认结果，避免重复提交。`
    }
    return null
  }, [networkStatus, pendingRecord])

  const run = useCallback(async (
    executor: (requestKey: string) => Promise<T>,
  ): Promise<{ kind: 'success'; data: T } | { kind: 'pending'; requestKey: string }> => {
    if (networkStatus !== 'online') {
      throw new Error('网络已断开，关键操作不可提交')
    }
    if (pendingRecord) {
      throw new Error(`${pendingRecord.label} 结果待确认，请先确认后再重试`)
    }

    const requestKey = createRequestKey(action.replace(/[^a-z0-9]+/gi, '-'))
    setPhase('submitting')
    setPhaseMessage(`${label}提交中，请保持当前页面并等待结果。`)
    setLastErrorMessage(null)
    const record: PendingRequestRecord = {
      requestKey,
      action,
      label,
      createdAt: new Date().toISOString(),
    }
    addPending(record)

    try {
      const data = await executor(requestKey)
      removePending(action)
      setPhase('idle')
      setPhaseMessage(null)
      if (onConfirmed) {
        await onConfirmed(data, { recovered: false, requestKey })
      }
      return { kind: 'success', data }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      if (isTransientFailure(message)) {
        setPhase('pending')
        setPhaseMessage(`网络波动，${label}结果待确认。请先确认结果，避免重复提交。`)
        return { kind: 'pending', requestKey }
      }
      removePending(action)
      setPhase('failed')
      setPhaseMessage(null)
      setLastErrorMessage(message || `${label}提交失败，请检查后重试。`)
      throw error
    }
  }, [action, addPending, label, networkStatus, onConfirmed, pendingRecord, removePending])

  return {
    networkStatus,
    pendingRecord,
    confirming,
    phase,
    phaseMessage,
    lastErrorMessage,
    blockedReason,
    submitBlocked: Boolean(blockedReason),
    run,
    confirmPending,
    clearPending: () => removePending(action),
    clearError: () => {
      setLastErrorMessage(null)
      if (phase === 'failed') setPhase('idle')
    },
  }
}
