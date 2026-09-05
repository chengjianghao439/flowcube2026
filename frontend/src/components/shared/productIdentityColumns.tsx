import type { TableColumn } from '@/types'

/** 商品身份字段独立成列；只读取当前行快照，不补查或拼接主数据。 */
export function productIdentityColumns(keys: { code?: string; name?: string } = {}): TableColumn<object>[] {
  return [
    { key: keys.code ?? 'productCode', title: '编码', width: 160 },
    { key: 'articleNumber', title: '供应商型号', width: 160 },
    { key: 'spec', title: '型号', width: 140 },
    { key: keys.name ?? 'productName', title: '名称', width: 220 },
    { key: 'color', title: '颜色', width: 110 },
  ].map(column => ({ ...column, render: (_, row) => {
    const value = (row as Record<string, unknown>)[column.key]
    return <span className="block break-words leading-6">{value == null || value === '' ? '—' : String(value)}</span>
  } }))
}
