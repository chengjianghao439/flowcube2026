/**
 * 销售订单打印入口。
 *
 * PrintPreviewOverlay — 全屏打印预览遮罩（portal）：
 *   1. 从数据库读取「销售订单」(type=1) 的打印模板列表，可在工具栏切换模板。
 *   2. 用 TemplateRenderer 将 layout_json + 订单数据渲染成真实预览。
 *   3. 点击「打印」调用 window.print()，@media print 只显示纸张区域。
 */

import { OrderPrintOverlay } from './OrderPrintOverlay'
import { mapSaleOrderToPrint } from '@/lib/orderPrintData'
import type { SaleOrder } from '@/types/sale'

interface OverlayProps {
  order:   SaleOrder
  onClose: () => void
}

export function PrintPreviewOverlay({ order, onClose }: OverlayProps) {
  const { data, items } = mapSaleOrderToPrint(order)
  return (
    <OrderPrintOverlay
      templateType={1}
      title={order.orderNo}
      data={data}
      items={items}
      onClose={onClose}
    />
  )
}
