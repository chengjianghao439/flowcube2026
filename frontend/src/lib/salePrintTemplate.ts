import type { PrintTemplate, TemplateLayout } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'

/** Unmodified 079 system seed; not a replacement for user-selected/default layouts. */
const legacyLayout: TemplateLayout = {
  elements: [
    {"id": "s_title", "type": "title", "fieldKey": "title", "label": "销售订单", "x": 25, "y": 8, "width": 160, "height": 10, "fontSize": 18, "fontWeight": "bold", "textAlign": "center", "border": false},
    {"id": "s_no", "type": "text", "fieldKey": "orderNo", "label": "单据编号", "x": 110, "y": 22, "width": 90, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "right", "border": false},
    {"id": "s_date", "type": "text", "fieldKey": "orderDate", "label": "单据日期", "x": 110, "y": 30, "width": 90, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "right", "border": false},
    {"id": "s_op", "type": "text", "fieldKey": "operator", "label": "经办人", "x": 110, "y": 38, "width": 90, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "right", "border": false},
    {"id": "s_cust", "type": "text", "fieldKey": "customerName", "label": "客户名称", "x": 5, "y": 22, "width": 100, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "left", "border": false},
    {"id": "s_wh", "type": "text", "fieldKey": "warehouseName", "label": "仓库", "x": 5, "y": 30, "width": 100, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "left", "border": false},
    {"id": "s_div1", "type": "divider", "fieldKey": "divider", "label": "分隔线", "x": 5, "y": 47, "width": 198, "height": 3, "fontSize": 10, "fontWeight": "normal", "textAlign": "left", "border": false},
    {"id": "s_rname", "type": "text", "fieldKey": "receiverName", "label": "收货人", "x": 5, "y": 52, "width": 50, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "left", "border": false},
    {"id": "s_rphone", "type": "text", "fieldKey": "receiverPhone", "label": "联系电话", "x": 60, "y": 52, "width": 70, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "left", "border": false},
    {"id": "s_raddr", "type": "text", "fieldKey": "receiverAddress", "label": "收货地址", "x": 5, "y": 60, "width": 198, "height": 6, "fontSize": 9, "fontWeight": "normal", "textAlign": "left", "border": false},
    {"id": "s_div2", "type": "divider", "fieldKey": "divider", "label": "分隔线", "x": 5, "y": 69, "width": 198, "height": 3, "fontSize": 10, "fontWeight": "normal", "textAlign": "left", "border": false},
    {"id": "s_table", "type": "table", "fieldKey": "itemsTable", "label": "商品明细", "x": 5, "y": 74, "width": 198, "height": 100, "fontSize": 9, "fontWeight": "normal", "textAlign": "left", "border": true, "tableColumns": ["code", "name", "unit", "qty", "price", "amount"]},
    {"id": "s_total", "type": "text", "fieldKey": "totalAmount", "label": "金额合计", "x": 120, "y": 178, "width": 83, "height": 8, "fontSize": 12, "fontWeight": "bold", "textAlign": "right", "border": false},
    {"id": "s_remark", "type": "text", "fieldKey": "remark", "label": "备注", "x": 5, "y": 190, "width": 198, "height": 14, "fontSize": 9, "fontWeight": "normal", "textAlign": "left", "border": true}
  ],
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? ''
}

/** Read-only upgrade. Custom templates and old totalAmount gross semantics remain intact. */
export function withSalePrintTotals(template: PrintTemplate): PrintTemplate {
  if (template.type !== 1 || template.paperSize !== 'A4' || template.name !== '默认销售订单模板'
    || template.createdBy !== null || isZplTemplateLayout(template.layout)
    || canonical(template.layout) !== canonical(legacyLayout)) return template
  const total = template.layout.elements.find(element => element.id === 's_total')!
  return { ...template, layout: { ...template.layout, elements: [
    ...template.layout.elements.map(element => element.id === 's_total' ? { ...element, label: '商品金额', fontSize: 10, fontWeight: 'normal' as const }
      : element.id === 's_remark' ? { ...element, y: 210 } : { ...element }),
    { ...total, id: 's_discount', fieldKey: 'discountAmount', label: '折扣金额', y: 188, fontSize: 10, fontWeight: 'normal' },
    { ...total, id: 's_net', fieldKey: 'netAmount', label: '订单金额', y: 198 },
  ] } }
}
