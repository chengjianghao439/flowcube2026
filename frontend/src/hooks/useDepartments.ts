import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listDepartmentsApi,
  listDepartmentOptionsApi,
  createDepartmentApi,
  updateDepartmentApi,
  deleteDepartmentApi,
} from '@/api/departments'
import type { Department } from '@/types/department'

const QUERY_KEY = 'departments'

export function useDepartments() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: listDepartmentsApi,
  })
}

/** 精简部门下拉（免 department.view 权限，供用户管理表单等场景使用） */
export function useDepartmentOptions() {
  return useQuery({
    queryKey: ['department-options'],
    queryFn: listDepartmentOptionsApi,
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Omit<Department, 'id' | 'createdAt' | 'memberCount'>>) =>
      createDepartmentApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useUpdateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<Department, 'id' | 'createdAt' | 'memberCount'>> }) =>
      updateDepartmentApi(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}

export function useDeleteDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteDepartmentApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  })
}
