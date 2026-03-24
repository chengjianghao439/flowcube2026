import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getUsersApi,
  createUserApi,
  updateUserApi,
  resetPasswordApi,
  deleteUserApi,
} from '@/api/users'
import type { QueryParams } from '@/types'
import type { CreateUserParams, UpdateUserParams } from '@/types/users'

const QUERY_KEY = 'users'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUserParams }) =>
      updateUserApi(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}
