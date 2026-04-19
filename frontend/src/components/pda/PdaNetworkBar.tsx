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
      <div className="w-full bg-red-600 px-4 py-2 flex items-center gap-2 text-white text-xs font-semibold">
        <span className="h-2 w-2 rounded-full bg-white animate-pulse shrink-0" />
        <span>网络中断，关键业务已阻断。恢复网络前不可提交收货、上架、拣货、复核、打包和出库。</span>
      </div>
    )
  }

  if (pendingCount > 0) {
    return (
      <div className="w-full bg-yellow-500 px-4 py-2 flex items-center gap-2 text-white text-xs font-semibold">
        <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" />
        <span>有 {pendingCount} 个关键操作结果待确认。请先确认结果，避免重复提交。</span>
      </div>
    )
  }

  return null
}
