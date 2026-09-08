import type { SaleOrder } from '@/types/sale'
import type { PurchaseOrder } from '@/types/purchase'
import type { WarehouseTask } from '@/api/warehouse-tasks'
import type { TemplateElement, TemplateType } from '@/types/print-template'
import { DEFAULT_LABEL_ELEMENTS } from '@/constants/printFieldDefs'
import { mapSaleOrderToPrint, mapPurchaseOrderToPrint, mapReturnOrderToPrint } from './orderPrintData'
import { formatDisplayDate, formatDisplayDateTime } from './dateTime'

type PreviewSource =
  | { kind: 'label'; data: Record<string, string | number | null> }
  | { kind: 'sale'; record: SaleOrder }
  | { kind: 'purchase'; record: PurchaseOrder }
  | { kind: 'return'; record: Parameters<typeof mapReturnOrderToPrint>[0] & { returnNo?: string } }
  | { kind: 'warehouse-task'; record: WarehouseTask }
export type PrintTemplatePreview = PreviewSource & { type: TemplateType; sourceLabel: string }
export type PreviewTableRow = Record<string, string>

export function adaptTemplatePreview(source: PrintTemplatePreview): { data: Record<string, string>; items: PreviewTableRow[] } {
  if (source.kind === 'label') return { data: Object.fromEntries(Object.entries(source.data).map(([key, value]) => [key, String(value ?? '')])), items: [] }
  if (source.kind === 'warehouse-task') {
    const task = source.record
    return {
      data: { title: '仓库任务单', orderNo: task.taskNo, customerName: task.customerName ?? '', warehouseName: task.warehouseName ?? '', orderDate: formatDisplayDate(task.createdAt, ''), operator: task.assignedName ?? '', remark: task.remark ?? '', printDate: formatDisplayDateTime(new Date()) },
      items: (task.items ?? []).map(it => ({ articleNo: it.articleNumber ?? '', code: it.productCode, name: it.productName, spec: it.spec ?? '', color: it.color ?? '', unit: it.unit, qty: String(it.requiredQty), price: '', amount: '', remark: '' })),
    }
  }
  const mapped = source.kind === 'sale' ? mapSaleOrderToPrint(source.record)
    : source.kind === 'purchase' ? mapPurchaseOrderToPrint(source.record)
      : mapReturnOrderToPrint({ ...source.record, orderNo: source.record.returnNo ?? source.record.orderNo })
  return {
    data: mapped.data,
    items: mapped.items.map(it => ({ articleNo: it.articleNumber ?? '', code: it.productCode, name: it.productName, spec: it.spec ?? '', color: it.color ?? '', unit: it.unit, qty: String(it.quantity), price: Number(it.unitPrice).toFixed(2), amount: Number(it.amount).toFixed(2), remark: it.remark ?? '' })),
  }
}

/** 只在初始空画布已取到真实记录时提供排版起点，元素始终保存字段引用。 */
export function defaultPreviewElements(type: TemplateType, widthMm = 210, heightMm = 297): TemplateElement[] {
  if (type >= 5) return DEFAULT_LABEL_ELEMENTS[type].map(el => ({ ...el, x: el.x * widthMm / 75, y: el.y * heightMm / 50, width: el.width * widthMm / 75, height: el.height * heightMm / 50 }))
  const fullWidth = widthMm - 20
  const halfWidth = (fullWidth - 10) / 2
  const rightX = 20 + halfWidth
  const tableHeight = Math.min(110, heightMm - 88)
  const field = (fieldKey: string, label: string, y: number, x = 10, width = halfWidth): TemplateElement => ({ id: `real-${type}-${fieldKey}`, type: 'text', fieldKey, label, x, y, width, height: 8, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false })
  return [
    { ...field('title', '单据', 10, 10, fullWidth), type: 'title', height: 12, fontSize: 18, textAlign: 'center' },
    field('orderNo', '单据编号', 28), field('orderDate', '单据日期', 28, rightX),
    field(type === 2 ? 'supplierName' : 'customerName', type === 2 ? '供应商' : '客户', 38), field('warehouseName', '仓库', 38, rightX),
    { ...field('itemsTable', '商品明细', 52, 10, fullWidth), type: 'table', height: tableHeight, tableColumns: ['code', 'name', 'spec', 'unit', 'qty', ...(type === 4 ? [] : ['price', 'amount'])] },
    field('remark', '备注', 60 + tableHeight, 10, fullWidth),
  ]
}
