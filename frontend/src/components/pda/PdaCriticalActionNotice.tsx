import PdaCard from './PdaCard'
import { Button } from '@/components/ui/button'
import type { PendingRequestRecord } from '@/hooks/usePendingRequests'
import type { CriticalPdaActionPhase } from '@/hooks/useCriticalPdaAction'

export default function PdaCriticalActionNotice({
  blockedReason,
  pendingRecord,
  confirming,
  phase,
  phaseMessage,
  lastErrorMessage,
  onConfirm,
  onClear,
  onDismissError,
}: {
  blockedReason: string | null
  pendingRecord?: PendingRequestRecord | null
  confirming?: boolean
  phase?: CriticalPdaActionPhase
  phaseMessage?: string | null
  lastErrorMessage?: string | null
  onConfirm?: () => void
  onClear?: () => void
  onDismissError?: () => void
}) {
  const pending = Boolean(pendingRecord)
  const offlineBlocked = Boolean(blockedReason) && !pending
  const submitting = phase === 'submitting'
  const confirmingState = phase === 'confirming'
  const failed = Boolean(lastErrorMessage)

  if (!blockedReason && !submitting && !confirmingState && !failed) return null

  let title = '当前不可提交'
  let body = blockedReason ?? ''
  let tone = 'border-red-300 bg-red-50/80 text-red-900'
  let bodyTone = 'text-red-800'

  if (pending) {
    title = '结果待确认'
    body = phaseMessage || blockedReason || '上次关键操作结果仍待确认，请先确认后再重试。'
    tone = 'border-amber-300 bg-amber-50/80 text-amber-900'
    bodyTone = 'text-amber-800'
  } else if (confirmingState) {
    title = '确认中'
    body = phaseMessage || '正在确认刚才结果，请勿重复提交。'
    tone = 'border-amber-300 bg-amber-50/80 text-amber-900'
    bodyTone = 'text-amber-800'
  } else if (submitting) {
    title = '提交中'
    body = phaseMessage || '请求已发出，请保持当前页面并等待结果返回。'
    tone = 'border-sky-300 bg-sky-50/80 text-sky-900'
    bodyTone = 'text-sky-800'
  } else if (failed) {
    title = '本次提交失败'
    body = `${lastErrorMessage}${lastErrorMessage?.includes('请') ? '' : '。请先核对当前任务状态，再决定是否重试。'}`
    tone = 'border-red-300 bg-red-50/80 text-red-900'
    bodyTone = 'text-red-800'
  }

  return (
    <PdaCard className={`${tone} space-y-3`}>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className={`text-xs leading-5 ${bodyTone}`}>{body}</p>
        {pendingRecord ? (
          <p className="text-[11px] text-amber-700">请求标识：{pendingRecord.requestKey}</p>
        ) : null}
      </div>
      {pendingRecord ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" className="flex-1" onClick={onConfirm} disabled={confirming}>
            {confirming ? '确认中…' : '确认刚才结果'}
          </Button>
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={onClear}>
            结果未找到后再重试
          </Button>
        </div>
      ) : null}
      {!pendingRecord && failed && onDismissError ? (
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onDismissError}>
          我已知晓，可重新提交
        </Button>
      ) : null}
      {!pendingRecord && offlineBlocked ? (
        <p className="text-[11px] text-red-700">恢复网络后再提交，系统不会自动补账。</p>
      ) : null}
    </PdaCard>
  )
}
