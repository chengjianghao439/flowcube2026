/**
 * PDA 上架流程（强制扫码）：扫库存条码 I → 扫货架条码 R → 调用入库任务上架接口
 * 禁止仅输入数字库存条码 ID；货架条码须为 LOC 格式并由后端校验启用/同仓
 */
import type { FlowDef } from '@/hooks/usePdaFlow'
import { parseBarcode } from '@/utils/barcode'
import apiClient from '@/api/client'
import { getContainerByBarcodeApi } from '@/api/inventory'
import { putawayInboundApi } from '@/api/inbound-tasks'
import type { ApiResponse } from '@/types'

interface LocationInfo {
  id: number
  code: string
}

export interface PutawayFlowContext {
  taskId: number
  containerId: number | null
}

function isStrictContainerScan(raw: string): boolean {
  return /^(?:I|CNT)\d+$/i.test(raw.trim())
}

function isStrictLocationScan(raw: string): boolean {
  return /^(?:R\d+|LOC[-A-Z0-9]+)$/i.test(raw.trim())
}

export function makePutawayFlow(
  taskId: number,
  opts?: { onAfterPutaway?: () => void | Promise<void> },
): FlowDef<PutawayFlowContext> {
  return {
    id:          'inbound-putaway',
    initialStep: 'scan-container',
    steps:       [
      {
        id:          'scan-container',
        label:       '扫描库存条码',
        placeholder: '扫描库存条码',
        barcodeType: 'container',
        handle:      async (raw, ctx) => {
          const trimmed = raw.trim()
          if (/^\d+$/.test(trimmed)) {
            return { ok: false, message: '扫描库存条码' }
          }
          if (!isStrictContainerScan(trimmed)) {
            return { ok: false, message: '扫描库存条码' }
          }
          const parsed = parseBarcode(trimmed)
          if (parsed.type !== 'container') return { ok: false, message: '扫描库存条码' }
          const res = await getContainerByBarcodeApi(trimmed)
          const d = res.data.data!
          if (d.containerStatus !== 'waiting_putaway') {
            return { ok: false, message: '该库存条码不是待上架状态' }
          }
          if (d.inboundTaskId == null || Number(d.inboundTaskId) !== Number(ctx.taskId)) {
            return { ok: false, message: '该库存条码不属于当前收货单' }
          }
          return {
            ok:         true,
            message:    `✓ ${d.productName ?? '商品'}，扫描货架条码`,
            nextStep:   'scan-location',
            context:    { containerId: d.containerId },
          }
        },
      },
      {
        id:          'scan-location',
        label:       '扫描货架条码',
        placeholder: '扫描货架条码',
        barcodeType: 'location',
        handle:      async (raw, ctx) => {
          const trimmed = raw.trim()
          if (!isStrictLocationScan(trimmed)) {
            return { ok: false, message: '扫描货架条码' }
          }
          const parsed = parseBarcode(trimmed)
          if (parsed.type !== 'location') return { ok: false, message: '扫描货架条码' }
          if (!ctx.containerId) return { ok: false, message: '扫描库存条码' }
          const res = await apiClient.get<ApiResponse<LocationInfo>>(`/locations/code/${encodeURIComponent(trimmed)}`)
          const loc = res.data.data!
          await putawayInboundApi(ctx.taskId, { containerId: ctx.containerId, locationId: loc.id })
          await opts?.onAfterPutaway?.()
          return {
            ok:         true,
            message:    `✓ 已上架到 ${loc.code}`,
            nextStep:   'scan-container',
            context:    { containerId: null },
          }
        },
      },
    ],
  }
}
