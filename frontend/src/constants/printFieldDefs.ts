/**
 * 打印模板字段单一事实源。
 *
 * 收敛散落在 editor.tsx / labelZplDefaults.ts 里的字段元数据：
 *   - 编辑器「字段面板」可拖拽字段
 *   - 编辑器预览示例数据
 *   - 新建标签模板的默认画布元素
 *   - 单据明细表格的列选项
 *
 * 修改打印变量时（例如后端 enqueue*LabelJob 新增一个变量），只改本文件即可，
 * 字段面板与预览数据会自动跟随，避免漏改一处导致「字段拖不出来 / 预览空白」。
 *
 * 对照后端变量来源（backend/src/modules/print-jobs/print-jobs.label-command.js）：
 *   type 5 货架:  rack_barcode, rack_code, zone, name
 *   type 6 库存:  container_code, product_name, qty
 *   type 7 物流:  box_code, task_no, customer_name, carrier_name, freight_type_name, piece_count, summary, item_list
 *   type 8 产品:  product_code, product_name, spec, unit, price
 *   type 9 塑料盒: container_code, product_name
 *   type 10 库位: location_barcode, location_code, zone, name
 */

import type { TemplateElement } from '@/types/print-template'

/** 可拖拽字段定义：编辑器字段面板 + 拖入画布时的默认尺寸（图标由编辑器按 type 映射） */
export interface PrintFieldDef {
  key: string
  label: string
  type: 'text' | 'table' | 'divider' | 'title' | 'barcode' | 'image'
  defaultW?: number // mm
  defaultH?: number // mm
}

/** 单据类字段（type 1–4）——标题 / 分隔线 / 文本字段 / 明细表格 */
export const DOC_FIELD_DEFS: PrintFieldDef[] = [
  // 标题 / 分隔
  { key: 'title', label: '大标题', type: 'title', defaultW: 160, defaultH: 10 },
  { key: 'divider', label: '分隔线', type: 'divider', defaultW: 160, defaultH: 4 },
  // 公司 Logo（image）：src 固定取自系统设置 → 品牌标识（字段键 companyLogo）
  { key: 'companyLogo', label: '公司 Logo', type: 'image', defaultW: 40, defaultH: 12 },
  // 文本字段
  { key: 'orderNo', label: '单据编号', type: 'text', defaultW: 80, defaultH: 7 },
  { key: 'customerName', label: '客户名称', type: 'text', defaultW: 80, defaultH: 7 },
  { key: 'supplierName', label: '供应商', type: 'text', defaultW: 80, defaultH: 7 },
  { key: 'orderDate', label: '单据日期', type: 'text', defaultW: 60, defaultH: 7 },
  { key: 'warehouseName', label: '仓库', type: 'text', defaultW: 60, defaultH: 7 },
  { key: 'salesperson', label: '业务员', type: 'text', defaultW: 50, defaultH: 7 },
  { key: 'receiverName', label: '收货人', type: 'text', defaultW: 60, defaultH: 7 },
  { key: 'receiverPhone', label: '联系电话', type: 'text', defaultW: 70, defaultH: 7 },
  { key: 'receiverAddress', label: '收货地址', type: 'text', defaultW: 130, defaultH: 7 },
  { key: 'totalAmount', label: '金额合计', type: 'text', defaultW: 70, defaultH: 7 },
  { key: 'remark', label: '备注', type: 'text', defaultW: 130, defaultH: 12 },
  { key: 'operator', label: '经办人', type: 'text', defaultW: 50, defaultH: 7 },
  { key: 'printDate', label: '打印日期', type: 'text', defaultW: 60, defaultH: 7 },
  // 表格
  { key: 'itemsTable', label: '商品明细', type: 'table', defaultW: 170, defaultH: 50 },
]

