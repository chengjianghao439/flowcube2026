import PdaCard from './PdaCard'
import { Button } from '@/components/ui/button'
import type { PendingRequestRecord } from '@/hooks/usePendingRequests'

export default function PdaCriticalActionNotice({
  blockedReason,
  pendingRecord,
  confirming,
  onConfirm,
  onClear,
}: {
  blockedReason: string | null
  pendingRecord?: PendingRequestRecord | null
  confirming?: boolean
  onConfirm?: () => void
  onClear?: () => void
}) {
  if (!blockedReason) return null

  const pending = Boolean(pendingRecord)

  return (
    <PdaCard className={pending ? 'border-amber-300 bg-amber-50/80 space-y-3' : 'border-red-300 bg-red-50/80 space-y-3'}>
      <div className="space-y-1">
        <p className={`text-sm font-semibold ${pending ? 'text-amber-900' : 'text-red-900'}`}>
          {pending ? '结果待确认' : '当前不可提交'}
        </p>
        <p className={`text-xs leading-5 ${pending ? 'text-amber-800' : 'text-red-800'}`}>{blockedReason}</p>
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
    </PdaCard>
  )
}
