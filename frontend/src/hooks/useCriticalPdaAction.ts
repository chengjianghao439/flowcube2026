import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNetworkStatus } from './useNetworkStatus'
import { usePendingRequests, type PendingRequestRecord } from './usePendingRequests'
import { createRequestKey } from '@/lib/requestKey'
import { useAuthStore } from '@/store/authStore'
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
export type CriticalPdaConfirmResult = OperationRequestStatus | {
  status: 'state_confirmed'
  data: unknown
  message: string
} | {
  status: 'state_unconfirmed'
  data: null
  message: string
  reason: 'receipt_missing' | 'state_not_advanced'
}

type ServerStateResult<T> =
  | { effective: true; data?: T; message?: string }
  | { effective: false; message?: string }

type ResolveServerState<T> = (ctx: {
  record: PendingRequestRecord
  operationStatus?: OperationRequestStatus | null
  error?: unknown
}) => Promise<ServerStateResult<T> | null | undefined>

function stateUnconfirmedMessage(label: string, reason: 'receipt_missing' | 'state_not_advanced') {
  if (reason === 'receipt_missing') {
    return `${label}还没确认成功，已重新查询任务状态。请刷新后再确认，暂勿重复扫码。`
  }
  return `${label}还没确认成功，任务状态也没有推进。请核对当前状态后再决定是否重试。`
}

