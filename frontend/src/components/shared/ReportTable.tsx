import { Children, Fragment, cloneElement, isValidElement, type HTMLAttributes, type ReactElement, type ReactNode, type TableHTMLAttributes, type ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { useTableColumns } from './useTableColumns'
import { TableColumnHeader } from './TableColumnHeader'
import { ProductIdentityHeaders } from './ProductIdentityCells'
import { productIdentityHeaderCells } from './productIdentityHeaderCells'
import type { TableColumn } from '@/types'

type NodeProps = { children?: ReactNode }
type HeaderCell = ReactElement<ThHTMLAttributes<HTMLTableCellElement>>
function elements(children: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<NodeProps>(child)) return []
    if (child.type === Fragment) return elements(child.props.children)
    if (child.type === ProductIdentityHeaders) return elements(productIdentityHeaderCells())
    return [child]
  })
}
function text(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<NodeProps>(child) ? text(child.props.children) : String(child)).join('')
}
const base = 'fc-report-table w-full text-sm tabular-nums [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:leading-6 [&_td]:align-middle [&_tbody_tr]:border-b [&_tbody_tr]:border-border/60 [&_tbody_tr:last-child]:border-0 [&_tbody_tr:hover]:bg-muted/20 [&_tfoot]:bg-muted/30 [&_tfoot]:font-semibold'

type HeaderPosition = { cell: HeaderCell; start: number; end: number; row: number; rowSpan: number }

/** 先验证表头的占位矩阵，再把跨行叶列与其分组对应；不猜测不完整的合并结构。 */
function headerLayout(rows: ReactElement<NodeProps>[]) {
  const occupied: boolean[][] = rows.map(() => [])
  const positions: HeaderPosition[][] = []
  for (let row = 0; row < rows.length; row++) {
    let start = 0
    const current: HeaderPosition[] = []
    for (const element of elements(rows[row].props.children)) {
      if (element.type !== 'th') return null
      const cell = element as HeaderCell
      const colSpan = cell.props.colSpan ?? 1, rowSpan = cell.props.rowSpan ?? 1
      if (!Number.isSafeInteger(colSpan) || colSpan < 1 || !Number.isSafeInteger(rowSpan) || rowSpan < 1 || row + rowSpan > rows.length) return null
      while (occupied[row][start]) start++
      const end = start + colSpan
      for (let y = row; y < row + rowSpan; y++) for (let x = start; x < end; x++) {
        if (occupied[y][x]) return null
        occupied[y][x] = true
      }
      current.push({ cell, start, end, row, rowSpan })
      start = end
    }
    positions.push(current)
  }
  const count = Math.max(0, ...occupied.map(row => row.length))
  if (!count || occupied.some(row => row.length !== count || Array.from({ length: count }, (_, x) => !row[x]).some(Boolean))) return null
  const all = positions.flat()
  const leaves = all.filter(p => p.end === p.start + 1 && p.row + p.rowSpan === rows.length).sort((a, b) => a.start - b.start)
  if (leaves.length !== count) return null
  return { positions, leaves, all }
}

/** 普通明细与分组报表共用叶列的列宽交互，保留原跨行/跨列、行输入与合计。 */
export function ReportTable({ children, className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  const sections = elements(children)
  const head = sections.find(section => section.type === 'thead')
  const rows = elements(head?.props.children)
  const layout = head && !sections.some(section => section.type === 'colgroup') ? headerLayout(rows) : null
  if (!layout || !head) return <table {...props} className={cn(base, className)}>{children}</table>
  return <ResizableReportTable {...props} className={className} head={head} rows={rows} header={layout}>{sections}</ResizableReportTable>
}
function ResizableReportTable({ children, className, style, head, rows, header, ...props }: TableHTMLAttributes<HTMLTableElement> & {
  head: ReactElement<NodeProps>; rows: ReactElement<NodeProps>[]; header: NonNullable<ReturnType<typeof headerLayout>>
}) {
  const columns: TableColumn<object>[] = header.leaves.map((leaf, index) => {
    const cell = leaf.cell
    const label = text(cell.props.children) || cell.props['aria-label'] || '选择'
    const parents = header.all.filter(p => p.row < leaf.row && p.start <= leaf.start && p.end > leaf.start).map(p => text(p.cell.props.children)).filter(Boolean)
    const title = [...parents, label].join(' · ')
    const widthClass = cell.props.className?.match(/(?:^|\s)(?:min-)?w-(\d+)(?:\s|$)/)
    return { key: `column-${index}-${title}`, title, width: widthClass ? Number(widthClass[1]) * 4 : Math.max(112, Math.min(240, label.length * 14 + 48)), align: cell.props.className?.includes('text-right') ? 'right' : cell.props.className?.includes('text-center') ? 'center' : 'left' }
  })
  const layout = useTableColumns({ columns, fluid: false, isSelectEnabled: false, allowReorder: false })
  const renderedHead = cloneElement(head as ReactElement<HTMLAttributes<HTMLTableSectionElement> & { 'data-resizable'?: boolean }>, {
    'data-resizable': true, className: cn('data-table-header', (head.props as HTMLAttributes<HTMLTableSectionElement>).className),
  }, rows.map((row, index) => cloneElement(row, { key: row.key ?? index }, header.positions[index].map(position => {
    const leafIndex = header.leaves.indexOf(position)
    if (leafIndex < 0) return cloneElement(position.cell, { key: position.cell.key ?? position.start, scope: 'colgroup', className: cn('fc-table-group-header', position.cell.props.className) })
    const cell = position.cell, column = columns[leafIndex]
    return <TableColumnHeader {...cell.props} key={column.key} column={column} layout={layout}>
      <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]" style={{ textAlign: column.align }}>{cell.props.children}</span>
    </TableColumnHeader>
  }))))
  return <table {...props} ref={layout.tableRef} className={cn(base, 'table-fixed', className)} style={{ ...style, width: layout.hasCustomWidths ? layout.tableWidth : '100%', minWidth: layout.tableWidth }}>
    {Children.map(children, child => isValidElement(child) && child.type === 'caption' ? child : null)}
    <colgroup ref={layout.colgroupRef}>{columns.map(column => <col key={column.key} style={{ width: layout.getColumnWidth(column) }} />)}</colgroup>
    {Children.map(children, child => isValidElement(child) && child.type === 'caption' ? null : isValidElement(child) && child.type === 'thead' ? renderedHead : child)}
  </table>
}
