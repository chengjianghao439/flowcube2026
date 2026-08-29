import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import type { TableColumn } from '@/types'

interface DataTableProps<T extends object> {
  columns: TableColumn<T>[]
  data: T[]
  loading?: boolean
  rowKey?: keyof T
  emptyText?: string
  /** 兼容旧用法：等价于 selectionMode="multiple" */
  selectable?: boolean
  /** 多选模式：显示 checkbox 列，受控 selectedIds/onSelectionChange */
  selectionMode?: 'multiple'
  /** 多选模式下哪些行可勾选（返回 false 的行 checkbox 禁用） */
  selectableCheck?: (row: T) => boolean
  selectedIds?: Set<number>
  /** 选中变化回调（onSelectChange 的别名，命名与 selectionMode 呼应） */
  onSelectionChange?: (ids: Set<number>) => void
  onSelectChange?: (ids: Set<number>) => void
  onRowDoubleClick?: (row: T) => void
  columnStorageKey?: string
  /** 当前排序字段（配合 col.sortable 使用），受控由调用方维护 */
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  onSortChange?: (key: string) => void
  /**
   * 按比例缩放模式：列宽以百分比（而非固定 px）存储和渲染，表格始终占满容器宽度，
   * 容器变宽时各列按当前比例一起放大，无需用户重新拖拽。col.width 在此模式下按
   * 百分比（0-100）解读。默认关闭，不影响其他仍按固定 px 记忆列宽的页面。
   */
  fluid?: boolean
}

function isAction(key: string, title: string): boolean {
  return key === 'actions' || title === '操作'
}

