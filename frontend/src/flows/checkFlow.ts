/**
 * PDA 流程配置 — 复核流程
 *
 * 步骤：扫描拣货时使用的库存条码 → 后端按库存单元确认复核量；全部库存单元确认后任务进入待打包
 */
import type { FlowDef } from '@/hooks/usePdaFlow'
import { submitCheckScanApi } from '@/api/warehouse-tasks'
import type { WarehouseTask } from '@/api/warehouse-tasks'

export interface CheckFlowContext {
  task: WarehouseTask | null
}

export const CHECK_FLOW: FlowDef<CheckFlowContext> = {
  id:          'check',
  initialStep: 'scan-container',
  steps: [
    {
      id:          'scan-container',
      label:       '扫描库存条码',
      placeholder: '扫描库存条码',
      barcodeType: 'container',
      handle: async (barcode, ctx) => {
        const { task } = ctx
        if (!task) return { ok: false, message: '请先选择任务' }

        try {
          const res = await submitCheckScanApi(task.id, barcode.trim())
          const payload = res.data.data
          const allChecked = payload?.allChecked ?? false
          if (allChecked) {
            return { ok: true, message: '✓ 全部复核完成！', nextStep: '__done__', context: {} }
          }
          return { ok: true, message: `✓ 已记录复核扫码`, context: {} }
        } catch (e: unknown) {
          const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
            ?? (e instanceof Error ? e.message : '复核扫码失败')
          return { ok: false, message: msg }
        }
      },
    },
  ],
}
