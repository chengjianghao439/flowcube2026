import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { TableColumn } from '@/types'

export function isAction(key: string, title: string): boolean { return key === 'actions' || title === '操作' }

/** 列布局持久化及鼠标/键盘交互；不负责行数据呈现。 */
export function useTableColumns<T extends object>({columns, fluid, columnStorageKey, isSelectEnabled, fitData = []}: {columns: TableColumn<T>[]; fluid: boolean; columnStorageKey?: string; isSelectEnabled: boolean; fitData?: T[]}) {
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
    // 双击时才测量已加载内容；临时使用自然宽度，支持换行文字和表单控件。
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
    // 虚拟行不在 DOM 中，基础文本仍从完整数据测量；复合控件沿用上面的实际 DOM 测量。
    if (fitData.length) {
      const context = document.createElement('canvas').getContext('2d')
      if (context) {
        context.font = tableRef.current ? window.getComputedStyle(tableRef.current).font || '14px sans-serif' : '14px sans-serif'
        for (const row of fitData) {
          const value = (row as Record<string, unknown>)[String(col.key)]
          if (typeof value === 'string' || typeof value === 'number') {
            for (const line of String(value).split('\n')) width = Math.max(width, context.measureText(line).width + 36)
          }
        }
      }
    }
    // 超长备注仍换行，避免一次适配生成数千像素的列；手动拖动不设此上限。
    savePixelWidths({ ...snapshot, [String(col.key)]: Math.min(800, Math.ceil(width)) })
  }

  return { orderedColumns, usesPercent, getColumnWidth, colgroupRef, tableRef, tableWidth, hasCustomWidths, setDraggingKey, draggingKey, moveColumn, startResize, fitColumn, resizeCleanupRef, measureWidths, savePixelWidths }
}
