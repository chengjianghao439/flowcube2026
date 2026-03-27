/**
 * 与 backend migrate seed / 打印占位符一致，供「恢复默认」与占位符说明。
 * type：5 货架 6 散件容器 7 物流箱贴 8 商品 9 库存
 */

export const TEMPLATE_ZPL_DEFAULTS: Record<number, string> = {
  5: '^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD{{rack_barcode}}^FS^FO32,108^A0N,22,22^FD{{rack_code}}^FS^FO32,138^A0N,20,20^FD{{zone}} {{name}}^FS^XZ',
  6: '^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD{{container_code}}^FS^FO32,108^A0N,24,24^FD{{product_name}}^FS^FO32,148^A0N,24,24^FDQTY {{qty}}^FS^XZ',
  7: '^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD{{box_code}}^FS^FO32,108^A0N,22,22^FD{{task_no}}^FS^FO32,142^A0N,20,20^FD{{customer_name}}^FS^FO32,176^A0N,18,18^FD{{summary}}^FS^XZ',
  8: '^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD{{product_code}}^FS^FO32,108^A0N,24,24^FD{{product_name}}^FS^FO32,148^A0N,22,22^FD{{spec}}^FS^XZ',
  9: '^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD{{sku}}^FS^FO32,108^A0N,24,24^FD{{product_name}}^FS^FO32,148^A0N,22,22^FD{{qty}} {{warehouse}}^FS^XZ',
}

export const ZPL_PLACEHOLDER_ROWS: Record<number, { key: string; label: string }[]> = {
  5: [
    { key: 'rack_barcode', label: '货架条码' },
    { key: 'rack_code', label: '货架编码' },
    { key: 'zone', label: '库区' },
    { key: 'name', label: '名称' },
  ],
  6: [
    { key: 'container_code', label: '容器编码' },
    { key: 'product_name', label: '品名' },
    { key: 'qty', label: '数量' },
  ],
  7: [
    { key: 'box_code', label: '箱码' },
    { key: 'task_no', label: '任务号' },
    { key: 'customer_name', label: '客户' },
    { key: 'summary', label: '摘要' },
  ],
  8: [
    { key: 'product_code', label: '商品编码' },
    { key: 'product_name', label: '商品名称' },
    { key: 'spec', label: '规格' },
  ],
  9: [
    { key: 'sku', label: 'SKU' },
    { key: 'product_name', label: '品名' },
    { key: 'qty', label: '数量' },
    { key: 'warehouse', label: '仓库' },
  ],
}

/** 预览用示例（非真实打印） */
export const ZPL_PREVIEW_SAMPLE: Record<number, Record<string, string>> = {
  5: { rack_barcode: 'R001', rack_code: 'A-01-02', zone: 'A区', name: '主通道货架' },
  6: { container_code: 'C123', product_name: '示例商品', qty: '12' },
  7: { box_code: 'BX001', task_no: 'T20240301', customer_name: '某某客户', summary: '3件/易碎' },
  8: { product_code: 'P001', product_name: '示例 SKU', spec: '500g' },
  9: { sku: 'SKU001', product_name: '库存品', qty: '99', warehouse: '主仓' },
}

export function applyZplPreview(body: string, sample: Record<string, string>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => sample[k] ?? `{{${k}}}`)
}
