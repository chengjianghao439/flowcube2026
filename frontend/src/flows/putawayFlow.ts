/**
 * PDA 上架流程（强制扫码）：扫箱码 CNT → 扫上架库位 LOC → 调用入库任务上架接口
 * 禁止仅输入数字箱码 ID；库位须为 LOC 格式并由后端校验启用/同仓
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
  return /^CNT\d+$/i.test(raw.trim())
}

function isStrictLocationScan(raw: string): boolean {
  return /^LOC[-A-Z0-9]+$/i.test(raw.trim())
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
        label:       '扫描待上架箱码（CNT）',
        placeholder: '请扫箱码，如 CNT123456',
        barcodeType: 'container',
        handle:      async (raw, ctx) => {
          const trimmed = raw.trim()
          if (/^\d+$/.test(trimmed)) {
            return { ok: false, message: '禁止仅输入数字 ID，请扫描完整箱码（CNT+数字）' }
          }
          if (!isStrictContainerScan(trimmed)) {
            return { ok: false, message: '请扫描箱码：必须以 CNT 开头（例如 CNT123456）' }
          }
          const parsed = parseBarcode(trimmed)
          if (parsed.type !== 'container') return { ok: false, message: '请扫描箱码（CNT）' }
          const res = await getContainerByBarcodeApi(trimmed)
          const d = res.data.data!
          if (d.containerStatus !== 'waiting_putaway') {
            return { ok: false, message: '该箱码不是待上架状态' }
          }
          if (d.inboundTaskId == null || Number(d.inboundTaskId) !== Number(ctx.taskId)) {
            return { ok: false, message: '该箱码不属于当前收货单' }
          }
          return {
            ok:         true,
            message:    `✓ ${d.productName ?? '商品'} 箱码已识别，请扫描上架库位（LOC）`,
            nextStep:   'scan-location',
            context:    { containerId: d.containerId },
          }
        },
      },
      {
        id:          'scan-location',
        label:       '扫描上架库位（LOC）',
        placeholder: '请扫上架库位条码，如 LOC-A01-01-01',
        barcodeType: 'location',
        handle:      async (raw, ctx) => {
          const trimmed = raw.trim()
          if (!isStrictLocationScan(trimmed)) {
            return { ok: false, message: '请扫描上架库位条码：LOC 开头格式（如 LOC-A01-01-01）' }
          }
          const parsed = parseBarcode(trimmed)
          if (parsed.type !== 'location') return { ok: false, message: '请扫描上架库位条码（LOC）' }
          if (!ctx.containerId) return { ok: false, message: '请先扫描箱码' }
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
