import { useCompanyQueryKey } from '@/hooks/useCompanyQueryKey'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getBackfillsApi, getBackfillDetailApi, approveBackfillApi, rejectBackfillApi, cancelBackfillApi,
  executeBackfillApi, regenerateBackfillVoucherApi,
} from '@/api/accounting'
import type { BackfillListQuery } from '@/types/accounting'

const QK = 'acct-backfills'

export const useBackfills = (params: BackfillListQuery) =>
  useQuery({ queryKey: useCompanyQueryKey([QK, 'list', params]), queryFn: () => getBackfillsApi(params) })

/**
 * 详情：列表接口**不返回** requestSnapshot（那是批准后重放原请求的完整入参），
 * 只有详情接口给。审批人核对「资金账户、支付方式、退款打回哪个仓库」这些原请求信息，
 * 只能从这里拿，所以详情弹窗必须真去调这个接口，不能拿列表行凑数。
 */
export const useBackfillDetail = (id: number | null) =>
  useQuery({
    queryKey: useCompanyQueryKey([QK, 'detail', id]),
    queryFn: () => getBackfillDetailApi(id as number),
    enabled: id != null,
  })

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
}

/** 批准即执行（后端在同一次请求里完成），所以成功后的通知要按返回体区分「已记账」与「已记账但凭证待重试」 */
export function useApproveBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, remark }: { id: number; remark?: string }) => approveBackfillApi(id, remark),
    onSuccess: () => invalidate(qc),
  })
}

export function useRejectBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, remark }: { id: number; remark: string }) => rejectBackfillApi(id, remark),
    onSuccess: () => invalidate(qc),
  })
}

/** 撤回（待审批，申请人自己）与作废（已批准但执行不下去）同一个接口，后端按状态判 */
export function useCancelBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelBackfillApi(id, reason),
    onSuccess: () => invalidate(qc),
  })
}

export function useExecuteBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => executeBackfillApi(id),
    onSuccess: () => invalidate(qc),
  })
}

export function useRegenerateBackfillVoucher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => regenerateBackfillVoucherApi(id),
    onSuccess: () => invalidate(qc),
  })
}
