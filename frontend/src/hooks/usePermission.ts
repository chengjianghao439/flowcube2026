import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import type { PermissionRequirement } from '@/lib/permissions'

export function usePermission() {
  const user = useAuthStore(s => s.user)
  const roleId = user?.roleId ?? 5
  const permissions = user?.permissions ?? []
  return {
    /** 传单个权限码 = 必须持有；传权限码数组 = 任一即可（见 PermissionRequirement） */
    can: (perm: PermissionRequirement) => hasPermission(permissions, perm, roleId),
    permissions,
    roleId,
  }
}
