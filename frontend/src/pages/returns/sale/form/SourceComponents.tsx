import { Button } from '@/components/ui/button'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { ReturnSourceLabels, ReturnSourceOrderItem } from '@/api/returns'
import { returnNet } from './returnSourcePresentation'
export function SourceLabel({
  source
}: {
  source: ReturnSourceLabels | ReturnSourceOrderItem | null | undefined
}) {
  if (!source) return <span>原来源身份待核对</span>
  return (
    <span>
      {source.taskNo || `原任务 #${source.taskId}`} ·{' '}
      {source.kind === 'kit'
        ? `${source.kitCode || ''} ${source.kitName || '原套'}`
        : '原普通成交行'}{' '}
      · 成交行 {source.lineKey} ·{' '}
      {source.warehouseName || `仓库 #${source.warehouseId}`} ·{' '}
      {source.confirmedAt
        ? formatDisplayDateTime(source.confirmedAt)
        : '原确认时间待核对'}
    </span>
  )
}
export function SourceComponents({
  items,
  disabled,
  onSelect
}: {
  items: ReturnSourceOrderItem[]
  disabled: boolean
  onSelect: (item: ReturnSourceOrderItem) => void
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <p className="px-3 py-2 text-xs text-muted-foreground">
        请选择本次实际退回的原出库配件。同商品、同仓库的不同来源需分单，不合并平均价。来源全量参考不代表本次退款，本次金额以保存后服务端估算为准，合格入仓后确定。
      </p>
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-y bg-muted/30 text-xs">
            <th className="p-2 text-left">原成交行 / 实发批次 / 配件</th>
            <th className="p-2 text-right">原发 / 已申请 / 可申请</th>
            <th className="p-2 text-right">原分摊毛预算</th>
            <th className="p-2 text-right">来源全量折后参考</th>
            <th className="p-2 text-right">来源累计实际合格 / 毛额 / 净额</th>
            <th className="p-2">选择</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.dispatchComponentId}
              className="border-b last:border-b-0"
            >
              <td className="p-2">
                <p className="font-medium">
                  {item.productCode} · {item.productName}
                </p>
                <p className="text-xs text-muted-foreground">
                  <SourceLabel source={item} />
                </p>
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.sourceQuantity} / {item.returnedQty} / {item.remainingQty}{' '}
                {item.unit}
              </td>
              <td className="p-2 text-right tabular-nums">
                {Number(item.sourceBudgetAmount).toFixed(2)}
              </td>
              <td className="p-2 text-right tabular-nums">
                {returnNet(item.sourceFinancialEstimate ?? 0)}
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.actualQualifiedQty ?? 0} /{' '}
                {Number(item.actualRefundGross ?? 0).toFixed(2)} /{' '}
                {returnNet(item.actualRefundAmount ?? 0)}
              </td>
              <td className="p-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || item.remainingQty <= 0}
                  onClick={() => onSelect(item)}
                >
                  选择 {item.taskNo || `#${item.taskId}`} ·{' '}
                  {item.kitName || '普通成交行'} · {item.productName}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
