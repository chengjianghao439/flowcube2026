import type { ReactNode, ThHTMLAttributes } from 'react'
import type { TableColumn } from '@/types'
import { cn } from '@/lib/utils'
import type { useTableColumns } from './useTableColumns'
import { TableColumnResizeHandle } from './TableColumnResizeHandle'

type HeaderLayout<T extends object> = Pick<ReturnType<typeof useTableColumns<T>>, 'startResize' | 'fitColumn' | 'measureWidths' | 'savePixelWidths'>

/** 列表、录入表与选择器共用表头；排序和列重排事件仍由各表持有。 */
export function TableColumnHeader<T extends object>({ column, layout, children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement> & {
  column: TableColumn<T> & { headerTitle?: string }
  layout: HeaderLayout<T>
  children?: ReactNode
}) {
  return <th scope="col" {...props} data-column-key={String(column.key)} className={cn('fc-table-header-cell relative px-4 py-2.5 text-left text-table-head', className)}>
    <div className="flex min-w-0 items-center">
      {children ?? <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]" style={{ textAlign: column.align ?? 'left' }} title={column.headerTitle ?? column.title}>{column.title}</span>}
      <TableColumnResizeHandle column={column} layout={layout} />
    </div>
  </th>
}
