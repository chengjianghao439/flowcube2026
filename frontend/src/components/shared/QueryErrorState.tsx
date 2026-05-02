import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from './EmptyState'
import { formatErrorMessage } from '@/utils/displayFormatters'

interface ErrorPayload {
  message?: string
  code?: string
  data?: unknown
}

function safeStringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function resolveDisplayMessage(error: unknown, fallback: string): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || ''

  const maybeResponse = error as { response?: { data?: { message?: string } } }
  return maybeResponse?.response?.data?.message || fallback
}

function resolveErrorDetail(error: unknown): { rawMessage: string; code: string; data: string } {
  const maybeResponse = error as { response?: { data?: ErrorPayload } }
  const payload = maybeResponse?.response?.data
  const rawMessage = typeof payload?.message === 'string' ? payload.message : ''
  const code = typeof payload?.code === 'string' ? payload.code : ''
  const data = payload && 'data' in payload ? safeStringify(payload.data) : ''

  return {
    rawMessage,
    code,
    data,
  }
}

function resolveFallbackDetail(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || ''
  return ''
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
  const [showDetail, setShowDetail] = useState(false)
  const displaySource = resolveDisplayMessage(error, description)
  const displayMessage = formatErrorMessage(displaySource, description)
  const detail = resolveErrorDetail(error)
  const fallbackDetail = resolveFallbackDetail(error)
  const hasDetail = Boolean(detail.rawMessage || detail.code || detail.data || fallbackDetail)

  return (
    <EmptyState
      variant="error"
      compact={compact}
      title={title}
      description={displayMessage}
      action={
        <div className="space-y-3">
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onRetry}>重试</Button>
            {hasDetail && (
              <Button type="button" variant="outline" onClick={() => setShowDetail(v => !v)}>
                {showDetail ? '隐藏错误详情' : '查看错误详情'}
              </Button>
            )}
          </div>
          {showDetail && hasDetail && (
            <div className="max-w-xl rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-xs leading-5 text-muted-foreground">
              {detail.code && <div>错误码：{detail.code}</div>}
              {detail.rawMessage && <div>原始信息：{detail.rawMessage}</div>}
              {detail.data && <div className="break-all">原始数据：{detail.data}</div>}
              {!detail.rawMessage && !detail.code && !detail.data && fallbackDetail && (
                <div>原始信息：{fallbackDetail}</div>
              )}
            </div>
          )}
        </div>
      }
    />
  )
}
