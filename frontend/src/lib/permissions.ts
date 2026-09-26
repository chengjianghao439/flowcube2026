import type { PermissionCode } from '@/lib/permission-codes'

export type PermCode = PermissionCode

/**
 * 一条路由 / 菜单项 / 按钮声明的权限要求。
 *   · 单个权限码 —— 必须持有它；
 *   · 权限码数组 —— **任一**即可。
 *
 * 数组形态是给「同一个页面服务两类角色」用的：跨期补录审批页既是不持审批权限的出纳
 * 回查、撤回自己申请的入口，也是审批人的审批入口（后端列表接口也是 requireAnyPermission
 * 这两档）。若前端只能写一个权限码，只被授予「审批跨期补录」的角色会被挡在菜单外，
 * 而他的工作是唯一必须在这个页面完成的——审批流在真实分权下就走不通了。
 */
export type PermissionRequirement = PermCode | readonly PermCode[]

export function normalizePermissions(perms: string[] | undefined): Set<PermCode> {
  return new Set(Array.isArray(perms) ? (perms.filter(Boolean) as PermCode[]) : [])
}

export function hasPermission(
  perms: string[] | undefined,
  perm: PermissionRequirement,
  roleId?: number,
): boolean {
  if (roleId === 1) return true
  const held = normalizePermissions(perms)
  const required: readonly PermCode[] = Array.isArray(perm) ? perm : [perm as PermCode]
  return required.some((code) => held.has(code))
}