export function useCriticalPdaAction<T>({
  action,
  requestAction,
  label,
  onConfirmed,
  resolveServerState,
}: {
  action: string
  requestAction?: string
  label: string
  onConfirmed?: (data: T, ctx: ConfirmContext) => void | Promise<void>
  resolveServerState?: ResolveServerState<T>
}) {
  const networkStatus = useNetworkStatus()
  const { records, claimPending, removePending, discardUnclaimed } = usePendingRequests()
  const pendingRecord = useMemo(
    () => records.find((item) => item.action === action) ?? null,
    [records, action],
  )
  const [confirming, setConfirming] = useState(false)
  const [phase, setPhase] = useState<CriticalPdaActionPhase>('idle')
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null)
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null)
  const autoConfirmRef = useRef<string | null>(null)
  const statusAction = requestAction || action

  const confirmByServerState = useCallback(async (
    record: PendingRequestRecord,
    operationStatus?: OperationRequestStatus | null,
    error?: unknown,
  ): Promise<CriticalPdaConfirmResult | null> => {
    if (record.unverifiedOwner || !resolveServerState) return null
    const serverState = await resolveServerState({ record, operationStatus, error })
    if (!serverState?.effective) return null
    const data = (serverState.data ?? operationStatus?.data ?? null) as T
    removePending(action)
    setPhase('idle')
    setPhaseMessage(serverState.message || `${record.label}已成功，任务状态已更新。`)
    setLastErrorMessage(null)
    if (onConfirmed) {
      await onConfirmed(data, {
        recovered: true,
        requestKey: record.requestKey,
      })
    }
    return {
      status: 'state_confirmed',
      data,
      message: serverState.message || `${record.label}已成功，任务状态已更新。`,
    }
  }, [action, onConfirmed, removePending, resolveServerState])

  const confirmPending = useCallback(async (): Promise<CriticalPdaConfirmResult | null> => {
    if (!pendingRecord || networkStatus !== 'online' || confirming || phase === 'submitting') return null
    const generation = useAuthStore.getState().sessionGeneration
    const isCurrentSession = () => useAuthStore.getState().sessionGeneration === generation
    setConfirming(true)
    setPhase('confirming')
    setPhaseMessage(`正在确认${pendingRecord.label}的结果，请勿重复提交。`)
    setLastErrorMessage(null)
    try {
      const status = await getOperationRequestStatusApi(
        pendingRecord.requestKey,
        // 老版本调拨 pending 保存固定 action；用当前单据 action 查询兼容回执，防止跨单误确认。
        /^transfer\.scan(?:Out|In)\.[1-9]\d*$/.test(statusAction)
          ? statusAction
          : pendingRecord.unverifiedOwner ? requestAction || pendingRecord.requestAction || statusAction : pendingRecord.requestAction || statusAction,
      )
      if (!isCurrentSession()) return null
      if (status.status === 'success') {
        if (pendingRecord.unverifiedOwner) discardUnclaimed(action, pendingRecord.requestKey)
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
        if (pendingRecord.unverifiedOwner) discardUnclaimed(action, pendingRecord.requestKey)
        const stateConfirmed = await confirmByServerState(pendingRecord, status)
        if (stateConfirmed) return stateConfirmed
        removePending(action)
        setPhase('failed')
        setPhaseMessage(null)
        setLastErrorMessage(status.message || `${pendingRecord.label}提交失败，任务状态没有推进。请检查后重试。`)
      }
      if (status.status === 'not_found') {
        const stateConfirmed = await confirmByServerState(pendingRecord, status)
        if (stateConfirmed) return stateConfirmed
        const message = pendingRecord.unverifiedOwner
          ? '历史操作的归属与结果仍无法确认，请人工核对；确认未生效后可清除记录。'
          : resolveServerState
          ? stateUnconfirmedMessage(pendingRecord.label, 'receipt_missing')
          : `${pendingRecord.label}结果还没确认。请稍后再次确认，暂勿重复扫码。`
        setPhase('pending')
        setPhaseMessage(message)
        setLastErrorMessage(null)
        return {
          status: 'state_unconfirmed',
          data: null,
          message,
          reason: 'receipt_missing',
        }
      }
      if (status.status === 'pending') {
        const stateConfirmed = await confirmByServerState(pendingRecord, status)
        if (stateConfirmed) return stateConfirmed
        setPhase('pending')
        setPhaseMessage(status.message || `系统还未确认${pendingRecord.label}结果，请稍后重试确认，暂勿重复提交。`)
      }
      return status
    } catch (error) {
      if (!isCurrentSession()) return null
      const message = error instanceof Error ? error.message : String(error ?? '')
      if (isTransientFailure(message)) {
        setPhase('pending')
        setPhaseMessage(`网络波动，暂时无法确认${pendingRecord.label}结果。请恢复网络后再次确认。`)
        return null
      }
      const stateConfirmed = await confirmByServerState(pendingRecord, null, error)
      if (stateConfirmed) return stateConfirmed
      setPhase('failed')
      setPhaseMessage(null)
      setLastErrorMessage(message || stateUnconfirmedMessage(pendingRecord.label, 'state_not_advanced'))
      return null
    } finally {
      setConfirming(false)
    }
  }, [action, confirmByServerState, confirming, discardUnclaimed, networkStatus, onConfirmed, pendingRecord, phase, removePending, requestAction, resolveServerState, statusAction])

  useEffect(() => {
    if (networkStatus !== 'online' || !pendingRecord) return
    if (phase === 'submitting') return
    if (autoConfirmRef.current === pendingRecord.requestKey) return
    autoConfirmRef.current = pendingRecord.requestKey
    void confirmPending()
  }, [networkStatus, pendingRecord, phase, confirmPending])

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
    metadata?: Record<string, unknown>,
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
      requestAction: statusAction,
      label,
      createdAt: new Date().toISOString(),
      metadata,
    }
    if (!claimPending(record)) throw new Error(`${label} 结果待确认，请先确认后再重试`)
    setPhase('submitting')
    setPhaseMessage(`${label}提交中，请保持当前页面并等待结果。`)
    setLastErrorMessage(null)

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
      const stateConfirmed = await confirmByServerState(record, null, error)
      if (stateConfirmed) {
        return { kind: 'success', data: stateConfirmed.data as T }
      }
      removePending(action)
      setPhase('failed')
      setPhaseMessage(null)
      setLastErrorMessage(message || `${label}未提交成功，任务状态未能确认已推进。请检查后重试。`)
      throw error
    }
  }, [action, claimPending, confirmByServerState, label, networkStatus, onConfirmed, pendingRecord, removePending, statusAction])

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
    clearPending: () => {
      if (pendingRecord?.unverifiedOwner) discardUnclaimed(action, pendingRecord.requestKey)
      removePending(action)
    },
    clearError: () => {
      setLastErrorMessage(null)
      if (phase === 'failed') setPhase('idle')
    },
  }
}
