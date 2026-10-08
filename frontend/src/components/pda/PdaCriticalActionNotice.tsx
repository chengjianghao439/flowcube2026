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
  let tone = 'border-destructive/30 bg-destructive/10 text-destructive-ink'
  let bodyTone = 'text-destructive-ink'

  if (pending) {
    title = '结果待确认'
    body = phaseMessage || blockedReason || '上次关键操作结果仍待确认，请先确认后再重试。'
    tone = 'border-warning/30 bg-warning/10 text-warning-ink'
    bodyTone = 'text-warning-ink'
  } else if (confirmingState) {
    title = '确认中'
    body = phaseMessage || '正在确认刚才结果，请勿重复提交。'
    tone = 'border-warning/30 bg-warning/10 text-warning-ink'
    bodyTone = 'text-warning-ink'
  } else if (submitting) {
    title = '提交中'
    body = phaseMessage || '请求已提交，请等待处理完成。'
    tone = 'border-info/30 bg-info/10 text-info-ink'
    bodyTone = 'text-info-ink'
  } else if (failed) {
    title = '本次提交失败'
    body = `${lastErrorMessage}${lastErrorMessage?.includes('请') ? '' : '。请先核对当前任务状态，再决定是否重试。'}`
    tone = 'border-destructive/30 bg-destructive/10 text-destructive-ink'
    bodyTone = 'text-destructive-ink'
  }

  return (
    <PdaCard className={`${tone} space-y-3`}>
      <div role={failed ? 'alert' : 'status'} aria-atomic="true" className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className={`text-xs leading-5 ${bodyTone}`}>{body}</p>
        {pendingRecord ? (
          <p className="text-xs text-warning-ink">记录号:{pendingRecord.requestKey.slice(0, 8)}（报修时提供）</p>
        ) : null}
      </div>
      {pendingRecord ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="lg" className="px-3 flex-1" onClick={onConfirm} disabled={confirming}>
            {confirming ? '确认中…' : '确认上次结果'}
          </Button>
          <Button type="button" size="lg" variant="outline" className="px-3 h-auto min-h-11 flex-1 whitespace-normal py-2" onClick={onClear}>
            结果未生效，清除记录
          </Button>
        </div>
      ) : null}
      {!pendingRecord && failed && onDismissError ? (
        <Button type="button" size="lg" variant="outline" className="px-3 w-full" onClick={onDismissError}>
          我已知晓，可重新提交
        </Button>
      ) : null}
      {!pendingRecord && offlineBlocked ? (
        <p className="text-[11px] text-destructive-ink">恢复网络后需重新提交，系统不会自动补录该操作。</p>
      ) : null}
    </PdaCard>
  )
}
