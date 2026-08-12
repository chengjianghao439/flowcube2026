import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient as client } from '@/api/client'
import { getRolesApi } from '@/api/settings'

export const ROLES_QUERY_KEY = 'roles'
export const ROLE_PERMS_QUERY_KEY = 'role-perms'

export interface Role {
  id: number
  code: string
  name: string
  remark: string
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
