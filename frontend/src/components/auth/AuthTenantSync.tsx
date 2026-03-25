import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'
import { syncTenantSession } from '@/lib/authTenantSync'

/**
 * 持久化恢复后：旧 JWT 无 tenantId 时自动 refresh；并同步 user.tenantId。
 */
export default function AuthTenantSync() {
  const done = useRef(false)

  useEffect(() => {
    function run() {
      if (done.current) return
      const { token, isAuthenticated } = useAuthStore.getState()
      if (!isAuthenticated || !token) return
      done.current = true
      void syncTenantSession().catch(() => {
        done.current = false
      })
    }

    const p = useAuthStore.persist
    if (p.hasHydrated()) {
      run()
      return
    }
    const unsub = p.onFinishHydration(() => run())
    return unsub
  }, [])

  return null
}
