import { ResizableTable } from '@/components/shared/ResizableTable'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FinderColumn } from '@/types/finder'

interface FinderTableProps<T extends Record<string, unknown>> {
  columns: FinderColumn<T>[]
  data: T[]
  selected: T | null
  onSelect: (row: T) => void
  onDoubleClickRow?: (row: T) => void
  getRowKey: (row: T) => number
  isLoading?: boolean
  emptyText?: string
}

function alignClass(align?: 'left' | 'center' | 'right'): string {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'
  return ''
}

export function FinderTable<T extends Record<string, unknown>>({
  columns, data, selected, onSelect, onDoubleClickRow, getRowKey,
  isLoading,
  emptyText = '暂无数据',
}: FinderTableProps<T>) {

  return (
    <ResizableTable columns={columns.map(column => ({ key: column.key, title: column.title, align: column.align, width: typeof column.width === 'number' ? column.width : typeof column.width === 'string' && /^\d+(?:\.\d+)?px$/.test(column.width) ? Number.parseFloat(column.width) : 220 }))}
      columnStorageKey={`finder-full:${columns.map(column => `${column.key}:${column.title}`).join('|')}`} stickyHeader role="grid" aria-label="查询结果" aria-readonly="true" aria-busy={isLoading}>
      <tbody>
      {/* Rows */}
      {isLoading && data.length === 0 ? (
        <tr><td colSpan={columns.length} className="h-40 text-center text-sm text-muted-foreground">
          <svg className="mr-2 inline-block h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          加载中…
        </td></tr>
      ) : data.length === 0 ? (
        <tr><td colSpan={columns.length} className="fc-table-empty py-16 text-center text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p className="text-sm">{emptyText}</p>
        </td></tr>
      ) : (
        data.map(row => {
          const key        = getRowKey(row)
          const isSelected = selected ? getRowKey(selected) === key : false
          return (
            <tr
              key={key}
              role="row"
              aria-selected={isSelected}
              tabIndex={0}
              onClick={() => onSelect(row)}
              onDoubleClick={() => onDoubleClickRow?.(row)}
              onKeyDown={e => {
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                  e.preventDefault()
                  const rows = [...e.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[role="row"][aria-selected]')]
                  const index = rows.indexOf(e.currentTarget)
                  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))
                  rows[next]?.focus()
                }
                if (e.key === 'Enter') onSelect(row)
                if (e.key === ' ' && onDoubleClickRow) { e.preventDefault(); onDoubleClickRow(row) }
              }}
              className={cn(
                'cursor-pointer border-b text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40',
              )}
            >
              {columns.map(col => {
                const raw = row[col.key]
                return (
                  <td role="gridcell" key={col.key} className={cn('min-w-0 break-words px-4 py-3 leading-5', alignClass(col.align))}>
                    {col.render
                      ? col.render(raw, row)
                      : raw != null && raw !== '' ? String(raw) : '—'}
                  </td>
                )
              })}
            </tr>
          )
        })
      )}
      </tbody>
    </ResizableTable>
  )
}
