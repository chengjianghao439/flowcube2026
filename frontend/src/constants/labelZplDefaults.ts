/**
 * 标签模板默认画布（与 backend migrate 种子一致）。
 * type：5 货架条码 6 库存条码 7 物流条码 8 产品条码 9 塑料盒条码
 */

import type { TemplateElement } from '@/types/print-template'

export const DEFAULT_LABEL_ELEMENTS: Record<number, TemplateElement[]> = {
  5: [
    { id: 'lb5_bc', type: 'barcode', fieldKey: 'rack_barcode', label: '货架条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb5_rc', type: 'text', fieldKey: 'rack_code', label: '货架编码', x: 4, y: 22, width: 72, height: 7, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb5_z', type: 'text', fieldKey: 'zone', label: '库区', x: 4, y: 32, width: 72, height: 7, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb5_n', type: 'text', fieldKey: 'name', label: '名称', x: 4, y: 41, width: 72, height: 14, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  6: [
    { id: 'lb6_bc', type: 'barcode', fieldKey: 'container_code', label: '库存条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb6_pn', type: 'text', fieldKey: 'product_name', label: '品名', x: 4, y: 22, width: 72, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb6_q', type: 'text', fieldKey: 'qty', label: '数量', x: 4, y: 36, width: 72, height: 7, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  7: [
    { id: 'lb7_bc', type: 'barcode', fieldKey: 'box_code', label: '物流条码', x: 4, y: 3, width: 72, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_tn', type: 'text', fieldKey: 'task_no', label: '任务号', x: 4, y: 18, width: 72, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_cn', type: 'text', fieldKey: 'customer_name', label: '客户', x: 4, y: 25, width: 40, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_ca', type: 'text', fieldKey: 'carrier_name', label: '快递', x: 44, y: 25, width: 32, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_ft', type: 'text', fieldKey: 'freight_type_name', label: '运费', x: 4, y: 32, width: 40, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_pc', type: 'text', fieldKey: 'piece_count', label: '件数', x: 44, y: 32, width: 32, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_il', type: 'text', fieldKey: 'item_list', label: '装箱内容', x: 4, y: 40, width: 72, height: 12, fontSize: 7, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  8: [
    { id: 'lb8_bc', type: 'barcode', fieldKey: 'product_code', label: '产品条码', x: 4, y: 4, width: 72, height: 14, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb8_pn', type: 'text', fieldKey: 'product_name', label: '产品名称', x: 4, y: 22, width: 72, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb8_sp', type: 'text', fieldKey: 'spec', label: '规格', x: 4, y: 36, width: 72, height: 7, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  9: [
    { id: 'lb9_bc', type: 'barcode', fieldKey: 'container_code', label: '塑料盒条码', x: 4, y: 4, width: 72, height: 16, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb9_pn', type: 'text', fieldKey: 'product_name', label: '品名', x: 4, y: 24, width: 72, height: 12, fontSize: 11, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
}

/** 画布预览用示例数据（与打印变量一致） */
export const LABEL_PREVIEW_SAMPLE: Record<number, Record<string, string>> = {
  5: { rack_barcode: 'H000001', rack_code: 'A-01-02', zone: 'A区', name: '主通道货架' },
  6: { container_code: 'I000123', product_name: '示例商品', qty: '12' },
  7: { box_code: 'L000001', task_no: 'WT202403010001', customer_name: '某某客户', carrier_name: '顺丰速运', freight_type_name: '寄付', piece_count: '3 件', item_list: '商品A×2, 商品B×1' },
  8: { product_code: 'SP0001', product_name: '示例 SKU', spec: '500g' },
  9: { container_code: 'B000456', product_name: '零散商品' },
}
