import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import type { Pagination, TableColumn } from '@/types'

interface DataTableProps<T extends object> {
  columns: TableColumn<T>[]
  data: T[]
  loading?: boolean
  pagination?: Pagination
  onPageChange?: (page: number) => void
  rowKey?: keyof T
  emptyText?: string
  selectable?: boolean
  selectedIds?: Set<number>
  onSelectChange?: (ids: Set<number>) => void
  onRowDoubleClick?: (row: T) => void
}

function isAction(key: string, title: string): boolean {
  return key === 'actions' || title === '操作'
}

export default function DataTable<T extends object>({
  columns, data, loading = false, pagination, onPageChange,
  rowKey = 'id' as keyof T, emptyText = '暂无数据',
  selectable = false, selectedIds, onSelectChange,
  onRowDoubleClick,
}: DataTableProps<T>) {
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 0

  const allIds = data.map(r => Number((r as Record<string, unknown>)[String(rowKey)]))
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds?.has(id))
  const someSelected = !allSelected && allIds.some(id => selectedIds?.has(id))

  const toggleAll = () => {
    if (!onSelectChange) return
    if (allSelected) {
      const next = new Set(selectedIds)
      allIds.forEach(id => next.delete(id))
      onSelectChange(next)
    } else {
      const next = new Set(selectedIds)
      allIds.forEach(id => next.add(id))
      onSelectChange(next)
    }
  }

  const toggleRow = (id: number) => {
    if (!onSelectChange) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectChange(next)
  }

  const colCount = columns.length + (selectable ? 1 : 0)

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer rounded"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground ${
                    isAction(String(col.key), col.title) ? 'sticky right-0 bg-muted/30' : ''
                  }`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Skeleton rows
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {selectable && <td className="px-4 h-12" />}
                  {columns.map((col) => (
                    <td key={String(col.key)} className="px-4 h-12">
                      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-8 w-8 opacity-40" />
                    <span className="text-sm">{emptyText}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const rowId = Number((row as Record<string, unknown>)[String(rowKey)])
                const isSelected = selectedIds?.has(rowId) ?? false
                return (
                  <tr
                    key={String(row[rowKey])}
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                    className={`h-12 border-b border-border last:border-0 transition-colors ${
                      isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
                    } ${onRowDoubleClick ? 'cursor-pointer' : ''}`}
                  >
                    {selectable && (
                      <td className="px-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(rowId)}
                          className="h-4 w-4 cursor-pointer rounded"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={String(col.key)}
                        onDoubleClick={isAction(String(col.key), col.title) ? e => e.stopPropagation() : undefined}
                        className={`px-4 text-foreground ${
                          isAction(String(col.key), col.title)
                            ? 'sticky right-0 bg-card group-hover:bg-muted/30'
                            : ''
                        }`}
                      >
                        {col.render
                          ? (col.render((row as Record<string, unknown>)[String(col.key)], row) as ReactNode)
                          : String((row as Record<string, unknown>)[String(col.key)] ?? '')}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            共 <span className="font-medium text-foreground">{pagination.total}</span> 条 · 第 {pagination.page} / {totalPages} 页
          </p>
          <div className="flex gap-1.5">
            <button
              disabled={pagination.page <= 1}
              onClick={() => onPageChange?.(pagination.page - 1)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-muted transition-colors"
            >
              上一页
            </button>
            <button
              disabled={pagination.page >= totalPages}
              onClick={() => onPageChange?.(pagination.page + 1)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-muted transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
