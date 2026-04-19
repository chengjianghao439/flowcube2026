/**
 * 保留原 hook 名称，内部已不再做离线补账队列。
 *
 * 这里仅维护“结果待确认”的关键请求列表：
 * - 断网/超时后不自动补提交
 * - 仅用于提示用户确认结果，避免重复推进业务状态
 */
import { usePendingRequests } from './usePendingRequests'

export function useOfflineQueue() {
  const { records, removePending, pendingCount } = usePendingRequests()

  return {
    queue: records,
    enqueue: () => {
      throw new Error('关键业务不支持离线排队提交')
    },
    remove: removePending,
    flush: async () => {},
    pendingCount,
    failedCount: 0,
  }
}
