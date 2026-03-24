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
 *   - success 3s、error 4s（可按需覆盖），支持手动关闭
 *   - 进出场动画（slide-in from right / fade-out）
 */

import { useState, useCallback, useEffect } from 'react'
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
  Icon:    React.ComponentType<{ className?: string }>
}> = {
  success: {
    wrap:    'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50',
    icon:    'text-green-600 dark:text-green-400',
    message: 'text-green-800 dark:text-green-200',
    close:   'text-green-600/70 hover:text-green-800 dark:text-green-400/70 dark:hover:text-green-200',
    Icon:    CheckCircle2,
  },
  error: {
    wrap:    'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50',
    icon:    'text-red-600 dark:text-red-400',
    message: 'text-red-800 dark:text-red-200',
    close:   'text-red-600/70 hover:text-red-800 dark:text-red-400/70 dark:hover:text-red-200',
    Icon:    XCircle,
  },
  warning: {
    wrap:    'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/50',
    icon:    'text-orange-600 dark:text-orange-400',
    message: 'text-orange-800 dark:text-orange-200',
    close:   'text-orange-600/70 hover:text-orange-800 dark:text-orange-400/70 dark:hover:text-orange-200',
    Icon:    AlertTriangle,
  },
}

const MAX_TOASTS = 5

// ─── 组件 ──────────────────────────────────────────────────────────────────────

export function AppToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts(prev => {
      const next = [...prev, { id, type, message, duration, open: true }]
      // 超出上限时丢弃最旧的
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
    })
  }, [])

  useEffect(() => {
    _registerToastFn(addToast)
  }, [addToast])

  function handleOpenChange(id: string, open: boolean) {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, open } : t))
    if (!open) {
      // 等动画结束后从列表移除（200ms）
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 250)
    }
  }

  return (
    <Toast.Provider swipeDirection="right" duration={3000}>
      {toasts.map(t => {
        const s = STYLES[t.type]
        return (
          <Toast.Root
            key={t.id}
            open={t.open}
            duration={t.duration}
            onOpenChange={open => handleOpenChange(t.id, open)}
            className={cn(
              'fc-toast flex w-[320px] items-start gap-3 rounded-lg border p-4 shadow-md',
              s.wrap,
            )}
          >
            <s.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', s.icon)} aria-hidden />
            <Toast.Description
              className={cn('flex-1 text-sm leading-relaxed', s.message)}
            >
              {t.message}
            </Toast.Description>
            <Toast.Close asChild>
              <button
                aria-label="关闭提示"
                className={cn(
                  '-mr-1 -mt-0.5 ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
                  s.close,
                )}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Toast.Close>
          </Toast.Root>
        )
      })}

      {/* 渲染容器：固定在右上角 */}
      <Toast.Viewport className="fixed right-4 top-4 z-[9999] flex flex-col gap-2 outline-none" />
    </Toast.Provider>
  )
}
