import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  listDepartmentsApi,
  listDepartmentOptionsApi,
  createDepartmentApi,
  updateDepartmentApi,
  deleteDepartmentApi,
} from '@/api/departments'
import type { Department } from '@/types/department'

const QUERY_KEY = 'departments'
const OPTIONS_QUERY_KEY = 'department-options'

function invalidateDepartmentQueries(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
    qc.invalidateQueries({ queryKey: [OPTIONS_QUERY_KEY] }),
  ])
}

export function useDepartments() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: listDepartmentsApi,
  })
}

/** 精简部门下拉（免 department.view 权限，供用户管理表单等场景使用） */
export function useDepartmentOptions() {
  return useQuery({
    queryKey: [OPTIONS_QUERY_KEY],
    queryFn: listDepartmentOptionsApi,
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Omit<Department, 'id' | 'createdAt' | 'memberCount'>>) =>
      createDepartmentApi(data),
    onSuccess: () => invalidateDepartmentQueries(qc),
  })
}

export function useUpdateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<Department, 'id' | 'createdAt' | 'memberCount'>> }) =>
      updateDepartmentApi(id, data),
    onSuccess: () => invalidateDepartmentQueries(qc),
  })
}

export function useDeleteDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteDepartmentApi(id),
    onSuccess: () => invalidateDepartmentQueries(qc),
  })
}
