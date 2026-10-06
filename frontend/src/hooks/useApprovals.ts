import { useApprovalReadScope } from '@/hooks/useApprovalReadScope'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  listApprovalFlowsApi,
  createApprovalFlowApi,
  updateApprovalFlowApi,
  deleteApprovalFlowApi,
  listPendingApprovalsApi,
} from '@/api/approvals'
import type { ApprovalFlowStep } from '@/types/approval'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { usePermission } from '@/hooks/usePermission'
import { PENDING_APPROVAL_PERMISSIONS } from '@/lib/approvalBusiness'

const FLOW_KEY = 'approval-flows'
const PENDING_KEY = 'approval-pending'

function invalidateFlowAndDepartments(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [FLOW_KEY] }),
    qc.invalidateQueries({ queryKey: ['departments'] }),
  ])
}

export function useApprovalFlows() {
  return useQuery({
    queryKey: [FLOW_KEY],
    queryFn: () => listApprovalFlowsApi(),
  })
}

export function useCreateApprovalFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: {
      bizType: string
      name: string
      minAmount?: number
      maxAmount?: number | null
      isActive?: boolean
      remark?: string
      steps: ApprovalFlowStep[]
    }) => createApprovalFlowApi(d),
    onSuccess: () => invalidateFlowAndDepartments(qc),
  })
}

export function useUpdateApprovalFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateApprovalFlowApi>[1] }) =>
      updateApprovalFlowApi(id, data),
    onSuccess: () => invalidateFlowAndDepartments(qc),
  })
}

export function useDeleteApprovalFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteApprovalFlowApi(id),
    onSuccess: () => invalidateFlowAndDepartments(qc),
  })
}

/** 待我审批列表 */
export function usePendingApprovals(page: number, pageSize = 20) {
  const scope = useApprovalReadScope()
  const active = useActiveWorkspaceTab()
  const { can } = usePermission()
  const enabled = active && can(PENDING_APPROVAL_PERMISSIONS)
  const query = useQuery({
    queryKey: [PENDING_KEY, scope.key, page, pageSize],
    queryFn: async ({ signal }) => {
      const result = await listPendingApprovalsApi({ page, pageSize }, 'paged', { signal, baseURL: scope.server, _authSessionGeneration: scope.generation, _erpApiFallbackTried: true })
      if (!scope.isCurrent()) throw new Error('审批待办读取上下文已变化，请重试')
      return result
    }, enabled, subscribed: enabled, placeholderData: undefined, staleTime: 0,
  })
  return { ...query, data: enabled && scope.isCurrent() && !query.isFetching && !query.isPaused ? query.data : undefined }
}
