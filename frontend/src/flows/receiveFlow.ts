/**
 * PDA 收货流程：扫采购单号 → 扫产品 → 输入本箱数量 → 提交生成待上架库存条码并排队打印标签
 */
import type { FlowDef } from '@/hooks/usePdaFlow'
import { parseBarcode } from '@/utils/barcode'
import { receiveInboundApi } from '@/api/inbound-tasks'
import type { InboundTaskItem } from '@/types/inbound-tasks'

export interface ReceiveFlowContext {
  taskId: number
  purchaseOrderNo: string | null
  taskNo: string
  items: InboundTaskItem[]
  productId: number | null
  productName: string | null
  productCode: string | null
}

function remainForProduct(items: InboundTaskItem[], productId: number): number {
  return items
    .filter(i => i.productId === productId)
    .reduce((s, i) => s + Math.max(0, i.orderedQty - i.receivedQty), 0)
}

/** 与后端 distributeQtyToLines 一致：按行 id 顺序分摊本箱数量 */
function applyReceiveToItems(items: InboundTaskItem[], productId: number, qty: number): InboundTaskItem[] {
  const next = items.map(i => ({ ...i }))
  let left = qty
  const lineEntries = next
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => i.productId === productId && i.receivedQty < i.orderedQty)
    .sort((a, b) => a.i.id - b.i.id)
  for (const { idx } of lineEntries) {
    if (left <= 0) break
    const i = next[idx]
    const cap = i.orderedQty - i.receivedQty
    const add = Math.min(left, cap)
    next[idx] = { ...i, receivedQty: i.receivedQty + add }
    left -= add
  }
  return next
}

export function makeReceiveFlow(opts?: {
  onPackageReceived?: () => void | Promise<void>
}): FlowDef<ReceiveFlowContext> {
  return {
    id:          'inbound-receive',
    initialStep: 'scan-po',
    steps: [
      {
        id:          'scan-po',
        label:       '扫描采购单',
        placeholder: '扫描采购单号或任务号',
        barcodeType: 'any',
        handle:      async (barcode, ctx) => {
          const raw = barcode.trim()
          const okPo = ctx.purchaseOrderNo && (raw === ctx.purchaseOrderNo || raw.toUpperCase() === String(ctx.purchaseOrderNo).toUpperCase())
          const okTask = raw.toUpperCase() === ctx.taskNo.toUpperCase() || raw === ctx.taskNo
          if (!okPo && !okTask) {
            return { ok: false, message: `单号不匹配（期望 ${ctx.purchaseOrderNo ?? '—'} / ${ctx.taskNo}）` }
          }
          return { ok: true, message: '✓ 单据已确认', nextStep: 'scan-product' }
        },
      },
      {
        id:          'scan-product',
        label:       '扫描产品',
        placeholder: '扫描产品条码',
        barcodeType: 'product',
        handle:      async (raw, ctx) => {
          const parsed = parseBarcode(raw)
          if (parsed.type !== 'product' && parsed.type !== 'unknown') {
            return { ok: false, message: '请扫描产品条码' }
          }
          const item = ctx.items.find(i =>
            i.productCode === raw ||
            i.productCode === raw.toUpperCase() ||
            `PRD${i.productCode}` === raw.toUpperCase(),
          )
          if (!item) return { ok: false, message: `商品不在本收货单：${raw}` }
          const remain = remainForProduct(ctx.items, item.productId)
          if (remain <= 0) {
            return { ok: false, message: `${item.productName} 已收货完成` }
          }
          return {
            ok:         true,
            message:    `✓ ${item.productName}，剩余 ${remain}，请输入本箱数量`,
            nextStep:   'input-qty',
            context:    {
              productId: item.productId, productName: item.productName, productCode: item.productCode,
            },
          }
        },
      },
      {
        id:          'input-qty',
        label:       '本箱数量',
        placeholder: '输入本箱数量后回车（逐箱收货）',
        barcodeType: 'any',
        handle:      async (barcode, ctx) => {
          const qty = Number(String(barcode).trim().replace(/,/g, '.'))
          if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: '请输入大于 0 的本箱数量' }
          if (!ctx.productId) return { ok: false, message: '请先扫描商品' }
          const remain = remainForProduct(ctx.items, ctx.productId)
          if (qty > remain) return { ok: false, message: `超出待收（本单该 SKU 剩余 ${remain}）` }
          const res = await receiveInboundApi(ctx.taskId, { productId: ctx.productId, qty })
          const pkg = res.data.data
          await opts?.onPackageReceived?.()
          const nextItems = applyReceiveToItems(ctx.items, ctx.productId, qty)
          const afterRemain = remainForProduct(nextItems, ctx.productId)
          const code = pkg?.containerCode ?? '—'
          const printHint = pkg?.printJobId ? '已加入打印队列' : '（未配置标签打印机则跳过打印）'
          return {
            ok:         true,
            message:    `✓ 库存条码 ${code}，${printHint}${afterRemain > 0 ? ` · 该 SKU 还剩 ${afterRemain}` : ' · 该 SKU 已收货完成'}`,
            nextStep:   'scan-product',
            context:    {
              items:       nextItems,
              productId:   null,
              productName: null,
              productCode: null,
            },
          }
        },
      },
    ],
  }
}
