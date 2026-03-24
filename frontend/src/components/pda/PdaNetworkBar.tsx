/**
 * PdaNetworkBar — PDA 网络状态指示条
 *
 * 显示规则：
 *  - online：隐藏（不干扰操作）
 *  - offline：顶部红色横幅「离线模式」
 *  - recovering：黄色横幅「正在同步 N 条操作」
 *  - 有失败队列：橙色警告
 */
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useOfflineQueue } from '@/hooks/useOfflineQueue'

export default function PdaNetworkBar() {
  const status = useNetworkStatus()
  const { pendingCount, failedCount, flush } = useOfflineQueue()

  if (status === 'online' && pendingCount === 0 && failedCount === 0) return null

  if (failedCount > 0) {
    return (
      <div className="w-full bg-orange-500 px-4 py-2 flex items-center justify-between text-white text-xs font-semibold">
        <span>⚠️ {failedCount} 条操作同步失败</span>
        <button onClick={flush} className="underline active:opacity-60">重试</button>
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="w-full bg-red-600 px-4 py-2 flex items-center gap-2 text-white text-xs font-semibold">
        <span className="h-2 w-2 rounded-full bg-white animate-pulse shrink-0" />
        <span>离线模式 — 操作将在网络恢复后自动同步</span>
      </div>
    )
  }

  if (pendingCount > 0) {
    return (
      <div className="w-full bg-yellow-500 px-4 py-2 flex items-center gap-2 text-white text-xs font-semibold">
        <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" />
        <span>正在同步 {pendingCount} 条离线操作…</span>
      </div>
    )
  }

  return null
}
