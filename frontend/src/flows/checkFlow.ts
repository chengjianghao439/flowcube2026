/**
 * PDA 流程配置 — 复核流程
 *
 * 步骤：扫商品码 → 自动填入已拣数量 → 全部完成自动提交
 */
import type { FlowDef } from '@/hooks/usePdaFlow'
import { checkTaskItemsApi, checkDoneApi } from '@/api/warehouse-tasks'
import type { WarehouseTask, WarehouseTaskItem } from '@/api/warehouse-tasks'

export interface CheckFlowContext {
  task:       WarehouseTask | null
  items:      WarehouseTaskItem[]
  checkedMap: Record<number, number>
}

export const CHECK_FLOW: FlowDef<CheckFlowContext> = {
  id:          'check',
  initialStep: 'scan-product',
  steps: [
    {
      id:          'scan-product',
      label:       '扫描商品条码',
      placeholder: '扫描商品条码 PRDxxxxxx',
      barcodeType: 'product',
      handle: async (barcode, ctx) => {
        const { task, items, checkedMap } = ctx
        if (!task) return { ok: false, message: '请先选择任务' }

        const item = items.find(i =>
          i.productCode === barcode ||
          `PRD${i.productCode}` === barcode.toUpperCase() ||
          i.productCode === barcode.replace(/^PRD/i, '')
        )
        if (!item) return { ok: false, message: `商品 ${barcode} 不在此任务中` }

        const newMap = { ...checkedMap, [item.id]: item.requiredQty }
        const allDone = items.every(i => (newMap[i.id] ?? 0) >= i.requiredQty)

        if (allDone) {
          await checkTaskItemsApi(task.id, items.map(i => ({ itemId: i.id, checkedQty: newMap[i.id] ?? 0 })))
          await checkDoneApi(task.id)
          return { ok: true, message: '✓ 全部复核完成！', nextStep: '__done__', context: { checkedMap: newMap } }
        }

        const remaining = items.filter(i => (newMap[i.id] ?? 0) < i.requiredQty).length
        return {
          ok: true,
          message: `✓ ${item.productName} 已复核，还剩 ${remaining} 种`,
          context: { checkedMap: newMap },
        }
      },
    },
  ],
}
