import { useQuery } from '@tanstack/react-query'
import { getTransferDetailApi } from '@/api/transfer'

/** PDA 调拨 · 调入仓扫码入库 — 调拨单详情 */
export function usePdaTransferInDetail(transferId: number) {
  return useQuery({
    queryKey: ['pda-transfer', transferId],
    queryFn: () => getTransferDetailApi(transferId),
    enabled: transferId > 0,
  })
}
