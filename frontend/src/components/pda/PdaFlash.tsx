/**
 * PdaFlash — 操作反馈视觉组件
 *
 * 配合 usePdaFeedback 使用：
 *   const { flash, ok, err } = usePdaFeedback()
 *   <PdaFlash flash={flash} />
 */
import type { FlashState } from '@/hooks/usePdaFeedback'

interface Props {
  flash: FlashState | null
  className?: string
}

const STYLE: Record<string, string> = {
  ok:   'bg-green-100 text-green-800 border-green-200',
  err:  'bg-red-100   text-red-800   border-red-200',
  warn: 'bg-yellow-100 text-yellow-800 border-yellow-200',
}

const ICON: Record<string, string> = {
  ok:   '✓',
  err:  '✕',
  warn: '⚠',
}

export default function PdaFlash({ flash, className = '' }: Props) {
  if (!flash) return null
  return (
    <div className={`mx-4 mt-2 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold animate-in fade-in slide-in-from-top-1 duration-150 ${STYLE[flash.type]} ${className}`}>
      <span className="text-base shrink-0">{ICON[flash.type]}</span>
      <span className="flex-1">{flash.msg}</span>
    </div>
  )
}
