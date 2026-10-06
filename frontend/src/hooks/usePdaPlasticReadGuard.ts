import { useEffect, useRef, useSyncExternalStore } from 'react'
import { splitEndpoint, splitOwnerEpoch, splitServerEpoch, subscribeSplitRecovery } from '@/lib/pdaSplitRecovery'
import { useAuthStore } from '@/store/authStore'
export function plasticReadContext() {
  const a = useAuthStore.getState()
  return JSON.stringify([a.user?.id, a.sessionGeneration, splitOwnerEpoch(), splitServerEpoch(), splitEndpoint()])
}
/** 三动作共享的扫描读取保护；隐藏实例不能接收晚到条码结果或反馈。 */
export function usePdaPlasticReadGuard(active: boolean) {
  // 裸fill深链没有父级恢复hook，也必须主动订阅合法改址/账号及权限变化。
  useSyncExternalStore(subscribeSplitRecovery, splitServerEpoch)
  useAuthStore(s => s.user)
  useAuthStore(s => s.sessionGeneration)
  const state = useRef({ active, epoch: 0, mounted: true })
  if (state.current.active !== active) state.current = { ...state.current, active, epoch: state.current.epoch + 1 }
  useEffect(() => { state.current.mounted = true; return () => { state.current.mounted = false } }, [])
  return () => {
    const endpoint = splitEndpoint(), server = splitServerEpoch(), owner = splitOwnerEpoch(), visible = state.current.epoch
    return {
      contextKey: plasticReadContext(),
      current: () => state.current.mounted && state.current.active && state.current.epoch === visible && splitServerEpoch() === server && splitOwnerEpoch() === owner && splitEndpoint() === endpoint,
      config: { baseURL: endpoint, _erpApiFallbackTried: true, skipGlobalError: true },
    }
  }
}
