import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import type { PermCode } from '@/lib/permissions'

export function usePermission() {
  const user = useAuthStore(s => s.user)
  const roleId = user?.roleId ?? 5
  const permissions = user?.permissions ?? []
  return {
    can: (perm: PermCode) => hasPermission(permissions, perm, roleId),
    permissions,
    roleId,
  }
}
