/**
 * PdaBottomBar — PDA 底部固定操作栏
 *
 * 规格：fixed bottom · height 64px · border-top · padding 12px · bg-white
 * 用途：确认 / 提交 / 下一步 / 发货 等主操作区
 */
import type { ReactNode } from 'react'

interface PdaBottomBarProps {
  children: ReactNode
  className?: string
  contentClassName?: string
}

export default function PdaBottomBar({
  children,
  className = '',
  contentClassName = '',
}: PdaBottomBarProps) {
  return (
    <div
      className={`sticky bottom-0 z-20 mt-auto border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 ${className}`}
      style={{ padding: 12 }}
    >
      <div className={`mx-auto flex h-full max-w-md flex-col gap-2 ${contentClassName}`.trim()}>
        {children}
      </div>
    </div>
  )
}
