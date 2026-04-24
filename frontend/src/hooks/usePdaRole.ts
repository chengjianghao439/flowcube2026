/**
 * PDA 角色显示与权限判定
 *
 * 显示角色映射（仅用于 UI 展示）：
 *  roleId=1  → 主管 supervisor  ：全部 PDA 功能 + 管理操作
 *  roleId=2  → 主管 supervisor  ：仓库管理员，等同主管
 *  roleId=3  → 收货员 receiver  ：仅收货入库
 *  roleId=4  → 拣货员 picker    ：拣货 + 复核 + 出库
 *  roleId=5  → 打包员 packer    ：复核 + 打包 + 出库
 *  其他      → 拣货员（默认）
 *
 */
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import type { PermissionCode } from '@/lib/permission-codes'

export type PdaRole = 'supervisor' | 'picker' | 'packer' | 'receiver'

export type PdaPerm = PermissionCode

// ── roleId → PDA 角色映射 ──────────────────────────────────────────────────
function toPdaRole(roleId: number): PdaRole {
  if (roleId === 1 || roleId === 2) return 'supervisor'
  if (roleId === 3)                 return 'receiver'
  if (roleId === 4)                 return 'picker'
  if (roleId === 5)                 return 'packer'
  return 'picker'
}

// ── 角色显示配置 ───────────────────────────────────────────────────────────
export const PDA_ROLE_LABEL: Record<PdaRole, string> = {
  supervisor: '主管',
  picker:     '拣货员',
  packer:     '打包员',
  receiver:   '收货员',
}

export const PDA_ROLE_ICON: Record<PdaRole, string> = {
  supervisor: '👔',
  picker:     '🗂️',
  packer:     '📦',
  receiver:   '📥',
}

export const PDA_ROLE_COLOR: Record<PdaRole, string> = {
  supervisor: 'bg-purple-100 text-purple-800 border-purple-200',
  picker:     'bg-blue-100   text-blue-800   border-blue-200',
  packer:     'bg-orange-100 text-orange-800 border-orange-200',
  receiver:   'bg-teal-100   text-teal-800   border-teal-200',
}

// ── Hook ──────────────────────────────────────────────────────────────────
export function usePdaRole() {
  const user   = useAuthStore(s => s.user)
  const roleId = user?.roleId ?? 4
  const role   = toPdaRole(roleId)
  const permissions = Array.isArray(user?.permissions) ? user.permissions : []
  const permissionsLoaded = Array.isArray(user?.permissions)
  const permissionsMissing = !!user && !permissionsLoaded

  return {
    role,
    roleLabel: PDA_ROLE_LABEL[role],
    roleIcon:  PDA_ROLE_ICON[role],
    roleColor: PDA_ROLE_COLOR[role],
    permissions,
    permissionsLoaded,
    permissionsMissing,
    can: (p: PdaPerm) => hasPermission(permissions, p, roleId),
    canAll: (perms: PdaPerm[]) => perms.every((perm) => hasPermission(permissions, perm, roleId)),
    canAny: (perms: PdaPerm[]) => perms.some((perm) => hasPermission(permissions, perm, roleId)),
    isSupervisor: role === 'supervisor',
  }
}
