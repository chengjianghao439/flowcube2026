import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Inbox, RotateCcw } from 'lucide-react'
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
   * 默认按百分比铺满容器，兼容旧比例设置；手动调整后按像素独立记忆列宽。
   * 恢复默认列宽后重新使用 col.width 的百分比布局。
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
  const [widthUnit, setWidthUnit] = useState<'px' | 'percent'>(fluid ? 'percent' : 'px')
  const usesPercent = fluid && widthUnit === 'percent'
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const columnKeySignature = JSON.stringify(columns.map(col => String(col.key)))
  const currentKeys = useMemo<string[]>(() => JSON.parse(columnKeySignature), [columnKeySignature])
  // keepAlive 页面继续渲染时，使用本表挂载时的路径，避免写入当前其他页的列宽。
  const [pageKey] = useState(() => typeof window === 'undefined' ? 'root' : window.location.hash.split('?')[0].replace(/^#/, '') || 'root')
  const colgroupRef = useRef<HTMLTableColElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  const resolvedStorageKey = useMemo(() => {
    if (columnStorageKey) return `flowcube:table-columns:${columnStorageKey}`
    if (typeof window === 'undefined') return null
    const columnKeys = currentKeys.join('|')
    return `flowcube:table-columns:${pageKey}:${columnKeys}`
  }, [columnStorageKey, currentKeys, pageKey])

  useEffect(() => {
    if (!resolvedStorageKey || typeof window === 'undefined') return
    setWidthUnit(fluid ? 'percent' : 'px')
    try {
      const raw = window.localStorage.getItem(resolvedStorageKey)
      if (!raw) {
        setColumnOrder(currentKeys)
        setColumnWidths({})
        return
      }
      const saved = JSON.parse(raw)
      if (Array.isArray(saved)) {
        const merged = [
          ...saved.filter((key): key is string => typeof key === 'string' && currentKeys.includes(key)),
          ...currentKeys.filter(key => !saved.includes(key)),
        ]
        setColumnOrder([...new Set(merged)])
        setColumnWidths({})
        return
      }
      if (!saved || typeof saved !== 'object') {
        setColumnOrder(currentKeys)
        setColumnWidths({})
        return
      }
      const savedOrder = Array.isArray(saved.order) ? saved.order : []
      const merged = [
        ...savedOrder.filter((key: unknown): key is string => typeof key === 'string' && currentKeys.includes(key)),
        ...currentKeys.filter(key => !savedOrder.includes(key)),
      ]
      setColumnOrder([...new Set(merged)])
      const widths = saved.widths && typeof saved.widths === 'object'
        ? Object.fromEntries(
            Object.entries(saved.widths).filter(
              ([key, value]) => currentKeys.includes(key) && typeof value === 'number' && Number.isFinite(value) && value > 0,
            ),
          )
        : {}
      setColumnWidths(widths as Record<string, number>)
      if (saved.widthUnit === 'px') setWidthUnit('px')
    } catch {
      setColumnOrder(currentKeys)
      setColumnWidths({})
    }
  }, [currentKeys, resolvedStorageKey, fluid])

  const orderedColumns = useMemo(() => {
    if (!columnOrder.length) return columns
    const byKey = new Map(columns.map(col => [String(col.key), col]))
    const merged = [
      ...columnOrder.map(key => byKey.get(key)).filter((col): col is TableColumn<T> => !!col),
      ...columns.filter(col => !columnOrder.includes(String(col.key))),
    ]
    return merged
  }, [columnOrder, columns])

  useEffect(() => () => resizeCleanupRef.current?.(), [currentKeys, resolvedStorageKey, fluid])

  const persistLayout = (nextOrder: string[], nextWidths: Record<string, number>, nextUnit = widthUnit) => {
    setColumnOrder(nextOrder)
    setColumnWidths(nextWidths)
    setWidthUnit(nextUnit)
    if (!resolvedStorageKey || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(resolvedStorageKey, JSON.stringify({ order: nextOrder, widths: nextWidths, widthUnit: nextUnit }))
    } catch {
      // 存储被禁用或配额不足时，本次页面内仍可正常调整。
    }
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

  const getColumnWidth = useCallback((col: TableColumn<T>) => {
    const key = String(col.key)
    const fallback = usesPercent ? 100 / (columns.length || 1) : (isAction(key, col.title) ? 180 : 160)
    // 比例表在手动模式新增列时，百分比默认值不能被当作几个像素。
    const width = columnWidths[key] ?? (fluid && !usesPercent ? fallback : col.width) ?? fallback
    const parsed = Number.parseFloat(String(width))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }, [columnWidths, fluid, usesPercent, columns])

  const isSelectEnabled = !!(selectable || selectionMode)
  const hasCustomWidths = Object.keys(columnWidths).length > 0
  const tableWidth = orderedColumns.reduce((sum, col) => sum + getColumnWidth(col), isSelectEnabled ? 56 : 0)

  const measureWidths = () => {
    const elements = Array.from(colgroupRef.current?.querySelectorAll('col') ?? []).slice(isSelectEnabled ? 1 : 0)
    return Object.fromEntries(orderedColumns.map((col, index) => [String(col.key), elements[index]?.getBoundingClientRect().width || getColumnWidth(col)]))
  }

  const savePixelWidths = (widths: Record<string, number>) => {
    persistLayout(columnOrder.length ? columnOrder : currentKeys, widths, 'px')
  }

  const startResize = (event: ReactMouseEvent, col: TableColumn<T>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.button !== 0) return
    resizeCleanupRef.current?.()
    const table = tableRef.current
    if (!table) return
    const key = String(col.key)
    const snapshot = measureWidths()
    const colElements = Array.from(colgroupRef.current?.querySelectorAll('col') ?? []).slice(isSelectEnabled ? 1 : 0)
    const originalStyles = colElements.map(element => element.style.width)
    const originalWidth = table.style.width
    const originalMinWidth = table.style.minWidth
    const handle = event.currentTarget as HTMLButtonElement
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    const startX = event.clientX
    let targetWidth = snapshot[key]
    let frame: number | null = null
    let changed = false

    // 只在动画帧中更新 colgroup/table；不会随鼠标移动重新执行所有行的 render。
    const preview = () => {
      frame = null
      table.style.minWidth = '0px'
      table.style.width = `${Object.values(snapshot).reduce((sum, width) => sum + width, isSelectEnabled ? 56 : 0) + targetWidth - snapshot[key]}px`
      colElements.forEach((element, index) => {
        const columnKey = String(orderedColumns[index].key)
        element.style.width = `${columnKey === key ? targetWidth : snapshot[columnKey]}px`
      })
    }
    const updateTarget = (clientX: number) => {
      targetWidth = Math.max(80, Math.round(snapshot[key] + clientX - startX))
      changed = targetWidth !== snapshot[key]
    }
    const cleanup = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('blur', cancel)
      table.style.width = originalWidth
      table.style.minWidth = originalMinWidth
      colElements.forEach((element, index) => { element.style.width = originalStyles[index] })
      delete handle.dataset.resizing
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      resizeCleanupRef.current = null
    }
    const cancel = () => cleanup()
    const handleKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); cancel() }
    }
    const handleMove = (moveEvent: MouseEvent) => {
      updateTarget(moveEvent.clientX)
      if (frame === null) frame = window.requestAnimationFrame(preview)
    }
    const handleUp = (upEvent: MouseEvent) => {
      updateTarget(upEvent.clientX)
      cleanup()
      if (changed) savePixelWidths({ ...snapshot, [key]: targetWidth })
    }
    resizeCleanupRef.current = cleanup
    handle.dataset.resizing = 'true'
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('keydown', handleKey)
    window.addEventListener('blur', cancel)
  }

  const fitColumn = (col: TableColumn<T>) => {
    resizeCleanupRef.current?.()
    const index = orderedColumns.findIndex(item => item.key === col.key) + (isSelectEnabled ? 1 : 0)
    const snapshot = measureWidths()
    let width = 80
    // 双击时才测量已加载内容；临时使用自然宽度，支持被 truncate 截断的文字和表单控件。
    for (const row of Array.from(tableRef.current?.rows ?? [])) {
      const cell = row.cells[index]
      if (!cell || cell.colSpan > 1) continue
      const content = cell.firstElementChild as HTMLElement | null
      if (!content) continue
      const previous = content.style.cssText
      try {
        content.style.width = 'max-content'
        content.style.maxWidth = 'none'
        content.style.whiteSpace = 'nowrap'
        // scrollWidth 为整数，额外留 4px 避免小数像素和字体渲染造成刚好换行。
        width = Math.max(width, Math.max(content.scrollWidth, content.getBoundingClientRect().width) + 36)
      } finally {
        content.style.cssText = previous
      }
    }
    // 超长备注仍换行，避免一次适配生成数千像素的列；手动拖动不设此上限。
    savePixelWidths({ ...snapshot, [String(col.key)]: Math.min(800, Math.ceil(width)) })
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
      <div className="flex justify-end border-b border-border/60 px-2 py-1">
        <button type="button" aria-label="恢复默认列宽" disabled={!hasCustomWidths}
          onClick={() => { resizeCleanupRef.current?.(); persistLayout(columnOrder.length ? columnOrder : currentKeys, {}, fluid ? 'percent' : 'px') }}
          className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-40">
          <RotateCcw className="h-3.5 w-3.5" />恢复默认列宽
        </button>
      </div>
      <div className="overflow-x-auto">
        <table ref={tableRef} aria-busy={loading} className="table-fixed text-sm" style={usesPercent ? { width: '100%' } : { width: tableWidth, minWidth: hasCustomWidths ? 0 : '100%' }}>
          <colgroup ref={colgroupRef}>
            {isSelectEnabled && <col style={{ width: 56 }} />}
            {orderedColumns.map(col => (
              <col key={String(col.key)} style={{ width: usesPercent ? `${getColumnWidth(col)}%` : getColumnWidth(col) }} />
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
                  onDragStart={event => { if (resizeCleanupRef.current) event.preventDefault(); else setDraggingKey(String(col.key)) }}
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
                      ? 'sticky right-0 z-20 min-w-[180px] bg-muted shadow-[-12px_0_16px_-12px_rgba(0,0,0,0.12)]'
                      : 'relative cursor-move select-none'
                  }`}
                >
                  <div className="group flex items-center gap-2">
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        aria-label={`按${col.title}排序`}
                        onClick={() => onSortChange(String(col.key))}
                        className={`min-w-0 flex-1 truncate transition-colors hover:text-foreground ${
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                        } ${sortKey === String(col.key) ? 'text-primary' : ''}`}
                        title={col.title}
                      >
                        {col.title} {sortKey === String(col.key) ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    ) : (
                      <span
                        className={`min-w-0 flex-1 truncate ${
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
                        title="拖动调整列宽，双击适应内容；方向键微调，Enter 适应内容"
                        draggable={false}
                        onClick={event => { event.preventDefault(); event.stopPropagation() }}
                        onDoubleClick={event => { event.stopPropagation(); fitColumn(col) }}
                        onKeyDown={event => {
                          if (event.key === 'Enter') { event.preventDefault(); fitColumn(col) }
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            event.preventDefault(); event.stopPropagation()
                            const widths = measureWidths()
                            const key = String(col.key)
                            savePixelWidths({ ...widths, [key]: Math.max(80, widths[key] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10)) })
                          }
                        }}
                        className="group/resize absolute inset-y-0 right-0 z-30 flex w-3 cursor-col-resize items-center justify-end touch-none hover:bg-primary/10 focus-visible:outline-none focus-visible:bg-primary/10 data-[resizing=true]:bg-primary/15"
                      >
                        <span className="pointer-events-none h-full w-px bg-border group-hover/resize:w-0.5 group-hover/resize:bg-primary group-focus-visible/resize:bg-primary group-data-[resizing=true]/resize:w-0.5 group-data-[resizing=true]/resize:bg-primary" />
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
              data.map((row, rowIndex) => {
                const rowId = Number((row as Record<string, unknown>)[String(rowKey)])
                const isSelected = selectedIds?.has(rowId) ?? false
                const rowSelectable = selectableCheck ? selectableCheck(row) : true
                return (
                  <tr
                    key={String(row[rowKey])}
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                    className={`group min-h-12 border-b border-border/70 last:border-0 transition-colors ${
                      isSelected ? 'bg-primary/[0.07]' : 'hover:bg-muted/30'
                    } ${onRowDoubleClick ? 'cursor-pointer' : ''}`}
                  >
                    {isSelectEnabled && (
                      <td className="px-4">
                        <input
                          type="checkbox"
                          aria-label={`选择第 ${rowIndex + 1} 行`}
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
                      >
                        {isAction(String(col.key), col.title)
                          ? (col.render ? (col.render(rawValue, row) as ReactNode) : textValue)
                          : (
                            <div className={`${col.render ? 'min-w-0 whitespace-normal break-words' : 'truncate'} ${alignClass}`} title={textValue}>
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
