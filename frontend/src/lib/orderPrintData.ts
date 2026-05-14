/**
 * 订单打印数据适配器
 * 将各订单类型的数据映射为 TemplateRenderer 所需的 data map + items 数组
 */

import { formatDisplayDateTime, formatDisplayDate } from '@/lib/dateTime'
import type { PrintItem } from '@/components/print/TemplateRenderer'
import type { SaleOrder } from '@/types/sale'
import type { PurchaseOrder } from '@/types/purchase'
import type { InboundTask } from '@/types/inbound-tasks'

// ─── 销售单 ─────────────────────────────────────────────────────────────────

export function mapSaleOrderToPrint(order: SaleOrder): { data: Record<string, string>; items: PrintItem[] } {
  return {
    data: {
      title:           '销售订单',
      orderNo:         order.orderNo ?? '',
      customerName:    order.customerName ?? '',
      supplierName:    '',
      orderDate:       formatDisplayDate(order.saleDate || order.createdAt, ''),
      warehouseName:   order.warehouseName ?? '',
      salesperson:     order.operatorName ?? '',
      receiverName:    order.receiverName ?? '',
      receiverPhone:   order.receiverPhone ?? '',
      receiverAddress: order.receiverAddress ?? '',
      totalAmount:     `¥ ${Number(order.totalAmount ?? 0).toFixed(2)}`,
      remark:          order.remark ?? '',
      operator:        order.operatorName ?? '',
      printDate:       formatDisplayDateTime(new Date()),
    },
    items: (order.items ?? []).map(it => ({
      productCode: it.productCode,
      productName: it.productName,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      amount: Number(it.amount),
    })),
  }
}

// ─── 采购单 ─────────────────────────────────────────────────────────────────

export function mapPurchaseOrderToPrint(order: PurchaseOrder): { data: Record<string, string>; items: PrintItem[] } {
  return {
    data: {
      title:           '采购订单',
      orderNo:         order.orderNo ?? '',
      customerName:    '',
      supplierName:    order.supplierName ?? '',
      orderDate:       formatDisplayDate(order.expectedDate || order.createdAt, ''),
      warehouseName:   order.warehouseName ?? '',
      salesperson:     order.operatorName ?? '',
      receiverName:    '',
      receiverPhone:   '',
      receiverAddress: '',
      totalAmount:     `¥ ${Number(order.totalAmount ?? 0).toFixed(2)}`,
      remark:          order.remark ?? '',
      operator:        order.operatorName ?? '',
      printDate:       formatDisplayDateTime(new Date()),
    },
    items: (order.items ?? []).map(it => ({
      productCode: it.productCode,
      productName: it.productName,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      amount: Number(it.amount),
    })),
  }
}

// ─── 收货订单 ───────────────────────────────────────────────────────────────

export function mapInboundTaskToPrint(task: InboundTask): { data: Record<string, string>; items: PrintItem[] } {
  return {
    data: {
      title:           '收货订单',
      orderNo:         task.taskNo ?? '',
      customerName:    '',
      supplierName:    task.supplierName ?? '',
      orderDate:       formatDisplayDate(task.createdAt, ''),
      warehouseName:   task.warehouseName ?? '',
      salesperson:     task.operatorName ?? '',
      receiverName:    '',
      receiverPhone:   '',
      receiverAddress: '',
      totalAmount:     '',
      remark:          task.purchaseOrderNo ? `采购单：${task.purchaseOrderNo}` : '混合采购',
      operator:        task.operatorName ?? '',
      printDate:       formatDisplayDateTime(new Date()),
    },
    items: (task.items ?? []).map(it => ({
      productCode: it.productCode ?? '',
      productName: it.productName ?? '',
      unit: it.unit ?? '',
      quantity: it.orderedQty ?? 0,
      unitPrice: 0,
      amount: 0,
    })),
  }
}

// ─── 退货单（通用） ─────────────────────────────────────────────────────────

interface ReturnOrderLike {
  orderNo?: string
  type?: string
  supplierName?: string
  customerName?: string
  warehouseName?: string
  totalAmount?: number
  operatorName?: string
  remark?: string
  createdAt?: string
  statusName?: string
  items?: Array<{
    productCode?: string
    productName?: string
    unit?: string
    quantity?: number
    unitPrice?: number
    amount?: number
  }>
}

export function mapReturnOrderToPrint(order: ReturnOrderLike): { data: Record<string, string>; items: PrintItem[] } {
  const typeLabel = order.type === 'purchase' ? '采购退货单' : '销售退货单'
  return {
    data: {
      title:           typeLabel,
      orderNo:         order.orderNo ?? '',
      customerName:    order.customerName ?? '',
      supplierName:    order.supplierName ?? '',
      orderDate:       formatDisplayDate(order.createdAt, ''),
      warehouseName:   order.warehouseName ?? '',
      salesperson:     order.operatorName ?? '',
      receiverName:    '',
      receiverPhone:   '',
      receiverAddress: '',
      totalAmount:     order.totalAmount != null ? `¥ ${Number(order.totalAmount).toFixed(2)}` : '',
      remark:          order.remark ?? '',
      operator:        order.operatorName ?? '',
      printDate:       formatDisplayDateTime(new Date()),
    },
    items: (order.items ?? []).map(it => ({
      productCode: it.productCode ?? '',
      productName: it.productName ?? '',
      unit: it.unit ?? '',
      quantity: it.quantity ?? 0,
      unitPrice: Number(it.unitPrice ?? 0),
      amount: Number(it.amount ?? 0),
    })),
  }
}