/** 各标签类型可拖拽字段（type 5–9），与后端 enqueue*LabelJob 提供变量一致 */
export const LABEL_FIELD_DEFS_BY_TYPE: Record<number, PrintFieldDef[]> = {
  5: [
    { key: 'rack_barcode', label: '货架条码', type: 'barcode', defaultW: 72, defaultH: 14 },
    { key: 'rack_code', label: '货架编码', type: 'text', defaultW: 72, defaultH: 7 },
    { key: 'zone', label: '库区', type: 'text', defaultW: 72, defaultH: 7 },
    { key: 'name', label: '名称', type: 'text', defaultW: 72, defaultH: 8 },
  ],
  6: [
    { key: 'container_code', label: '库存条码', type: 'barcode', defaultW: 72, defaultH: 14 },
    { key: 'product_name', label: '品名', type: 'text', defaultW: 72, defaultH: 10 },
    { key: 'qty', label: '数量', type: 'text', defaultW: 72, defaultH: 7 },
  ],
  7: [
    { key: 'box_code', label: '物流条码', type: 'barcode', defaultW: 72, defaultH: 12 },
    { key: 'task_no', label: '任务号', type: 'text', defaultW: 72, defaultH: 6 },
    { key: 'customer_name', label: '客户', type: 'text', defaultW: 40, defaultH: 6 },
    { key: 'carrier_name', label: '快递', type: 'text', defaultW: 32, defaultH: 6 },
    { key: 'freight_type_name', label: '运费方式', type: 'text', defaultW: 32, defaultH: 6 },
    { key: 'piece_count', label: '件数', type: 'text', defaultW: 32, defaultH: 6 },
    { key: 'summary', label: '行数/件数摘要', type: 'text', defaultW: 32, defaultH: 6 },
    { key: 'item_list', label: '装箱内容', type: 'text', defaultW: 72, defaultH: 12 },
  ],
  8: [
    { key: 'product_code', label: '产品条码', type: 'barcode', defaultW: 72, defaultH: 14 },
    { key: 'product_name', label: '产品名称', type: 'text', defaultW: 72, defaultH: 10 },
    { key: 'spec', label: '型号', type: 'text', defaultW: 72, defaultH: 7 },
    { key: 'unit', label: '单位', type: 'text', defaultW: 24, defaultH: 6 },
    { key: 'price', label: '售价', type: 'text', defaultW: 40, defaultH: 6 },
  ],
  9: [
    { key: 'container_code', label: '塑料盒条码', type: 'barcode', defaultW: 72, defaultH: 16 },
    { key: 'product_name', label: '品名', type: 'text', defaultW: 72, defaultH: 12 },
  ],
  10: [
    { key: 'location_barcode', label: '库位条码', type: 'barcode', defaultW: 72, defaultH: 14 },
    { key: 'location_code', label: '库位编码', type: 'text', defaultW: 72, defaultH: 7 },
    { key: 'zone', label: '区域', type: 'text', defaultW: 72, defaultH: 7 },
    { key: 'name', label: '名称', type: 'text', defaultW: 72, defaultH: 8 },
  ],
}

/** 单据明细表格列选项（type 1–3），key 与后端商品行字段一致 */
export interface TableColumnOption {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
}

export const TABLE_COLUMN_OPTIONS: TableColumnOption[] = [
  { key: 'articleNo', label: '供应商型号' },
  { key: 'code', label: '商品编码' },
  { key: 'name', label: '商品名称' },
  { key: 'spec', label: '型号' },
  { key: 'color', label: '颜色' },
  { key: 'unit', label: '单位' },
  { key: 'qty', label: '数量' },
  { key: 'price', label: '单价' },
  { key: 'amount', label: '金额' },
  { key: 'remark', label: '备注' },
]

/**
 * 标签模板默认画布元素（type 5–9）。
 * 与后端 backend/src/database/079_seed_default_print_templates.sql 种子模板同构；
 * 默认纸张 75×50mm。
 */
