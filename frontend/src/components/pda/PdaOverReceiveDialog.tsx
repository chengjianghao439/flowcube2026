/**
 * PdaOverReceiveDialog — 超收确认弹窗（强制选原因码）
 *
 * 取代原来的「再点一次同一个按钮」确认：戴着手套赶工的员工连点两下是本能，
 * 那道闸门形同虚设。超收会随上架自动结算进应付，确认这一下是真花钱的动作，
 * 必须让人停下来看清楚数量和金额，并说明为什么多收——原因码同时给财务留下追溯依据。
 *
 * 交互刻意做成：默认不选中任何原因 + 未选原因时确认按钮禁用，
 * 让「无脑连点」这条路走不通。
 */
import { useState } from 'react'

export const OVER_RECEIVE_REASONS = [
  { code: 'supplier_over_delivery', label: '供应商多发货' },
  { code: 'previous_short_makeup', label: '前次少收，本次补发' },
  { code: 'scan_mistake', label: '扫码/数量录错' },
  { code: 'other', label: '其他（需在备注说明）' },
] as const

export type OverReceiveReasonCode = typeof OVER_RECEIVE_REASONS[number]['code']

interface Props {
  productName: string
  unit: string
  orderedQty: number
  receivedQty: number
  thisQty: number
  overQty: number
  /** 后端按该商品在本任务的最高采购单价估算，拿不到单价时为 null */
  overAmount: number | null
  onCancel: () => void
  onConfirm: (reason: OverReceiveReasonCode) => void
}

export default function PdaOverReceiveDialog({
  productName, unit, orderedQty, receivedQty, thisQty, overQty, overAmount,
  onCancel, onConfirm,
}: Props) {
  const [reason, setReason] = useState<OverReceiveReasonCode | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl bg-background p-4 shadow-xl">
        <div className="text-lg font-semibold text-destructive">确认超收</div>
        <div className="mt-1 text-sm text-muted-foreground">{productName}</div>

        <div className="mt-3 rounded-xl bg-muted/50 p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">应到</span><span className="tabular-nums">{orderedQty} {unit}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">已收</span><span className="tabular-nums">{receivedQty} {unit}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">本次</span><span className="tabular-nums">{thisQty} {unit}</span></div>
          <div className="flex justify-between border-t pt-1 font-semibold text-destructive">
            <span>超收</span><span className="tabular-nums">{overQty} {unit}</span>
          </div>
          {overAmount != null && overAmount > 0 && (
            <div className="flex justify-between font-semibold text-destructive">
              <span>多付货款约</span><span className="tabular-nums">¥{overAmount}</span>
            </div>
          )}
        </div>

        <div className="mt-3 text-sm font-medium">超收原因（必选）</div>
        <div className="mt-2 space-y-2">
          {OVER_RECEIVE_REASONS.map(item => (
            <button
              key={item.code}
              type="button"
              onClick={() => setReason(item.code)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                reason === item.code
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border bg-background'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 rounded-xl border border-border text-base font-medium"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!reason}
            onClick={() => reason && onConfirm(reason)}
            className="h-12 flex-1 rounded-xl bg-destructive text-base font-semibold text-destructive-foreground disabled:opacity-40"
          >
            确认超收登记
          </button>
        </div>
      </div>
    </div>
  )
}
