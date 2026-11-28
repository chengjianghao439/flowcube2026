import type { ReactNode } from 'react'
import type { TableColumn } from '@/types'
import { useTableColumns } from '@/components/shared/useTableColumns'
import { TableColumnHeader } from '@/components/shared/TableColumnHeader'

type EntryColumn = 'product' | 'quantity' | 'unit' | 'historyPrice' | 'unitPrice' | 'amount' | 'remark' | 'actions'
const columns: TableColumn<Record<EntryColumn, unknown>>[] = [
  { key: 'product', title: '商品', width: 39, minWidth: 220 },
  { key: 'quantity', title: '数量', width: 9, minWidth: 96, align: 'right' },
  { key: 'unit', title: '单位', width: 7, minWidth: 72 },
  { key: 'historyPrice', title: '历史价', width: 9, minWidth: 96, align: 'right' },
  { key: 'unitPrice', title: '单价 (¥)', width: 11, minWidth: 116, align: 'right' },
  { key: 'amount', title: '金额', width: 10, minWidth: 108, align: 'right' },
  { key: 'remark', title: '备注', width: 11, minWidth: 140 },
  { key: 'actions', title: '操作', width: 6, minWidth: 72, align: 'center' },
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
      <tr>{columns.map(col => <TableColumnHeader key={String(col.key)} column={col} layout={layout} />)}</tr>
    </thead>
    {children}
  </table>
}
