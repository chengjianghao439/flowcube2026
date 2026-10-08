/**
 * PdaNetworkBar — PDA 网络状态指示条
 *
 * 显示规则：
 *  - online：隐藏（不干扰操作）
 *  - offline：顶部红色横幅「关键操作已阻断」
 *  - pending：黄色横幅「结果待确认」
 */
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useOfflineQueue } from '@/hooks/useOfflineQueue'

export default function PdaNetworkBar() {
  const status = useNetworkStatus()
  const { pendingCount } = useOfflineQueue()

  if (status === 'online' && pendingCount === 0) return null

  if (status === 'offline') {
    return (
      <div role="alert" className="w-full bg-destructive/10 px-4 py-2 flex items-center gap-2 text-destructive-ink text-xs font-semibold">
        <span className="h-2 w-2 rounded-full bg-destructive-ink motion-safe:animate-pulse shrink-0" />
        <span>网络中断，作业已暂停。恢复网络后再提交。</span>
      </div>
    )
  }

  if (pendingCount > 0) {
    return (
      <div role="status" className="w-full bg-warning/10 px-4 py-2 flex items-center gap-2 text-warning-ink text-xs font-semibold">
        <span className="h-3 w-3 rounded-full border-2 border-warning-ink border-t-transparent motion-safe:animate-spin shrink-0" />
        <span>有 {pendingCount} 个操作待确认，请先确认再继续。</span>
      </div>
    )
  }

  return null
}
