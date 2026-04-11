import { Button } from '@/components/ui/button'
import { EmptyState } from './EmptyState'

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || fallback

  const maybeResponse = error as { response?: { data?: { message?: string } } }
  return maybeResponse?.response?.data?.message || fallback
}

interface QueryErrorStateProps {
  error: unknown
  onRetry: () => void
  title?: string
  description?: string
  compact?: boolean
}

export function QueryErrorState({
  error,
  onRetry,
  title = '加载失败',
  description = '数据加载时发生错误，请稍后重试',
  compact = false,
}: QueryErrorStateProps) {
  return (
    <EmptyState
      variant="error"
      compact={compact}
      title={title}
      description={resolveErrorMessage(error, description)}
      action={<Button onClick={onRetry}>重试</Button>}
    />
  )
}
