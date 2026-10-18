import { useCompanyQueryKey } from '@/hooks/useCompanyQueryKey'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getBackfillsApi, getBackfillDetailApi, approveBackfillApi, rejectBackfillApi, cancelBackfillApi,
  executeBackfillApi, regenerateBackfillVoucherApi,
} from '@/api/accounting'
import type { AxiosRequestConfig } from 'axios'
import { collectAllRecords } from '@/api/allRecords'
import { useCompanyStore } from '@/store/companyStore'
import type { BackfillApplication, BackfillListQuery, BackfillListResult } from '@/types/accounting'

const QK = 'acct-backfills'
/** Opt-in immutable context only for supplier_refund; legacy kinds keep their existing calls. */
export interface SupplierRefundBackfillContext { config: AxiosRequestConfig; identity: readonly unknown[]; current: () => boolean; requestCurrent?: () => boolean }
async function withinRefundContext<T>(context: SupplierRefundBackfillContext | undefined, send: () => Promise<T>): Promise<T> {
  if (context && !context.current()) throw Error('原供应商退款上下文已变化，请重新核对')
  const result = await send()
  if (context && !context.current()) throw Error('原供应商退款回应上下文已变化，原输入保留')
  return result
}
async function refreshRefund(qc: ReturnType<typeof useQueryClient>, context?: SupplierRefundBackfillContext) {
  if (!context) { invalidate(qc); return }
  if (!context.current()) return
  await qc.invalidateQueries({queryKey:[QK]})
  if (!context.current()) throw Error('原供应商退款刷新上下文已变化，原输入保留')
}
type ExecutionInput = number | {id:number;refundContext?:SupplierRefundBackfillContext}
const executionId = (v: ExecutionInput) => typeof v === 'number' ? v : v.id
const executionContext = (v: ExecutionInput) => typeof v === 'number' ? undefined : v.refundContext

export type BackfillReadRow = BackfillApplication & { refundContext?: SupplierRefundBackfillContext }
function useBackfillList(params: BackfillListQuery, captureRefundRead?: () => SupplierRefundBackfillContext, all = false, active = true) {
  const queryKey = useCompanyQueryKey([QK, all ? 'all' : 'list', params])
  const companyId = queryKey[1] as number
  return useQuery({ queryKey, ...(all ? { enabled: active, subscribed: active } : {}), queryFn: async queryContext => {
    const signal = all ? queryContext.signal : undefined
    const context = captureRefundRead?.()
    const config = all ? { ...context?.config, _companyScopeId: companyId, signal } : context?.config
    // Never send a fixed old-server request after its owner has changed.
    const readPage = async (query: BackfillListQuery) => {
      if (all && useCompanyStore.getState().companyId !== companyId) throw Error('账套已切换，请重新读取补录申请')
      if (context && !(context.requestCurrent?.() ?? context.current())) throw Error('原供应商退款读取上下文已变化，请主动刷新核对')
      const result = await getBackfillsApi(query, config)
      if (all && useCompanyStore.getState().companyId !== companyId) throw Error('账套已切换，请重新读取补录申请')
      if (all && context && !(context.requestCurrent?.() ?? context.current())) throw Error('原供应商退款读取上下文已变化，请主动刷新核对')
      return result
    }
    const result: BackfillListResult & { truncated?: boolean } = all
      ? await collectAllRecords(page => readPage({ ...params, page, pageSize: 200 }), signal)
      : await readPage(params)
    const current = !context || context.current()
    const list: BackfillReadRow[] = result.list.flatMap(row => {
      if (row.bizType !== 'supplier_refund' || !context) return [row]
      return current ? [{ ...row, refundContext: context }] : []
    })
    return { ...result, list }
  }, retry: captureRefundRead ? false : undefined })
}
export const useBackfills = (params: BackfillListQuery, captureRefundRead?: () => SupplierRefundBackfillContext) =>
  useBackfillList(params, captureRefundRead)

/** 仅跨期补录列表使用；保留旧分页读取合同与各页原退款上下文。 */
export const useAllBackfills = (params: Omit<BackfillListQuery, 'page' | 'pageSize'>, captureRefundRead?: () => SupplierRefundBackfillContext, active = true) =>
  useBackfillList(params, captureRefundRead, true, active)

/**
 * 详情：列表接口**不返回** requestSnapshot（那是批准后重放原请求的完整入参），
 * 只有详情接口给。审批人核对「资金账户、支付方式、退款打回哪个仓库」这些原请求信息，
 * 只能从这里拿，所以详情弹窗必须真去调这个接口，不能拿列表行凑数。
 */
export const useBackfillDetail = (id: number | null, refundContext?: SupplierRefundBackfillContext) =>
  useQuery({
    queryKey: useCompanyQueryKey([QK, 'detail', id, ...(refundContext ? refundContext.identity : [])]),
    queryFn: () => withinRefundContext(refundContext, () => getBackfillDetailApi(id as number, refundContext?.config)),
    enabled: id != null && (!refundContext || refundContext.current()),
    retry: refundContext ? false : undefined,
  })

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [QK] })
}

/** 批准即执行（后端在同一次请求里完成），所以成功后的通知要按返回体区分「已记账」与「已记账但凭证待重试」 */
export function useApproveBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, remark, refundContext }: { id: number; remark?: string; refundContext?: SupplierRefundBackfillContext }) => withinRefundContext(refundContext, () => approveBackfillApi(id, remark, refundContext?.config)),
    onSuccess: (_data, variables) => refreshRefund(qc, variables.refundContext),
  })
}

export function useRejectBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, remark, refundContext }: { id: number; remark: string; refundContext?: SupplierRefundBackfillContext }) => withinRefundContext(refundContext, () => rejectBackfillApi(id, remark, refundContext?.config)),
    onSuccess: (_data, variables) => refreshRefund(qc, variables.refundContext),
  })
}

/** 撤回（待审批，申请人自己）与作废（已批准但执行不下去）同一个接口，后端按状态判 */
export function useCancelBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason, refundContext }: { id: number; reason: string; refundContext?: SupplierRefundBackfillContext }) => withinRefundContext(refundContext, () => cancelBackfillApi(id, reason, refundContext?.config)),
    onSuccess: (_data, variables) => refreshRefund(qc, variables.refundContext),
  })
}

export function useExecuteBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ExecutionInput) => withinRefundContext(executionContext(input), () => executeBackfillApi(executionId(input), executionContext(input)?.config)),
    onSuccess: (_data, input) => refreshRefund(qc, executionContext(input)),
  })
}

export function useRegenerateBackfillVoucher() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ExecutionInput) => withinRefundContext(executionContext(input), () => regenerateBackfillVoucherApi(executionId(input), executionContext(input)?.config)),
    onSuccess: (_data, input) => refreshRefund(qc, executionContext(input)),
  })
}
