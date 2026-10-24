import type { ReactNode } from 'react'
import type { TableColumn } from '@/types'
import { useTableColumns } from '@/components/shared/useTableColumns'
import { TableColumnHeader } from '@/components/shared/TableColumnHeader'

const columns: TableColumn<Record<string, unknown>>[] = [
  { key: 'product', title: '商品', width: 36, minWidth: 220 },
  { key: 'quantity', title: '数量', width: 12, minWidth: 80, align: 'right' },
  { key: 'unit', title: '单位', width: 10, minWidth: 80 },
  { key: 'unitPrice', title: '单价 (¥)', width: 16, minWidth: 96, align: 'right' },
  { key: 'amount', title: '金额', width: 18, minWidth: 108, align: 'right' },
  { key: 'actions', title: '操作', width: 12, minWidth: 80, align: 'center' },
]

/** 只复用销售样板的列宽与表头能力；采购明细及数量、价格仍归采购表单。 */
export function PurchaseEntryTable({ children, rowCount, stickyHeader }: { children: ReactNode; rowCount: number; stickyHeader: boolean }) {
  const layout = useTableColumns({ columns, fluid: true, columnStorageKey: 'purchase-entry-items', isSelectEnabled: false })
  return <table ref={layout.tableRef} data-purchase-entry-table aria-rowcount={rowCount}
    className="isolate table-fixed text-sm [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle"
    style={layout.usesPercent ? { width: '100%', minWidth: layout.percentMinWidth } : { width: layout.tableWidth, minWidth: layout.hasCustomWidths ? 0 : '100%' }}>
    <colgroup ref={layout.colgroupRef}>{columns.map(col => <col key={String(col.key)} style={{ width: layout.usesPercent ? layout.getPercentColumnWidth(col) : layout.getColumnWidth(col) }} />)}</colgroup>
    <thead data-resizable className={`data-table-header ${stickyHeader ? 'sticky top-0 z-10' : ''}`}><tr>
      {columns.map(col => <TableColumnHeader key={String(col.key)} column={col} layout={layout} />)}
    </tr></thead>
    {children}
  </table>
}
