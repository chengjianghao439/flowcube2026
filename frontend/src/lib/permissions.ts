import type { PermissionCode } from '@/lib/permission-codes'

export type PermCode = PermissionCode

export function normalizePermissions(perms: string[] | undefined): Set<PermCode> {
  return new Set(Array.isArray(perms) ? perms.filter(Boolean) : [])
}

export function hasPermission(
  perms: string[] | undefined,
  perm: PermCode,
  roleId?: number,
): boolean {
  if (roleId === 1) return true
  return normalizePermissions(perms).has(perm)
}
