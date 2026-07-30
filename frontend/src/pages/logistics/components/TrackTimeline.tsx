import { formatDisplayDateTime } from '@/lib/dateTime'
import type { TrackEvent } from '@/types/logistics'

/** 物流轨迹竖向时间线（最新在上）。无通用 Timeline 组件，为运单详情自建。 */
export default function TrackTimeline({ events }: { events: TrackEvent[] }) {
  if (!events.length) {
    return <div className="py-8 text-center text-sm text-muted-foreground">暂无轨迹（已取号后由系统按节流轮询快递平台，稍后刷新）</div>
  }
  // 展示按时间倒序（最新在上）
  const ordered = [...events].sort((a, b) => {
    const ta = a.eventTime ? new Date(a.eventTime).getTime() : 0
    const tb = b.eventTime ? new Date(b.eventTime).getTime() : 0
    return tb - ta
  })
  return (
    <ol className="relative space-y-0">
      {ordered.map((ev, i) => {
        const isLatest = i === 0
        return (
          <li key={ev.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* 竖线 */}
            {i < ordered.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-border" aria-hidden />}
            {/* 节点圆点 */}
            <span className={`relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${isLatest ? 'border-success bg-success' : 'border-muted-foreground/40 bg-background'}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${isLatest ? 'font-medium text-foreground' : 'text-foreground/80'}`}>{ev.description || '—'}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {ev.eventTime && <span className="tabular-nums">{formatDisplayDateTime(ev.eventTime)}</span>}
                {ev.location && <span>{ev.location}</span>}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
