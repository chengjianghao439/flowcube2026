/**
 * AppToast — 全局提示条系统
 *
 * 挂载方式：在 AppLayout 中渲染 <AppToast /> 一次即可。
 * 在任意模块中调用：
 *   import { toast } from '@/lib/toast'
 *   toast.success('操作成功')
 *   toast.error('库存不足')
 *   toast.warning('请先选择客户')
 *
 * 特性：
 *   - 右上角堆叠，最多同时显示 5 条
 *   - success 默认 3s、error 默认 4s（可覆盖，见 resolveToastDurationMs）
 *   - 使用自建定时关闭，避免 Radix 在 pointermove / 窗口失焦 时暂停计时导致不自动消失
 *   - 底部倒计时条与关闭时长同步
 */

import { useState, useCallback, useEffect, memo, useRef } from 'react'
import * as Toast from '@radix-ui/react-toast'
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { _registerToastFn, type ToastType } from '@/lib/toast'

// ─── 类型 ─────────────────────────────────────────────────────────────────────

interface ToastItem {
  id:       string
  type:     ToastType
  message:  string
  duration: number
  open:     boolean
}

// ─── 样式映射 ──────────────────────────────────────────────────────────────────

const STYLES: Record<ToastType, {
  wrap:    string
  icon:    string
  message: string
  close:   string
  bar:     string
  Icon:    React.ComponentType<{ className?: string }>
}> = {
  success: {
    wrap:    'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50',
    icon:    'text-green-600 dark:text-green-400',
    message: 'text-green-800 dark:text-green-200',
    close:   'text-green-600/70 hover:text-green-800 dark:text-green-400/70 dark:hover:text-green-200',
    bar:     'bg-green-600/70 dark:bg-green-400/60',
    Icon:    CheckCircle2,
  },
  error: {
    wrap:    'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50',
    icon:    'text-red-600 dark:text-red-400',
    message: 'text-red-800 dark:text-red-200',
    close:   'text-red-600/70 hover:text-red-800 dark:text-red-400/70 dark:hover:text-red-200',
    bar:     'bg-red-600/70 dark:bg-red-400/60',
    Icon:    XCircle,
  },
  warning: {
    wrap:    'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/50',
    icon:    'text-orange-600 dark:text-orange-400',
    message: 'text-orange-800 dark:text-orange-200',
    close:   'text-orange-600/70 hover:text-orange-800 dark:text-orange-400/70 dark:hover:text-orange-200',
    bar:     'bg-orange-600/70 dark:bg-orange-400/60',
    Icon:    AlertTriangle,
  },
}

const MAX_TOASTS = 5

// ─── 单条：自建定时关闭 + 倒计时条（Radix duration 设为 Infinity，避免暂停逻辑不恢复） ───

const ToastInstance = memo(function ToastInstance({
  t,
  onRequestClose,
}: {
  t: ToastItem
  onRequestClose: (id: string) => void
}) {
  const s = STYLES[t.type]
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      onRequestClose(t.id)
    }, t.duration)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [t.id, t.duration, onRequestClose])

  function handleOpenChange(open: boolean) {
    if (!open) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      onRequestClose(t.id)
    }
  }

  return (
    <Toast.Root
      open={t.open}
      onOpenChange={handleOpenChange}
      duration={Infinity}
      className={cn(
        'fc-toast relative flex w-[320px] flex-col overflow-hidden rounded-lg border shadow-md',
        s.wrap,
      )}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <s.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', s.icon)} aria-hidden />
        <Toast.Description
          className={cn('flex-1 text-sm leading-relaxed', s.message)}
        >
          {t.message}
        </Toast.Description>
        <Toast.Close asChild>
          <button
            type="button"
            aria-label="关闭提示"
            className={cn(
              '-mr-1 -mt-0.5 ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
              s.close,
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Toast.Close>
      </div>

      <div
        className="pointer-events-none h-0.5 w-full shrink-0 overflow-hidden bg-black/10 dark:bg-white/10"
        aria-hidden
      >
        <div
          className={cn('h-full w-full origin-left', s.bar)}
          style={{
            animation: `fc-toast-countdown ${t.duration}ms linear forwards`,
          }}
        />
      </div>
    </Toast.Root>
  )
})

// ─── 组件 ──────────────────────────────────────────────────────────────────────

export function AppToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts(prev => {
      const next = [...prev, { id, type, message, duration, open: true }]
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
    })
  }, [])

  useEffect(() => {
    _registerToastFn(addToast)
  }, [addToast])

  const handleRemove = useCallback((id: string) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, open: false } : t)))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 250)
  }, [])

  return (
    <Toast.Provider swipeDirection="right" duration={Infinity}>
      {toasts.map(t => (
        <ToastInstance key={t.id} t={t} onRequestClose={handleRemove} />
      ))}

      <Toast.Viewport className="fixed right-4 top-4 z-[9999] flex flex-col gap-2 outline-none" />
    </Toast.Provider>
  )
}
