/**
 * PDA 流程配置 — 分拣流程
 *
 * 步骤：
 *  1. scan-product：扫商品码 → 查询目标分拣格
 *  2. scan-bin：扫分拣格码 → 确认放入，上报完成
 */
import type { FlowDef } from '@/hooks/usePdaFlow'
import { scanProductForSortApi } from '@/api/sorting-bins'
import { sortDoneApi } from '@/api/warehouse-tasks'

export interface SortFlowContext {
  binCode:      string
  productName:  string
  qty:          number
  unit:         string
  taskNo:       string
  customerName: string
  taskId:       number
  itemId:       number
}

export const SORT_FLOW: FlowDef<SortFlowContext> = {
  id:          'sort',
  initialStep: 'scan-product',
  steps: [
    {
      id:          'scan-product',
      label:       '扫描商品条码',
      placeholder: '扫描商品条码',
      barcodeType: 'any',
      handle: async (barcode, _ctx) => {
        const res    = await scanProductForSortApi(barcode)
        const result = res.data.data
        if (!result)              return { ok: false, message: '未找到备货中的商品，请确认条码' }
        if (!result.sortingBinCode) return { ok: false, message: `任务 ${result.taskNo} 未分配分拣格` }
        return {
          ok:      true,
          message: `请放入分拣格 ${result.sortingBinCode}`,
          nextStep: 'scan-bin',
          context: {
            binCode:      result.sortingBinCode,
            productName:  result.productName,
            qty:          result.pickedQty,
            unit:         result.unit,
            taskNo:       result.taskNo,
            customerName: result.customerName,
            taskId:       result.taskId,
            itemId:       result.itemId,
          },
        }
      },
    },
    {
      id:          'scan-bin',
      label:       '扫描分拣格确认',
      placeholder: '扫描分拣格条码',
      barcodeType: 'bin',
      handle: async (barcode, ctx) => {
        if (barcode.toUpperCase() !== ctx.binCode.toUpperCase()) {
          return { ok: false, message: `错误！请放入 ${ctx.binCode}，当前是 ${barcode}` }
        }
        const res    = await sortDoneApi(ctx.taskId, [{ itemId: ctx.itemId, sortedQty: ctx.qty }])
        const result = res.data.data
        const msg    = result?.allSorted
          ? `✓ 任务 ${ctx.taskNo} 分拣全部完成！`
          : `✓ 已放入 ${ctx.binCode}（${result?.progress ?? '?'}）`
        return {
          ok:      true,
          message: msg,
          nextStep: result?.allSorted ? '__done__' : 'scan-product',
        }
      },
    },
  ],
}
