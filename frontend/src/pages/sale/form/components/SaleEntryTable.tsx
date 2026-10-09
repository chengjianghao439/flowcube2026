import type { ReactNode } from 'react'
import type { TableColumn } from '@/types'
import { useTableColumns } from '@/components/shared/useTableColumns'
import { TableColumnResizeHandle } from '@/components/shared/TableColumnResizeHandle'

type EntryColumn = 'product' | 'quantity' | 'unit' | 'unitPrice' | 'amount' | 'remark' | 'actions'
const columns: TableColumn<Record<EntryColumn, unknown>>[] = [
  { key: 'product', title: '商品', width: 48, minWidth: 240 },
  { key: 'quantity', title: '数量', width: 9, minWidth: 100, align: 'right' },
  { key: 'unit', title: '单位', width: 7, minWidth: 80 },
  { key: 'unitPrice', title: '单价 (¥)', width: 11, minWidth: 120, align: 'right' },
  { key: 'amount', title: '金额', width: 10, minWidth: 110, align: 'right' },
  { key: 'remark', title: '备注', width: 13, minWidth: 160 },
  { key: 'actions', title: '操作', width: 6, minWidth: 80, align: 'center' },
]

/** 录入行继续归原表单管理，只复用共享表格的列宽与交互。 */
export function SaleEntryTable({ children, rowCount, stickyHeader = false }: { children: ReactNode; rowCount?: number; stickyHeader?: boolean }) {
  const layout = useTableColumns({ columns, fluid: true, columnStorageKey: 'sale-entry-items', isSelectEnabled: false })
  return <table ref={layout.tableRef} aria-rowcount={rowCount} data-sale-entry-table
    className="isolate table-fixed text-sm [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle"
    style={layout.usesPercent ? { width: '100%', minWidth: layout.percentMinWidth } : { width: layout.tableWidth, minWidth: layout.hasCustomWidths ? 0 : '100%' }}>
    <colgroup ref={layout.colgroupRef}>
      {columns.map(col => <col key={String(col.key)} style={{ width: layout.usesPercent ? layout.getPercentColumnWidth(col) : layout.getColumnWidth(col) }} />)}
    </colgroup>
    <thead data-resizable className={`data-table-header ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
      <tr>{columns.map(col => <th key={String(col.key)} scope="col" className="relative">
        <div className={`flex min-w-0 items-center pr-3 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}`}>
          <span>{col.title}</span>
          <TableColumnResizeHandle column={col} layout={layout} />
        </div>
      </th>)}</tr>
    </thead>
    {children}
  </table>
}
