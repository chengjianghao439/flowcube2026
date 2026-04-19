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
  const autoConfirmRef = useRef<string | null>(null)

  const confirmPending = useCallback(async (): Promise<OperationRequestStatus | null> => {
    if (!pendingRecord || networkStatus !== 'online' || confirming) return null
    setConfirming(true)
    try {
      const res = await getOperationRequestStatusApi(pendingRecord.requestKey, pendingRecord.action)
      const status = res.data.data!
      if (status.status === 'success') {
        removePending(action)
        if (onConfirmed) {
          await onConfirmed(status.data as T, {
            recovered: true,
            requestKey: pendingRecord.requestKey,
          })
        }
      }
      if (status.status === 'failed' || status.status === 'not_found') {
        removePending(action)
      }
      return status
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
      if (onConfirmed) {
        await onConfirmed(data, { recovered: false, requestKey })
      }
      return { kind: 'success', data }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      if (isTransientFailure(message)) {
        return { kind: 'pending', requestKey }
      }
      removePending(action)
      throw error
    }
  }, [action, addPending, label, networkStatus, onConfirmed, pendingRecord, removePending])

  return {
    networkStatus,
    pendingRecord,
    confirming,
    blockedReason,
    submitBlocked: Boolean(blockedReason),
    run,
    confirmPending,
    clearPending: () => removePending(action),
  }
}
