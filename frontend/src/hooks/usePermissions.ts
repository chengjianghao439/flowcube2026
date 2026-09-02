import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient as client } from '@/api/client'
import { getRolesApi, createRoleApi, deleteRoleApi } from '@/api/settings'

export const ROLES_QUERY_KEY = 'roles'
export const ROLE_PERMS_QUERY_KEY = 'role-perms'

export interface Role {
  id: number
  code: string
  name: string
  remark: string
  /** 1=系统内置角色（不可删除），0=自定义 */
  is_system: number
}

export function useRoles() {
  return useQuery({ queryKey: [ROLES_QUERY_KEY], queryFn: () => getRolesApi().then(r => r || []) })
}

export function useRolePermissions(roleId: number) {
  return useQuery({
    queryKey: [ROLE_PERMS_QUERY_KEY, roleId],
    queryFn: () => client.get<string[]>(`/roles/${roleId}/permissions`).then(r => r || []),
    enabled: !!roleId,
  })
}

export function useSaveRolePermissions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: number; permissions: string[] }) =>
      client.put(`/roles/${roleId}/permissions`, { permissions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROLE_PERMS_QUERY_KEY] }),
  })
}

/** 复制角色（含权限）。成功后清角色列表缓存，权限页角色栏立即出现新角色 */
export function useDuplicateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ roleId, code, name, remark }: { roleId: number; code: string; name: string; remark?: string }) =>
      client.post(`/roles/${roleId}/duplicate`, { code, name, remark }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROLES_QUERY_KEY] }),
  })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: { code: string; name: string; remark?: string }) => createRoleApi(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROLES_QUERY_KEY] }),
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteRoleApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROLES_QUERY_KEY] }),
  })
}