export default function DataTable<T extends object>({
  columns, data, loading = false,
  rowKey = 'id' as keyof T, emptyText = '暂无数据',
  selectable = false, selectionMode, selectedIds, onSelectChange, onSelectionChange, selectableCheck,
  onRowDoubleClick,
  columnStorageKey,
  sortKey, sortDirection, onSortChange,
  fluid = false,
}: DataTableProps<T>) {
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const columnWidthsRef = useRef<Record<string, number>>({})
  const colgroupRef = useRef<HTMLTableColElement>(null)

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
        setColumnWidths({})
        return
      }
      const saved = JSON.parse(raw)
      if (Array.isArray(saved)) {
        const currentKeys = columns.map(col => String(col.key))
        const merged = [
          ...saved.filter((key): key is string => typeof key === 'string' && currentKeys.includes(key)),
          ...currentKeys.filter(key => !saved.includes(key)),
        ]
        setColumnOrder(merged)
        setColumnWidths({})
        return
      }
      if (!saved || typeof saved !== 'object') {
        setColumnOrder(columns.map(col => String(col.key)))
        setColumnWidths({})
        return
      }
      const currentKeys = columns.map(col => String(col.key))
      const savedOrder = Array.isArray(saved.order) ? saved.order : []
      const merged = [
        ...savedOrder.filter((key: unknown): key is string => typeof key === 'string' && currentKeys.includes(key)),
        ...currentKeys.filter(key => !savedOrder.includes(key)),
      ]
      setColumnOrder(merged)
      const widths = saved.widths && typeof saved.widths === 'object'
        ? Object.fromEntries(
            Object.entries(saved.widths).filter(
              ([key, value]) => currentKeys.includes(key) && typeof value === 'number' && Number.isFinite(value),
            ),
          )
        : {}
      setColumnWidths(widths as Record<string, number>)
    } catch {
      setColumnOrder(columns.map(col => String(col.key)))
      setColumnWidths({})
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

  useEffect(() => {
    columnWidthsRef.current = columnWidths
  }, [columnWidths])

  const persistLayout = (nextOrder: string[], nextWidths: Record<string, number>) => {
    setColumnOrder(nextOrder)
    setColumnWidths(nextWidths)
    if (!resolvedStorageKey || typeof window === 'undefined') return
    window.localStorage.setItem(
      resolvedStorageKey,
      JSON.stringify({
        order: nextOrder,
        widths: nextWidths,
      }),
    )
  }

  const persistOrder = (next: string[]) => {
    persistLayout(next, columnWidths)
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

  // useCallback 不是为了性能，是为了让 tableWidth 的依赖能写全：这个函数读了
  // columnWidths / fluid / orderedColumns / columns 四个值，原先 tableWidth 的依赖数组
  // 手写了前三个、漏了 columns（fluid 模式下的 fallback 用 columns.length）。
  const getColumnWidth = useCallback((col: TableColumn<T>) => {
    const key = String(col.key)
    const fallback = fluid
      ? 100 / (orderedColumns.length || columns.length || 1)
      : (isAction(key, col.title) ? 180 : 160)
    const width = columnWidths[key] ?? col.width ?? fallback
    if (typeof width === 'number' && Number.isFinite(width)) return width
    const parsed = fluid ? Number.parseFloat(String(width)) : Number.parseInt(String(width), 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }, [columnWidths, fluid, orderedColumns, columns])

  const isSelectEnabled = !!(selectable || selectionMode)

  const tableWidth = useMemo(() => {
    if (fluid) return 0
    const base = orderedColumns.reduce((sum, col) => sum + getColumnWidth(col), 0)
    return base + (isSelectEnabled ? 56 : 0)
  }, [orderedColumns, isSelectEnabled, fluid, getColumnWidth])

  const startResize = (event: ReactMouseEvent, col: TableColumn<T>) => {
    event.preventDefault()
    event.stopPropagation()
    if (typeof window === 'undefined') return
    const key = String(col.key)

    // 快照所有列当前渲染宽度 + 找相邻列作为补偿列（只影响这一对相邻列，
    // 不会像"固定找最后一列补偿"那样把最后一列越挤越窄，导致后面任何列都拖不动）
    const allCols = orderedColumns.length ? orderedColumns : columns
    const colIndex = allCols.findIndex(c => String(c.key) === key)
    const isLast = colIndex === allCols.length - 1
    const neighborCol = isLast ? allCols[colIndex - 1] : allCols[colIndex + 1]
    const minWidth = isAction(key, col.title) ? 120 : 80

    const snapshot: Record<string, number> = {}
    if (colgroupRef.current) {
      const colEls = colgroupRef.current.querySelectorAll('col')
      let ci = isSelectEnabled ? 1 : 0
      colEls.forEach(el => {
        if (isSelectEnabled && ci === 0) { ci++; return }
        const idx = isSelectEnabled ? ci - 1 : ci
        if (idx >= 0 && idx < allCols.length) {
          snapshot[String(allCols[idx].key)] = el.getBoundingClientRect().width
        }
        ci++
      })
    } else {
      allCols.forEach(c => { snapshot[String(c.key)] = getColumnWidth(c) })
    }

    const startX = event.clientX
    // 如果拖拽的不是最后一列，用右边相邻列补偿；如果拖拽最后一列，用左边相邻列补偿
    const compKey = String(neighborCol.key)
    const compMinW = isAction(compKey, neighborCol.title) ? 120 : 80

    // fluid 模式下，拖拽过程中的像素运算不变（更符合直觉），只在写入 state/持久化前
    // 按拖拽开始时的总宽度换算成百分比，使全部列宽始终归一化到 100%。
    const totalSnapshotWidth = allCols.reduce((sum, c) => sum + snapshot[String(c.key)], 0)
    const toStoredWidths = (widthsPx: Record<string, number>): Record<string, number> => {
      if (!fluid || totalSnapshotWidth <= 0) return widthsPx
      return Object.fromEntries(
        Object.entries(widthsPx).map(([k, v]) => [k, (v / totalSnapshotWidth) * 100]),
      )
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rawTarget = Math.round(snapshot[key] + moveEvent.clientX - startX)
      const maxTarget = snapshot[key] + snapshot[compKey] - compMinW
      const newTarget = Math.max(minWidth, Math.min(maxTarget, rawTarget))
      const newComp = Math.max(compMinW, Math.round(snapshot[compKey] - (newTarget - snapshot[key])))
      setColumnWidths(prev => ({ ...prev, ...toStoredWidths({ [key]: newTarget, [compKey]: newComp }) }))
    }

    const handleMouseUp = (moveEvent: MouseEvent) => {
      const rawTarget = Math.round(snapshot[key] + moveEvent.clientX - startX)
      const maxTarget = snapshot[key] + snapshot[compKey] - compMinW
      const newTarget = Math.max(minWidth, Math.min(maxTarget, rawTarget))
      const newComp = Math.max(compMinW, Math.round(snapshot[compKey] - (newTarget - snapshot[key])))
      const nextWidths = toStoredWidths({ ...snapshot, [key]: newTarget, [compKey]: newComp })
      persistLayout(columnOrder.length ? columnOrder : columns.map(item => String(item.key)), nextWidths)
      cleanup()
    }

    // 失焦兜底：拖拽中 Alt-Tab 切走，mousemove/mouseup 不会触发，残留监听器直到下次 mousedown（对齐 editor 的 onWindowBlur）
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', handleBlur)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    const handleBlur = () => { cleanup() }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', handleBlur)
  }

  const allIds = data.map(r => Number((r as Record<string, unknown>)[String(rowKey)]))
  const enabledIds = selectableCheck ? allIds.filter(id => selectableCheck(data.find(r => Number((r as Record<string, unknown>)[String(rowKey)]) === id)!)) : allIds
  const allSelected = enabledIds.length > 0 && enabledIds.every(id => selectedIds?.has(id))
  const someSelected = !allSelected && enabledIds.some(id => selectedIds?.has(id))

  const handleSelectChange = (next: Set<number>) => {
    if (onSelectionChange) onSelectionChange(next)
    else onSelectChange?.(next)
  }

  const toggleAll = () => {
    if (!onSelectChange && !onSelectionChange) return
    if (allSelected) {
      const next = new Set(selectedIds)
      enabledIds.forEach(id => next.delete(id))
      handleSelectChange(next)
    } else {
      const next = new Set(selectedIds)
      enabledIds.forEach(id => next.add(id))
      handleSelectChange(next)
    }
  }

  const toggleRow = (id: number) => {
    if (!onSelectChange && !onSelectionChange) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    handleSelectChange(next)
  }

  const colCount = orderedColumns.length + (isSelectEnabled ? 1 : 0)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-fixed text-sm" style={fluid ? { width: '100%' } : { width: Math.max(tableWidth, 0), minWidth: '100%' }}>
          <colgroup ref={colgroupRef}>
            {isSelectEnabled && <col style={{ width: 56 }} />}
            {orderedColumns.map(col => (
              <col key={String(col.key)} style={{ width: fluid ? `${getColumnWidth(col)}%` : getColumnWidth(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {isSelectEnabled && (
                <th scope="col" className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="选择当前页全部行"
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
                  scope="col"
                  aria-sort={sortKey === String(col.key) ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
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
                  className={`px-4 py-2.5 text-left text-table-head ${
                    isAction(String(col.key), col.title)
                      ? 'sticky right-0 z-20 min-w-[180px] bg-muted/30 shadow-[-12px_0_16px_-12px_rgba(0,0,0,0.12)]'
                      : 'cursor-move select-none'
                  }`}
                  style={fluid ? { width: `${getColumnWidth(col)}%` } : (getColumnWidth(col) ? { width: getColumnWidth(col), minWidth: getColumnWidth(col) } : undefined)}
                >
                  <div className="group flex items-center gap-2">
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        aria-label={`按${col.title}排序`}
                        onClick={() => onSortChange(String(col.key))}
                        className={`min-w-0 flex-1 whitespace-nowrap transition-colors hover:text-foreground ${
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                        } ${sortKey === String(col.key) ? 'text-primary' : ''}`}
                        title={col.title}
                      >
                        {col.title} {sortKey === String(col.key) ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    ) : (
                      <span
                        className={`min-w-0 flex-1 whitespace-nowrap ${
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''
                        }`}
                        title={col.title}
                      >{col.title}</span>
                    )}
                    {!isAction(String(col.key), col.title) && (
                      <button
                        type="button"
                        aria-label={`调整${col.title}列宽`}
                        onMouseDown={(event) => startResize(event, col)}
                        onClick={event => event.preventDefault()}
                        className="ml-auto flex h-5 w-3 shrink-0 cursor-col-resize items-center justify-center rounded-sm opacity-70 transition-opacity group-hover:opacity-100"
                      >
                        <span className="block h-4 w-px bg-border/80" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Skeleton rows
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {isSelectEnabled && <td className="min-h-12 px-4 py-2.5" />}
                  {orderedColumns.map((col) => (
                    <td key={String(col.key)} className="min-h-12 px-4 py-2.5">
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
                const rowSelectable = selectableCheck ? selectableCheck(row) : true
                return (
                  <tr
                    key={String(row[rowKey])}
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                    className={`min-h-12 border-b border-border last:border-0 transition-colors ${
                      isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
                    } ${onRowDoubleClick ? 'cursor-pointer' : ''}`}
                  >
                    {isSelectEnabled && (
                      <td className="px-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!rowSelectable}
                          onChange={() => toggleRow(rowId)}
                          className="h-4 w-4 cursor-pointer rounded"
                          title={rowSelectable ? undefined : '该行不可勾选'}
                        />
                      </td>
                    )}
                    {orderedColumns.map((col) => {
                      const rawValue = (row as Record<string, unknown>)[String(col.key)]
                      const textValue = String(rawValue ?? '')
                      const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''
                      return (
                      <td
                        key={String(col.key)}
                        onDoubleClick={isAction(String(col.key), col.title) ? e => e.stopPropagation() : undefined}
                        className={`px-4 text-foreground align-middle ${
                          isAction(String(col.key), col.title)
                            ? 'sticky right-0 z-10 min-w-[180px] bg-card py-2.5 shadow-[-12px_0_16px_-12px_rgba(0,0,0,0.08)] group-hover:bg-muted/30'
                            : 'overflow-hidden py-2.5'
                        }`}
                        style={fluid ? { width: `${getColumnWidth(col)}%` } : (getColumnWidth(col) ? { width: getColumnWidth(col), minWidth: getColumnWidth(col) } : undefined)}
                      >
                        {isAction(String(col.key), col.title)
                          ? (col.render ? (col.render(rawValue, row) as ReactNode) : textValue)
                          : (
                            <div className={`truncate ${alignClass}`} title={textValue}>
                              {col.render ? (col.render(rawValue, row) as ReactNode) : textValue}
                            </div>
                          )}
                      </td>
                      )
                    })}
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
