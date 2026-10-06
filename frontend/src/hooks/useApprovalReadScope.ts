import { useSyncExternalStore } from 'react'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

/** 只读交接的缓存与在途请求按当前会话、权限和服务器隔离。 */
export function useApprovalReadScope() {
  const generation = useAuthStore(s => s.sessionGeneration)
  const user = useAuthStore(s => s.user)
  const server = useSyncExternalStore(subscribeApiClientBaseURL, getApiClientBaseURL)
  const key = JSON.stringify([generation, user?.id, user?.roleId, user?.permissions, server])
  return { key, server, generation, isCurrent: () => {
    const current = useAuthStore.getState()
    return key === JSON.stringify([current.sessionGeneration, current.user?.id, current.user?.roleId, current.user?.permissions, getApiClientBaseURL()])
  } }
}
