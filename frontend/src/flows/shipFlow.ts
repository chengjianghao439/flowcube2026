/**
 * PDA 流程配置 — 出库确认流程
 *
 * 使用 usePdaFlow 驱动，替代 ship.tsx 中的手写逻辑
 * 演示：如何用流程引擎配置一个「扫物流条码 → 自动出库」流程
 */
import type { FlowDef } from '@/hooks/usePdaFlow'
import { getPackageByBarcodeApi } from '@/api/packages'
import { shipTaskApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import type { PackageShipInfo } from '@/api/packages'

export interface ShipFlowContext {
  info: PackageShipInfo | null
}

export const SHIP_FLOW: FlowDef<ShipFlowContext> = {
  id:          'ship',
  initialStep: 'scan-box',
  steps: [
    {
      id:          'scan-box',
      label:       '扫描物流条码',
      placeholder: '扫描物流条码 BOXxxxxxx',
      barcodeType: 'box',
      handle: async (barcode, _ctx) => {
        const res  = await getPackageByBarcodeApi(barcode)
        const data = res.data.data!
        if (data.taskStatus === WT_STATUS.SHIPPED)   return { ok: false, message: '该订单已完成出库' }
        if (data.taskStatus === WT_STATUS.CANCELLED) return { ok: false, message: '该任务已取消' }
        // 自动触发出库
        await shipTaskApi(data.warehouseTaskId)
        return {
          ok:       true,
          message:  `✓ 出库成功！${data.taskNo}`,
          nextStep: '__done__',
          context:  { info: data },
        }
      },
    },
  ],
}
