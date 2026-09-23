import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getUsersApi,
  getAssignableRolesApi,
  createUserApi,
  updateUserApi,
  resetPasswordApi,
  deleteUserApi,
} from '@/api/users'
import type { QueryParams } from '@/types'
import type { CreateUserParams, UpdateUserParams } from '@/types/users'

const QUERY_KEY = 'users'

function invalidateOrganizationUsers(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
    qc.invalidateQueries({ queryKey: ['user-options'] }),
    qc.invalidateQueries({ queryKey: ['departments'] }),
  ])
}

export function useUsers(params: QueryParams) {
  return useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => getUsersApi(params),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateUserParams) => createUserApi(data),
    onSuccess: () => invalidateOrganizationUsers(qc),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUserParams }) =>
      updateUserApi(id, data),
    onSuccess: () => invalidateOrganizationUsers(qc),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      resetPasswordApi(id, newPassword),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteUserApi(id),
    onSuccess: () => invalidateOrganizationUsers(qc),
  })
}

export function useAssignableRoles(enabled = true) {
  return useQuery({ queryKey: ['assignable-roles'], queryFn: getAssignableRolesApi, enabled })
}
