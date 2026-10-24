import type { TableHTMLAttributes } from 'react'
import type { TableColumn } from '@/types'
import { cn } from '@/lib/utils'
import { useTableColumns } from './useTableColumns'
import { TableColumnHeader } from './TableColumnHeader'

export interface ResizableTableProps extends TableHTMLAttributes<HTMLTableElement> {
  columns: (TableColumn<object> & { headerTitle?: string })[]
  columnStorageKey: string
  minWidth?: number
  stickyHeader?: boolean
}

/** 原生明细表共用列宽能力；保留调用方的行、输入、合计和事件，字段顺序不随记忆漂移。 */
export function ResizableTable({ columns, columnStorageKey, minWidth = 0, stickyHeader = false, className, style, children, ...props }: ResizableTableProps) {
  const layout = useTableColumns({ columns, columnStorageKey, fluid: false, isSelectEnabled: false, allowReorder: false })
  return <table {...props} ref={layout.tableRef} className={cn('fc-resizable-table isolate table-fixed text-sm', className)}
    style={{ ...style, width: layout.hasCustomWidths ? layout.tableWidth : '100%', minWidth: layout.hasCustomWidths ? layout.tableWidth : Math.max(minWidth, layout.tableWidth) }}>
    <colgroup ref={layout.colgroupRef}>{columns.map(column => <col key={String(column.key)} style={{ width: layout.getColumnWidth(column) }} />)}</colgroup>
    <thead data-resizable className={cn('data-table-header', stickyHeader && 'sticky top-0 z-10')}><tr role={props.role === 'grid' ? 'row' : undefined}>
      {columns.map(column => <TableColumnHeader key={String(column.key)} column={column} layout={layout} title={column.headerTitle} role={props.role === 'grid' ? 'columnheader' : undefined} />)}
    </tr></thead>
    {children}
  </table>
}
