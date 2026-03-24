import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import client from '@/api/client'
import type { ApiResponse } from '@/types'

interface NotifItem { type: string; icon: string; text: string; path: string }
interface NotifData { total: number; items: NotifItem[] }

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => client.get<ApiResponse<NotifData>>('/notifications').then(r => r.data.data!),
    refetchInterval: 60000, // 每分钟刷新
  })

  const total = data?.total ?? 0
  const items = data?.items ?? []

  const colorMap: Record<string, string> = {
    warning: 'text-amber-600 bg-amber-50 border-amber-200',
    danger:  'text-red-600 bg-red-50 border-red-200',
    info:    'text-blue-600 bg-blue-50 border-blue-200',
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="通知中心"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center px-0.5 font-bold">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 遮罩 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* 下拉面板 */}
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-lg border z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">通知中心</h3>
              {total > 0 && <span className="text-xs text-muted-foreground">{total} 条待处理</span>}
            </div>

            {items.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <p className="text-2xl mb-2">✓</p>
                <p>暂无待处理事项</p>
              </div>
            ) : (
              <div className="divide-y max-h-80 overflow-y-auto">
                {items.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => { setOpen(false); navigate(item.path) }}
                    className={`w-full text-left px-4 py-3 hover:opacity-80 transition-opacity flex items-start gap-3 ${colorMap[item.type] || 'text-foreground bg-background'}`}
                  >
                    <span className="text-base shrink-0 mt-0.5">{item.icon}</span>
                    <span className="text-sm font-medium">{item.text}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="px-4 py-2 border-t text-center">
              <span className="text-xs text-muted-foreground">每分钟自动刷新</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
