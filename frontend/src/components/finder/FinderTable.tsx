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

function colTrack(col: FinderColumn): string {
  if (!col.width) return '1fr'
  return typeof col.width === 'number' ? `${col.width}px` : col.width
}

export function FinderTable<T extends Record<string, unknown>>({
  columns, data, selected, onSelect, onDoubleClickRow, getRowKey,
  isLoading,
  emptyText = '暂无数据',
}: FinderTableProps<T>) {
  const gridTemplate = columns.map(colTrack).join(' ')

  return (
    <div className="w-full">
      {/* Column header — sticky so it stays visible while scrolling */}
      <div
        className="sticky top-0 z-10 grid gap-2 border-b bg-muted/40 px-6 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map(col => <span key={col.key}>{col.title}</span>)}
      </div>

      {/* Rows */}
      {isLoading && data.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          加载中...
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Inbox className="mb-2 h-8 w-8 opacity-30" />
          <p className="text-sm">{emptyText}</p>
        </div>
      ) : (
        data.map(row => {
          const key        = getRowKey(row)
          const isSelected = selected ? getRowKey(selected) === key : false
          return (
            <div
              key={key}
              role="row"
              tabIndex={0}
              onClick={() => onSelect(row)}
              onDoubleClick={() => onDoubleClickRow?.(row)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSelect(row)
                if (e.key === ' ' && onDoubleClickRow) { e.preventDefault(); onDoubleClickRow(row) }
              }}
              className={cn(
                'grid cursor-pointer gap-2 border-b px-6 py-3 text-sm transition-colors',
                isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40',
              )}
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {columns.map(col => {
                const raw = row[col.key]
                return (
                  <span key={col.key} className="truncate leading-5">
                    {col.render
                      ? col.render(raw, row)
                      : raw != null && raw !== '' ? String(raw) : '—'}
                  </span>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
