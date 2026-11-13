/**
 * PDA 上架流程：扫库存条码 → 扫库位条码或输入库位编码 → 提交上架。
 * 库存条码不能只输数字 ID。库位的状态、仓库和范围由后端校验。
 *
 * 定向上架（推荐库位）：扫容器成功后拉取推荐库位（同商品聚集优先，其次空库位），
 * 提示语直接引导去推荐库位；扫到非推荐库位时需再扫一次确认（偏离会记入上架事件，
 * 供后续制定硬性上架规则参考），推荐为空时不做任何拦截。
 */
import type { FlowDef } from '@/hooks/usePdaFlow'
import { parseBarcode } from '@/utils/barcode'
import { ApiClientError, payloadClient as apiClient } from '@/api/client'
import { getLocationByCodeApi } from '@/api/locations'
import { getContainerByBarcodeApi } from '@/api/inventory'
import { putawayInboundApi } from '@/api/inbound-tasks'

const LOCATION_SCAN_HINT = '扫描库位条码或输入库位编码'

interface PutawaySuggestion {
  strategy: 'same_product' | 'empty_location'
  suggestions: Array<{ locationId: number; locationCode: string; containerCount: number }>
}

export interface PutawayFlowContext {
  taskId: number
  containerId: number | null
  suggestedLocations?: Array<{ locationId: number; locationCode: string }> | null
  deviationArmedCode?: string | null
  [key: string]: unknown
}

function isStrictContainerScan(raw: string): boolean {
  return /^(?:I|CNT)\d+$/i.test(raw.trim())
}

export function makePutawayFlow(
  opts?: {
    onAfterPutaway?: () => void | Promise<void>
    submitPutaway?: (payload: {
      taskId: number
      containerId: number
      locationId: number
      deviatedFromSuggestion?: boolean
      suggestedLocationCode?: string
    }) => Promise<void>
  },
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
          const d = await getContainerByBarcodeApi(trimmed, { skipGlobalError: true })
          if (d.containerStatus !== 'waiting_putaway') {
            return { ok: false, message: '该库存条码不是待上架状态' }
          }
          if (d.inboundTaskId == null || Number(d.inboundTaskId) !== Number(ctx.taskId)) {
            return { ok: false, message: '该库存条码不属于当前收货单' }
          }
          // 拉取推荐库位；失败不阻断上架（推荐是辅助，不是硬前提）
          let suggested: Array<{ locationId: number; locationCode: string }> | null = null
          try {
            const sug = await apiClient.get<PutawaySuggestion>(
              `/inbound-tasks/${ctx.taskId}/putaway-suggestion`,
              { params: { containerId: d.containerId }, skipGlobalError: true },
            )
            if (sug.suggestions.length) {
              suggested = sug.suggestions.map(s => ({ locationId: s.locationId, locationCode: s.locationCode }))
            }
          } catch { /* 推荐拉取失败时静默降级为无推荐 */ }
          const hint = suggested?.length ? `建议库位 ${suggested[0].locationCode}，${LOCATION_SCAN_HINT}` : LOCATION_SCAN_HINT
          return {
            ok:         true,
            message:    `✓ ${d.productName ?? '商品'}，${hint}`,
            nextStep:   'scan-location',
            context:    { containerId: d.containerId, suggestedLocations: suggested, deviationArmedCode: null },
          }
        },
      },
      {
        id:          'scan-location',
        label:       '扫描库位条码',
        placeholder: LOCATION_SCAN_HINT,
        barcodeType: 'bin',
        handle:      async (raw, ctx) => {
          const trimmed = raw.trim()
          if (!trimmed) return { ok: false, message: LOCATION_SCAN_HINT }
          if (!ctx.containerId) return { ok: false, message: '扫描库存条码' }
          // 库位一律交给后端按「编码或条码」解析：现场打印出来的库位标签既可能是
          // `R000123` 这样的条码，也可能是库位编码（如 `SH-A01`、`SMK-396842`），
          // 前端再用 R/LOC 前缀卡格式会把历史库位全部挡死（2026-09-17 验收 ISSUE-018）。
          // 归属仓/库状态/范围仍由服务端校验。
          const loc = await getLocationByCodeApi(trimmed).catch((error: unknown) => {
            if (error instanceof ApiClientError && error.status === 404) return null
            throw error
          })
          if (!loc?.id) return { ok: false, message: '未找到库位，请扫描本仓库位条码（如 R000123）或输入库位编码' }

          // 偏离推荐库位：同一库位需连扫两次确认（第一次提示，第二次放行并留痕）
          const suggestions = ctx.suggestedLocations ?? null
          const isSuggested = !suggestions?.length || suggestions.some(s => s.locationId === loc.id)
          const deviated = !isSuggested
          if (deviated && ctx.deviationArmedCode !== loc.code) {
            return {
              ok: false,
              message: `⚠ 与建议库位 ${suggestions![0].locationCode} 不符，确认放到库位 ${loc.code} 请再扫一次`,
              context: { deviationArmedCode: loc.code },
            }
          }

          const payload = {
            taskId: ctx.taskId,
            containerId: ctx.containerId,
            locationId: loc.id,
            ...(deviated ? { deviatedFromSuggestion: true, suggestedLocationCode: suggestions![0].locationCode } : {}),
          }
          if (opts?.submitPutaway) {
            await opts.submitPutaway(payload)
          } else {
            await putawayInboundApi(ctx.taskId, {
              containerId: ctx.containerId,
              locationId: loc.id,
              ...(deviated ? { deviatedFromSuggestion: true, suggestedLocationCode: suggestions![0].locationCode } : {}),
            })
          }
          await opts?.onAfterPutaway?.()
          return {
            ok:         true,
            message:    `✓ 已上架到库位 ${loc.code}`,
            nextStep:   'scan-container',
            context:    { containerId: null, suggestedLocations: null, deviationArmedCode: null },
          }
        },
      },
    ],
  }
}