export const DEFAULT_LABEL_ELEMENTS: Record<number, TemplateElement[]> = {
  5: [
    { id: 'lb5_bc', type: 'barcode', fieldKey: 'rack_barcode', label: '货架条码', x: 2, y: 2, width: 71, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb5_rc', type: 'text', fieldKey: 'rack_code', label: '货架编码', x: 2, y: 16, width: 71, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb5_z', type: 'text', fieldKey: 'zone', label: '库区', x: 2, y: 24, width: 71, height: 6, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb5_n', type: 'text', fieldKey: 'name', label: '名称', x: 2, y: 32, width: 71, height: 14, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  6: [
    { id: 'lb6_bc', type: 'barcode', fieldKey: 'container_code', label: '库存条码', x: 2, y: 2, width: 71, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb6_pn', type: 'text', fieldKey: 'product_name', label: '品名', x: 2, y: 16, width: 71, height: 8, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb6_q', type: 'text', fieldKey: 'qty', label: '数量', x: 2, y: 26, width: 71, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  7: [
    { id: 'lb7_bc', type: 'barcode', fieldKey: 'box_code', label: '物流条码', x: 2, y: 2, width: 71, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_tn', type: 'text', fieldKey: 'task_no', label: '任务号', x: 2, y: 14, width: 71, height: 5, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_cn', type: 'text', fieldKey: 'customer_name', label: '客户', x: 2, y: 20, width: 40, height: 5, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_ca', type: 'text', fieldKey: 'carrier_name', label: '快递', x: 42, y: 20, width: 31, height: 5, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_ft', type: 'text', fieldKey: 'freight_type_name', label: '运费', x: 2, y: 26, width: 40, height: 5, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_pc', type: 'text', fieldKey: 'piece_count', label: '件数', x: 42, y: 26, width: 31, height: 5, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb7_il', type: 'text', fieldKey: 'item_list', label: '装箱内容', x: 2, y: 33, width: 71, height: 14, fontSize: 7, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  8: [
    { id: 'lb8_bc', type: 'barcode', fieldKey: 'product_code', label: '产品条码', x: 2, y: 2, width: 71, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb8_pn', type: 'text', fieldKey: 'product_name', label: '产品名称', x: 2, y: 16, width: 71, height: 8, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb8_sp', type: 'text', fieldKey: 'spec', label: '型号', x: 2, y: 26, width: 71, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  9: [
    { id: 'lb9_bc', type: 'barcode', fieldKey: 'container_code', label: '塑料盒条码', x: 2, y: 2, width: 71, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb9_pn', type: 'text', fieldKey: 'product_name', label: '品名', x: 2, y: 16, width: 71, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
  10: [
    { id: 'lb10_bc', type: 'barcode', fieldKey: 'location_barcode', label: '库位条码', x: 2, y: 2, width: 71, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb10_lc', type: 'text', fieldKey: 'location_code', label: '库位编码', x: 2, y: 16, width: 71, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb10_z', type: 'text', fieldKey: 'zone', label: '区域', x: 2, y: 24, width: 71, height: 6, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'lb10_n', type: 'text', fieldKey: 'name', label: '名称', x: 2, y: 32, width: 71, height: 14, fontSize: 8, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
}

/** 标签画布预览示例数据（与打印变量一致，字段面板收敛后自动跟随） */
export const LABEL_PREVIEW_SAMPLE: Record<number, Record<string, string>> = {
  5: { rack_barcode: 'H000001', rack_code: 'A-01-02', zone: 'A区', name: '主通道货架' },
  6: { container_code: 'I000123', product_name: '示例商品', qty: '12' },
  7: { box_code: 'L000001', task_no: 'WT202403010001', customer_name: '某某客户', carrier_name: '顺丰速运', freight_type_name: '寄付', piece_count: '3 件', summary: '2 行 / 3 件', item_list: '商品A×2, 商品B×1' },
  8: { product_code: 'SP0001', product_name: '示例 SKU', spec: '500g', unit: '件', price: '12.50' },
  9: { container_code: 'B000456', product_name: '零散商品' },
  10: { location_barcode: 'R000001', location_code: 'A01-01-0101', zone: 'A区', name: '主通道货架-1' },
}

/** 单据画布预览示例数据（type 1–4） */
export const DOC_PREVIEW_SAMPLE: Record<string, string> = {
  title: '销售订单',
  orderNo: 'SO2024031500001',
  customerName: '北京科技有限公司',
  supplierName: '上海供应链有限公司',
  orderDate: '2024-03-15',
  warehouseName: '主仓库',
  salesperson: '张三',
  receiverName: '李四',
  receiverPhone: '13812345678',
  receiverAddress: '北京市朝阳区 XX 街道 XX 号',
  totalAmount: '¥ 3,200.00',
  remark: '请注意包装，易碎品。',
  operator: '王五',
  printDate: '2024-03-15 14:30:00',
}

/** 单据画布预览示例明细（与 TemplateRenderer.PrintItem 一致） */
export const DOC_PREVIEW_ITEMS = [
  { articleNo: 'JH-1001', code: 'P001', name: '商品A', spec: '500g/件', color: '黑色', unit: '件', qty: '10', price: '100.00', amount: '1,000.00', remark: '易碎品' },
  { articleNo: 'JH-1002', code: 'P002', name: '商品B', spec: '1kg/箱', color: '白色', unit: '箱', qty: '5', price: '200.00', amount: '1,000.00', remark: '' },
  { articleNo: 'JH-1003', code: 'P003', name: '商品C', spec: '250ml/瓶', color: '', unit: '瓶', qty: '20', price: '60.00', amount: '1,200.00', remark: '按批次发货' },
]
