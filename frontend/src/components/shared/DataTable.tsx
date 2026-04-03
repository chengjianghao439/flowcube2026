import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
  columnStorageKey?: string
}

function isAction(key: string, title: string): boolean {
  return key === 'actions' || title === '操作'
}

export default function DataTable<T extends object>({
  columns, data, loading = false, pagination, onPageChange,
  rowKey = 'id' as keyof T, emptyText = '暂无数据',
  selectable = false, selectedIds, onSelectChange,
  onRowDoubleClick,
  columnStorageKey,
}: DataTableProps<T>) {
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [draggingKey, setDraggingKey] = useState<string | null>(null)

  const resolvedStorageKey = useMemo(() => {
    if (columnStorageKey) return `flowcube:table-columns:${columnStorageKey}`
    if (typeof window === 'undefined') return null
    const pageKey = window.location.hash.split('?')[0].replace(/^#/, '') || 'root'
    const columnKeys = columns.map(col => String(col.key)).join('|')
    return `flowcube:table-columns:${pageKey}:${columnKeys}`
  }, [columnStorageKey, columns])

  useEffect(() => {
    if (!resolvedStorageKey || typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(resolvedStorageKey)
      if (!raw) {
        setColumnOrder(columns.map(col => String(col.key)))
        return
      }
      const saved = JSON.parse(raw)
      if (!Array.isArray(saved)) {
        setColumnOrder(columns.map(col => String(col.key)))
        return
      }
      const currentKeys = columns.map(col => String(col.key))
      const merged = [
        ...saved.filter((key): key is string => typeof key === 'string' && currentKeys.includes(key)),
        ...currentKeys.filter(key => !saved.includes(key)),
      ]
      setColumnOrder(merged)
    } catch {
      setColumnOrder(columns.map(col => String(col.key)))
    }
  }, [columns, resolvedStorageKey])

  const orderedColumns = useMemo(() => {
    if (!columnOrder.length) return columns
    const byKey = new Map(columns.map(col => [String(col.key), col]))
    const merged = [
      ...columnOrder.map(key => byKey.get(key)).filter((col): col is TableColumn<T> => !!col),
      ...columns.filter(col => !columnOrder.includes(String(col.key))),
    ]
    return merged
  }, [columnOrder, columns])

  const persistOrder = (next: string[]) => {
    setColumnOrder(next)
    if (!resolvedStorageKey || typeof window === 'undefined') return
    window.localStorage.setItem(resolvedStorageKey, JSON.stringify(next))
  }

  const moveColumn = (targetKey: string) => {
    if (!draggingKey || draggingKey === targetKey) return
    const next = [...(columnOrder.length ? columnOrder : columns.map(col => String(col.key)))]
    const fromIndex = next.indexOf(draggingKey)
    const toIndex = next.indexOf(targetKey)
    if (fromIndex < 0 || toIndex < 0) return
    next.splice(fromIndex, 1)
    next.splice(toIndex, 0, draggingKey)
    persistOrder(next)
    setDraggingKey(null)
  }

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

  const colCount = orderedColumns.length + (selectable ? 1 : 0)

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
              {orderedColumns.map((col) => (
                <th
                  key={String(col.key)}
                  draggable={!isAction(String(col.key), col.title)}
                  onDragStart={() => setDraggingKey(String(col.key))}
                  onDragOver={(e) => {
                    if (draggingKey && draggingKey !== String(col.key)) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    moveColumn(String(col.key))
                  }}
                  onDragEnd={() => setDraggingKey(null)}
                  className={`px-4 py-3 text-left text-table-head ${
                    isAction(String(col.key), col.title)
                      ? 'sticky right-0 z-20 min-w-[200px] bg-muted/30 shadow-[-12px_0_16px_-12px_rgba(0,0,0,0.12)]'
                      : 'cursor-move select-none'
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
                  {selectable && <td className="px-4 min-h-12 py-3" />}
                  {orderedColumns.map((col) => (
                    <td key={String(col.key)} className="px-4 min-h-12 py-3">
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
                    className={`min-h-12 border-b border-border last:border-0 transition-colors ${
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
                    {orderedColumns.map((col) => (
                      <td
                        key={String(col.key)}
                        onDoubleClick={isAction(String(col.key), col.title) ? e => e.stopPropagation() : undefined}
                        className={`px-4 text-foreground align-top ${
                          isAction(String(col.key), col.title)
                            ? 'sticky right-0 z-10 min-w-[200px] bg-card py-3 shadow-[-12px_0_16px_-12px_rgba(0,0,0,0.08)] group-hover:bg-muted/30'
                            : 'py-3'
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

    </div>
  )
}
