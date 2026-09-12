import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Button } from '@/components/ui/button'

interface Props {
  title: string
  hasData: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
  onRetry: () => void
}

/** 首次失败与缓存刷新失败分开呈现，避免把未知值当成零或空列表。 */
export function ReportQueryFeedback({ title, hasData, isError, isFetching, error, onRetry }: Props) {
  if (isError && hasData) {
    return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
      <span>{title}刷新失败，当前显示上次成功的数据，可能已发生变化。</span>
      <Button variant="outline" size="sm" disabled={isFetching} onClick={onRetry}>{isFetching ? '正在重试…' : '重试'}</Button>
    </div>
  }
  if (isError) return <QueryErrorState title={`${title}加载失败`} error={error} onRetry={onRetry} compact />
  if (isFetching) return <p role="status" className="text-sm text-muted-foreground">{hasData ? `正在刷新${title}…` : `正在加载${title}…`}</p>
  return null
}
