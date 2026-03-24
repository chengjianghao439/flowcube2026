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
}

export default function PdaBottomBar({ children, className = '' }: PdaBottomBarProps) {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-white ${className}`}
      style={{ padding: 12, minHeight: 64 }}
    >
      <div className="max-w-md mx-auto h-full flex items-center gap-3">
        {children}
      </div>
    </div>
  )
}
