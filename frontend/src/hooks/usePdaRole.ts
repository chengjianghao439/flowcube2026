/**
 * PDA 角色显示与权限映射
 *
 * 映射规则（基于现有 roleId）：
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
import { PERMISSIONS } from '@/lib/permission-codes'
import type { PermissionCode } from '@/lib/permission-codes'

export type PdaRole = 'supervisor' | 'picker' | 'packer' | 'receiver'

export type PdaPerm = PermissionCode

// ── 角色 → 权限映射 ────────────────────────────────────────────────────────
const ROLE_PERMS: Record<PdaRole, PdaPerm[]> = {
  supervisor: [
    PERMISSIONS.INBOUND_ORDER_VIEW,
    PERMISSIONS.INBOUND_RECEIVE_EXECUTE,
    PERMISSIONS.INBOUND_PUTAWAY_EXECUTE,
    PERMISSIONS.WAREHOUSE_TASK_VIEW,
    PERMISSIONS.WAREHOUSE_TASK_PICK,
    PERMISSIONS.SORTING_BIN_VIEW,
    PERMISSIONS.SORTING_BIN_MANAGE,
    PERMISSIONS.WAREHOUSE_TASK_CHECK,
    PERMISSIONS.WAREHOUSE_TASK_PACK,
    PERMISSIONS.WAREHOUSE_TASK_SHIP,
    PERMISSIONS.INVENTORY_CONTAINER_SPLIT,
  ],
  receiver: [
    PERMISSIONS.INBOUND_ORDER_VIEW,
    PERMISSIONS.INBOUND_RECEIVE_EXECUTE,
    PERMISSIONS.INBOUND_PUTAWAY_EXECUTE,
  ],
  picker: [
    PERMISSIONS.WAREHOUSE_TASK_VIEW,
    PERMISSIONS.WAREHOUSE_TASK_PICK,
    PERMISSIONS.SORTING_BIN_VIEW,
    PERMISSIONS.SORTING_BIN_MANAGE,
    PERMISSIONS.WAREHOUSE_TASK_CHECK,
    PERMISSIONS.WAREHOUSE_TASK_SHIP,
    PERMISSIONS.INVENTORY_CONTAINER_SPLIT,
  ],
  packer: [
    PERMISSIONS.WAREHOUSE_TASK_VIEW,
    PERMISSIONS.WAREHOUSE_TASK_CHECK,
    PERMISSIONS.WAREHOUSE_TASK_PACK,
    PERMISSIONS.WAREHOUSE_TASK_SHIP,
    PERMISSIONS.INVENTORY_CONTAINER_SPLIT,
  ],
}

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
  const fallbackPerms = ROLE_PERMS[role]
  const grantedPerms = user?.permissions && user.permissions.length > 0 ? user.permissions : fallbackPerms

  return {
    role,
    roleLabel: PDA_ROLE_LABEL[role],
    roleIcon:  PDA_ROLE_ICON[role],
    roleColor: PDA_ROLE_COLOR[role],
    can: (p: PdaPerm) => hasPermission(grantedPerms, p, roleId),
    isSupervisor: role === 'supervisor',
  }
}
