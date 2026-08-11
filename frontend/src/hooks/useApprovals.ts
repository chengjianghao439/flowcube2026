import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listApprovalFlowsApi,
  createApprovalFlowApi,
  updateApprovalFlowApi,
  deleteApprovalFlowApi,
  listPendingApprovalsApi,
  getBizApprovalApi,
} from '@/api/approvals'
import type { ApprovalFlowStep } from '@/types/approval'

const FLOW_KEY = 'approval-flows'
const PENDING_KEY = 'approval-pending'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: [FLOW_KEY] }),
  })
}

export function useUpdateApprovalFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateApprovalFlowApi>[1] }) =>
      updateApprovalFlowApi(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [FLOW_KEY] }),
  })
}

export function useDeleteApprovalFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteApprovalFlowApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [FLOW_KEY] }),
  })
}

/** 待我审批列表 */
export function usePendingApprovals(page: number, pageSize = 20) {
  return useQuery({
    queryKey: [PENDING_KEY, page, pageSize],
    queryFn: () => listPendingApprovalsApi({ page, pageSize }),
  })
}

/** 某业务单据的审批进度 */
export function useBizApproval(bizType: string | null, bizId: number | null) {
  return useQuery({
    queryKey: ['biz-approval', bizType, bizId],
    queryFn: () => (bizType && bizId ? getBizApprovalApi(bizType, bizId) : Promise.resolve(null)),
    enabled: !!bizType && !!bizId,
  })
}
